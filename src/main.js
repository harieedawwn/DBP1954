window.G = window.G || {};

// main.js: renderer, loop, player controller, collision, hit resolution, UI and game flow.
(function () {
  'use strict';

  const CFG = G.CFG;
  const P = CFG.player;
  const C = CFG.combat;
  const V3 = THREE.Vector3;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  // ---------------------------------------------------------------- errors / audio
  const errors = [];
  function report(where, e) {
    const msg = where + ': ' + (e && e.stack ? e.stack : e);
    if (errors.length < 20) errors.push(msg);
    if (errors.length <= 3) console.error(msg);
  }
  function snd(name, opts) {
    try { if (G.Audio) G.Audio.play(name, opts); } catch (e) { report('audio ' + name, e); }
  }
  function loopSnd(name, on) {
    try { if (G.Audio) G.Audio.loop(name, on); } catch (e) { report('audio loop', e); }
  }

  // ---------------------------------------------------------------- state
  const S = { state: 'boot', screen: null, busy: false, diff: CFG.defaultDifficulty, ready: false, prevScreen: 'menu' };
  const keys = { f: false, b: false, l: false, r: false, shift: false, crouch: false, fire: false, ads: false, e: false };
  const pulses = { jump: false, reload: false, use: false };

  let canvas, renderer, camera, scene, map, weapon, enemies, colliders = [];
  let worldDirty = true;
  let viewScene = null;
  let lastTs = 0;
  let menuTime = 0;

  const player = {
    pos: new V3(),          // eye position (read by enemies)
    feet: new V3(),
    vel: new V3(),
    yaw: 0, pitch: 0,
    health: 100, maxHealth: 100,
    alive: true,
    onGround: true,
    crouch: 0,
    eyeH: P.eyeHeight,
    damage(amount, fromPos) { damagePlayer(amount, fromPos); }
  };

  let run = null;
  function newRun() {
    return {
      t: 0, sinceDamage: 99, dmgFlash: 0, shake: 0, lastHurtSnd: -9,
      stats: { time: 0, shots: 0, hits: 0, kills: 0, headshots: 0 },
      cleared: false, hold: 0, ending: null,
      stepOff: 0, bobPhase: 0, stepCount: 0, bobAmp: 0, bobY: 0, bobX: 0, roll: 0,
      deathDrop: 0, spread: 6, bloom: 0, sprinting: false, hSpeed: 0,
      crates: [], hitT: 0, hitKill: false, fade: 1, toastT: 0, dirs: [],
      lastAlive: -1, lastObjState: ''
    };
  }
  run = newRun();

  // ---------------------------------------------------------------- DOM helpers
  const ui = {};
  const screens = {};

  function h(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function setText(el, t) {
    t = String(t);
    if (el._t !== t) { el._t = t; el.textContent = t; }
  }
  function setStyle(el, prop, v) {
    if (el._s === undefined) el._s = {};
    if (el._s[prop] !== v) { el._s[prop] = v; el.style[prop] = v; }
  }
  function toggle(el, cls, on) {
    if (el._c === undefined) el._c = {};
    if (el._c[cls] !== on) { el._c[cls] = on; el.classList.toggle(cls, on); }
  }

  function buildUI() {
    const root = document.getElementById('ui');
    ui.root = root;

    // ----- HUD
    const hud = ui.hud = h('div', 'layer', null, root);
    hud.style.display = 'none';

    const hp = h('div', 'panel hud-hp', null, hud);
    const hr = h('div', 'hrow', null, hp);
    h('span', 'lbl cond', 'Sức khỏe', hr);
    ui.hpNum = h('span', 'num cond', '100', hr);
    const bar = h('div', 'bar', null, hp);
    ui.hpFill = h('div', 'fill', null, bar);

    const am = h('div', 'panel hud-ammo', null, hud);
    h('div', 'lbl cond', 'Đạn', am);
    const ar = h('div', 'arow', null, am);
    ui.ammoMag = h('span', 'mag cond', '0', ar);
    ui.ammoRes = h('span', 'res cond', '/ 0', ar);
    ui.ammoNote = h('div', 'note cond', '', am);

    const ob = h('div', 'panel hud-obj', null, hud);
    h('div', 'lbl cond', 'Nhiệm vụ', ob);
    ui.objTitle = h('div', 'otitle', '', ob);
    ui.objLine = h('div', 'oline cond', '', ob);

    const pr = ui.promptBox = h('div', 'panel hud-prompt', null, hud);
    pr.style.display = 'none';
    ui.promptText = h('div', 'ptext cond', '', pr);
    ui.holdWrap = h('div', 'bar hold', null, pr);
    ui.holdFill = h('div', 'fill', null, ui.holdWrap);

    ui.toast = h('div', 'toast cond', '', hud);

    ui.cross = h('div', 'cross', null, hud);
    ui.ticks = [];
    for (let i = 0; i < 4; i++) ui.ticks.push(h('div', 'tick ' + (i < 2 ? 'v' : 'hz'), null, ui.cross));
    h('div', 'dot', null, ui.cross);

    ui.hm = h('div', 'hm', null, hud);
    for (let i = 0; i < 4; i++) {
      const l = h('div', 'hl', null, ui.hm);
      l.style.transform = 'rotate(' + (45 + i * 90) + 'deg) translateX(7px)';
    }

    // ----- effects layer
    const fx = ui.fx = h('div', 'layer', null, root);
    ui.vig = h('div', 'vig', null, fx);
    ui.dirs = [];
    for (let i = 0; i < 6; i++) {
      const w = h('div', 'dirwrap', null, fx);
      h('div', 'dirmark', null, w);
      w.style.opacity = '0';
      ui.dirs.push(w);
    }
    ui.fade = h('div', 'fade', null, fx);

    // ----- screens
    buildMenuScreen();
    buildControlsScreen();
    buildBriefingScreen();
    buildPauseScreen();
    buildDeadScreen();
    buildWinScreen();

    // ----- loading overlay
    const ld = ui.loading = h('div', 'screen on loading', null, root);
    const lp = h('div', 'panel box', null, ld);
    ui.loadText = h('div', 'cond ltxt', 'Đang tải…', lp);
    ld.style.display = 'none';
  }

  function makeScreen(name, cls) {
    const el = h('div', 'screen ' + (cls || ''), null, ui.root);
    const scr = { name, root: el, menu: null, onBack: null };
    screens[name] = scr;
    return scr;
  }

  // items: [{label: fn, value?: fn, onSelect: fn, onAlt?: fn(dir)}]
  function makeMenu(scr, parent, items) {
    const m = { items, rows: [], sel: 0 };
    const box = h('div', 'menu', null, parent);
    items.forEach((it, i) => {
      const row = h('div', 'item cond', null, box);
      h('span', 'mark', '▶', row);
      const lab = h('span', 'lab', '', row);
      let vtxt = null;
      if (it.onAlt) {
        const val = h('span', 'val', null, row);
        const l = h('span', 'arr', '◄', val);
        vtxt = h('span', 'vtxt', '', val);
        const r = h('span', 'arr', '►', val);
        l.addEventListener('click', (e) => { e.stopPropagation(); m.select(i); m.alt(-1); });
        r.addEventListener('click', (e) => { e.stopPropagation(); m.select(i); m.alt(1); });
      }
      row.addEventListener('mouseenter', () => m.select(i));
      row.addEventListener('click', () => m.activate(i));
      m.rows.push({ row, lab, vtxt });
    });
    m.refresh = () => {
      items.forEach((it, i) => {
        const r = m.rows[i];
        setText(r.lab, it.label());
        if (r.vtxt) setText(r.vtxt, it.value());
        toggle(r.row, 'sel', i === m.sel);
      });
    };
    m.select = (i) => {
      if (i === m.sel) return;
      m.sel = i;
      snd('ui_move');
      m.refresh();
    };
    m.move = (d) => {
      m.select((m.sel + d + items.length) % items.length);
    };
    m.activate = (i) => {
      if (S.busy) return;
      m.sel = i;
      snd('ui_select');
      m.refresh();
      const it = items[i];
      if (it.onSelect) it.onSelect();
      else if (it.onAlt) it.onAlt(1);
    };
    m.alt = (d) => {
      const it = items[m.sel];
      if (it && it.onAlt && !S.busy) { snd('ui_move'); it.onAlt(d); m.refresh(); }
    };
    scr.menu = m;
    m.refresh();
    return m;
  }

  function buildMenuScreen() {
    const scr = makeScreen('menu', 'scr-menu');
    const col = h('div', 'col', null, scr.root);
    const t = h('div', 'title', null, col);
    h('div', 't1 cond', 'Điện Biên Phủ', t);
    h('div', 't2 cond', '1954', t);
    h('div', 'tsub cond', '★  Nhiệm vụ cuối cùng  ★', t);
    const panel = h('div', 'panel box', null, col);
    makeMenu(scr, panel, [
      { label: () => 'Bắt đầu', onSelect: startBriefing },
      {
        label: () => 'Độ khó',
        value: () => CFG.difficulty[S.diff].label,
        onAlt: (d) => {
          const o = CFG.difficultyOrder;
          S.diff = o[(o.indexOf(S.diff) + d + o.length) % o.length];
        }
      },
      {
        label: () => 'Đồ họa',
        value: () => GFX[gfx].label,
        onAlt: (d) => cycleGfx(d)
      },
      {
        label: () => 'Âm lượng',
        value: () => String(Math.round(G.Audio.getVolume('master') * 10)),
        onAlt: (d) => G.Audio.setVolume('master', Math.round(G.Audio.getVolume('master') * 10 + d) / 10)
      },
      {
        label: () => 'Âm môi trường',
        value: () => String(Math.round(G.Audio.getVolume('ambience') * 10)),
        onAlt: (d) => G.Audio.setVolume('ambience', Math.round(G.Audio.getVolume('ambience') * 10 + d) / 10)
      },
      { label: () => 'Điều khiển', onSelect: () => openControls('menu') }
    ]);
    h('div', 'foot', '↑ ↓ chọn   ← → thay đổi   Enter xác nhận', scr.root);
  }

  function buildControlsScreen() {
    const scr = makeScreen('controls', 'scr-dim');
    const panel = h('div', 'panel box wide', null, scr.root);
    h('div', 'htitle cond', 'Điều khiển', panel);
    const rows = [
      ['W A S D', 'Di chuyển'],
      ['Chuột', 'Nhìn / ngắm'],
      ['Chuột trái', 'Bắn'],
      ['Chuột phải', 'Ngắm qua thước ngắm'],
      ['Shift', 'Chạy nhanh'],
      ['Ctrl  hoặc  C', 'Cúi thấp'],
      ['Space', 'Nhảy'],
      ['R', 'Nạp đạn'],
      ['E', 'Lấy đạn / giữ để kéo cờ'],
      ['Esc', 'Tạm dừng']
    ];
    const list = h('div', 'ctl', null, panel);
    rows.forEach((r) => {
      const row = h('div', 'crow', null, list);
      h('span', 'ck cond', r[0], row);
      h('span', 'cv', r[1], row);
    });
    makeMenu(scr, panel, [{ label: () => 'Quay lại', onSelect: closeControls }]);
    scr.onBack = closeControls;
  }

  function buildBriefingScreen() {
    const scr = makeScreen('briefing', 'scr-dim');
    const panel = h('div', 'panel box wide', null, scr.root);
    h('div', 'htitle cond', 'Chỉ thị nhiệm vụ', panel);
    [
      'Điện Biên Phủ, tháng 5 năm 1954. Chiến dịch bước vào ngày quyết định.',
      'Đồng đội đã vượt qua hệ thống giao thông hào. Cứ điểm cuối cùng nằm ở phía bắc.',
      'Nhiệm vụ: tiêu diệt toàn bộ quân địch trong cứ điểm.',
      'Sau đó tiến vào hầm chỉ huy và kéo cờ lên mái hầm.'
    ].forEach((line, i) => {
      const p = h('div', 'brief', null, panel);
      h('span', 'bn cond', String(i + 1), p);
      h('span', 'bt', line, p);
    });
    makeMenu(scr, panel, [
      { label: () => (S.ready ? 'Tiến vào trận địa' : 'Đang chuẩn bị…'), onSelect: () => { if (S.ready) beginRun(); } }
    ]);
    scr.onBack = () => { S.ready = false; goMenu(); };
  }

  function buildPauseScreen() {
    const scr = makeScreen('pause', 'scr-dim');
    const panel = h('div', 'panel box', null, scr.root);
    h('div', 'htitle cond', 'Tạm dừng', panel);
    makeMenu(scr, panel, [
      { label: () => 'Tiếp tục', onSelect: resumeGame },
      {
        label: () => 'Đồ họa',
        value: () => GFX[gfx].label,
        onAlt: (d) => cycleGfx(d)
      },
      {
        label: () => 'Âm lượng',
        value: () => String(Math.round(G.Audio.getVolume('master') * 10)),
        onAlt: (d) => G.Audio.setVolume('master', Math.round(G.Audio.getVolume('master') * 10 + d) / 10)
      },
      {
        label: () => 'Âm môi trường',
        value: () => String(Math.round(G.Audio.getVolume('ambience') * 10)),
        onAlt: (d) => G.Audio.setVolume('ambience', Math.round(G.Audio.getVolume('ambience') * 10 + d) / 10)
      },
      { label: () => 'Điều khiển', onSelect: () => openControls('pause') },
      { label: () => 'Về menu chính', onSelect: goMenu }
    ]);
    scr.onBack = resumeGame;
  }

  function buildDeadScreen() {
    const scr = makeScreen('dead', 'scr-dead');
    const panel = h('div', 'panel box wide', null, scr.root);
    h('div', 'htitle cond bad', 'Thất bại', panel);
    h('div', 'msg', 'Bạn đã ngã xuống. Nhiệm vụ chưa hoàn thành.', panel);
    ui.deadStats = h('div', 'stats', null, panel);
    makeMenu(scr, panel, [
      { label: () => 'Thử lại', onSelect: retryRun },
      { label: () => 'Về menu chính', onSelect: goMenu }
    ]);
  }

  function buildWinScreen() {
    const scr = makeScreen('win', 'scr-dim');
    const panel = h('div', 'panel box wide', null, scr.root);
    h('div', 'htitle cond good', 'Hoàn thành', panel);
    h('div', 'msg', 'Cờ đã tung bay trên hầm chỉ huy. Cứ điểm đã được làm chủ.', panel);
    ui.winStats = h('div', 'stats', null, panel);
    makeMenu(scr, panel, [
      { label: () => 'Chơi lại', onSelect: retryRun },
      { label: () => 'Về menu chính', onSelect: goMenu }
    ]);
  }

  function fillStats(el, withTime) {
    const st = run.stats;
    const acc = st.shots > 0 ? Math.round((st.hits / st.shots) * 100) : 0;
    const rows = [];
    if (withTime) rows.push(['Thời gian', fmtTime(st.time)]);
    rows.push(['Tiêu diệt', String(st.kills)]);
    rows.push(['Bắn trúng đầu', String(st.headshots)]);
    rows.push(['Độ chính xác', acc + '%']);
    rows.push(['Độ khó', CFG.difficulty[S.diff].label]);
    el.textContent = '';
    rows.forEach((r) => {
      const row = h('div', 'srow', null, el);
      h('span', 'sk cond', r[0], row);
      h('span', 'sd', null, row);
      h('span', 'sv cond', r[1], row);
    });
  }

  function showScreen(name, keepSel) {
    for (const k in screens) screens[k].root.classList.toggle('on', k === name);
    S.screen = name;
    const scr = name && screens[name];
    if (scr && scr.menu) { if (!keepSel) scr.menu.sel = 0; scr.menu.refresh(); }
  }

  function setBusy(on, text) {
    S.busy = on;
    if (text) ui.loadText.textContent = text;
    ui.loading.style.display = on ? 'flex' : 'none';
  }

  // ---------------------------------------------------------------- world / run lifecycle
  function disposeScene(sc) {
    if (!sc) return;
    sc.traverse((o) => {
      try {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        const m = o.material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose && x.dispose());
      } catch (e) { /* ignore */ }
    });
  }

  function rebuildWorldNow() {
    disposeScene(scene);
    disposeScene(viewScene);
    viewScene = null; weapon = null; enemies = null;
    scene = new THREE.Scene();
    map = G.Map.build(scene);
    colliders = map.colliders || [];
    if (map.sun) { const sz = GFX[gfx].size; map.sun.shadow.mapSize.set(sz, sz); }
    if (G.Realism) { try { G.Realism.prepareWorld(scene, renderer); } catch (e) { report('realism world', e); } }
    worldDirty = false;
  }

  function createRunObjects() {
    weapon = G.Weapon.create(scene);
    viewScene = weapon.viewScene;
    if (G.Realism) { try { G.Realism.prepareView(viewScene, renderer); } catch (e) { report('realism view', e); } }
    enemies = G.Enemies.create(scene, map, CFG.difficulty[S.diff]);
    worldDirty = true;
    if (weapon.viewCamera && weapon.viewCamera.isPerspectiveCamera !== false) onResize();
    resetRunState();
  }

  function resetRunState() {
    run = newRun();
    const diff = CFG.difficulty[S.diff];
    player.maxHealth = diff.playerHealth;
    player.health = diff.playerHealth;
    player.alive = true;
    player.crouch = 0;
    player.eyeH = P.eyeHeight;
    player.vel.set(0, 0, 0);
    const sp = map.playerStart;
    player.feet.set(sp.pos.x, map.groundHeightAt(sp.pos.x, sp.pos.z), sp.pos.z);
    player.yaw = sp.yaw || 0;
    player.pitch = 0;
    player.onGround = true;
    player.pos.set(player.feet.x, player.feet.y + player.eyeH, player.feet.z);
    run.crates = (map.ammoCrates || []).map((p) => ({ pos: p, cd: 0 }));
    for (const k in keys) keys[k] = false;
    for (const k in pulses) pulses[k] = false;
  }

  // After the busy overlay is painted, run fn.
  function deferred(text, fn) {
    setBusy(true, text);
    setTimeout(() => {
      try { fn(); } catch (e) { report('build', e); ui.loadText.textContent = 'Lỗi khi tải trận địa. Hãy tải lại trang.'; return; }
      setBusy(false);
    }, 40);
  }

  function ensureMenuWorld(done) {
    if (scene && !worldDirty) { if (done) done(); return; }
    deferred('Đang tải trận địa…', () => { rebuildWorldNow(); if (done) done(); });
  }

  function prepareRun(done) {
    deferred('Đang chuẩn bị trận địa…', () => {
      if (worldDirty || !scene) rebuildWorldNow();
      createRunObjects();
      if (done) done();
    });
  }

  function goMenu() {
    loopSnd('wind', false);
    exitLock();
    S.state = 'menu';
    S.ready = false;
    ui.hud.style.display = 'none';
    setStyle(ui.fade, 'opacity', '0');
    showScreen('menu');
    ensureMenuWorld();
  }

  function openControls(from) {
    S.prevScreen = from;
    showScreen('controls');
  }
  function closeControls() { showScreen(S.prevScreen, true); }

  function startBriefing() {
    S.state = 'briefing';
    S.ready = false;
    showScreen('briefing');
    prepareRun(() => {
      S.ready = true;
      if (S.screen === 'briefing') screens.briefing.menu.refresh();
    });
  }

  function retryRun() {
    loopSnd('wind', false);
    S.ready = false;
    showScreen(null);
    S.state = 'briefing'; // transitional: input ignored until play begins
    prepareRun(() => beginRun());
  }

  function beginRun() {
    S.state = 'play';
    showScreen(null);
    ui.hud.style.display = 'block';
    run.fade = 1;
    enemies.spawnAll();
    if (G.Realism) { try { G.Realism.upgrade(scene); } catch (e) { report('realism enemies', e); } }
    if (map.setFlagProgress) map.setFlagProgress(0);
    shadowT = 0;
    loopSnd('wind', true);
    requestLock();
  }

  function pauseGame() {
    if (S.state !== 'play') return;
    S.state = 'paused';
    for (const k in keys) keys[k] = false;
    loopSnd('wind', false);
    showScreen('pause');
  }

  function resumeGame() {
    if (S.state !== 'paused') return;
    S.state = 'play';
    showScreen(null);
    loopSnd('wind', true);
    requestLock();
  }

  function requestLock() {
    try {
      const r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => { if (S.state === 'play') pauseGame(); });
    } catch (e) { /* handled by pointerlockerror */ }
  }
  function exitLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ }
  }

  function die() {
    if (run.ending) return;
    player.alive = false;
    run.ending = { type: 'dead', t: 0 };
    keys.fire = false; keys.ads = false;
  }

  function winRun() {
    if (run.ending) return;
    run.ending = { type: 'win', t: 0 };
    keys.fire = false; keys.ads = false;
    snd('flag_raise');
    toast('Cờ đã được kéo lên!', 3);
  }

  function finishEnding() {
    const type = run.ending && run.ending.type;
    if (!type) return;
    loopSnd('wind', false);
    exitLock();
    ui.hud.style.display = 'none';
    S.state = type;
    if (type === 'dead') { fillStats(ui.deadStats, true); showScreen('dead'); }
    else { fillStats(ui.winStats, true); showScreen('win'); }
  }

  function damagePlayer(amount, fromPos) {
    if (S.state !== 'play' || !player.alive || run.ending || !(amount > 0)) return;
    player.health = Math.max(0, player.health - amount);
    run.sinceDamage = 0;
    run.dmgFlash = Math.min(1, run.dmgFlash + 0.3 + amount / 50);
    run.shake = Math.min(1, run.shake + amount / 35);
    if (fromPos) addDirIndicator(fromPos);
    if (run.t - run.lastHurtSnd > 0.4) { run.lastHurtSnd = run.t; snd('player_hurt'); }
    if (player.health <= 0) die();
  }

  function addDirIndicator(from) {
    let dx = from.x - player.pos.x, dz = from.z - player.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    dx /= len; dz /= len;
    let slot = null;
    for (const d of run.dirs) {
      if (d.life > 0 && d.dx * dx + d.dz * dz > 0.96) { slot = d; break; }
    }
    if (!slot) slot = run.dirs.find((d) => d.life <= 0) || null;
    if (!slot) {
      if (run.dirs.length < ui.dirs.length) { slot = { el: ui.dirs[run.dirs.length], life: 0, dx, dz }; run.dirs.push(slot); }
      else slot = run.dirs.reduce((a, b) => (a.life < b.life ? a : b)); // oldest / expired first
    }
    slot.dx = dx; slot.dz = dz; slot.life = 1.6;
  }

  function toast(text, secs) {
    ui.toast.textContent = text;
    run.toastT = secs || 4;
  }

  // ---------------------------------------------------------------- collision
  function resolveXZ(p, r, height) {
    const y0 = p.y + P.stepHeight, y1 = p.y + height;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (b.max.y <= y0 || b.min.y >= y1) continue;
        if (p.x < b.min.x - r || p.x > b.max.x + r || p.z < b.min.z - r || p.z > b.max.z + r) continue;
        const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          p.x += dx * k; p.z += dz * k;
        } else {
          const l = p.x - b.min.x + r, rr = b.max.x - p.x + r, t = p.z - b.min.z + r, bt = b.max.z - p.z + r;
          const m = Math.min(l, rr, t, bt);
          if (m === l) p.x = b.min.x - r;
          else if (m === rr) p.x = b.max.x + r;
          else if (m === t) p.z = b.min.z - r;
          else p.z = b.max.z + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  function supportHeight(x, z, feetY) {
    let top = map.groundHeightAt(x, z);
    const lim = feetY + P.stepHeight, e = 0.1;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (b.max.y > lim || b.max.y <= top) continue;
      if (x < b.min.x - e || x > b.max.x + e || z < b.min.z - e || z > b.max.z + e) continue;
      top = b.max.y;
    }
    return top;
  }

  function headroomBlocked(feet, h) {
    const r = P.radius * 0.8, y0 = feet.y + P.stepHeight, y1 = feet.y + h;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (b.max.y <= y0 || b.min.y >= y1) continue;
      if (feet.x < b.min.x - r || feet.x > b.max.x + r || feet.z < b.min.z - r || feet.z > b.max.z + r) continue;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- player controller
  function updatePlayer(dt) {
    const f = player.feet;
    const adsAmt = weapon ? weapon.adsAmount() : 0;

    // crouch
    if (keys.crouch) player.crouch = approach(player.crouch, 1, dt * P.crouchRate);
    else if (player.crouch > 0 && !headroomBlocked(f, P.height)) player.crouch = approach(player.crouch, 0, dt * P.crouchRate);
    const height = lerp(P.height, P.crouchHeight, player.crouch);
    player.eyeH = lerp(P.eyeHeight, P.crouchEyeHeight, player.crouch);

    // wish direction
    const fin = (keys.f ? 1 : 0) - (keys.b ? 1 : 0);
    const rin = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    let wx = -sy * fin + cy * rin, wz = -cy * fin - sy * rin;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    const sprint = keys.shift && fin > 0 && player.crouch < 0.3 && !keys.ads && player.onGround;
    let speed = sprint ? P.sprintSpeed : lerp(P.walkSpeed, P.crouchSpeed, player.crouch);
    if (fin < 0) speed *= P.backMul;
    speed *= lerp(1, P.adsSpeedMul, adsAmt);
    const acc = (player.onGround ? P.groundAccel : P.airAccel) * dt;
    player.vel.x = approach(player.vel.x, wx * speed, acc);
    player.vel.z = approach(player.vel.z, wz * speed, acc);

    // horizontal move with sub-steps
    const ox = f.x, oz = f.z;
    const mx = player.vel.x * dt, mz = player.vel.z * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (P.radius * 0.5)));
    for (let i = 0; i < n; i++) {
      f.x += mx / n; f.z += mz / n;
      resolveXZ(f, P.radius, height);
    }
    f.x = clamp(f.x, P.bounds.minX, P.bounds.maxX);
    f.z = clamp(f.z, P.bounds.minZ, P.bounds.maxZ);
    const hSpeed = Math.hypot(f.x - ox, f.z - oz) / Math.max(dt, 1e-4);
    run.hSpeed = hSpeed;
    run.sprinting = sprint && hSpeed > 1;

    // jump
    if (pulses.jump && player.onGround && player.crouch < 0.5) {
      player.vel.y = P.jumpSpeed;
      player.onGround = false;
    }
    pulses.jump = false;

    // vertical
    const oldY = f.y;
    player.vel.y -= P.gravity * dt;
    f.y += player.vel.y * dt;
    if (player.vel.y > 0) {
      const head = f.y + height, r = P.radius * 0.8;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (b.min.y < oldY + height - 0.01 || b.min.y > head) continue;
        if (f.x < b.min.x - r || f.x > b.max.x + r || f.z < b.min.z - r || f.z > b.max.z + r) continue;
        f.y = b.min.y - height; player.vel.y = 0; break;
      }
    }
    const sup = supportHeight(f.x, f.z, oldY);
    if (f.y <= sup && player.vel.y <= 0) {
      if (!player.onGround && player.vel.y < -4) snd('footstep', { volume: 1 });
      run.stepOff += oldY - sup;
      f.y = sup; player.vel.y = 0; player.onGround = true;
    } else if (player.onGround && player.vel.y <= 0 && f.y - sup <= P.stepDown) {
      run.stepOff += f.y - sup;
      f.y = sup; player.vel.y = 0;
    } else if (f.y > sup + 0.02) {
      player.onGround = false;
    }
    run.stepOff = approach(run.stepOff, 0, dt * 5);
    run.stepOff = clamp(run.stepOff, -0.6, 0.6);

    if (f.y < P.fallLimit) {
      const sp = map.playerStart;
      f.set(sp.pos.x, map.groundHeightAt(sp.pos.x, sp.pos.z), sp.pos.z);
      player.vel.set(0, 0, 0);
    }

    // head bob + footsteps
    const moving = player.onGround && hSpeed > 0.6;
    const B = P.bob;
    const baseAmp = run.sprinting ? B.sprintAmp : lerp(B.walkAmp, B.crouchAmp, player.crouch);
    const targetAmp = moving ? baseAmp * lerp(1, B.adsMul, adsAmt) : 0;
    run.bobAmp = approach(run.bobAmp, targetAmp, dt * 0.4);
    if (moving) {
      const stepLen = run.sprinting ? B.stepLenSprint : lerp(B.stepLenWalk, B.stepLenCrouch, player.crouch);
      run.bobPhase += (hSpeed * dt / stepLen) * Math.PI;
      const sc = Math.floor(run.bobPhase / Math.PI);
      if (sc !== run.stepCount) {
        run.stepCount = sc;
        snd('footstep', { volume: run.sprinting ? 1 : player.crouch > 0.5 ? 0.35 : 0.65 });
      }
    }
    run.bobY = -Math.abs(Math.sin(run.bobPhase)) * run.bobAmp;
    run.bobX = Math.sin(run.bobPhase * 0.5) * run.bobAmp * 0.7;
    run.roll = Math.sin(run.bobPhase * 0.5) * run.bobAmp * 0.08;

    player.pos.set(f.x, f.y + player.eyeH, f.z);
  }

  function setCamera(dt) {
    const adsAmt = weapon ? weapon.adsAmount() : 0;
    const fov = lerp(P.fov, P.adsFov, adsAmt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    const e = run.ending;
    let pitch = player.pitch, roll = run.roll, drop = 0;
    if (e && e.type === 'dead') {
      const k = clamp(e.t / 1.2, 0, 1), s = k * k * (3 - 2 * k);
      pitch = lerp(player.pitch, 0.25, s);
      roll = lerp(run.roll, 0.8, s);
      drop = s * (player.eyeH - 0.35);
    }
    run.shake = approach(run.shake, 0, dt * 2.5);
    const sh = run.shake * run.shake * 0.03;
    const shp = (Math.random() - 0.5) * 2 * sh, shy = (Math.random() - 0.5) * 2 * sh;

    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    camera.position.set(
      player.feet.x + cy * run.bobX,
      player.feet.y + player.eyeH + run.stepOff + run.bobY - drop,
      player.feet.z - sy * run.bobX
    );
    camera.rotation.set(pitch + shp, player.yaw + shy, roll);
    camera.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- hit resolution
  const ray = new THREE.Raycaster();
  const tmpN = new V3();

  function fireShot(origin, dir) {
    const st = run.stats;
    st.shots++;
    run.bloom = Math.min(14, run.bloom + 5);
    ray.set(origin, dir);
    ray.near = 0; ray.far = C.maxRange;
    const wh = ray.intersectObjects(map.raycastMeshes, false);
    const wall = wh.length ? wh[0] : null;
    const eh = enemies.hitTest(ray);
    enemies.alertAt(player.pos, C.alertRadius);

    if (eh && (!wall || eh.distance <= wall.distance)) {
      const mul = eh.part === 'head' ? C.headMul : eh.part === 'limb' ? C.limbMul : 1;
      const before = enemies.aliveCount();
      enemies.damage(eh.enemy, C.shotDamage * mul, eh.part, dir);
      st.hits++;
      const killed = enemies.aliveCount() < before;
      if (killed) { st.kills++; if (eh.part === 'head') st.headshots++; }
      run.hitT = killed ? 0.35 : 0.16;
      run.hitKill = killed;
      snd('hit_marker');
    } else if (wall) {
      if (wall.face && wall.object && wall.object.matrixWorld) tmpN.copy(wall.face.normal).transformDirection(wall.object.matrixWorld);
      else tmpN.copy(dir).multiplyScalar(-1);
      weapon.impact(wall.point, tmpN, (wall.object.userData && wall.object.userData.surface) || 'dirt');
    }
  }

  // ---------------------------------------------------------------- play update
  function updatePlay(dt) {
    run.t += dt;
    const e = run.ending;

    if (e) {
      e.t += dt;
      player.vel.x = approach(player.vel.x, 0, 30 * dt);
      player.vel.z = approach(player.vel.z, 0, 30 * dt);
    } else {
      run.stats.time += dt;
      run.sinceDamage += dt;
      updatePlayer(dt);
    }
    setCamera(dt);
    try { G.Audio.updateListener(camera); } catch (err) { report('listener', err); }

    // weapon
    if (!e) {
      const res = weapon.update(dt, {
        fire: keys.fire, ads: keys.ads && !run.sprinting, reload: pulses.reload,
        moving: run.hSpeed > 0.5 && player.onGround, sprinting: run.sprinting, camera
      });
      pulses.reload = false;
      if (res) {
        if (res.shots) for (let i = 0; i < res.shots.length; i++) fireShot(res.shots[i].origin, res.shots[i].dir);
        if (res.kick) {
          player.pitch = clamp(player.pitch + clamp(res.kick.pitch * C.kickScale, -0.15, 0.15), -P.pitchLimit, P.pitchLimit);
          player.yaw += clamp(res.kick.yaw * C.kickScale, -0.15, 0.15);
        }
      }
    }

    enemies.update(dt, player);

    // keep the sharp shadow area around the player; raise the flag with the hold
    shadowT -= dt;
    if (shadowT <= 0 && map.setShadowFocus) { shadowT = 0.5; map.setShadowFocus(player.feet, 60); }
    if (map.setFlagProgress) map.setFlagProgress(run.ending && run.ending.type === 'win' ? 1 : run.hold / CFG.objective.holdTime);

    if (!e) {
      // regeneration
      if (run.sinceDamage > CFG.regen.delay && player.health < player.maxHealth) {
        player.health = Math.min(player.maxHealth, player.health + CFG.regen.rate * dt);
      }
      updateInteractions(dt);
    } else if (e.type === 'dead' && e.t >= CFG.flow.deathScreenDelay) finishEnding();
    else if (e.type === 'win' && e.t >= CFG.flow.winScreenDelay) finishEnding();

    updateHUD(dt);
  }

  // short, diegetic-style hints: shown once per run, only when relevant
  function hints() {
    const H = run.hints || (run.hints = {});
    const once = (k, cond, text, secs) => { if (!H[k] && cond) { H[k] = 1; toast(text, secs || 5); } };
    const a = weapon.ammo();
    once('move', run.t > 1.5, 'W A S D di chuyển  ·  Shift chạy  ·  Chuột phải ngắm', 5);
    once('cover', run.t > 9, 'Địch nấp trong giao thông hào phía bắc. Ctrl để cúi thấp.', 5);
    once('hurt', player.health < player.maxHealth * 0.7, 'Tìm chỗ nấp. Không trúng đạn một lúc sẽ hồi sức.', 4);
    once('reload', a.mag <= 6 && !a.reloading, 'R: nạp đạn', 3);
    once('crate', a.reserve <= 40, 'Thiếu đạn: tìm hòm đạn ở các lán, đến gần nhấn E.', 5);
    once('back', run.t > 25, 'Cẩn thận phía sau: có địch luồn lách áp sát.', 4);
  }

  function updateInteractions(dt) {
    if (run.toastT <= 0) hints();
    const alive = enemies.aliveCount();
    if (alive === 0 && !run.cleared) {
      run.cleared = true;
      toast('Cứ điểm đã sạch bóng địch. Tiến vào hầm chỉ huy và kéo cờ.', 5);
    }

    let prompt = '';
    let showHold = false;

    // crates
    for (const c of run.crates) c.cd = Math.max(0, c.cd - dt);
    let near = null, nd = CFG.crate.range;
    for (const c of run.crates) {
      const d = Math.hypot(c.pos.x - player.feet.x, c.pos.z - player.feet.z);
      if (d < nd && Math.abs(c.pos.y - player.feet.y) < 2.5) { near = c; nd = d; }
    }
    if (near) {
      if (near.cd > 0) prompt = 'Hộp đạn đã cạn (' + Math.ceil(near.cd) + ' giây)';
      else {
        prompt = '[E]  Lấy đạn';
        if (pulses.use) {
          weapon.addAmmo(CFG.crate.ammo);
          near.cd = CFG.crate.cooldown;
          snd('reload_in');
          toast('Đã lấy ' + CFG.crate.ammo + ' viên đạn', 2);
        }
      }
    }

    // objective
    if (run.cleared) {
      const o = map.objective;
      const inside = Math.hypot(o.pos.x - player.feet.x, o.pos.z - player.feet.z) <= o.radius;
      if (inside && keys.e) run.hold += dt;
      else run.hold = Math.max(0, run.hold - dt * 2);
      if (inside || run.hold > 0) {
        prompt = 'Giữ [E] để kéo cờ';
        showHold = true;
      }
      if (run.hold >= CFG.objective.holdTime) { run.hold = CFG.objective.holdTime; winRun(); }
    } else run.hold = 0;
    pulses.use = false;

    run.prompt = prompt;
    run.showHold = showHold;
  }

  // ---------------------------------------------------------------- HUD
  function updateHUD(dt) {
    const pct = clamp(player.health / player.maxHealth, 0, 1);
    setText(ui.hpNum, Math.ceil(player.health));
    setStyle(ui.hpFill, 'width', (pct * 100).toFixed(1) + '%');
    toggle(ui.hpFill, 'mid', pct <= 0.5 && pct > 0.25);
    toggle(ui.hpFill, 'low', pct <= 0.25);

    const a = weapon.ammo();
    setText(ui.ammoMag, a.mag);
    setText(ui.ammoRes, '/ ' + a.reserve);
    toggle(ui.ammoMag, 'low', a.mag <= 5);
    let note = '';
    if (a.reloading) note = 'Đang nạp đạn';
    else if (a.mag === 0 && a.reserve > 0) note = 'Nạp đạn [R]';
    else if (a.mag === 0) note = 'Hết đạn: tìm hộp đạn';
    setText(ui.ammoNote, note);

    const alive = enemies.aliveCount(), total = enemies.totalCount();
    const os = run.cleared ? 'clear' : 'fight';
    if (os !== run.lastObjState) {
      run.lastObjState = os;
      setText(ui.objTitle, run.cleared ? 'Kéo cờ lên mái hầm chỉ huy' : 'Tiêu diệt toàn bộ quân địch');
    }
    if (run.cleared) {
      const o = map.objective.pos, dist = Math.round(Math.hypot(o.x - player.feet.x, o.z - player.feet.z));
      setText(ui.objLine, 'Hầm chỉ huy: ' + dist + ' m về phía bắc');
    } else setText(ui.objLine, 'Địch còn lại: ' + alive + ' / ' + total);

    // prompt + hold bar
    const ptxt = run.prompt || '';
    ui.promptBox.style.display = ptxt ? 'block' : 'none';
    setText(ui.promptText, ptxt);
    ui.holdWrap.style.display = run.showHold ? 'block' : 'none';
    setStyle(ui.holdFill, 'width', (clamp(run.hold / CFG.objective.holdTime, 0, 1) * 100).toFixed(1) + '%');

    // toast
    run.toastT = Math.max(0, run.toastT - dt);
    setStyle(ui.toast, 'opacity', run.toastT > 0 ? String(Math.min(1, run.toastT)) : '0');

    // crosshair
    const adsAmt = weapon.adsAmount();
    run.bloom = Math.max(0, run.bloom - 30 * dt);
    let target = Math.min(run.hSpeed, 7) / 7 * 8 + (run.sprinting ? 6 : 0) + (player.onGround ? 0 : 10) + run.bloom - player.crouch * 2;
    target *= 1 - 0.7 * adsAmt;
    run.spread = lerp(run.spread, 5 + Math.max(0, target), 1 - Math.exp(-18 * dt));
    const g = run.spread.toFixed(1);
    ui.ticks[0].style.transform = 'translateY(' + (-g - 7) + 'px)';
    ui.ticks[1].style.transform = 'translateY(' + g + 'px)';
    ui.ticks[2].style.transform = 'translateX(' + (-g - 7) + 'px)';
    ui.ticks[3].style.transform = 'translateX(' + g + 'px)';
    setStyle(ui.cross, 'opacity', String(clamp(1 - (adsAmt - 0.3) / 0.4, 0, 1) * (run.ending ? 0 : 1)));

    // hit marker
    run.hitT = Math.max(0, run.hitT - dt);
    setStyle(ui.hm, 'opacity', run.hitT > 0 ? String(Math.min(1, run.hitT / 0.1)) : '0');
    toggle(ui.hm, 'kill', run.hitKill);

    // damage vignette, direction indicators
    run.dmgFlash = Math.max(0, run.dmgFlash - dt * 1.4);
    let v = run.dmgFlash * 0.9;
    if (pct <= 0.3 && player.alive) v = Math.max(v, 0.3 + 0.12 * Math.sin(run.t * 5) + (0.3 - pct));
    setStyle(ui.vig, 'opacity', clamp(v, 0, 1).toFixed(2));
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    for (const d of run.dirs) {
      d.life = Math.max(0, d.life - dt);
      const sx = d.dx * cy - d.dz * sy;
      const sf = -d.dx * sy - d.dz * cy;
      const ang = Math.atan2(sx, sf) * 180 / Math.PI;
      d.el.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
      d.el.style.opacity = String(clamp(d.life / 0.8, 0, 1));
    }

    // fade (intro / death)
    let fade = run.fade;
    const e = run.ending;
    if (e && e.type === 'dead') fade = Math.max(fade, clamp((e.t - 0.5) / 1.3, 0, 1));
    if (e && e.type === 'win') fade = Math.max(fade, clamp((e.t - 1.2) / 1.0, 0, 1));
    setStyle(ui.fade, 'opacity', fade.toFixed(2));
    run.fade = Math.max(0, run.fade - dt * 1.2);
  }

  // ---------------------------------------------------------------- menu background camera
  function updateMenuCam(dt) {
    menuTime += dt;
    if (!map) return;
    const sp = map.playerStart.pos;
    const gy = map.groundHeightAt(sp.x, sp.z);
    camera.position.set(sp.x + Math.sin(menuTime * 0.07) * 9, gy + 5.5 + Math.sin(menuTime * 0.11) * 0.6, sp.z + 8);
    camera.rotation.set(-0.12, Math.sin(menuTime * 0.05) * 0.25, 0);
    if (Math.abs(camera.fov - 62) > 0.01) { camera.fov = 62; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- render + loop
  let shadowT = 0, composer = null, lastDt = 0.016, frameN = 0;
  const GFX = {
    low:    { label: 'Thấp',       pr: 0.75, post: false, msaa: 0, shadows: false, size: 1024 },
    medium: { label: 'Trung bình', pr: 1.0,  post: true,  msaa: 0, shadows: true,  size: 1024 },
    high:   { label: 'Cao',        pr: 1.25, post: true,  msaa: 4, shadows: true,  size: 2048 }
  };
  const GFX_ORDER = ['low', 'medium', 'high'];
  let gfx = 'medium';
  try { const g = localStorage.getItem('dbp_gfx'); if (GFX[g]) gfx = g; } catch (e) { /* storage off */ }
  if (/[?&]low\b/.test(location.search)) gfx = 'low';
  function applyGfx(changed) {
    if (!renderer) return;
    const q = GFX[gfx];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    const shadowsChanged = renderer.shadowMap.enabled !== q.shadows;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = gfx === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = gfx === 'high';
    if (map && map.sun && map.sun.shadow.mapSize.x !== q.size) {
      map.sun.shadow.mapSize.set(q.size, q.size);
      if (map.sun.shadow.map) { map.sun.shadow.map.dispose(); map.sun.shadow.map = null; }
    }
    if (changed && scene && shadowsChanged) scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    composer = null;
    if (q.post && G.Realism) { try { composer = G.Realism.createComposer(renderer, { msaa: q.msaa }); } catch (e) { report('composer', e); composer = null; } }
    onResize();
  }
  function cycleGfx(d) {
    gfx = GFX_ORDER[(GFX_ORDER.indexOf(gfx) + d + GFX_ORDER.length) % GFX_ORDER.length];
    try { localStorage.setItem('dbp_gfx', gfx); } catch (e) { /* storage off */ }
    applyGfx(true);
  }
  function render() {
    if (!scene) return;
    frameN++;
    if (!renderer.shadowMap.autoUpdate) renderer.shadowMap.needsUpdate = (frameN & 1) === 0;   // shadows every other frame
    if (composer) {
      const inGameC = (S.state === 'play' || S.state === 'paused') && weapon && viewScene && player.alive;
      composer.render(scene, camera, inGameC ? viewScene : null, inGameC ? weapon.viewCamera : null, lastDt, run ? run.dmgFlash : 0);
      return;
    }
    renderer.clear();
    renderer.render(scene, camera);
    const inGame = (S.state === 'play' || S.state === 'paused') && weapon && viewScene && player.alive;
    if (inGame) {
      renderer.clearDepth();
      renderer.render(viewScene, weapon.viewCamera);
    }
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = clamp((ts - lastTs) / 1000, 0, 0.05) || 0.016;
    lastTs = ts; lastDt = dt;
    try {
      if (!S.busy && scene) {
        if (S.state === 'play') updatePlay(dt);
        else if (S.state === 'menu' || S.state === 'briefing') updateMenuCam(dt);
        else if (S.state === 'dead' || S.state === 'win') {
          // fade the vignette out on the end screens
          run.fade = Math.max(run.fade, 0);
        }
      }
      render();
    } catch (e) { report('frame', e); }
  }

  function onResize() {
    if (!renderer) return;
    const w = window.innerWidth, hgt = window.innerHeight;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, hgt);
    if (weapon && weapon.viewCamera && weapon.viewCamera.updateProjectionMatrix) {
      weapon.viewCamera.aspect = w / hgt;
      weapon.viewCamera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- input
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try { G.Audio.unlock(); } catch (e) { report('unlock', e); }
  }

  function setKey(code, down) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': keys.f = down; return true;
      case 'KeyS': case 'ArrowDown': keys.b = down; return true;
      case 'KeyA': case 'ArrowLeft': keys.l = down; return true;
      case 'KeyD': case 'ArrowRight': keys.r = down; return true;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = down; return true;
      case 'ControlLeft': case 'ControlRight': case 'KeyC': keys.crouch = down; return true;
      case 'KeyE': keys.e = down; return true;
      default: return false;
    }
  }

  function onKeyDown(e) {
    unlockAudio();
    if (S.busy) return;
    if (S.state === 'play') {
      if (run.ending) return;
      if (e.code === 'Space') { if (!e.repeat) pulses.jump = true; e.preventDefault(); return; }
      if (e.code === 'KeyR') { if (!e.repeat) pulses.reload = true; return; }
      if (e.code === 'KeyE' && !e.repeat) pulses.use = true;
      if (setKey(e.code, true)) e.preventDefault();
      return;
    }
    const scr = S.screen && screens[S.screen];
    if (!scr || !scr.menu) return;
    const m = scr.menu;
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': m.move(-1); break;
      case 'ArrowDown': case 'KeyS': m.move(1); break;
      case 'ArrowLeft': case 'KeyA': m.alt(-1); break;
      case 'ArrowRight': case 'KeyD': m.alt(1); break;
      case 'Enter': case 'NumpadEnter': case 'Space': m.activate(m.sel); break;
      case 'Escape': case 'Backspace': if (scr.onBack) { snd('ui_select'); scr.onBack(); } break;
      default: return;
    }
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (S.state === 'play' || S.state === 'paused') setKey(e.code, false);
  }

  function onMouseMove(e) {
    if (S.state !== 'play' || run.ending || document.pointerLockElement !== canvas) return;
    let mx = e.movementX || 0, my = e.movementY || 0;
    if (Math.abs(mx) > 300 || Math.abs(my) > 300) return; // ignore spikes
    const adsAmt = weapon ? weapon.adsAmount() : 0;
    const k = P.mouseSensitivity * lerp(1, P.adsFov / P.fov, adsAmt);
    player.yaw -= mx * k;
    player.pitch = clamp(player.pitch - my * k, -P.pitchLimit, P.pitchLimit);
  }

  function onMouseDown(e) {
    unlockAudio();
    if (S.state === 'play' && !run.ending && document.pointerLockElement === canvas) {
      if (e.button === 0) keys.fire = true;
      else if (e.button === 2) keys.ads = true;
      e.preventDefault();
    }
  }
  function onMouseUp(e) {
    if (e.button === 0) keys.fire = false;
    else if (e.button === 2) keys.ads = false;
  }

  function onLockChange() {
    const locked = document.pointerLockElement === canvas;
    if (!locked) {
      keys.fire = false; keys.ads = false;
      if (S.state === 'play') {
        if (run.ending) finishEnding();
        else pauseGame();
      }
    }
  }
  function onLockError() { if (S.state === 'play') pauseGame(); }

  function onBlur() {
    for (const k in keys) keys[k] = false;
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    canvas = document.getElementById('game');
    buildUI();
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      report('webgl', e);
      setBusy(true, 'Không thể khởi tạo WebGL. Hãy dùng Chrome bản mới.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;

    camera = new THREE.PerspectiveCamera(P.fov, window.innerWidth / window.innerHeight, 0.05, 600);
    camera.rotation.order = 'YXZ';
    applyGfx(false);

    try { G.Audio.init(); } catch (e) { report('audio init', e); }

    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);

    requestAnimationFrame(frame);
    ensureMenuWorld(() => {
      S.state = 'menu';
      showScreen('menu');
    });
  }

  G.Main = {
    boot,
    errors,
    _test: {
      S, keys, player, ui, screens,
      get run() { return run; },
      get map() { return map; },
      get enemies() { return enemies; },
      get weapon() { return weapon; },
      get scene() { return scene; },
      get renderer() { return renderer; },
      get camera() { return camera; }
    }
  };

  if (typeof document !== 'undefined' && !G.__noAutoBoot) boot();
})();
