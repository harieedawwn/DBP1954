/* weapon.js — Type 50 SMG (PPSh-41 copy) first-person weapon.
 * G.Weapon.create(scene) -> { viewScene, viewCamera, update(dt,input), impact(point,normal,surface),
 *                             ammo(), addAmmo(n), adsAmount(), + spreadDeg(), poolStats() }
 *
 * Conventions (main.js must follow):
 *  - Render order: world scene with the world camera, renderer.clearDepth(), then viewScene with viewCamera.
 *    viewCamera stays at the origin looking down -Z (never move it). Its aspect is synced from input.camera.
 *  - update(dt, input): input = {fire, ads, reload, moving, sprinting, camera, groundY?}
 *    camera = world camera (matrixWorld is read). groundY (optional) = floor height under the player for brass.
 *  - returns {shots:[{origin:Vector3, dir:Vector3}], kick:{pitch, yaw}} — kick is in RADIANS for this frame,
 *    pitch > 0 = look up, yaw > 0 = turn left (counter-clockwise seen from above). Add it to the camera angles.
 *  - A PointLight is added to `scene` once (intensity 0 when idle) so shaders never recompile at the first shot.
 *  - The gun cannot fire while sprinting (pose must recover first) or while reloading.
 */
window.G = window.G || {};
(function () {
  'use strict';
  const T = THREE;

  const MAG_SIZE = 35, RPM = 900, INTERVAL = 60 / RPM, RELOAD_T = 2.4, ADS_T = 0.2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const seg = (t, a, b) => smooth((t - a) / (b - a));

  // =====================================================================================
  //  Procedural textures (canvas)
  // =====================================================================================
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function toTex(c) {
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }
  function speckle(g, w, h, amt, dens) {
    const n = Math.floor(w * h * dens);
    for (let i = 0; i < n; i++) {
      const v = Math.random() * amt;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,' + v + ')' : 'rgba(255,255,255,' + v + ')';
      g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 1, 1);
    }
  }

  function woodTex() {
    const S = 256, [c, g] = mkCanvas(S, S);
    g.fillStyle = '#7a4a26'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) {                       // broad tonal bands
      const t = Math.sin(y * 0.045) * 0.5 + Math.sin(y * 0.13 + 1.3) * 0.5;
      g.fillStyle = (t > 0 ? 'rgba(60,30,10,' : 'rgba(205,145,85,') + Math.abs(t) * 0.2 + ')';
      g.fillRect(0, y, S, 2);
    }
    for (let i = 0; i < 170; i++) {                         // wavy grain lines along U
      const y0 = Math.random() * S, amp = rnd(1, 5), fr = rnd(0.01, 0.04), ph = Math.random() * 6.28;
      g.strokeStyle = (Math.random() < 0.7 ? 'rgba(50,25,10,' : 'rgba(215,155,95,') + rnd(0.08, 0.32) + ')';
      g.lineWidth = rnd(0.5, 1.5);
      g.beginPath();
      for (let x = 0; x <= S; x += 8) { const y = y0 + Math.sin(x * fr + ph) * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    for (let k = 0; k < 2; k++) {                           // knots / swirls
      const x = rnd(30, S - 30), y = rnd(30, S - 30);
      for (let r = 3; r < 16; r += 3) { g.strokeStyle = 'rgba(40,20,8,' + (0.35 - r * 0.015) + ')'; g.beginPath(); g.ellipse(x, y, r * 2.2, r * 0.8, 0, 0, 6.28); g.stroke(); }
    }
    for (let i = 0; i < 30; i++) {                          // worn varnish + dings
      g.fillStyle = 'rgba(190,140,90,' + rnd(0.05, 0.16) + ')';
      g.fillRect(Math.random() * S, Math.random() * S, rnd(6, 28), rnd(1, 4));
    }
    speckle(g, S, S, 0.25, 0.15);
    return toTex(c);
  }

  function metalTex(kind) {
    const S = 128, [c, g] = mkCanvas(S, S);
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, '#2b343b'); gr.addColorStop(1, '#161b20');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    speckle(g, S, S, 0.28, 0.2);
    for (let i = 0; i < 45; i++) {                          // fine scratches
      g.strokeStyle = 'rgba(170,175,180,' + rnd(0.06, 0.22) + ')'; g.lineWidth = 1;
      const x = Math.random() * S, y = Math.random() * S, l = rnd(4, 22), a = rnd(-0.4, 0.4);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 10; i++) {                          // oil / rust specks
      g.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '90,50,25' : '10,10,10') + ',' + rnd(0.15, 0.4) + ')';
      g.fillRect(Math.random() * S, Math.random() * S, rnd(1, 4), rnd(1, 3));
    }
    if (kind === 'mag') {                                   // stamped ribs
      for (let y = 10; y < S; y += 20) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, S, 2); g.fillStyle = 'rgba(160,165,170,0.14)'; g.fillRect(0, y + 2, S, 1); }
    }
    for (let i = 0; i < S; i++) {                           // worn bare steel at the edges (every face is UV 0..1)
      const a = rnd(0.25, 0.75);
      g.fillStyle = 'rgba(150,155,160,' + a + ')';
      if (Math.random() < 0.55) g.fillRect(i, 0, 1, rnd(1, 3));
      if (Math.random() < 0.55) g.fillRect(i, S - rnd(1, 3), 1, 3);
      if (Math.random() < 0.55) g.fillRect(0, i, rnd(1, 3), 1);
      if (Math.random() < 0.55) g.fillRect(S - rnd(1, 3), i, 3, 1);
    }
    return toTex(c);
  }

  function shroudTex() {                                    // perforated barrel jacket: U around, V along
    const S = 128, [c, g] = mkCanvas(S, S);
    const gr = g.createLinearGradient(0, 0, S, 0);
    gr.addColorStop(0, '#222b32'); gr.addColorStop(0.5, '#2a343c'); gr.addColorStop(1, '#222b32');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    speckle(g, S, S, 0.25, 0.18);
    const cols = 20, rows = 9;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const x = (k + 0.5 + (r % 2) * 0.5) * (S / cols), y = (r + 0.8) * (S / (rows + 0.6));
        g.fillStyle = '#3b434a'; g.beginPath(); g.ellipse(x, y, 3.1, 2.7, 0, 0, 6.28); g.fill();
        g.fillStyle = '#050608'; g.beginPath(); g.ellipse(x, y, 2.3, 2.0, 0, 0, 6.28); g.fill();
      }
    }
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = 'rgba(170,175,180,' + rnd(0.05, 0.18) + ')';
      const x = Math.random() * S, y = Math.random() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-14, 14), y + rnd(-3, 3)); g.stroke();
    }
    for (let i = 0; i < S; i++) {
      g.fillStyle = 'rgba(150,155,160,' + rnd(0.2, 0.6) + ')';
      if (Math.random() < 0.5) g.fillRect(i, 0, 1, 2);
      if (Math.random() < 0.5) g.fillRect(i, S - 2, 1, 2);
    }
    return toTex(c);
  }

  function clothTex() {
    const S = 128, [c, g] = mkCanvas(S, S);
    g.fillStyle = '#74744a'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 2) { g.fillStyle = 'rgba(0,0,0,0.09)'; g.fillRect(i, 0, 1, S); g.fillStyle = 'rgba(255,255,220,0.06)'; g.fillRect(0, i, S, 1); }
    for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(30,30,10,' + rnd(0.1, 0.25) + ')'; g.fillRect(0, Math.random() * S, S, rnd(2, 6)); }   // folds
    speckle(g, S, S, 0.3, 0.3);
    return toTex(c);
  }

  function skinTex() {
    const S = 64, [c, g] = mkCanvas(S, S);
    g.fillStyle = '#b3835a'; g.fillRect(0, 0, S, S);
    speckle(g, S, S, 0.3, 0.4);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(90,50,30,' + rnd(0.08, 0.2) + ')'; g.fillRect(Math.random() * S, Math.random() * S, rnd(6, 20), rnd(1, 3)); }
    return toTex(c);
  }

  function flashTex(spikes) {
    const S = 128, [c, g] = mkCanvas(S, S);
    g.translate(S / 2, S / 2);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    rg.addColorStop(0, 'rgba(255,255,235,1)'); rg.addColorStop(0.25, 'rgba(255,200,110,0.85)');
    rg.addColorStop(0.6, 'rgba(255,130,40,0.25)'); rg.addColorStop(1, 'rgba(255,100,20,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, S / 2, 0, 6.28); g.fill();
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * 6.283 + rnd(-0.2, 0.2), l = rnd(0.55, 1.0) * S / 2, w = rnd(3, 7);
      g.save(); g.rotate(a);
      const lg = g.createLinearGradient(0, 0, l, 0);
      lg.addColorStop(0, 'rgba(255,240,190,0.95)'); lg.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, -w); g.lineTo(l, 0); g.lineTo(0, w); g.closePath(); g.fill();
      g.restore();
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  function decalTex(kind) {
    const S = 64, [c, g] = mkCanvas(S, S);
    g.translate(S / 2, S / 2);
    const blob = (r, col, a) => {
      g.fillStyle = col; g.globalAlpha = a; g.beginPath();
      for (let i = 0; i <= 14; i++) { const an = i / 14 * 6.283, rr = r * rnd(0.75, 1.1); if (i) g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); else g.moveTo(rr, 0); }
      g.closePath(); g.fill(); g.globalAlpha = 1;
    };
    if (kind === 'dirt') { blob(26, '#2c1d12', 0.35); blob(15, '#1a100a', 0.7); }
    else if (kind === 'sandbag') { blob(24, '#5a4a30', 0.4); blob(11, '#2a2014', 0.75); }
    else if (kind === 'wood') {
      blob(11, '#140c06', 0.95);
      for (let i = 0; i < 12; i++) { const a = rnd(0, 6.28), l = rnd(14, 28); g.strokeStyle = 'rgba(225,185,120,' + rnd(0.5, 0.9) + ')'; g.lineWidth = rnd(1, 2); g.beginPath(); g.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke(); }
    } else {                                                 // metal: dent with bright rim + scratches
      blob(14, '#9aa0a6', 0.55); blob(9, '#0b0d0f', 0.95);
      for (let i = 0; i < 8; i++) { const a = rnd(0, 6.28), l = rnd(12, 26); g.strokeStyle = 'rgba(200,205,210,' + rnd(0.25, 0.6) + ')'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke(); }
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  // =====================================================================================
  //  Geometry builder (own primitives: flat arrays -> BufferGeometry)
  // =====================================================================================
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  function MeshData() { this.p = []; this.n = []; this.u = []; }
  MeshData.prototype.push = function (a, b, c, na, nb, nc, ua, ub, uc) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  };
  // flat triangle; `want` (optional) = outward direction, the winding is flipped to match it
  MeshData.prototype.tri = function (a, b, c, ua, ub, uc, want) {
    let n = vnorm(vcross(vsub(b, a), vsub(c, a)));
    if (want && vdot(n, want) < 0) { const tb = b; b = c; c = tb; const tu = ub; ub = uc; uc = tu; n = vmul(n, -1); }
    this.push(a, b, c, n, n, n, ua, ub, uc);
  };
  // box from centre and three half-extent vectors (each face UV 0..1)
  MeshData.prototype.box = function (c, hx, hy, hz) {
    const sets = [[hx, hy, hz], [hy, hz, hx], [hz, hx, hy]];
    for (const [A, B, C] of sets) {
      for (const s of [1, -1]) {
        const b = s > 0 ? B : C, cc = s > 0 ? C : B, o = vadd(c, vmul(A, s)), w = vmul(A, s);
        const p0 = vsub(vsub(o, b), cc), p1 = vsub(vadd(o, b), cc), p2 = vadd(vadd(o, b), cc), p3 = vadd(vsub(o, b), cc);
        this.tri(p0, p1, p2, [0, 0], [1, 0], [1, 1], w);
        this.tri(p0, p2, p3, [0, 0], [1, 1], [0, 1], w);
      }
    }
  };
  MeshData.prototype.boxA = function (cx, cy, cz, w, h, d) { this.box([cx, cy, cz], [w / 2, 0, 0], [0, h / 2, 0], [0, 0, d / 2]); };
  // truncated cone between two points; smooth radial normals; optional end caps
  MeshData.prototype.cyl = function (p0, p1, r0, r1, segs, cap0, cap1, uRep) {
    const a = vnorm(vsub(p1, p0));
    const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = vnorm(vcross(a, helper)), e2 = vcross(a, e1), ur = uRep || 1;
    const dir = (i) => { const t = (i / segs) * 6.283185; return vadd(vmul(e1, Math.cos(t)), vmul(e2, Math.sin(t))); };
    for (let i = 0; i < segs; i++) {
      const d0 = dir(i), d1 = dir(i + 1);
      const A = vadd(p0, vmul(d0, r0)), B = vadd(p0, vmul(d1, r0)), C = vadd(p1, vmul(d1, r1)), D = vadd(p1, vmul(d0, r1));
      const u0 = (i / segs) * ur, u1 = ((i + 1) / segs) * ur;
      this.push(A, B, C, d0, d1, d1, [u0, 0], [u1, 0], [u1, 1]);
      this.push(A, C, D, d0, d1, d0, [u0, 0], [u1, 1], [u0, 1]);
      if (cap0) this.push(p0, B, A, vmul(a, -1), vmul(a, -1), vmul(a, -1), [0.5, 0.5], [0.5 + 0.5 * Math.cos(((i + 1) / segs) * 6.283), 0.5 + 0.5 * Math.sin(((i + 1) / segs) * 6.283)], [0.5 + 0.5 * Math.cos((i / segs) * 6.283), 0.5 + 0.5 * Math.sin((i / segs) * 6.283)]);
      if (cap1) this.push(p1, C, D, a, a, a, [0.5, 0.5], [0.5 + 0.5 * Math.cos(((i + 1) / segs) * 6.283), 0.5 + 0.5 * Math.sin(((i + 1) / segs) * 6.283)], [0.5 + 0.5 * Math.cos((i / segs) * 6.283), 0.5 + 0.5 * Math.sin((i / segs) * 6.283)]);
    }
  };
  // ear-clipping triangulation of a simple polygon [[a,b],...] -> index triples
  function triangulate(poly) {
    const n = poly.length, idx = [];
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1]; }
    for (let i = 0; i < n; i++) idx.push(area > 0 ? i : n - 1 - i);
    const out = [];
    const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inTri = (p, a, b, c) => cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0;
    let guard = 0;
    while (idx.length > 3 && guard++ < 500) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
        const a = poly[i0], b = poly[i1], c = poly[i2];
        if (cr(a, b, c) <= 1e-12) continue;
        let ok = true;
        for (const k of idx) { if (k === i0 || k === i1 || k === i2) continue; if (inTri(poly[k], a, b, c)) { ok = false; break; } }
        if (ok) { out.push([i0, i1, i2]); idx.splice(i, 1); cut = true; break; }
      }
      if (!cut) break;
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    return out;
  }
  // polygon in (z,y), extruded along X from x0 to x1; UV planar (grain along z)
  MeshData.prototype.prism = function (poly, x0, x1, su, sv) {
    const tris = triangulate(poly), n = poly.length;
    const P = (i, x) => [x, poly[i][1], poly[i][0]];
    const UV = (i, x) => [poly[i][0] * su, poly[i][1] * sv];
    for (const t of tris) {
      this.tri(P(t[0], x1), P(t[1], x1), P(t[2], x1), UV(t[0]), UV(t[1]), UV(t[2]), [1, 0, 0]);
      this.tri(P(t[0], x0), P(t[1], x0), P(t[2], x0), UV(t[0]), UV(t[1]), UV(t[2]), [-1, 0, 0]);
    }
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1]; }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, dz = poly[j][0] - poly[i][0], dy = poly[j][1] - poly[i][1];
      const nrm = area > 0 ? [0, -dz, dy] : [0, dz, -dy];
      const w = vnorm(nrm);
      const a = P(i, x0), b = P(j, x0), c = P(j, x1), d = P(i, x1);
      this.tri(a, b, c, [poly[i][0] * su, x0 * sv], [poly[j][0] * su, x0 * sv], [poly[j][0] * su, x1 * sv], w);
      this.tri(a, c, d, [poly[i][0] * su, x0 * sv], [poly[j][0] * su, x1 * sv], [poly[i][0] * su, x1 * sv], w);
    }
  };
  // sweep a list of rings (each = 4 corner points) into a closed tube
  MeshData.prototype.sweep = function (rings) {
    const cen = (r) => vmul(r.reduce((s, p) => vadd(s, p), [0, 0, 0]), 1 / r.length);
    const cs = rings.map(cen);
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i], B = rings[i + 1], mid = vmul(vadd(cs[i], cs[i + 1]), 0.5), v0 = i / (rings.length - 1), v1 = (i + 1) / (rings.length - 1);
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4, a = A[k], b = A[k2], c = B[k2], d = B[k];
        const fc = vmul(vadd(vadd(a, b), vadd(c, d)), 0.25), w = vsub(fc, mid);
        this.tri(a, b, c, [k / 4, v0], [(k + 1) / 4, v0], [(k + 1) / 4, v1], w);
        this.tri(a, c, d, [k / 4, v0], [(k + 1) / 4, v1], [k / 4, v1], w);
      }
    }
    const capR = (r, w) => { this.tri(r[0], r[1], r[2], [0, 0], [1, 0], [1, 1], w); this.tri(r[0], r[2], r[3], [0, 0], [1, 1], [0, 1], w); };
    capR(rings[0], vsub(cs[0], cs[1]));
    capR(rings[rings.length - 1], vsub(cs[cs.length - 1], cs[cs.length - 2]));
  };
  MeshData.prototype.count = function () { return this.p.length / 9; };
  MeshData.prototype.geometry = function () {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new T.BufferAttribute(new Float32Array(this.u), 2));
    return g;
  };

  // =====================================================================================
  //  Model.  Gun-local space: origin = centre of the rear-sight aperture, -Z = muzzle, +Y up, +X right.
  //  Bore axis is at y = -0.060.  Total length 0.865 m (muzzle z=-0.40 .. butt z=+0.465).
  // =====================================================================================
  const BORE_Y = -0.060;
  const MUZZLE = [0, BORE_Y, -0.415];
  const EJECT = [0.032, -0.048, 0.10];

  function buildModel(mats) {
    const wood = new MeshData(), steel = new MeshData(), jacket = new MeshData(), dark = new MeshData(),
      mag = new MeshData(), bolt = new MeshData(), skinR = new MeshData(), clothR = new MeshData(),
      skinL = new MeshData(), clothL = new MeshData();

    // ---- stock: one-piece wood, side profile (z,y), generous chamfers
    const stock = [[0.125, -0.066], [0.26, -0.066], [0.30, -0.069], [0.34, -0.078], [0.40, -0.086], [0.452, -0.091], [0.462, -0.097],
      [0.462, -0.198], [0.455, -0.207], [0.41, -0.209], [0.375, -0.195], [0.345, -0.168], [0.325, -0.172], [0.312, -0.186], [0.30, -0.19],
      [0.255, -0.188], [0.235, -0.180], [0.208, -0.126], [0.198, -0.104], [0.19, -0.1], [0.125, -0.1]];
    wood.prism(stock, -0.021, 0.021, 2.0, 5.0);

    // ---- receiver (stamped tube), dust cover, cap
    steel.cyl([0, BORE_Y, 0.0], [0, BORE_Y, 0.265], 0.029, 0.029, 14, true, false);
    steel.cyl([0, BORE_Y, 0.265], [0, BORE_Y, 0.285], 0.031, 0.031, 14, true, true);
    steel.boxA(0, -0.0295, 0.13, 0.016, 0.003, 0.23);                                        // dust-cover hinge strip
    steel.boxA(0, -0.0315, 0.255, 0.034, 0.004, 0.018);                                      // cover latch
    // ---- trigger group
    steel.boxA(0, -0.1305, 0.178, 0.006, 0.004, 0.078);                                      // guard bottom
    steel.boxA(0, -0.115, 0.1415, 0.006, 0.030, 0.004);                                      // guard front
    steel.boxA(0, -0.107, 0.172, 0.004, 0.022, 0.006);                                       // trigger
    steel.boxA(0, -0.094, 0.115, 0.012, 0.012, 0.014);                                       // selector block
    steel.boxA(0.0095, -0.094, 0.115, 0.004, 0.006, 0.02);                                   // selector lever
    // ---- buttplate (blued steel) + screws
    steel.boxA(0, -0.1485, 0.4685, 0.046, 0.112, 0.012);
    for (const yy of [-0.12, -0.18]) steel.cyl([0, yy, 0.4745], [0, yy, 0.4775], 0.004, 0.004, 6, false, true);
    // ---- sling swivels (small rings, axis along X)
    for (const sw of [[-0.026, -0.2, 0.43], [-0.032, -0.078, 0.012]]) {
      for (let i = 0; i < 8; i++) {
        const a0 = i / 8 * 6.283, a1 = (i + 1) / 8 * 6.283, r = 0.011;
        steel.cyl([sw[0], sw[1] + Math.sin(a0) * r, sw[2] + Math.cos(a0) * r], [sw[0], sw[1] + Math.sin(a1) * r, sw[2] + Math.cos(a1) * r], 0.0026, 0.0026, 5, false, false);
      }
    }
    // ---- rivets / screws along the receiver sides
    for (let i = 0; i < 9; i++) {
      for (const sx of [-1, 1]) {
        const z = 0.03 + i * 0.027;
        steel.cyl([sx * 0.0285, -0.056, z], [sx * 0.0312, -0.056, z], 0.0045, 0.0038, 8, false, true);
      }
    }
    for (let i = 0; i < 5; i++) { const z = 0.05 + i * 0.045; steel.cyl([0.0, -0.0325, z], [0.0, -0.0345, z], 0.004, 0.0035, 6, false, true); }
    // ---- rear sight: base, post legs, aperture frame (hole is 0.016 x 0.016 centred on the origin)
    steel.boxA(0, -0.0345, 0.012, 0.034, 0.008, 0.034);
    steel.boxA(0, -0.0255, 0.0, 0.02, 0.012, 0.006);
    steel.boxA(-0.0165, 0.0, 0.0, 0.017, 0.04, 0.006);
    steel.boxA(0.0165, 0.0, 0.0, 0.017, 0.04, 0.006);
    steel.boxA(0, 0.014, 0.0, 0.016, 0.012, 0.006);
    steel.boxA(0, -0.014, 0.0, 0.016, 0.012, 0.006);
    // ---- muzzle compensator + front sight (post inside a square hood)
    steel.cyl([0, BORE_Y, -0.41], [0, BORE_Y, -0.358], 0.0225, 0.0245, 14, true, true);
    steel.boxA(0, -0.0345, -0.375, 0.016, 0.012, 0.03);
    steel.boxA(0, -0.018, -0.376, 0.0035, 0.036, 0.004);                                     // blade
    steel.boxA(-0.0125, -0.016, -0.372, 0.003, 0.044, 0.009);                                // hood ears
    steel.boxA(0.0125, -0.016, -0.372, 0.003, 0.044, 0.009);
    steel.boxA(0, 0.0055, -0.372, 0.028, 0.003, 0.009);                                      // hood bridge
    // ---- jacket rings
    steel.cyl([0, BORE_Y, -0.015], [0, BORE_Y, 0.006], 0.0285, 0.0285, 16, true, true);
    steel.cyl([0, BORE_Y, -0.362], [0, BORE_Y, -0.348], 0.0285, 0.0285, 16, true, true);
    // ---- perforated barrel jacket (texture holes), 20 sides
    jacket.cyl([0, BORE_Y, -0.355], [0, BORE_Y, -0.012], 0.0265, 0.0265, 20, false, false, 1);
    // ---- dark cut-outs: ejection port, cocking slot, compensator ports, muzzle bore, guard cavity
    dark.boxA(0.0275, -0.050, 0.10, 0.006, 0.022, 0.058);
    dark.boxA(0.0268, -0.074, 0.13, 0.006, 0.007, 0.115);
    for (let i = 0; i < 3; i++) dark.boxA(0, BORE_Y + 0.0232, -0.398 + i * 0.012, 0.012, 0.0025, 0.006);
    dark.cyl([0, BORE_Y, -0.4105], [0, BORE_Y, -0.4112], 0.0085, 0.0085, 10, false, true);
    dark.boxA(0, -0.1005, 0.178, 0.02, 0.002, 0.06);

    // ---- curved 35-round magazine: swept rectangle along an arc, stamped ribs
    {
      const R = 0.30, w = 0.036, dpt = 0.066, z0 = 0.085, y0 = -0.088, maxA = 0.56, nr = 18, rings = [];
      for (let i = 0; i < nr; i++) {
        const f = Math.floor(i / 2) / (nr / 2 - 1), a = f * maxA, rib = (i % 2 === 0) ? 1.0 : 0.955;
        const cy = y0 - R * Math.sin(a), cz = z0 - R * (1 - Math.cos(a));
        const ny = Math.sin(a), nz = -Math.cos(a);               // front/back axis (points forward at a=0)
        const hw = (w / 2) * rib, hd = (dpt / 2) * rib;
        rings.push([[-hw, cy - ny * hd, cz - nz * hd], [hw, cy - ny * hd, cz - nz * hd], [hw, cy + ny * hd, cz + nz * hd], [-hw, cy + ny * hd, cz + nz * hd]]);
      }
      mag.sweep(rings);
      const last = rings[nr - 1], cx = [0, (last[0][1] + last[2][1]) / 2, (last[0][2] + last[2][2]) / 2];
      mag.boxA(cx[0], cx[1] - 0.004, cx[2], 0.042, 0.008, 0.074);                  // floor plate
    }

    // ---- bolt handle (animated; origin = rest position on the right of the receiver)
    bolt.cyl([0, 0, 0], [0.014, 0, 0], 0.0048, 0.0048, 8, false, false);
    bolt.cyl([0.014, 0, 0], [0.026, 0, 0], 0.0085, 0.0075, 10, true, true);
    bolt.boxA(0.004, 0, 0.003, 0.008, 0.012, 0.016);

    // ---- right hand (on the wrist grip), sleeve
    {
      const palm = [0.031, -0.150, 0.285];
      skinR.box(palm, [0.011, 0, 0], [0, 0.043, 0], [0, 0, 0.031]);
      const fy = [-0.130, -0.1475, -0.165];
      for (const y of fy) {                                              // three curled fingers
        const A = [0.034, y, 0.272], B = [0.032, y, 0.236], C = [0.004, y, 0.232], D = [-0.020, y, 0.244];
        skinR.cyl(A, B, 0.0085, 0.0082, 8, false, false); skinR.cyl(B, C, 0.0082, 0.0078, 8, false, false); skinR.cyl(C, D, 0.0078, 0.0068, 8, false, true);
      }
      skinR.cyl([0.034, -0.113, 0.265], [0.034, -0.110, 0.212], 0.0085, 0.0075, 8, false, false);   // trigger finger
      skinR.cyl([0.034, -0.110, 0.212], [0.02, -0.108, 0.176], 0.0075, 0.0065, 8, false, true);
      skinR.cyl([0.014, -0.128, 0.30], [-0.012, -0.128, 0.262], 0.0105, 0.009, 8, false, false);     // thumb
      skinR.cyl([-0.012, -0.128, 0.262], [-0.030, -0.121, 0.248], 0.009, 0.0075, 8, false, true);
      clothR.cyl([0.06, -0.172, 0.325], [0.26, -0.36, 0.86], 0.034, 0.05, 14, false, true);          // sleeve
      clothR.cyl([0.052, -0.166, 0.312], [0.066, -0.173, 0.33], 0.038, 0.038, 14, true, false);      // cuff
    }
    // ---- left hand (grips the jacket from below; group is animated)
    {
      skinL.box([-0.004, -0.114, -0.158], [0.044, 0, 0], [0, 0.011, 0], [0, 0, 0.040]);
      for (let i = 0; i < 4; i++) {
        const z = -0.192 + i * 0.0245;
        const A = [0.040, -0.110, z], B = [0.050, -0.090, z], C = [0.044, -0.068, z], D = [0.026, -0.0535, z];
        skinL.cyl(A, B, 0.0092, 0.0088, 8, false, false); skinL.cyl(B, C, 0.0088, 0.0082, 8, false, false); skinL.cyl(C, D, 0.0082, 0.0072, 8, false, true);
      }
      skinL.cyl([-0.036, -0.112, -0.122], [-0.040, -0.088, -0.15], 0.0105, 0.009, 8, false, false);
      skinL.cyl([-0.040, -0.088, -0.15], [-0.030, -0.062, -0.186], 0.009, 0.0072, 8, false, true);
      clothL.cyl([-0.05, -0.128, -0.10], [-0.24, -0.34, 0.42], 0.034, 0.05, 14, false, true);
      clothL.cyl([-0.046, -0.125, -0.108], [-0.058, -0.131, -0.092], 0.038, 0.038, 14, true, false);
    }

    const parts = { wood, steel, jacket, dark, mag, bolt, skinR, clothR, skinL, clothL };
    let tris = 0; for (const k in parts) tris += parts[k].count();
    return { parts, tris };
  }

  // =====================================================================================
  //  Particle system: one Points draw call for smoke, dust, clods, splinters, sparks
  // =====================================================================================
  function Particles(scene, max) {
    this.max = max; this.head = 0; this.live = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.base = new Float32Array(max * 3);
    const geo = new T.BufferGeometry();
    this.aPos = new T.BufferAttribute(this.pos, 3); this.aCol = new T.BufferAttribute(this.col, 4); this.aSize = new T.BufferAttribute(this.size, 1);
    if (T.DynamicDrawUsage !== undefined) { this.aPos.setUsage(T.DynamicDrawUsage); this.aCol.setUsage(T.DynamicDrawUsage); this.aSize.setUsage(T.DynamicDrawUsage); }
    geo.setAttribute('position', this.aPos); geo.setAttribute('aColor', this.aCol); geo.setAttribute('aSize', this.aSize);
    this.mat = new T.ShaderMaterial({
      uniforms: { uScale: { value: 900 } }, transparent: true, depthWrite: false,
      vertexShader: 'attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;\n' +
        'void main(){ vColor=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;\n' +
        ' gl_PointSize=min(aSize*uScale/max(-mv.z,0.1),160.0); }',
      fragmentShader: 'varying vec4 vColor; void main(){ vec2 c=gl_PointCoord-0.5; float d=length(c)*2.0;\n' +
        ' float a=smoothstep(1.0,0.3,d); if(a<0.01) discard; gl_FragColor=vec4(vColor.rgb,vColor.a*a); }'
    });
    this.points = new T.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  Particles.prototype.emit = function (x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav, drag) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.grav[i] = grav; this.drag[i] = drag;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = a; this.size[i] = s0;
    this.live = Math.max(this.live, 1);
  };
  Particles.prototype.update = function (dt) {
    if (this.live === 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3, i4 = i * 4;
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i4 + 3] = 0; continue; }
      alive++;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = lerp(this.s0[i], this.s1[i], t);
      this.col[i4 + 3] = this.a0[i] * Math.min(1, t * 10) * (1 - t) * (1 - t * 0.3);
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
    if (alive === 0) this.live = 0;
  };

  // =====================================================================================
  //  Weapon
  // =====================================================================================
  const HIP = { x: 0.118, y: -0.118, z: -0.36, rx: 0.012, ry: 0.05, rz: 0 };
  const ADS = { x: 0, y: 0, z: -0.35, rx: 0, ry: 0, rz: 0 };          // aperture centre on the camera axis
  const SPR = { x: 0.17, y: -0.235, z: -0.30, rx: -0.55, ry: 0.80, rz: -0.28 };
  const HAND_G = [0.0, -0.05, 0.17], MAG_D = [0.0, -0.14, -0.02], MAG_W = [-0.08, -0.22, 0.10];
  const SURF = { dirt: 1, wood: 1, sandbag: 1, metal: 1 };

  function create(scene, opts) {
    opts = opts || {};
    const S = {
      mag: MAG_SIZE, reserve: opts.reserve != null ? opts.reserve : 105, reloading: false, rt: 0,
      evOut: false, evIn: false, evAmmo: false, evBolt: false,
      cool: 0, heat: 0, sinceShot: 9, prevFire: false, ads: 0, spr: 0, mv: 0, t: 0, shots: 0,
      bobPh: 0, bobAmt: 0, lagY: 0, lagX: 0, prevYaw: null, prevPitch: 0,
      kz: 0, kvz: 0, kp: 0, kvp: 0, kr: 0, kvr: 0, flashT: 0, spreadDeg: 0, trig: 0, smokeAlt: 0
    };

    // ---- view scene
    const viewScene = new T.Scene();
    const viewCamera = new T.PerspectiveCamera(58, 16 / 9, 0.01, 10);
    const hemi = new T.HemisphereLight(0xdfe6ff, 0x6b5a45, 1.6); viewScene.add(hemi);
    const sun = new T.DirectionalLight(0xfff1d6, 2.6); sun.position.set(0.5, 1, 0.6); viewScene.add(sun);

    const mats = {
      wood: new T.MeshPhongMaterial({ map: woodTex(), specular: 0x221a10, shininess: 18 }),
      steel: new T.MeshPhongMaterial({ map: metalTex('body'), specular: 0x4a5056, shininess: 45 }),
      jacket: new T.MeshPhongMaterial({ map: shroudTex(), specular: 0x4a5056, shininess: 45 }),
      mag: new T.MeshPhongMaterial({ map: metalTex('mag'), specular: 0x4a5056, shininess: 40 }),
      dark: new T.MeshBasicMaterial({ color: 0x050608 }),
      skin: new T.MeshLambertMaterial({ map: skinTex() }),
      cloth: new T.MeshLambertMaterial({ map: clothTex() })
    };
    const model = buildModel(mats);
    const mk = (md, m) => { const me = new T.Mesh(md.geometry(), m); me.frustumCulled = false; return me; };
    const gunRoot = new T.Group(), magGroup = new T.Group(), boltGroup = new T.Group(), leftGroup = new T.Group();
    const P = model.parts;
    gunRoot.add(mk(P.wood, mats.wood), mk(P.steel, mats.steel), mk(P.jacket, mats.jacket), mk(P.dark, mats.dark),
      mk(P.skinR, mats.skin), mk(P.clothR, mats.cloth));
    magGroup.add(mk(P.mag, mats.mag)); gunRoot.add(magGroup);
    boltGroup.position.set(0.0262, -0.074, 0.135); boltGroup.add(mk(P.bolt, mats.steel)); gunRoot.add(boltGroup);
    leftGroup.add(mk(P.skinL, mats.skin), mk(P.clothL, mats.cloth)); gunRoot.add(leftGroup);
    viewScene.add(gunRoot);

    // muzzle flash sprite (in gun space)
    const flashTexs = [flashTex(5), flashTex(7), flashTex(6)];
    const flash = new T.Sprite(new T.SpriteMaterial({ map: flashTexs[0], blending: T.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
    flash.position.set(MUZZLE[0], MUZZLE[1], MUZZLE[2] - 0.02); flash.visible = false; flash.frustumCulled = false;
    gunRoot.add(flash);

    // ---- world-side pooled effects
    const mzLight = new T.PointLight(0xffa850, 0, 16, 2); scene.add(mzLight);
    const parts = new Particles(scene, 320);

    const CAS_N = 32, casMesh = (function () {
      const m = new MeshData(); m.cyl([0, 0, -0.0125], [0, 0, 0.0125], 0.0048, 0.0042, 8, true, true);
      const im = new T.InstancedMesh(m.geometry(), new T.MeshPhongMaterial({ color: 0xb48a3c, specular: 0xffe090, shininess: 70 }), CAS_N);
      im.frustumCulled = false; scene.add(im); return im;
    })();
    const zeroM = new T.Matrix4().compose(new T.Vector3(0, -999, 0), new T.Quaternion(), new T.Vector3(0, 0, 0));
    for (let i = 0; i < CAS_N; i++) casMesh.setMatrixAt(i, zeroM);
    casMesh.instanceMatrix.needsUpdate = true;
    const cas = []; for (let i = 0; i < CAS_N; i++) cas.push({ on: false, p: new T.Vector3(), v: new T.Vector3(), r: [0, 0, 0], w: [0, 0, 0], age: 0, rest: false });
    let casHead = 0;
    const tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpE = new T.Euler(), tmpS = new T.Vector3(1, 1, 1);

    const TR_N = 8, tracers = [];
    { const m = new MeshData(); m.boxA(0, 0, 0, 0.012, 0.012, 1.1); const g = m.geometry();
      const tm = new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      for (let i = 0; i < TR_N; i++) { const me = new T.Mesh(g, tm); me.visible = false; me.frustumCulled = false; scene.add(me); tracers.push({ mesh: me, dir: new T.Vector3(), age: 0, on: false }); } }
    let trHead = 0;

    function quadGeo() { const m = new MeshData(); const n = [0, 0, 1];
      m.push([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], n, n, n, [0, 0], [1, 0], [1, 1]);
      m.push([-0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], n, n, n, [0, 0], [1, 1], [0, 1]); return m.geometry(); }
    const DEC_N = 28, decals = {}, decCount = {};
    for (const k of ['dirt', 'wood', 'sandbag', 'metal']) {
      const im = new T.InstancedMesh(quadGeo(), new T.MeshBasicMaterial({ map: decalTex(k), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), DEC_N);
      im.frustumCulled = false; im.visible = false; im.raycast = function () { };
      for (let i = 0; i < DEC_N; i++) im.setMatrixAt(i, zeroM);
      scene.add(im); decals[k] = im; decCount[k] = 0;
    }

    // ---- temporaries
    const camPos = new T.Vector3(), camQ = new T.Quaternion(), fwd = new T.Vector3(), v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3();
    const Y_UP = new T.Vector3(0, 1, 0), Z_AX = new T.Vector3(0, 0, 1);

    function gunToWorld(loc, out, cam) {
      out.set(loc[0], loc[1], loc[2]).applyMatrix4(gunRoot.matrixWorld).applyMatrix4(cam.matrixWorld);
      return out;
    }
    function aud(name, o) { if (G.Audio && G.Audio.play) G.Audio.play(name, o); }

    // ---------------------------------------------------------------- effects
    function spawnCasing(cam, base) {
      const c = cas[casHead]; casHead = (casHead + 1) % CAS_N;
      gunToWorld(EJECT, c.p, cam);
      const e = cam.matrixWorld.elements;
      const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], bx = e[8], by = e[9], bz = e[10];
      const a = rnd(1.5, 2.6), b = rnd(0.9, 1.9), d = rnd(-0.3, 0.7);
      c.v.set(rx * a + ux * b + bx * d, ry * a + uy * b + by * d, rz * a + uz * b + bz * d);
      c.r = [rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28)]; c.w = [rnd(-30, 30), rnd(-30, 30), rnd(-30, 30)];
      c.age = 0; c.on = true; c.rest = false; c.ground = base;
    }
    function updateCasings(dt) {
      let any = false;
      for (let i = 0; i < CAS_N; i++) {
        const c = cas[i];
        if (!c.on) continue;
        any = true;
        c.age += dt;
        if (c.age > 3) { c.on = false; casMesh.setMatrixAt(i, zeroM); continue; }
        if (!c.rest) {
          c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt);
          c.r[0] += c.w[0] * dt; c.r[1] += c.w[1] * dt; c.r[2] += c.w[2] * dt;
          if (c.p.y < c.ground + 0.005) {
            c.p.y = c.ground + 0.005;
            if (Math.abs(c.v.y) > 0.6) { c.v.y *= -0.3; c.v.x *= 0.55; c.v.z *= 0.55; c.w[0] *= 0.5; c.w[1] *= 0.5; c.w[2] *= 0.5; }
            else { c.rest = true; c.v.set(0, 0, 0); }
          }
        }
        tmpE.set(c.r[0], c.r[1], c.r[2]); tmpQ.setFromEuler(tmpE);
        const sc = c.age > 2.6 ? Math.max(0, (3 - c.age) / 0.4) : 1; tmpS.set(sc, sc, sc);
        tmpM.compose(c.p, tmpQ, tmpS); casMesh.setMatrixAt(i, tmpM);
      }
      if (any) casMesh.instanceMatrix.needsUpdate = true;
    }

    function spawnTracer(origin, dir) {
      const t = tracers[trHead]; trHead = (trHead + 1) % TR_N;
      t.dir.copy(dir); t.age = 0; t.on = true;
      t.mesh.position.copy(origin); t.mesh.quaternion.setFromUnitVectors(Z_AX, dir);
      t.mesh.scale.set(1, 1, 1); t.mesh.visible = true;
    }
    function updateTracers(dt) {
      for (const t of tracers) {
        if (!t.on) continue;
        t.age += dt;
        if (t.age > 0.3) { t.on = false; t.mesh.visible = false; continue; }
        t.mesh.position.addScaledVector(t.dir, 230 * dt);
      }
    }

    function spawnSmoke(mz, cam) {
      const e = cam.matrixWorld.elements;
      for (let k = 0; k < 2; k++) {
        parts.emit(mz.x, mz.y, mz.z, -e[8] * rnd(0.4, 1.2) + rnd(-0.15, 0.15), rnd(0.15, 0.5), -e[10] * rnd(0.4, 1.2) + rnd(-0.15, 0.15),
          rnd(0.7, 1.1), 0.035, rnd(0.22, 0.32), 0.78, 0.78, 0.76, 0.2, -0.05, 1.6);
      }
    }

    function decal(kind, pt, n) {
      const im = decals[kind]; const i = decCount[kind] % DEC_N; decCount[kind]++;
      const s = rnd(0.07, 0.11) * (kind === 'dirt' ? 1.4 : 1);
      tmpQ.setFromUnitVectors(Z_AX, n);
      const roll = new T.Quaternion().setFromAxisAngle(Z_AX, rnd(0, 6.28)); tmpQ.multiply(roll);
      v1.copy(pt).addScaledVector(n, 0.012); tmpS.set(s, s, s);
      tmpM.compose(v1, tmpQ, tmpS); im.setMatrixAt(i, tmpM); im.instanceMatrix.needsUpdate = true; im.visible = true;
    }

    function impact(point, normal, surface) {
      const kind = SURF[surface] ? surface : 'dirt';
      const n = normal && normal.lengthSq && normal.lengthSq() > 0 ? v2.copy(normal).normalize() : v2.set(0, 1, 0);
      const nx = n.x, ny = n.y, nz = n.z, px = point.x, py = point.y, pz = point.z;
      decal(kind, point, n.clone());
      const R = () => rnd(-1, 1);
      if (kind === 'dirt') {
        for (let i = 0; i < 4; i++) parts.emit(px, py, pz, nx * rnd(0.3, 1.1) + R() * 0.45, ny * rnd(0.3, 1.1) + 0.5 + R() * 0.3, nz * rnd(0.3, 1.1) + R() * 0.45, rnd(0.6, 1.0), 0.05, rnd(0.25, 0.4), 0.55, 0.42, 0.29, 0.55, -0.1, 2.2);
        for (let i = 0; i < 4; i++) parts.emit(px, py, pz, nx * rnd(1.5, 4) + R() * 1.6, ny * rnd(1.5, 4) + 1.0, nz * rnd(1.5, 4) + R() * 1.6, rnd(0.35, 0.7), 0.016, 0.012, 0.32, 0.22, 0.14, 1, 9.8, 0.3);
      } else if (kind === 'sandbag') {
        for (let i = 0; i < 5; i++) parts.emit(px, py, pz, nx * rnd(0.3, 1.2) + R() * 0.5, ny * rnd(0.3, 1.2) + 0.4 + R() * 0.3, nz * rnd(0.3, 1.2) + R() * 0.5, rnd(0.7, 1.1), 0.06, rnd(0.3, 0.45), 0.78, 0.68, 0.5, 0.5, -0.1, 2.0);
        for (let i = 0; i < 3; i++) parts.emit(px, py, pz, nx * rnd(1.5, 3) + R() * 1.2, ny * rnd(1.5, 3) + 0.8, nz * rnd(1.5, 3) + R() * 1.2, rnd(0.3, 0.5), 0.012, 0.01, 0.75, 0.65, 0.45, 1, 9.8, 0.3);
      } else if (kind === 'wood') {
        for (let i = 0; i < 6; i++) parts.emit(px, py, pz, nx * rnd(1.5, 5) + R() * 2, ny * rnd(1.5, 5) + R() * 2, nz * rnd(1.5, 5) + R() * 2, rnd(0.3, 0.6), 0.02, 0.014, 0.82, 0.64, 0.4, 1, 9.8, 0.5);
        for (let i = 0; i < 2; i++) parts.emit(px, py, pz, nx * 0.6 + R() * 0.3, ny * 0.6 + 0.3, nz * 0.6 + R() * 0.3, rnd(0.5, 0.8), 0.04, 0.2, 0.7, 0.6, 0.45, 0.35, -0.1, 2.0);
      } else {
        for (let i = 0; i < 7; i++) parts.emit(px, py, pz, nx * rnd(2, 6) + R() * 3, ny * rnd(2, 6) + R() * 3, nz * rnd(2, 6) + R() * 3, rnd(0.1, 0.25), 0.014, 0.004, 1.0, 0.8, 0.35, 1, 6, 0.8);
        parts.emit(px, py, pz, nx * 0.5, ny * 0.5 + 0.3, nz * 0.5, 0.5, 0.03, 0.15, 0.6, 0.6, 0.6, 0.3, -0.1, 2.0);
      }
      aud('impact_' + kind, { position: point });
    }

    // ---------------------------------------------------------------- shooting
    function currentSpreadDeg(input) {
      const a = smooth(S.ads);
      const sd = lerp(1.4, 0.35, a) + S.heat * lerp(3.0, 1.1, a) + S.mv * lerp(1.3, 0.35, a);
      return clamp(sd, 0, 6.5);
    }

    function shoot(cam, input, shots, kick) {
      S.mag--; S.shots++;
      const sdeg = currentSpreadDeg(input); S.spreadDeg = sdeg;
      const rmax = Math.tan(sdeg * Math.PI / 180), r = rmax * Math.sqrt(Math.random()), ph = Math.random() * 6.2832;
      const dir = new T.Vector3(r * Math.cos(ph), r * Math.sin(ph), -1).normalize().applyQuaternion(camQ);
      shots.push({ origin: camPos.clone(), dir });
      const a = smooth(S.ads), k = 1 - 0.3 * a;
      kick.pitch += (0.0040 + 0.0030 * S.heat) * k * rnd(0.85, 1.15);
      kick.yaw += rnd(-1, 1) * (0.0022 + 0.0018 * S.heat) * k;
      S.heat = Math.min(1, S.heat + 0.055); S.sinceShot = 0;
      // viewmodel kick
      S.kvz += 0.55 * (1 - 0.45 * a); S.kvp += 1.0 * (1 - 0.4 * a); S.kvr += rnd(-1, 1) * 0.6;
      // flash + light
      S.flashT = 0.045;
      flash.material.map = flashTexs[(Math.random() * 3) | 0]; flash.material.rotation = rnd(0, 6.28);
      const fs = rnd(0.15, 0.24) * (1 - 0.55 * a); flash.scale.set(fs, fs, 1); flash.material.opacity = 1 - 0.55 * a; flash.visible = true;
      gunToWorld(MUZZLE, v3, cam); mzLight.position.copy(v3); mzLight.intensity = rnd(45, 70);
      if ((S.shots & 1) === 0) spawnSmoke(v3, cam);
      spawnCasing(cam, input.groundY !== undefined ? input.groundY : camPos.y - 1.65);
      if (S.shots % 4 === 0) {                                  // faint tracer, converging on the aim ray at 35 m
        v1.copy(camPos).addScaledVector(dir, 35).sub(v3).normalize();
        spawnTracer(v3, v1);
      }
      aud('player_shot');
    }

    // ---------------------------------------------------------------- update
    function update(dt, input) {
      dt = clamp(dt, 0, 0.1); S.t += dt;
      const cam = input.camera;
      cam.updateMatrixWorld();
      camQ.setFromRotationMatrix(cam.matrixWorld);
      const e = cam.matrixWorld.elements;
      camPos.set(e[12], e[13], e[14]); fwd.set(-e[8], -e[9], -e[10]);
      if (cam.aspect && Math.abs(viewCamera.aspect - cam.aspect) > 1e-4) { viewCamera.aspect = cam.aspect; viewCamera.updateProjectionMatrix(); }

      // camera motion -> sway lag
      const yaw = Math.atan2(-fwd.x, -fwd.z), pitch = Math.asin(clamp(fwd.y, -1, 1));
      let dyaw = 0, dpitch = 0;
      if (S.prevYaw !== null) { dyaw = yaw - S.prevYaw; if (dyaw > Math.PI) dyaw -= 6.2832; if (dyaw < -Math.PI) dyaw += 6.2832; dpitch = pitch - S.prevPitch; }
      S.prevYaw = yaw; S.prevPitch = pitch;
      const decay = Math.exp(-dt * 9);
      S.lagY = S.lagY * decay + clamp(-dyaw, -0.08, 0.08) * 0.55;
      S.lagX = S.lagX * decay + clamp(dpitch, -0.08, 0.08) * -0.45;

      // reload
      if (input.reload && !S.reloading && S.mag < MAG_SIZE && S.reserve > 0) {
        S.reloading = true; S.rt = 0; S.evOut = S.evIn = S.evAmmo = S.evBolt = false;
      }
      if (S.reloading) {
        S.rt += dt;
        if (!S.evOut && S.rt >= 0.40) { S.evOut = true; aud('reload_out'); }
        if (!S.evIn && S.rt >= 1.52) { S.evIn = true; aud('reload_in'); }
        if (!S.evAmmo && S.rt >= 1.60) { S.evAmmo = true; const take = Math.min(MAG_SIZE - S.mag, S.reserve); S.mag += take; S.reserve -= take; }
        if (!S.evBolt && S.rt >= 1.90) { S.evBolt = true; aud('bolt'); }
        if (S.rt >= RELOAD_T) { S.reloading = false; S.rt = 0; }
      }

      // sprint / ADS / movement blends
      const sprT = input.sprinting && !S.reloading && !input.ads ? 1 : 0;
      S.spr += (sprT - S.spr) * (1 - Math.exp(-dt * 10));
      const adsT = input.ads && !S.reloading && S.spr < 0.3 ? 1 : 0;
      S.ads += clamp(adsT - S.ads, -dt / ADS_T, dt / ADS_T);
      S.mv += ((input.moving ? 1 : 0) - S.mv) * (1 - Math.exp(-dt * 8));

      // firing
      const shots = [], kick = { pitch: 0, yaw: 0 };
      const canShoot = !S.reloading && !input.sprinting && S.spr < 0.35;
      const trying = !!input.fire && canShoot;
      const edge = !!input.fire && !S.prevFire; S.prevFire = !!input.fire;
      if (S.cool > 0) S.cool -= dt;          // no timing credit while idle; overshoot carries over while firing
      S.sinceShot += dt;
      if (!(trying && S.mag > 0) && S.cool < 0) S.cool = 0;
      if (trying && S.mag > 0) {
        let n = 0;
        while (S.cool <= 1e-6 && S.mag > 0 && n < 3) { shoot(cam, input, shots, kick); S.cool += INTERVAL; n++; }
      } else if (edge && canShoot && S.mag === 0) {
        aud('dry_fire'); S.kvz += 0.12; S.trig = 1;
      }
      if (S.sinceShot > 0.12) S.heat = Math.max(0, S.heat - dt * 1.1);
      S.spreadDeg = currentSpreadDeg(input);

      // --- viewmodel pose
      const ae = smooth(S.ads), se = smooth(S.spr);
      const kStiff = 420, kDamp = 28;
      S.kvz += (-kStiff * S.kz - kDamp * S.kvz) * dt; S.kz = clamp(S.kz + S.kvz * dt, -0.01, 0.04);
      S.kvp += (-kStiff * S.kp - kDamp * S.kvp) * dt; S.kp = clamp(S.kp + S.kvp * dt, -0.02, 0.10);
      S.kvr += (-kStiff * S.kr - kDamp * S.kvr) * dt; S.kr = clamp(S.kr + S.kvr * dt, -0.05, 0.05);
      S.trig = Math.max(0, S.trig - dt * 6);

      const bobSpeed = input.sprinting ? 10.5 : 7.2;
      S.bobAmt += (((input.moving ? (input.sprinting ? 1.7 : 1) : 0)) - S.bobAmt) * (1 - Math.exp(-dt * 8));
      S.bobPh += dt * bobSpeed * (S.bobAmt > 0.02 ? 1 : 0);
      const bobK = S.bobAmt * (1 - 0.85 * ae);
      const breath = Math.sin(S.t * 1.6), breath2 = Math.sin(S.t * 0.9 + 1.3);
      const bk = 1 - 0.6 * ae;

      let x = lerp(HIP.x, ADS.x, ae), y = lerp(HIP.y, ADS.y, ae), z = lerp(HIP.z, ADS.z, ae);
      let rx = lerp(HIP.rx, ADS.rx, ae), ry = lerp(HIP.ry, ADS.ry, ae), rz = lerp(HIP.rz, ADS.rz, ae);
      x = lerp(x, SPR.x, se); y = lerp(y, SPR.y, se); z = lerp(z, SPR.z, se);
      rx = lerp(rx, SPR.rx, se); ry = lerp(ry, SPR.ry, se); rz = lerp(rz, SPR.rz, se);
      x += S.lagY * 0.25 + Math.cos(S.bobPh) * 0.006 * bobK + breath2 * 0.0008 * bk;
      y += S.lagX * 0.2 + Math.abs(Math.sin(S.bobPh)) * -0.008 * bobK + breath * 0.0014 * bk;
      z += S.kz;
      rx += S.kp + S.lagX * 0.8 + breath * 0.0025 * bk;
      ry += S.lagY * 0.8;
      rz += S.kr + Math.cos(S.bobPh) * 0.012 * bobK + breath2 * 0.003 * bk;

      // reload animation
      let magOff = [0, 0, 0], handOff = [0, 0, 0], pull = 0;
      if (S.reloading) {
        const t = S.rt;
        const tilt = seg(t, 0, 0.3) - seg(t, 2.1, 2.4);
        x += tilt * 0.01; y += tilt * 0.015; rx += tilt * 0.18; rz += tilt * 0.38; ry += tilt * 0.12;
        const grip = seg(t, 0.25, 0.45) - seg(t, 1.65, 1.9);
        const uOut = seg(t, 0.45, 0.75), uAway = seg(t, 0.75, 1.15), uBack = seg(t, 1.15, 1.45), uIn = seg(t, 1.45, 1.65);
        const outA = t < 1.15 ? uOut : 1 - uIn, awayA = t < 1.15 ? uAway : 1 - uBack;
        for (let i = 0; i < 3; i++) { magOff[i] = outA * MAG_D[i] + awayA * MAG_W[i]; handOff[i] = grip * HAND_G[i] + magOff[i]; }
        pull = seg(t, 1.9, 2.05) - seg(t, 2.05, 2.22);
        rz += pull * 0.03; z += pull * 0.012;
      }
      gunRoot.position.set(x, y, z); gunRoot.rotation.set(rx, ry, rz);
      magGroup.position.set(magOff[0], magOff[1], magOff[2]);
      magGroup.rotation.set(magOff[1] * -1.4, 0, 0);
      leftGroup.position.set(handOff[0], handOff[1], handOff[2]);
      boltGroup.position.z = 0.135 + pull * 0.045 + S.trig * 0.004;
      viewCamera.fov = lerp(58, 52, ae);
      if (Math.abs(viewCamera.fov - (viewCamera._lf || 0)) > 0.01) { viewCamera._lf = viewCamera.fov; viewCamera.updateProjectionMatrix(); }
      viewScene.updateMatrixWorld(true);

      // --- effects
      if (S.flashT > 0) {
        S.flashT -= dt;
        if (S.flashT <= 0) { flash.visible = false; mzLight.intensity = 0; }
        else mzLight.intensity *= 0.7;
      }
      updateCasings(dt); updateTracers(dt); parts.update(dt);
      if (typeof window !== 'undefined' && window.innerHeight) {
        const h = window.innerHeight * (window.devicePixelRatio || 1), fov = (cam.fov || 75) * Math.PI / 180;
        parts.mat.uniforms.uScale.value = h / (2 * Math.tan(fov / 2));
      }
      return { shots, kick };
    }

    function ammo() { return { mag: S.mag, reserve: S.reserve, reloading: S.reloading }; }
    function addAmmo(n) { S.reserve = Math.min(350, S.reserve + Math.max(0, n | 0)); }
    function adsAmount() { return smooth(S.ads); }
    function spreadDeg() { return S.spreadDeg; }
    function poolStats() {
      let live = 0; for (let i = 0; i < parts.max; i++) if (parts.life[i] > 0) live++;
      return { sceneChildren: scene.children.length, viewChildren: viewScene.children.length, particleCap: parts.max, particlesLive: live,
        casingCap: CAS_N, tracerCap: TR_N, decalCap: DEC_N * 4, gunTriangles: model.tris,
        parts: Object.keys(model.parts).reduce((o, k) => { o[k] = model.parts[k].count(); return o; }, {}) };
    }

    return { viewScene, viewCamera, update, impact, ammo, addAmmo, adsAmount, spreadDeg, poolStats };
  }

  G.Weapon = { create, MAG_SIZE, RPM, RELOAD_T };
})();
