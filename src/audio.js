/* audio.js — all game sounds, pure Web Audio synthesis (no external assets).
 * API: G.Audio.init(), unlock(), updateListener(camera), play(name, {position?, volume?}), loop(name, on)
 * position may be a THREE.Vector3 or {x,y,z}. No square/saw waves, no pitch sweeps anywhere.
 * Signal path: voices -> inBus -> compressor -> makeup -> limiter -> soft clip -> master -> destination
 *              voices -> wet send -> generated-IR convolver (outdoor tail + slap echoes) -> inBus
 */
window.G = window.G || {};
(function () {
  'use strict';

  const vol = { master: 1, ambience: 0.35 };
  let masterGain = null, ambBus = null;
  try { const v = JSON.parse(localStorage.getItem('dbp_volume') || 'null'); if (v) Object.assign(vol, v); } catch (e) { /* storage off */ }
  let ctx = null, inBus = null, wetIn = null, noiseBuf = null, windBuf = null;
  const lis = { x: 0, y: 0, z: 0 };
  const loops = {};
  const lastPlay = {};
  const warned = {};

  const rnd = (a, b) => a + Math.random() * (b - a);
  const jit = (v, p) => v * (1 + (Math.random() * 2 - 1) * p);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const NAMES = ['player_shot', 'enemy_shot', 'dry_fire', 'reload_out', 'reload_in', 'bolt',
    'impact_dirt', 'impact_wood', 'impact_metal', 'impact_sandbag', 'bullet_whiz', 'footstep',
    'hit_marker', 'player_hurt', 'ui_move', 'ui_select', 'flag_raise', 'wind'];

  // ---------- buffers ----------
  function makeNoise(c) {
    const n = Math.floor(c.sampleRate * 3), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Outdoor impulse response: dispersed, progressively darker tail + three discrete slap-back reflections.
  function makeIR(c) {
    const sr = c.sampleRate, n = Math.floor(sr * 2.6), b = c.createBuffer(2, n, sr);
    const slaps = [0.17, 0.27, 0.38];
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const a = 0.08 + 0.88 * Math.min(t / 1.4, 1);
        y += (Math.random() * 2 - 1 - y) * (1 - a);
        d[i] = y * Math.exp(-t * 2.9) * (t < 0.012 ? t / 0.012 : 1) * 0.9;
      }
      slaps.forEach((s, k) => {
        const st = Math.floor((s + (ch ? 0.013 : 0) + Math.random() * 0.01) * sr);
        const len = Math.floor(0.03 * sr);
        let z = 0;
        for (let i = 0; i < len && st + i < n; i++) {
          z += (Math.random() * 2 - 1 - z) * 0.35;
          d[st + i] += z * (1.0 - 0.25 * k) * Math.exp(-i / (len * 0.28));
        }
      });
    }
    return b;
  }

  // Seamless looping wind: low-passed noise with slow gusts, loop-point cross-faded.
  function makeWind(c) {
    const sr = c.sampleRate, n = Math.floor(sr * 7), fade = Math.floor(sr * 0.6);
    const b = c.createBuffer(1, n, sr), out = b.getChannelData(0);
    const s = new Float32Array(n + fade);
    let y = 0, y2 = 0;
    for (let i = 0; i < n + fade; i++) {
      y += (Math.random() * 2 - 1 - y) * 0.035;
      y2 += (y - y2) * 0.2;
      const t = i / sr;
      s[i] = y2 * 5 * (1 + 0.45 * Math.sin(2 * Math.PI * t / 7) + 0.25 * Math.sin(2 * Math.PI * 3 * t / 7 + 1.1));
    }
    for (let i = 0; i < n; i++) {
      out[i] = i < fade ? s[i] * (i / fade) + s[i + n] * (1 - i / fade) : s[i];
    }
    return b;
  }

  // ---------- init ----------
  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = null; return false; }

    inBus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.002; comp.release.value = 0.18;
    const makeup = ctx.createGain(); makeup.gain.value = 1.5;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.0005; lim.release.value = 0.06;
    const sat = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3) * 0.98; }
    sat.curve = curve; sat.oversample = '2x';
    const master = ctx.createGain(); master.gain.value = 0.9 * vol.master;
    masterGain = master;
    ambBus = ctx.createGain(); ambBus.gain.value = vol.ambience; ambBus.connect(inBus);
    inBus.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(sat); sat.connect(master);
    master.connect(ctx.destination);

    wetIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx);
    const wetOut = ctx.createGain(); wetOut.gain.value = 1.2;
    wetIn.connect(conv); conv.connect(wetOut); wetOut.connect(inBus);

    noiseBuf = makeNoise(ctx);
    windBuf = makeWind(ctx);
    return true;
  }

  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
  }

  function updateListener(camera) {
    if (!ctx || !camera) return;
    const e = camera.matrixWorld.elements, L = ctx.listener;
    lis.x = e[12]; lis.y = e[13]; lis.z = e[14];
    if (L.positionX) {
      L.positionX.value = e[12]; L.positionY.value = e[13]; L.positionZ.value = e[14];
      L.forwardX.value = -e[8]; L.forwardY.value = -e[9]; L.forwardZ.value = -e[10];
      L.upX.value = e[4]; L.upY.value = e[5]; L.upZ.value = e[6];
    } else if (L.setPosition) {
      L.setPosition(e[12], e[13], e[14]);
      L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  // ---------- building blocks ----------
  function env(g, t, peak, att, dec) {
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(Math.max(peak, 0.0002), t + att);
    p.exponentialRampToValueAtTime(0.0001, t + att + dec);
  }

  function nz(dest, t, o) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass'; f.frequency.value = o.f || 1000; f.Q.value = o.q || 0.7;
    const g = ctx.createGain();
    const att = o.att || 0.002, dec = o.dec || 0.05;
    env(g, t, o.peak == null ? 1 : o.peak, att, dec);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 2.0); s.stop(t + att + dec + 0.03);
  }

  function tone(dest, t, o) {            // fixed-frequency sine, amplitude envelope only
    const os = ctx.createOscillator();
    os.type = 'sine';
    os.frequency.value = o.f || 100;
    const g = ctx.createGain();
    const att = o.att || 0.002, dec = o.dec || 0.1;
    env(g, t, o.peak == null ? 1 : o.peak, att, dec);
    os.connect(g); g.connect(dest);
    os.start(t); os.stop(t + att + dec + 0.03);
  }

  function dist(o) {
    const p = o && o.position;
    if (!p) return 0;
    return Math.hypot(p.x - lis.x, p.y - lis.y, p.z - lis.z);
  }

  // per-voice output: gain -> [lowpass] -> [panner] -> bus (+ wet send)
  function voice(o, wet, lp) {
    const inp = ctx.createGain();
    inp.gain.value = o && o.volume != null ? o.volume : 1;
    let last = inp;
    if (lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
      last.connect(f); last = f;
    }
    if (o && o.position) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = 8; p.maxDistance = 600; p.rolloffFactor = 1.15;
      const q = o.position;
      if (p.positionX) { p.positionX.value = q.x; p.positionY.value = q.y; p.positionZ.value = q.z; }
      else if (p.setPosition) p.setPosition(q.x, q.y, q.z);
      last.connect(p); last = p;
    }
    last.connect(inBus);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; last.connect(w); w.connect(wetIn); }
    return { in: inp, tail: last };
  }

  function echo(v, delay, gain, lpf) {   // slap-back reflection
    const d = ctx.createDelay(1.0); d.delayTime.value = delay;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpf;
    const g = ctx.createGain(); g.gain.value = gain;
    v.tail.connect(d); d.connect(lp); lp.connect(g); g.connect(inBus);
  }

  // ---------- sound definitions ----------
  const S = {};

  S.player_shot = (o, t) => {
    const v = voice(o, 0.75, null), d = v.in, vs = jit(1, 0.08);
    // 1) crack: sharp noise transient
    nz(d, t, { type: 'highpass', f: jit(1700, 0.2), q: 0.5, peak: 1.0 * vs, att: 0.0006, dec: jit(0.05, 0.2) });
    nz(d, t, { type: 'bandpass', f: jit(3600, 0.15), q: 0.8, peak: 0.6 * vs, att: 0.0005, dec: 0.03 });
    // 2) body thump 60-150 Hz (+ low noise body)
    const f = rnd(62, 140);
    tone(d, t, { f, peak: 0.95 * vs, att: 0.002, dec: jit(0.16, 0.2) });
    tone(d, t, { f: f * 2.01, peak: 0.35, att: 0.002, dec: 0.08 });
    nz(d, t, { type: 'lowpass', f: jit(520, 0.2), q: 0.7, peak: 0.9, att: 0.001, dec: jit(0.16, 0.2) });
    // 3) mechanical action: bolt slam + spring/metal tick
    const m = t + jit(0.012, 0.3);
    nz(d, m, { type: 'bandpass', f: jit(1200, 0.2), q: 2.2, peak: 0.32, att: 0.001, dec: 0.035 });
    nz(d, m + 0.006, { type: 'bandpass', f: jit(2900, 0.2), q: 3, peak: 0.2, att: 0.0008, dec: 0.02 });
    tone(d, m, { f: jit(1650, 0.1), peak: 0.07, att: 0.001, dec: 0.05 });
    // 4) tail: convolution reverb (wet send) + explicit slap-back
    echo(v, rnd(0.15, 0.38), rnd(0.18, 0.3), 2600);
  };

  S.enemy_shot = (o, t) => {
    const d0 = dist(o);
    const lp = clamp(9500 / (1 + d0 / 22), 700, 9000);            // air absorption
    const o2 = Object.assign({}, o); o2.volume = (o && o.volume != null ? o.volume : 1) * 0.85;
    const v = voice(o2, 0.4 + Math.min(d0 / 150, 1) * 0.5, lp), d = v.in, vs = jit(1, 0.1);
    // bolt-action rifle crack: sharper and thinner than the SMG
    nz(d, t, { type: 'highpass', f: jit(1300, 0.15), q: 0.6, peak: 1.0 * vs, att: 0.0005, dec: jit(0.07, 0.2) });
    nz(d, t, { type: 'bandpass', f: jit(2600, 0.15), q: 0.9, peak: 0.5 * vs, att: 0.0005, dec: 0.035 });
    tone(d, t, { f: rnd(80, 115), peak: 0.55, att: 0.002, dec: 0.17 });
    nz(d, t, { type: 'lowpass', f: jit(450, 0.2), q: 0.7, peak: 0.6, att: 0.001, dec: 0.18 });
    echo(v, rnd(0.2, 0.4), 0.28 + Math.min(d0 / 200, 1) * 0.15, 2200);
  };

  S.dry_fire = (o, t) => {
    const v = voice(o, 0.08, null), d = v.in;
    nz(d, t, { type: 'bandpass', f: jit(2600, 0.1), q: 2.5, peak: 0.5, att: 0.0007, dec: 0.02 });
    nz(d, t + 0.002, { type: 'lowpass', f: 900, q: 0.7, peak: 0.45, att: 0.001, dec: 0.045 });
    tone(d, t, { f: jit(190, 0.1), peak: 0.25, att: 0.001, dec: 0.05 });
  };

  S.reload_out = (o, t) => {                   // mag catch click, mag slides out and drops
    const v = voice(o, 0.15, null), d = v.in;
    nz(d, t, { type: 'bandpass', f: jit(2400, 0.1), q: 3, peak: 0.55, att: 0.001, dec: 0.025 });
    tone(d, t, { f: 1450, peak: 0.08, att: 0.001, dec: 0.05 });
    nz(d, t + 0.06, { type: 'bandpass', f: jit(700, 0.15), q: 1.2, peak: 0.3, att: 0.004, dec: 0.09 });
    nz(d, t + 0.32, { type: 'lowpass', f: 600, q: 0.8, peak: 0.45, att: 0.002, dec: 0.1 });
    tone(d, t + 0.32, { f: 95, peak: 0.35, att: 0.002, dec: 0.1 });
  };

  S.reload_in = (o, t) => {                    // mag slides in, locks
    const v = voice(o, 0.15, null), d = v.in;
    nz(d, t, { type: 'bandpass', f: jit(900, 0.1), q: 1.2, peak: 0.28, att: 0.01, dec: 0.08 });
    nz(d, t + 0.1, { type: 'bandpass', f: jit(1900, 0.1), q: 2.5, peak: 0.6, att: 0.001, dec: 0.03 });
    nz(d, t + 0.1, { type: 'lowpass', f: 700, q: 0.8, peak: 0.55, att: 0.001, dec: 0.08 });
    tone(d, t + 0.1, { f: jit(120, 0.1), peak: 0.4, att: 0.002, dec: 0.09 });
    tone(d, t + 0.1, { f: 1350, peak: 0.07, att: 0.001, dec: 0.06 });
  };

  S.bolt = (o, t) => {                         // pull back, release forward
    const v = voice(o, 0.18, null), d = v.in;
    nz(d, t, { type: 'bandpass', f: jit(1500, 0.1), q: 1.5, peak: 0.3, att: 0.015, dec: 0.1 });
    nz(d, t + 0.1, { type: 'bandpass', f: jit(2200, 0.1), q: 3, peak: 0.55, att: 0.001, dec: 0.03 });
    const t2 = t + 0.16;
    nz(d, t2, { type: 'lowpass', f: 800, q: 0.8, peak: 0.8, att: 0.001, dec: 0.09 });
    nz(d, t2, { type: 'bandpass', f: jit(1300, 0.1), q: 2, peak: 0.55, att: 0.001, dec: 0.04 });
    tone(d, t2, { f: jit(105, 0.1), peak: 0.55, att: 0.002, dec: 0.1 });
    tone(d, t2, { f: 1700, peak: 0.07, att: 0.001, dec: 0.07 });
  };

  S.impact_dirt = (o, t) => {
    const v = voice(o, 0.3, null), d = v.in;
    nz(d, t, { type: 'lowpass', f: jit(650, 0.2), q: 0.7, peak: 0.7, att: 0.001, dec: jit(0.12, 0.2) });
    nz(d, t, { type: 'bandpass', f: jit(2200, 0.2), q: 0.8, peak: 0.18, att: 0.001, dec: 0.05 });
    tone(d, t, { f: jit(90, 0.15), peak: 0.35, att: 0.002, dec: 0.1 });
  };

  S.impact_wood = (o, t) => {
    const v = voice(o, 0.25, null), d = v.in;
    nz(d, t, { type: 'bandpass', f: jit(1300, 0.2), q: 3, peak: 0.65, att: 0.001, dec: 0.06 });
    nz(d, t, { type: 'highpass', f: 3000, q: 0.5, peak: 0.15, att: 0.0008, dec: 0.025 });
    tone(d, t, { f: jit(230, 0.15), peak: 0.5, att: 0.001, dec: 0.08 });
  };

  S.impact_metal = (o, t) => {                 // inharmonic partials = ping
    const v = voice(o, 0.4, null), d = v.in;
    nz(d, t, { type: 'highpass', f: 2500, q: 0.6, peak: 0.45, att: 0.0005, dec: 0.02 });
    const base = jit(1750, 0.15);
    [1, 1.53, 2.31, 3.17].forEach((r, i) => tone(d, t, { f: base * r, peak: 0.22 / (1 + i * 0.5), att: 0.0008, dec: jit(0.28 - i * 0.04, 0.2) }));
    tone(d, t, { f: jit(240, 0.1), peak: 0.25, att: 0.001, dec: 0.08 });
  };

  S.impact_sandbag = (o, t) => {
    const v = voice(o, 0.2, null), d = v.in;
    nz(d, t, { type: 'lowpass', f: jit(320, 0.2), q: 0.7, peak: 0.9, att: 0.001, dec: jit(0.1, 0.2) });
    nz(d, t, { type: 'bandpass', f: jit(1500, 0.2), q: 0.7, peak: 0.12, att: 0.001, dec: 0.04 });
    tone(d, t, { f: jit(70, 0.15), peak: 0.4, att: 0.002, dec: 0.09 });
  };

  S.bullet_whiz = (o, t) => {                  // supersonic crack-by, fixed bands, amplitude envelope only
    const v = voice(o, 0.05, null), d = v.in;
    nz(d, t, { type: 'bandpass', f: jit(3000, 0.12), q: 1.4, peak: 0.55, att: 0.03, dec: 0.13 });
    nz(d, t + 0.01, { type: 'bandpass', f: jit(4800, 0.12), q: 2, peak: 0.25, att: 0.02, dec: 0.08 });
    nz(d, t + 0.02, { type: 'highpass', f: 5000, q: 0.5, peak: 0.12, att: 0.002, dec: 0.015 });
  };

  S.footstep = (o, t) => {
    const v = voice(o, 0.05, null), d = v.in;
    nz(d, t, { type: 'lowpass', f: jit(380, 0.25), q: 0.7, peak: 0.55, att: 0.004, dec: jit(0.09, 0.2) });
    tone(d, t, { f: jit(75, 0.15), peak: 0.35, att: 0.003, dec: 0.07 });
    nz(d, t + 0.005, { type: 'highpass', f: 2200, q: 0.6, peak: 0.1, att: 0.002, dec: 0.05 });
  };

  S.hit_marker = (o, t) => {
    const v = voice(o, 0, null), d = v.in;
    tone(d, t, { f: 1900, peak: 0.22, att: 0.001, dec: 0.045 });
    nz(d, t, { type: 'bandpass', f: 2800, q: 2, peak: 0.25, att: 0.0008, dec: 0.02 });
    tone(d, t, { f: 420, peak: 0.2, att: 0.001, dec: 0.05 });
  };

  S.player_hurt = (o, t) => {
    const v = voice(o, 0.05, null), d = v.in;
    tone(d, t, { f: 68, peak: 0.9, att: 0.004, dec: 0.26 });
    nz(d, t, { type: 'lowpass', f: 700, q: 0.7, peak: 0.6, att: 0.003, dec: 0.3 });
    nz(d, t + 0.07, { type: 'bandpass', f: 900, q: 0.8, peak: 0.3, att: 0.05, dec: 0.3 });   // exhale
  };

  S.ui_move = (o, t) => {
    const v = voice(o, 0, null), d = v.in;
    tone(d, t, { f: 640, peak: 0.11, att: 0.002, dec: 0.05 });
    nz(d, t, { type: 'bandpass', f: 1800, q: 1.5, peak: 0.08, att: 0.001, dec: 0.02 });
  };

  S.ui_select = (o, t) => {
    const v = voice(o, 0.05, null), d = v.in;
    nz(d, t, { type: 'bandpass', f: 1300, q: 2, peak: 0.35, att: 0.001, dec: 0.04 });
    tone(d, t, { f: 520, peak: 0.2, att: 0.002, dec: 0.12 });
    tone(d, t + 0.05, { f: 780, peak: 0.16, att: 0.002, dec: 0.14 });
  };

  S.flag_raise = (o, t) => {                   // rope running over a pulley + cloth flaps
    const v = voice(o, 0.3, null), d = v.in;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 1.2;
    const g = ctx.createGain(); env(g, t, 0.2, 0.2, 2.2);
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
    const lg = ctx.createGain(); lg.gain.value = 0.08;
    lfo.connect(lg); lg.connect(g.gain);
    s.connect(f); f.connect(g); g.connect(d);
    s.start(t, 0.5); s.stop(t + 2.6); lfo.start(t); lfo.stop(t + 2.6);
    tone(d, t + 0.1, { f: 110, peak: 0.12, att: 1.0, dec: 1.4 });
    nz(d, t + 1.7, { type: 'lowpass', f: 900, q: 0.7, peak: 0.35, att: 0.02, dec: 0.25 });
    nz(d, t + 2.05, { type: 'lowpass', f: 800, q: 0.7, peak: 0.28, att: 0.02, dec: 0.3 });
  };

  // ---------- public ----------
  function play(name, opts) {
    const o = opts || {};
    try {
      if (!init() || !ctx) return;
      if (name === 'wind') { loop('wind', true); return; }
      const fn = S[name];
      if (!fn) { if (!warned[name]) { warned[name] = 1; console.warn('Audio: unknown sound', name); } return; }
      if (ctx.state !== 'running') return;       // not unlocked yet: skip instead of queueing a burst
      const now = ctx.currentTime;
      if (name !== 'player_shot' && lastPlay[name] != null && now - lastPlay[name] < 0.012) return;   // de-dupe same-frame spam
      lastPlay[name] = now;
      fn(o, now + 0.005);
    } catch (e) {
      if (G.Audio.strict) throw e;
      console.warn('Audio error', name, e);
    }
  }

  function loop(name, on) {
    try {
      if (!init() || !ctx) return;
      if (name !== 'wind') return;
      const now = ctx.currentTime;
      let L = loops[name];
      if (on) {
        if (L) { L.g.gain.cancelScheduledValues(now); L.g.gain.setValueAtTime(L.g.gain.value, now); L.g.gain.linearRampToValueAtTime(0.5, now + 1.5); L.off = false; return; }
        const src = ctx.createBufferSource(); src.buffer = windBuf; src.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.5, now + 2.5);
        src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ambBus);
        src.start(now, Math.random() * 5);
        loops[name] = { src, g, off: false };
      } else if (L) {
        L.g.gain.cancelScheduledValues(now); L.g.gain.setValueAtTime(L.g.gain.value, now);
        L.g.gain.linearRampToValueAtTime(0.0001, now + 1.2);
        const src = L.src; delete loops[name];
        setTimeout(() => { try { src.stop(); } catch (e) { /* already stopped */ } }, 1400);
      }
    } catch (e) {
      if (G.Audio.strict) throw e;
      console.warn('Audio loop error', e);
    }
  }

  function setVolume(ch, v) {
    vol[ch] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('dbp_volume', JSON.stringify(vol)); } catch (e) { /* storage off */ }
    if (ctx && masterGain && ambBus) {
      const t = ctx.currentTime;
      masterGain.gain.setTargetAtTime(0.9 * vol.master, t, 0.03);
      ambBus.gain.setTargetAtTime(vol.ambience, t, 0.03);
    }
  }
  function getVolume(ch) { return vol[ch]; }
  G.Audio = { setVolume, getVolume, init, unlock, updateListener, play, loop, names: NAMES, strict: false,
    context: () => ctx };
})();
