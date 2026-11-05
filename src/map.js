// map.js — Điện Biên Phủ strongpoint: terrain, trenches, bunkers, props, sky (P1)
// Conventions: meters, Y up. yaw = rotation.y (0 faces -Z / north). playerStart.pos and enemySpawns[].pos are FEET positions.
window.G = window.G || {};
G.Map = (function () {
  'use strict';
  const T = THREE, TAU = Math.PI * 2;

  // ======================= utils =======================
  function mkRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function h2(ix, iy) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vn2(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(h2(x0, y0), h2(x0 + 1, y0), fx), lerp(h2(x0, y0 + 1), h2(x0 + 1, y0 + 1), fx), fy);
  }

  // ======================= layout data =======================
  const HW = 1.25, TD = 1.6, RAMP = 6.5, WALL_T = 0.6;
  const PIECES = [
    { id: 'A1', pts: [[-48, 56], [-36, 56], [-36, 50], [-20, 50]] },
    { id: 'A2', pts: [[-8, 50], [8, 50], [8, 56], [26, 56]] },
    { id: 'A3', pts: [[34, 50], [34, 56], [48, 56]] },
    { id: 'B1', pts: [[-48, 14], [-40, 14], [-40, 20], [-22, 20], [-22, 14], [-6, 14]] },
    { id: 'B2', pts: [[8, 20], [24, 20], [24, 14], [40, 14], [40, 20], [48, 20]] },
    { id: 'C1', pts: [[-48, -26], [-32, -26], [-32, -32], [-12, -32]] },
    { id: 'C2', pts: [[-2, -32], [16, -32], [16, -26], [34, -26], [34, -32], [48, -32]] },
    { id: 'D1', pts: [[-40, -64], [-18, -64], [-18, -70], [-12, -70]] },
    { id: 'D2', pts: [[12, -70], [18, -70], [18, -64], [40, -64]] },
  ];
  const SEGS = [];
  PIECES.forEach(p => {
    let s = 0; p.segs = [];
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), m = HW + WALL_T + 0.1;
      const sg = { x0: a[0], z0: a[1], x1: b[0], z1: b[1], ux: dx / len, uz: dz / len, len, s0: s, p, i,
        minx: Math.min(a[0], b[0]) - m, maxx: Math.max(a[0], b[0]) + m, minz: Math.min(a[1], b[1]) - m, maxz: Math.max(a[1], b[1]) + m };
      p.segs.push(sg); SEGS.push(sg); s += len;
    }
    p.L = s;
  });

  const BUNKERS = [
    { x: 36, z: 36, w: 4.2, d: 3.4, roof: 'tin', door: 'N' },
    { x: -34, z: -1, w: 4.2, d: 3.4, roof: 'log', door: 'N' },
    { x: 24, z: -12, w: 4.6, d: 3.6, roof: 'tin', door: 'N' },
    { x: -24, z: -48, w: 4.2, d: 3.4, roof: 'log', door: 'N' },
    { x: 30, z: -52, w: 4.6, d: 3.6, roof: 'tin', door: 'N' },
    { x: 0, z: -82.5, w: 10, d: 7, roof: 'log', door: 'S', cmd: true },
  ];
  const TANK = { x: -18, z: 38, yaw: 0.55 };
  const WIRES = [
    { z: 64, x0: -54, x1: 54, gaps: [[-18, -6], [30, 38]] },
    { z: 27, x0: -54, x1: 54, gaps: [[-6, 8], [-40, -32]] },
    { z: -19, x0: -54, x1: 54, gaps: [[-14, 0], [34, 42]] },
  ];
  const CRATES = [[-9, 72], [12, 6], [-8, -44]];
  const SMOKE = [[TANK.x, TANK.z], [30, -22], [-26, -58]];
  const TARPS = [[-34, 44, 0.2], [32, 8, -0.3], [-22, -38, 0.4], [20, -44, 0.1]];
  // [x, z, kind, tier] — trench spawns lie on trench centre lines; bunker spawns at bunker centres
  const SPAWNS = [
    [-42, 56, 'rifle', 1], [-36, 53, 'rifle', 1], [0, 50, 'rifle', 1], [8, 53, 'rifle', 1], [20, 56, 'rifle', 1], [42, 56, 'rifle', 1], [36, 36, 'rifle', 1],
    [-43, 14, 'rifle', 2], [-40, 17, 'rifle', 2], [-14, 14, 'smg', 2], [16, 20, 'rifle', 2], [32, 14, 'rifle', 2], [-34, -1, 'rifle', 2], [24, -12, 'rifle', 2],
    [-42, -26, 'rifle', 3], [8, -32, 'rifle', 3], [28, -26, 'smg', 3], [-30, -64, 'smg', 3], [-24, -48, 'rifle', 3], [30, -52, 'smg', 3],
  ];

  const PADS = [{ x: 0, z: 90, hx: 13, hz: 7 }, { x: TANK.x, z: TANK.z, hx: 4.5, hz: 3.8 }];
  BUNKERS.forEach(b => PADS.push({ x: b.x, z: b.z, hx: b.w / 2 + (b.cmd ? 3 : 2.2), hz: b.d / 2 + (b.cmd ? 3.5 : 2.4) }));

  function nearTrench(x, z, m) {
    for (let i = 0; i < SEGS.length; i++) {
      const s = SEGS[i];
      let t = (x - s.x0) * s.ux + (z - s.z0) * s.uz; t = t < 0 ? 0 : t > s.len ? s.len : t;
      if (Math.hypot(x - (s.x0 + s.ux * t), z - (s.z0 + s.uz * t)) < m) return true;
    }
    return false;
  }
  function inPads(x, z, m) { for (const p of PADS) if (Math.abs(x - p.x) < p.hx + m && Math.abs(z - p.z) < p.hz + m) return true; return false; }
  function nearWire(z, m) { for (const w of WIRES) if (Math.abs(z - w.z) < m) return true; return false; }
  function inGap(w, x) { for (const g of w.gaps) if (x > g[0] && x < g[1]) return true; return false; }

  // ======================= height field =======================
  const CR = [];
  (function () {
    const R = mkRng(777); let tries = 0;
    while (CR.length < 48 && tries++ < 4000) {
      const x = (R() * 2 - 1) * 50, z = -88 + R() * 176, r = 2.4 + R() * 3, d = 0.45 + R();
      if (nearTrench(x, z, r + HW + WALL_T + 1.5) || inPads(x, z, r + 1.5) || nearWire(z, r + 2.5) || Math.hypot(x, z - 90) < 14) continue;
      let ok = true;
      for (const c of CR) if (Math.hypot(x - c.x, z - c.z) < (r + c.r) * 0.8) { ok = false; break; }
      for (const c of CRATES) if (Math.hypot(x - c[0], z - c[1]) < r + 2.5) ok = false;
      for (const c of SMOKE) if (Math.hypot(x - c[0], z - c[1]) < r + 1) ok = false;
      if (ok) CR.push({ x, z, r, d, R2: r * 1.7 * r * 1.7 });
    }
  })();
  function craterH(x, z) {
    let h = 0;
    for (let i = 0; i < CR.length; i++) {
      const c = CR[i], dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
      if (d2 > c.R2) continue;
      const u = Math.sqrt(d2) / c.r;
      if (u < 1) { const q = 1 - u * u; h -= q * q * c.d; }
      const e = (u - 1.1) / 0.25; h += c.d * 0.2 * Math.exp(-e * e);
    }
    return h;
  }
  function baseH(x, z) {
    let h = 14 * smooth(88, -66, z);
    h += 0.9 * Math.sin(x * 0.11 + z * 0.05) + 0.7 * Math.sin(z * 0.13 - x * 0.07 + 1.3) + 0.35 * Math.sin(x * 0.23 + z * 0.19 + 2.1);
    h += smooth(50, 66, Math.abs(x)) * 16 * (0.85 + 0.15 * Math.sin(z * 0.07));
    h += smooth(94, 108, z) * 14 + smooth(94, 108, -z) * 18;
    return h;
  }
  const rawH = (x, z) => baseH(x, z) + craterH(x, z);
  PADS.forEach(p => { p.h = rawH(p.x, p.z); });
  function heightFlat(x, z) {
    let h = rawH(x, z);
    for (let i = 0; i < PADS.length; i++) {
      const p = PADS[i], dx = Math.max(Math.abs(x - p.x) - p.hx, 0), dz = Math.max(Math.abs(z - p.z) - p.hz, 0);
      if (dx > 3 || dz > 3) continue;
      const d = Math.hypot(dx, dz);
      if (d < 3) { const w = 1 - smooth(0, 3, d); h = h * (1 - w) + p.h * w; }
    }
    return h;
  }
  const TR = { c: 0, f: 0 };
  function trench(x, z) {
    let c = 0, f = 0;
    for (let i = 0; i < SEGS.length; i++) {
      const s = SEGS[i];
      if (x < s.minx || x > s.maxx || z < s.minz || z > s.maxz) continue;
      let t = (x - s.x0) * s.ux + (z - s.z0) * s.uz; t = t < 0 ? 0 : t > s.len ? s.len : t;
      const d = Math.hypot(x - (s.x0 + s.ux * t), z - (s.z0 + s.uz * t));
      if (d > HW + WALL_T) continue;
      const ss = s.s0 + t, tap = smooth(0, RAMP, Math.min(ss, s.p.L - ss)), fac = 1 - smooth(HW, HW + WALL_T, d);
      const cc = TD * tap * fac; if (cc > c) c = cc;
      const ff = fac * (tap > 0.15 ? 1 : tap / 0.15); if (ff > f) f = ff;
    }
    TR.c = c; TR.f = f;
  }
  function groundHeightAt(x, z) {
    x = clamp(x, -90, 90); z = clamp(z, -130, 130);
    const h = heightFlat(x, z); trench(x, z);
    return h - TR.c;
  }
  function trenchDepthAt(s, t) { const ss = s.s0 + clamp(t, 0, s.len); return TD * smooth(0, RAMP, Math.min(ss, s.p.L - ss)); }

  // ======================= geometry batching =======================
  class Acc { constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
    vert(x, y, z, nx, ny, nz, u, v, r, g, b) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(r, g, b); return this.v++; } }
  let BATCH = {}, R = mkRng(1954);
  function acc(key, z) {
    const ch = clamp(Math.floor((z + 105) / 42), 0, 4), k = key + '|' + ch;
    return (BATCH[k] || (BATCH[k] = { key, ch, a: new Acc() })).a;
  }
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _v = new T.Vector3(), _s = new T.Vector3(), _n = new T.Vector3(), _nm = new T.Matrix3();
  const _qa = new T.Quaternion(), _qb = new T.Quaternion(), UP = new T.Vector3(0, 1, 0), EX = new T.Vector3(1, 0, 0);
  function xf(x, y, z, rx, ry, rz, sx, sy, sz, q) {
    if (q) _q.copy(q); else { _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e); }
    _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)); _nm.getNormalMatrix(_m);
  }
  function tint3(t) { return t == null ? [1, 1, 1] : typeof t === 'number' ? [t, t, t] : t; }
  const BOXV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  function addBox(key, x, y, z, sx, sy, sz, o) {
    o = o || {};
    const A = acc(key, z), tile = o.tile || 1, tc = tint3(o.t), dims = [sx, sy, sz];
    xf(x, y, z, o.rx, o.ry, o.rz, sx, sy, sz, o.q);
    const ou = R(), ov = R();
    for (let a = 0; a < 3; a++) for (let sg = 1; sg >= -1; sg -= 2) {
      const ua = (a + 1) % 3, va = (a + 2) % 3, b0 = A.v;
      _n.set(0, 0, 0); _n.setComponent(a, sg); _n.applyMatrix3(_nm).normalize();
      const nx = _n.x, ny = _n.y, nz = _n.z;
      for (const [i, j] of BOXV) {
        const pp = [0, 0, 0]; pp[a] = 0.5 * sg; pp[ua] = i - 0.5; pp[va] = j - 0.5;
        _v.set(pp[0], pp[1], pp[2]).applyMatrix4(_m);
        const u = o.cell ? o.cell[0] + i * o.cell[2] : i * dims[ua] / tile + ou, v = o.cell ? o.cell[1] + j * o.cell[3] : j * dims[va] / tile + ov;
        const ao = o.ao ? 0.72 + 0.28 * (pp[1] + 0.5) : 1;
        A.vert(_v.x, _v.y, _v.z, nx, ny, nz, u, v, tc[0] * ao, tc[1] * ao, tc[2] * ao);
      }
      if (sg > 0) { A.i.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); } else { A.i.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2); }
    }
  }
  // cylinder, axis local Y, centred on (x,y,z)
  function addCyl(key, x, y, z, r0, r1, h, seg, o) {
    o = o || {};
    const A = acc(key, z), tile = o.tile || 1, tc = tint3(o.t);
    xf(x, y, z, o.rx, o.ry, o.rz, 1, 1, 1, o.q);
    const k = Math.max(1, Math.round(TAU * Math.max(r0, r1) / tile)), ov = R(), sl = (r0 - r1) / h;
    const base = A.v;
    for (let j = 0; j < 2; j++) {
      const r = j ? r1 : r0, yy = (j ? 0.5 : -0.5) * h;
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * TAU, ca = Math.cos(a), sa = Math.sin(a);
        _n.set(ca, sl, sa).applyMatrix3(_nm).normalize();
        _v.set(ca * r, yy, sa * r).applyMatrix4(_m);
        const ao = o.ao ? 0.75 + 0.25 * j : 1;
        A.vert(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, i / seg * k, j * h / tile + ov, tc[0] * ao, tc[1] * ao, tc[2] * ao);
      }
    }
    for (let i = 0; i < seg; i++) { const a = base + i, b = base + i + 1, c = base + seg + 1 + i, d = base + seg + 2 + i; A.i.push(a, c, b, b, c, d); }
    if (o.caps) for (let j = 0; j < 2; j++) {
      const r = j ? r1 : r0, yy = (j ? 0.5 : -0.5) * h, sgn = j ? 1 : -1;
      _n.set(0, sgn, 0).applyMatrix3(_nm).normalize(); const nx = _n.x, ny = _n.y, nz = _n.z;
      _v.set(0, yy, 0).applyMatrix4(_m);
      const c0 = A.vert(_v.x, _v.y, _v.z, nx, ny, nz, 0.15, 0.15, tc[0], tc[1], tc[2]);
      const rb = A.v;
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * TAU; _v.set(Math.cos(a) * r, yy, Math.sin(a) * r).applyMatrix4(_m);
        A.vert(_v.x, _v.y, _v.z, nx, ny, nz, 0.15 + Math.cos(a) * 0.1, 0.15 + Math.sin(a) * 0.1, tc[0] * 0.9, tc[1] * 0.9, tc[2] * 0.9);
      }
      for (let i = 0; i < seg; i++) { if (j) A.i.push(c0, rb + i + 1, rb + i); else A.i.push(c0, rb + i, rb + i + 1); }
    }
  }
  // thin beam between two points (wire, braces)
  const _d = new T.Vector3();
  function addBeam(key, x0, y0, z0, x1, y1, z1, th, o) {
    _d.set(x1 - x0, y1 - y0, z1 - z0); const len = _d.length(); if (len < 1e-4) return;
    _qa.setFromUnitVectors(EX, _d.normalize());
    addBox(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, len, th, th, Object.assign({}, o, { q: _qa.clone() }));
  }
  // single quad from 4 corner arrays [x,y,z]; uv rect [u0,v0,u1,v1]; up-facing normal for soft foliage lighting
  function addQuad(key, p, uv, tc, nrm) {
    const A = acc(key, p[0][2]), b0 = A.v, c = tint3(tc), n = nrm || [0, 1, 0];
    const us = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    for (let i = 0; i < 4; i++) A.vert(p[i][0], p[i][1], p[i][2], n[0], n[1], n[2], us[i][0], us[i][1], c[0], c[1], c[2]);
    A.i.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  }
  // standing card (base-centre anchored), yaw + tilt (tilt leans toward its facing direction)
  function addCard(key, cx, cy, cz, w, h, yaw, tilt, uvr, tc) {
    const sy = Math.sin(yaw), cyw = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt), pts = [];
    for (const [lx, ly] of [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]]) {
      const fz = ly * st, yy = ly * ct;
      pts.push([cx + lx * cyw + fz * sy, cy + yy, cz - lx * sy + fz * cyw]);
    }
    addQuad(key, pts, uvr, tc);
  }
  let ROCKGEO = null;
  function addRock(x, y, z, r, sy, rot, tc) {
    if (!ROCKGEO) ROCKGEO = new T.IcosahedronGeometry(1, 0);
    const g = ROCKGEO, pos = g.attributes.position, uv = g.attributes.uv, A = acc('rock', z);
    xf(x, y, z, 0, rot, 0, r, r * sy, r, null);
    const t = tint3(tc), b0 = A.v, tri = [];
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const j = 1 + 0.28 * Math.sin(px * 9.1 + py * 5.3 + pz * 7.7 + x) + 0.18 * Math.sin(px * 17 - pz * 11 + y);
      _v.set(px * j, py * j, pz * j).applyMatrix4(_m); tri.push(_v.x, _v.y, _v.z);
    }
    for (let f = 0; f < pos.count; f += 3) {
      const ax = tri[f * 3], ay = tri[f * 3 + 1], az = tri[f * 3 + 2], bx = tri[f * 3 + 3], by = tri[f * 3 + 4], bz = tri[f * 3 + 5], cx = tri[f * 3 + 6], cy = tri[f * 3 + 7], cz = tri[f * 3 + 8];
      _n.set(bx - ax, by - ay, bz - az).cross(_d.set(cx - ax, cy - ay, cz - az)).normalize();
      for (let k = 0; k < 3; k++) A.vert(tri[(f + k) * 3], tri[(f + k) * 3 + 1], tri[(f + k) * 3 + 2], _n.x, _n.y, _n.z, uv.getX(f + k) * 2, uv.getY(f + k) * 2, t[0], t[1], t[2]);
      A.i.push(A.v - 3, A.v - 2, A.v - 1);
    }
  }

  // ======================= placement helpers =======================
  const colliders = [];
  function box3(x0, y0, z0, x1, y1, z1) { colliders.push(new T.Box3(new T.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), new T.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)))); }
  function free(x, z, m) {
    if (Math.abs(x) > 56 || z > 95 || z < -92) return false;
    if (nearTrench(x, z, HW + WALL_T + 1 + m) || inPads(x, z, m) || nearWire(z, m + 1) || Math.hypot(x, z - 90) < 7) return false;
    for (const c of CRATES) if (Math.hypot(x - c[0], z - c[1]) < m + 2) return false;
    return true;
  }
  const SAND_CELLS = [[0, 0.75, 0.5, 0.25], [0.5, 0.75, 0.5, 0.25], [0, 0.25, 0.5, 0.25], [0.5, 0.25, 0.5, 0.25], [0.25, 0.5, 0.5, 0.25], [0.25, 0, 0.5, 0.25]];
  function bag(x, y, z, yaw, len) {
    const w = (len || 0.56) * (0.94 + R() * 0.1), t = 0.84 + R() * 0.3;
    addBox('sand', x, y + 0.13, z, w, 0.27, 0.36, { ry: yaw + (R() - 0.5) * 0.1, cell: SAND_CELLS[(R() * 6) | 0], t: [t, t * 0.98, t * 0.94] });
  }
  // row of bags along x (alongX) or z, centred at (cx,cz) with length L, `layers` high (brick offset)
  function bagRow(cx, cz, L, layers, alongX, y0) {
    const n = Math.max(1, Math.round(L / 0.56)), step = L / n;
    for (let l = 0; l < layers; l++) for (let i = 0; i < n; i++) {
      const o = (l % 2 ? 0.5 : 0) * step, s = -L / 2 + (i + 0.5) * step + o; if (l % 2 && i === n - 1) continue;
      const bx = alongX ? cx + s : cx, bz = alongX ? cz : cz + s;
      bag(bx, y0 + l * 0.26, bz, alongX ? 0 : Math.PI / 2, step + 0.02);
    }
  }
  const sideN = (s, sg) => [-s.uz * sg, s.ux * sg];

  // ======================= structures =======================
  function buildTrenches() {
    for (const p of PIECES) for (const s of p.segs) {
      const alongX = Math.abs(s.uz) < 1e-6;
      for (const sg of [1, -1]) {
        const nrm = sideN(s, sg);
        let e0 = 0, e1 = 0;
        if (s.i > 0) { const pr = p.segs[s.i - 1]; e0 = (nrm[0] * -pr.ux + nrm[1] * -pr.uz) > 0 ? -HW : HW + 0.05; }
        if (s.i < p.segs.length - 1) { const nx = p.segs[s.i + 1]; e1 = (nrm[0] * nx.ux + nrm[1] * nx.uz) > 0 ? -HW : HW + 0.05; }
        const a = -e0, b = s.len + e1, n = Math.max(1, Math.ceil((b - a) / 1.5)), sl = (b - a) / n;
        for (let k = 0; k < n; k++) {
          const t = a + (k + 0.5) * sl, D = trenchDepthAt(s, t);
          if (D < 0.45) continue;
          const cx = s.x0 + s.ux * t, cz = s.z0 + s.uz * t, off = HW + 0.03;
          const wx = cx + nrm[0] * off, wz = cz + nrm[1] * off;
          const floorY = groundHeightAt(cx + nrm[0] * (HW - 0.2), cz + nrm[1] * (HW - 0.2)), topY = heightFlat(cx + nrm[0] * (HW + 0.7), cz + nrm[1] * (HW + 0.7)) + 0.16;
          const hgt = topY - floorY + 0.1;
          addBox('plank', wx, floorY - 0.1 + hgt / 2, wz, alongX ? sl + 0.02 : 0.1, hgt, alongX ? 0.1 : sl + 0.02, { tile: 1.2, t: 0.86 + R() * 0.22 });
          const px = cx - s.ux * sl / 2 + nrm[0] * (HW - 0.06), pz = cz - s.uz * sl / 2 + nrm[1] * (HW - 0.06);
          addCyl('log', px, floorY - 0.1 + (hgt + 0.1) / 2, pz, 0.085, 0.085, hgt + 0.1, 6, { tile: 0.8, t: 0.8 + R() * 0.25, caps: true });
          addCyl('log', cx + nrm[0] * (HW - 0.06), topY - 0.02, cz + nrm[1] * (HW - 0.06), 0.065, 0.065, sl + 0.05, 6, { rx: alongX ? 0 : Math.PI / 2, rz: alongX ? Math.PI / 2 : 0, tile: 0.7, t: 0.9 + R() * 0.2 });
          // sandbag parapet (south side of E-W runs) and firing step
          if (alongX && nrm[1] > 0 && t >= 0 && t <= s.len && D > 1.1) {
            const bz = cz + HW + 0.62, by = heightFlat(cx, bz);
            bagRow(cx, bz, sl, 2 + (R() < 0.3 ? 1 : 0), true, by - 0.04);
            box3(cx - sl / 2, by - 0.3, bz - 0.2, cx + sl / 2, by + 0.6, bz + 0.2);
          }
          if (alongX && nrm[1] > 0 && D > 1.2) addBox('plank', cx, floorY + 0.17, cz + HW - 0.3, sl, 0.34, 0.55, { tile: 1, t: 0.7 });
        }
      }
    }
  }

  function logWall(b, fixed, from, to, rows, axis) {
    for (const r of rows) {
      const y = b.y0 + r * 0.24 + 0.12, len = to - from + 0.24, mid = (from + to) / 2;
      const tn = 0.8 + R() * 0.3;
      if (axis === 'x') addCyl('log', mid, y, fixed, 0.12, 0.12, len, 7, { rz: Math.PI / 2, tile: 0.9, t: tn, caps: true });
      else addCyl('log', fixed, y, mid, 0.12, 0.12, len, 7, { rx: Math.PI / 2, tile: 0.9, t: tn, caps: true });
    }
  }
  const SLIT = [4, 5];
  function buildBunker(b) {
    const y0 = groundHeightAt(b.x, b.z); b.y0 = y0;
    const hw = b.w / 2, hd = b.d / 2, WH = 2.16, DW = b.cmd ? 1.7 : 1.3, all = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const T_ = 0.3;
    // front (S, +z) and back (N, -z) walls
    for (const side of ['S', 'N']) {
      const zc = b.z + (side === 'S' ? hd : -hd), hasDoor = b.door === side, slit = side === 'S' || b.cmd;
      const lowRows = [0, 1, 2, 3], upRows = [6, 7, 8];
      const parts = hasDoor ? [[b.x - hw, b.x - DW / 2], [b.x + DW / 2, b.x + hw]] : [[b.x - hw, b.x + hw]];
      for (const [x0, x1] of parts) {
        const rows = all.filter(r => !(hasDoor && r === 8)).filter(r => !(slit && SLIT.includes(r)));
        logWall(b, zc, x0, x1, rows, 'x');
        if (slit) { box3(x0 - 0.1, y0, zc - T_ / 2, x1 + 0.1, y0 + 0.96, zc + T_ / 2); box3(x0 - 0.1, y0 + 1.44, zc - T_ / 2, x1 + 0.1, y0 + WH, zc + T_ / 2); }
        else box3(x0 - 0.1, y0, zc - T_ / 2, x1 + 0.1, y0 + WH, zc + T_ / 2);
      }
      if (hasDoor) { logWall(b, zc, b.x - DW / 2, b.x + DW / 2, [8], 'x'); box3(b.x - DW / 2, y0 + 1.92, zc - T_ / 2, b.x + DW / 2, y0 + WH, zc + T_ / 2); }
    }
    for (const sx of [-1, 1]) { logWall(b, b.x + sx * hw, b.z - hd, b.z + hd, all, 'z'); box3(b.x + sx * hw - T_ / 2, y0, b.z - hd, b.x + sx * hw + T_ / 2, y0 + WH, b.z + hd); }
    // roof
    const ry = y0 + WH, rw = b.w + 0.9, rd = b.d + 0.9;
    const nb = Math.ceil(rd / 0.9);
    for (let i = 0; i <= nb; i++) addCyl('log', b.x, ry + 0.12, b.z - rd / 2 + i * rd / nb, 0.12, 0.12, rw, 7, { rz: Math.PI / 2, tile: 0.9, t: 0.85 + R() * 0.2, caps: true });
    if (b.roof === 'tin') {
      addBox('corr', b.x, ry + 0.32, b.z, rw, 0.07, rd, { rx: 0.05, tile: 1.4 });
      bagRow(b.x, b.z + hd + 0.2, rw - 0.4, 2, true, ry + 0.36);
      bagRow(b.x, b.z - hd - 0.2, rw - 0.4, 1, true, ry + 0.36);
    } else {
      const nl = Math.ceil(rd / 0.24);
      for (let i = 0; i < nl; i++) addCyl('log', b.x, ry + 0.36, b.z - rd / 2 + 0.12 + i * (rd - 0.24) / (nl - 1), 0.12, 0.12, rw, 6, { rz: Math.PI / 2, tile: 0.9, t: 0.75 + R() * 0.2, caps: true });
      const nr = Math.ceil((rd - 0.3) / 0.38), nc = Math.ceil((rw - 0.3) / 0.56);
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
        const x = b.x - (rw - 0.3) / 2 + (j + 0.5 + (i % 2) * 0.5) * (rw - 0.3) / nc, z = b.z - (rd - 0.3) / 2 + (i + 0.5) * (rd - 0.3) / nr;
        if (Math.abs(x - b.x) < rw / 2 - 0.1) bag(x, ry + 0.48, z, 0, 0.6);
      }
    }
    box3(b.x - rw / 2, ry, b.z - rd / 2, b.x + rw / 2, ry + 0.75, b.z + rd / 2);
    addBox('plank', b.x, y0 + 0.02, b.z, b.w - 0.3, 0.06, b.d - 0.3, { tile: 1.2, t: 0.7 });
    // sandbag bank in front (leaves a gap at the command bunker door)
    const bz = b.z + hd + 0.55, bl = b.w + 1.2;
    if (b.door === 'S') {
      const gx = DW / 2 + 0.9, l1 = bl / 2 - gx;
      for (const sx of [-1, 1]) { const cx = b.x + sx * (gx + l1 / 2); bagRow(cx, bz, l1, 3, true, y0 - 0.02); box3(cx - l1 / 2, y0 - 0.2, bz - 0.22, cx + l1 / 2, y0 + 0.8, bz + 0.22); }
    } else { bagRow(b.x, bz, bl, 3, true, y0 - 0.02); box3(b.x - bl / 2, y0 - 0.2, bz - 0.22, b.x + bl / 2, y0 + 0.8, bz + 0.22); }
    if (b.cmd) { // flag pole base on the roof
      const py = ry + 0.75;
      addCyl('log', b.x, py + 2.6, b.z, 0.07, 0.05, 5.2, 8, { tile: 0.8, t: 0.9, caps: true });
      b.roofY = py; b.poleH = 5.2;
    }
  }

  function buildTank() {
    const y0 = groundHeightAt(TANK.x, TANK.z) + 0.02, yaw = TANK.yaw;
    const qy = new T.Quaternion().setFromAxisAngle(UP, yaw), la = new T.Euler();
    function P(lx, ly, lz) { return _v.set(lx, ly, lz).applyQuaternion(qy); }
    function part(kind, lx, ly, lz, sx, sy, sz, rx, ry, rz, t) {
      const p = P(lx, ly, lz); const x = TANK.x + p.x, y = y0 + p.y, z = TANK.z + p.z;
      _qb.copy(qy).multiply(_qa.setFromEuler(la.set(rx || 0, ry || 0, rz || 0, 'YXZ')));
      const q = _qb.clone();
      if (kind === 'b') addBox('tank', x, y, z, sx, sy, sz, { q, tile: 2.2, t: t || 1 });
      else addCyl('tank', x, y, z, sx, sx * (sz || 1), sy, 10, { q, tile: 1.6, t: t || 1, caps: true });
    }
    part('b', 0, 0.78, 0, 4.7, 0.75, 2.3, 0, 0, 0);
    part('b', -1.3, 1.32, 0, 2.2, 0.35, 2.4, 0, 0, 0, 0.9);
    part('b', 2.05, 1.12, 0, 1.4, 0.1, 2.2, 0, 0, -0.55);
    part('b', 2.45, 0.7, 0, 0.4, 0.55, 2.2, 0, 0, 0);
    for (const sz of [-1, 1]) {
      part('b', 0, 0.55, sz * 1.38, 4.7, 0.62, 0.5, 0, 0, 0, 0.55);
      part('b', 0, 1.02, sz * 1.5, 4.3, 0.07, 0.66, 0, 0, 0, 0.85);
      for (let i = 0; i < 5; i++) part('c', -1.8 + i * 0.9, 0.34, sz * 1.64, 0.3, 0.14, 1, Math.PI / 2, 0, 0, 0.7);
      part('c', -2.45, 0.46, sz * 1.64, 0.38, 0.16, 1, Math.PI / 2, 0, 0, 0.75);
      part('c', 2.45, 0.42, sz * 1.64, 0.32, 0.16, 1, Math.PI / 2, 0, 0, 0.75);
    }
    part('c', -0.35, 1.72, 0.1, 0.98, 0.55, 0.92, 0, 0.26, 0, 1);
    part('b', 0.7, 1.74, 0.38, 0.55, 0.5, 0.75, 0, 0.26, 0, 0.9);
    part('c', 2.0, 1.55, 0.78, 0.055, 3.0, 1, 0, 0.26, Math.PI / 2 + 0.14, 0.7);
    part('c', 0.0, 2.08, -0.15, 0.3, 0.2, 1, 0, 0, 0, 0.9);
    part('b', -0.7, 2.12, 0.5, 0.6, 0.05, 0.5, 0.2, 0.5, 0.5, 0.8); // propped-open hatch
    part('b', -2.4, 1.28, 0.9, 0.9, 0.5, 0.1, 0, 0.7, 0.5, 0.6); // loose plate
    // collider: AABB of rotated hull
    const c = Math.cos(yaw), s = Math.sin(yaw), ex = 2.9 * Math.abs(c) + 1.7 * Math.abs(s), ez = 2.9 * Math.abs(s) + 1.7 * Math.abs(c);
    box3(TANK.x - ex, y0, TANK.z - ez, TANK.x + ex, y0 + 2.3, TANK.z + ez);
  }

  const LEAF = { bamboo: [0, 0, 0.5, 1], banana: [0.5, 0, 0.75, 1], grass: [0.75, 0, 1, 1] };
  function bambooClump(x, z, collide) {
    const y = groundHeightAt(x, z), n = 7 + ((R() * 6) | 0);
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, rr = R() * 0.55, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, h = 5 + R() * 5, lean = 0.05 + R() * 0.13, la = R() * TAU;
      const dx = Math.cos(la), dz = Math.sin(la), tx = px + dx * Math.sin(lean) * h, tz = pz + dz * Math.sin(lean) * h;
      addCyl('bamboo', (px + tx) / 2, y + h * Math.cos(lean) / 2, (pz + tz) / 2, 0.045, 0.028, h, 5, { rx: lean * dz, rz: -lean * dx, tile: 1.6, t: 0.85 + R() * 0.3 });
      for (let k = 0; k < 4; k++) {
        const f = 0.6 + R() * 0.4, lx = lerp(px, tx, f), lz = lerp(pz, tz, f), ly = y + h * Math.cos(lean) * f;
        const w = 1.5 + R() * 1, yw = R() * Math.PI, tl = 0.35 + R() * 0.4, g = 0.75 + R() * 0.4;
        addCard('foliage', lx, ly - w * 0.55, lz, w * 1.6, w * 1.4, yw, tl, LEAF.bamboo, [g * 0.9, g, g * 0.8]);
        addCard('foliage', lx, ly - w * 0.55, lz, w * 1.6, w * 1.4, yw + Math.PI / 2, tl, LEAF.bamboo, [g * 0.9, g, g * 0.8]);
      }
    }
    if (collide) box3(x - 0.6, y - 0.5, z - 0.6, x + 0.6, y + 3, z + 0.6);
  }
  function bananaTree(x, z, collide) {
    const y = groundHeightAt(x, z), h = 2.4 + R() * 1;
    addCyl('bamboo', x, y + h / 2, z, 0.13, 0.095, h, 6, { tile: 1.2, t: [0.78, 0.95, 0.6], caps: true });
    const nl = 7 + ((R() * 3) | 0);
    for (let i = 0; i < nl; i++) {
      const a = i / nl * TAU + R() * 0.5, dx = Math.cos(a), dz = Math.sin(a), g = 0.75 + R() * 0.35, wd = 0.5 + R() * 0.1;
      const p0 = [x, y + h, z], L1 = 1.3, L2 = 1.5 + R() * 0.5, up1 = 0.85 + R() * 0.3;
      const p1 = [p0[0] + dx * L1, p0[1] + up1, p0[2] + dz * L1], p2 = [p1[0] + dx * L2, p1[1] - 0.15 - R() * 0.8, p1[2] + dz * L2];
      const px = -dz * wd, pz = dx * wd, tc = [g * 0.85, g, g * 0.75], u = LEAF.banana;
      const mid = u[1] + (u[3] - u[1]) * 0.5;
      addQuad('foliage', [[p0[0] - px * 0.3, p0[1], p0[2] - pz * 0.3], [p0[0] + px * 0.3, p0[1], p0[2] + pz * 0.3], [p1[0] + px, p1[1], p1[2] + pz], [p1[0] - px, p1[1], p1[2] - pz]], [u[0], u[1], u[2], mid], tc);
      addQuad('foliage', [[p1[0] - px, p1[1], p1[2] - pz], [p1[0] + px, p1[1], p1[2] + pz], [p2[0] + px * 0.2, p2[1], p2[2] + pz * 0.2], [p2[0] - px * 0.2, p2[1], p2[2] - pz * 0.2]], [u[0], mid, u[2], u[3]], tc);
    }
    if (collide) box3(x - 0.25, y - 0.5, z - 0.25, x + 0.25, y + 3, z + 0.25);
  }
  function burntTree(x, z, collide) {
    const y = groundHeightAt(x, z) - 0.1, H = 4 + R() * 5, r0 = 0.2 + R() * 0.2, lean = (R() - 0.5) * 0.12, la = R() * TAU;
    const dx = Math.cos(la), dz = Math.sin(la);
    addCyl('bark', x + dx * Math.sin(lean) * H / 2, y + H / 2, z + dz * Math.sin(lean) * H / 2, r0 * 0.55, r0, H, 8, { rx: lean * dz, rz: -lean * dx, tile: 1.1, t: 0.9 + R() * 0.2, caps: true });
    const nb = 2 + ((R() * 3) | 0);
    for (let i = 0; i < nb; i++) {
      const f = 0.45 + R() * 0.5, a = R() * TAU, bl = 0.8 + R() * 1.6, up = 0.5 + R() * 0.6, bx = x + dx * Math.sin(lean) * H * f, bz = z + dz * Math.sin(lean) * H * f, by = y + H * f;
      const ex = bx + Math.cos(a) * bl, ez = bz + Math.sin(a) * bl, ey = by + up * bl * 0.6;
      addBeam('bark', bx, by, bz, ex, ey, ez, 0.11, { tile: 1, t: 0.8 });
    }
    if (collide) box3(x - 0.3, y - 0.5, z - 0.3, x + 0.3, y + H, z + 0.3);
  }
  function fallenLog(x, z, yaw, len, r) {
    const h0 = groundHeightAt(x - Math.sin(yaw) * len / 2, z - Math.cos(yaw) * len / 2), h1 = groundHeightAt(x + Math.sin(yaw) * len / 2, z + Math.cos(yaw) * len / 2);
    const y0 = Math.max(h0, h1) + r * 0.7;
    addCyl('bark', x, y0, z, r, r * 0.85, len, 8, { rx: Math.PI / 2, ry: yaw + Math.PI, tile: 1, t: 0.9, caps: true });
  }
  function tarpShelter(x, z, yaw) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), y0 = groundHeightAt(x, z);
    const W = 3.2, D = 2.4;
    for (const [lx, lz, hh] of [[-W / 2, -D / 2, 2.0], [W / 2, -D / 2, 2.0], [-W / 2, D / 2, 1.3], [W / 2, D / 2, 1.3]]) {
      const px = x + lx * cy + lz * sy, pz = z - lx * sy + lz * cy;
      const gy = groundHeightAt(px, pz);
      addCyl('log', px, gy + hh / 2, pz, 0.06, 0.06, hh, 6, { tile: 0.8, caps: true });
      box3(px - 0.1, gy, pz - 0.1, px + 0.1, gy + hh, pz + 0.1);
    }
    addBox('tarp', x, y0 + 1.72, z, W + 0.4, 0.05, D + 0.5, { ry: yaw, rx: 0.3, tile: 1.6, t: 0.92 });
    addBox('plank', x, y0 + 0.05, z, W - 0.4, 0.08, D - 0.4, { ry: yaw, tile: 1.2, t: 0.6 });
  }
  function crateGroup(x, z, i) {
    const y = groundHeightAt(x, z), yaw = i * 0.9;
    addBox('plank', x, y + 0.23, z, 0.95, 0.46, 0.58, { ry: yaw, tile: 0.9, t: [0.62, 0.72, 0.5] });
    addBox('plank', x + 0.1, y + 0.7, z + 0.05, 0.8, 0.44, 0.5, { ry: yaw + 0.4, tile: 0.9, t: [0.58, 0.68, 0.48] });
    addBox('plank', x - 0.9 * Math.cos(yaw), y + 0.22, z + 0.9 * Math.sin(yaw), 0.7, 0.42, 0.45, { ry: yaw - 0.3, tile: 0.9, t: [0.66, 0.74, 0.54] });
    addBox('tarp', x + 0.5, y + 0.1, z - 0.7, 0.7, 0.2, 0.5, { ry: 0.2, tile: 0.9, t: 0.85 });
  }
  function buildWire(w) {
    const runs = []; let a = w.x0;
    for (const g of w.gaps.slice().sort((p, q) => p[0] - q[0])) { if (g[0] > a) runs.push([a, g[0]]); a = g[1]; }
    if (a < w.x1) runs.push([a, w.x1]);
    for (const [r0, r1] of runs) {
      const n = Math.max(1, Math.round((r1 - r0) / 2.6)), st = (r1 - r0) / n, pts = [];
      for (let i = 0; i <= n; i++) {
        const x = r0 + i * st, z = w.z + (R() - 0.5) * 0.3, y = groundHeightAt(x, z);
        pts.push([x, y, z]);
        addCyl('log', x, y + 0.6, z, 0.035, 0.03, 1.35, 5, { rz: (R() - 0.5) * 0.12, tile: 0.6, t: 0.8, caps: true });
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[i + 1];
        for (const hh of [0.35, 0.7, 1.05]) addBeam('wire', p[0], p[1] + hh, p[2], q[0], q[1] + hh - 0.04, q[2], 0.014, { t: 1 });
        addBeam('wire', p[0], p[1] + 0.3, p[2], q[0], q[1] + 1.0, q[2], 0.012, { t: 1 });
        addBeam('wire', p[0], p[1] + 1.0, p[2], q[0], q[1] + 0.3, q[2], 0.012, { t: 1 });
      }
      for (let s0 = r0; s0 < r1 - 0.01; s0 += 6) {
        const s1 = Math.min(r1, s0 + 6); let lo = 1e9, hi = -1e9;
        for (let x = s0; x <= s1; x += 1) { const y = groundHeightAt(x, w.z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        box3(s0, lo - 0.1, w.z - 0.3, s1, hi + 1.1, w.z + 0.3);
      }
    }
  }

  // ======================= canvas helpers (local textures) =======================
  function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function leafAtlas() {
    const c = cv(512, 256), x = c.getContext('2d'), r = mkRng(5);
    function leaf(bx, by, ang, L, w, c0, c1) {
      const tx = bx + Math.cos(ang) * L, ty = by + Math.sin(ang) * L, mx = (bx + tx) / 2, my = (by + ty) / 2, px = -Math.sin(ang) * w, py = Math.cos(ang) * w;
      const gr = x.createLinearGradient(bx, by, tx, ty); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      x.fillStyle = gr; x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(mx + px, my + py, tx, ty); x.quadraticCurveTo(mx - px, my - py, bx, by); x.fill();
      x.strokeStyle = 'rgba(190,200,120,0.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(bx, by); x.lineTo(tx, ty); x.stroke();
    }
    for (let i = 0; i < 52; i++) { // bamboo tuft
      const a = -Math.PI / 2 + (r() - 0.5) * 2.3, g = 100 + r() * 50;
      leaf(128 + (r() - 0.5) * 24, 252, a, 80 + r() * 130, 6 + r() * 7, 'rgb(' + (50 + r() * 30 | 0) + ',' + (g * 0.8 | 0) + ',36)', 'rgb(' + (80 + r() * 30 | 0) + ',' + g + ',50)');
    }
    // banana leaf (one long leaf, ragged, with midrib + veins)
    x.fillStyle = 'rgb(84,128,50)'; x.beginPath(); x.moveTo(320, 254);
    for (let i = 0; i <= 20; i++) { const t = i / 20, hw = 52 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (0.9 + 0.1 * r()); x.lineTo(320 - hw + (r() - 0.5) * 6, 254 - t * 248); }
    for (let i = 20; i >= 0; i--) { const t = i / 20, hw = 52 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (0.9 + 0.1 * r()); x.lineTo(320 + hw + (r() - 0.5) * 6, 254 - t * 248); }
    x.fill();
    x.strokeStyle = 'rgba(150,170,80,0.5)'; x.lineWidth = 2; x.beginPath(); x.moveTo(320, 254); x.lineTo(320, 6); x.stroke();
    x.strokeStyle = 'rgba(40,70,24,0.35)'; x.lineWidth = 1;
    for (let i = 0; i < 34; i++) { const yy = 250 - i * 7; x.beginPath(); x.moveTo(320, yy); x.lineTo(320 - 50, yy - 16); x.moveTo(320, yy); x.lineTo(320 + 50, yy - 16); x.stroke(); }
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) { const yy = 40 + r() * 190, side = r() < 0.5 ? -1 : 1, hw = 52 * Math.sin(Math.PI * Math.pow((254 - yy) / 248, 0.7)); x.beginPath(); x.moveTo(320 + side * (hw + 4), yy); x.lineTo(320 + side * (hw - 22 - r() * 12), yy + 10); x.lineTo(320 + side * (hw + 4), yy + 14); x.fill(); }
    x.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 26; i++) { // dry grass tuft
      const a = -Math.PI / 2 + (r() - 0.5) * 1.5, L = 90 + r() * 150, bx = 448 + (r() - 0.5) * 14, c2 = [190 + r() * 40, 160 + r() * 30, 90 + r() * 30];
      leaf(bx, 254, a, L, 2.5 + r() * 2.5, 'rgb(' + (c2[0] * 0.6 | 0) + ',' + (c2[1] * 0.6 | 0) + ',' + (c2[2] * 0.5 | 0) + ')', 'rgb(' + (c2[0] | 0) + ',' + (c2[1] | 0) + ',' + (c2[2] | 0) + ')');
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function puffTex() {
    const c = cv(128, 128), x = c.getContext('2d'), r = mkRng(9);
    for (let i = 0; i < 26; i++) {
      const px = 64 + (r() - 0.5) * 50, py = 64 + (r() - 0.5) * 50, rad = 18 + r() * 26, g = x.createRadialGradient(px, py, 0, px, py, rad), s = 50 + r() * 40;
      g.addColorStop(0, 'rgba(' + s + ',' + (s - 4) + ',' + (s - 8) + ',0.30)'); g.addColorStop(1, 'rgba(' + s + ',' + (s - 4) + ',' + (s - 8) + ',0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }
    const mk = x.createRadialGradient(64, 64, 10, 64, 64, 64); mk.addColorStop(0, 'rgba(0,0,0,1)'); mk.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'destination-in'; x.fillStyle = mk; x.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  function flagTex() {
    const c = cv(256, 170), x = c.getContext('2d');
    x.fillStyle = '#c8201e'; x.fillRect(0, 0, 256, 170);
    x.fillStyle = '#ffde1a'; x.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 22 : 56; x.lineTo(128 + Math.cos(a) * rr, 85 + Math.sin(a) * rr); }
    x.closePath(); x.fill();
    const r = mkRng(3); for (let i = 0; i < 400; i++) { x.fillStyle = 'rgba(' + (r() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (0.03 + r() * 0.05) + ')'; x.fillRect(r() * 256, r() * 170, 2 + r() * 8, 1); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  const SUN = new T.Vector3(0.55, 0.62, 0.55).normalize(), HAZE = [214, 198, 166];
  function skyTex() {
    const W = 1024, H = 512, c = cv(W, H), ctx = c.getContext('2d'), im = ctx.createImageData(W, H), d = im.data;
    const zen = [88, 126, 176], low = [150, 174, 198], below = [160, 146, 120];
    const cl = new Float32Array(W), sl_ = new Float32Array(W);
    for (let x = 0; x < W; x++) { const lon = ((x + 0.5) / W - 0.5) * TAU; cl[x] = Math.cos(lon); sl_[x] = Math.sin(lon); }
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - (y + 0.5) / H) * Math.PI, sy = Math.sin(lat), cy = Math.cos(lat);
      for (let x = 0; x < W; x++) {
        const dx = cl[x] * cy, dz = sl_[x] * cy;
        let col;
        if (sy >= 0) { const t = Math.pow(clamp(sy, 0, 1), 0.5); const mid = lerp(0, 1, smooth(0, 0.4, sy)); col = [0, 1, 2].map(k => lerp(lerp(HAZE[k], low[k], mid), zen[k], t * t)); }
        else col = [0, 1, 2].map(k => lerp(HAZE[k], below[k], clamp(-sy * 3, 0, 1)));
        const dot = Math.max(0, dx * SUN.x + sy * SUN.y + dz * SUN.z), glow = Math.pow(dot, 6) * 0.35 + Math.pow(dot, 48) * 0.8;
        col[0] += 255 * glow * 0.9; col[1] += 225 * glow * 0.8; col[2] += 170 * glow * 0.6;
        if (dot > 0.9996) col = [255, 250, 235];
        if (sy > 0.02) {
          const px = dx / (sy + 0.22) * 1.4, pz = dz / (sy + 0.22) * 1.4;
          let n = 0, a = 1, f = 1.3, nn = 0; for (let o = 0; o < 4; o++) { n += a * vn2(px * f + 11, pz * f + 5); nn += a; a *= 0.5; f *= 2.1; }
          n /= nn; const cld = smooth(0.5, 0.74, n) * smooth(0.02, 0.22, sy), lit = 0.65 + 0.35 * dot;
          col = col.map((v, k) => lerp(v, [244, 232, 212][k] * lit + [186, 184, 184][k] * (1 - lit), cld * 0.7));
        }
        const i = (y * W + x) * 4; d[i] = clamp(col[0], 0, 255); d[i + 1] = clamp(col[1], 0, 255); d[i + 2] = clamp(col[2], 0, 255); d[i + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    const t = new T.CanvasTexture(c); t.mapping = T.EquirectangularReflectionMapping; t.colorSpace = T.SRGBColorSpace; return t;
  }

  // ======================= mountains / smoke =======================
  function buildMountains(scene) {
    const r = mkRng(31), pos = [], col = [];
    const N = 22;
    function tri(a, b, c, ca, cb, cc) { const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2], bx = c[0] - a[0], by = c[1] - a[1], bz = c[2] - a[2]; const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; if (ny >= 0) { pos.push(...a, ...b, ...c); col.push(...ca, ...cb, ...cc); } else { pos.push(...a, ...c, ...b); col.push(...ca, ...cc, ...cb); } }
    for (let m = 0; m < N; m++) {
      const ang = m / N * TAU + (r() - 0.5) * 0.2, cx = Math.cos(ang) * (185 + r() * 40), cz = Math.sin(ang) * (205 + r() * 35);
      const R0 = 45 + r() * 40, H = 30 + r() * 45, seg = 9, ring0 = [], ring1 = [];
      for (let i = 0; i < seg; i++) {
        const a = i / seg * TAU, j0 = 0.85 + r() * 0.35, j1 = 0.8 + r() * 0.4;
        ring0.push([cx + Math.cos(a) * R0 * j0, -6, cz + Math.sin(a) * R0 * j0 * 0.9]);
        ring1.push([cx + Math.cos(a) * R0 * 0.52 * j1, H * (0.5 + (r() - 0.5) * 0.25), cz + Math.sin(a) * R0 * 0.52 * j1 * 0.9]);
      }
      const apex = [cx + (r() - 0.5) * 10, H, cz + (r() - 0.5) * 10], g = 0.9 + r() * 0.2;
      const c0 = [0.22 * g, 0.31 * g, 0.24 * g], c1 = [0.3 * g, 0.4 * g, 0.34 * g], c2 = [0.42 * g, 0.5 * g, 0.44 * g];
      for (let i = 0; i < seg; i++) {
        const k = (i + 1) % seg;
        tri(ring0[i], ring0[k], ring1[i], c0, c0, c1); tri(ring0[k], ring1[k], ring1[i], c0, c1, c1); tri(ring1[i], ring1[k], apex, c1, c1, c2);
      }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const mesh = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.frustumCulled = false; mesh.name = 'mountains'; scene.add(mesh); return mesh;
  }
  function buildSmoke(scene, srcs) {
    const P = [], C = [], D = [], I = [], r = mkRng(77);
    srcs.forEach(([x, z], si) => {
      const y = groundHeightAt(x, z);
      for (let i = 0; i < 28; i++) {
        const ph = i / 28, data = [ph, 0.035 + r() * 0.015, 2.2 + r() * 1.6, r()], b = P.length / 3;
        for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(x + (r() - 0.5) * 1.2, y + 0.5, z + (r() - 0.5) * 1.2); C.push(cx, cy); D.push(...data); }
        I.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('aCorner', new T.Float32BufferAttribute(C, 2)); g.setAttribute('aData', new T.Float32BufferAttribute(D, 4)); g.setIndex(I);
    const mat = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { map: { value: puffTex() }, uTime: { value: 0 } }]),
      vertexShader: 'attribute vec2 aCorner; attribute vec4 aData; uniform float uTime; varying vec2 vUv; varying float vAlpha;\n#include <fog_pars_vertex>\nvoid main(){ float f = fract(aData.x + uTime*aData.y); vec3 p = position; p.y += f*28.0; p.x += f*f*10.0 + sin(uTime*0.4 + aData.w*6.28)*f*1.8; p.z += f*3.0*sin(aData.w*6.28); float sz = aData.z*(0.5 + f*2.4); vec4 mvPosition = modelViewMatrix*vec4(p,1.0); mvPosition.xy += aCorner*sz; gl_Position = projectionMatrix*mvPosition; vUv = aCorner*0.5+0.5; vAlpha = smoothstep(0.0,0.1,f)*(1.0-smoothstep(0.5,1.0,f));\n#include <fog_vertex>\n}',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying float vAlpha;\n#include <fog_pars_fragment>\nvoid main(){ vec4 t = texture2D(map, vUv); float a = t.a*vAlpha*0.6; if(a < 0.01) discard; gl_FragColor = vec4(t.rgb, a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>\n}',
      transparent: true, depthWrite: false, fog: true,
    });
    const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'smoke';
    mesh.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
    scene.add(mesh); return mesh;
  }

  // ======================= terrain =======================
  const TX0 = -80, TX1 = 80, TZ0 = -118, TZ1 = 118, CELL = 0.75;
  function buildTerrain(scene, tex) {
    const nx = Math.round((TX1 - TX0) / CELL), nz = Math.round((TZ1 - TZ0) / CELL), vx = nx + 1, vz = nz + 1, cnt = vx * vz;
    const P = new Float32Array(cnt * 3), Nn = new Float32Array(cnt * 3), U = new Float32Array(cnt * 2), M = new Float32Array(cnt * 2), Cc = new Float32Array(cnt * 3), H = new Float32Array(cnt);
    const sx = (TX1 - TX0) / nx, sz = (TZ1 - TZ0) / nz;
    for (let j = 0, k = 0; j < vz; j++) for (let i = 0; i < vx; i++, k++) {
      const x = TX0 + i * sx, z = TZ0 + j * sz, hf = heightFlat(x, z); trench(x, z);
      const h = hf - TR.c; H[k] = h;
      P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = z; U[k * 2] = x / 5; U[k * 2 + 1] = z / 5;
      const ch = craterH(x, z);
      let mud = TR.f * 0.95 + smooth(0.25, 0.9, -ch) * 0.75;
      for (const s of SMOKE) mud = Math.max(mud, (1 - smooth(1.2, 5.5, Math.hypot(x - s[0], z - s[1]))) * 0.9);
      mud = clamp(mud, 0, 1);
      let g = smooth(0.42, 0.72, vn2(x * 0.09 + 3, z * 0.09) * 0.65 + vn2(x * 0.31, z * 0.31) * 0.35);
      g = clamp(g + 0.35 * smooth(55, 78, z) + 0.4 * smooth(46, 62, Math.abs(x)), 0, 1) * (1 - mud) * (1 - 0.5 * smooth(-62, -76, z));
      M[k * 2] = g; M[k * 2 + 1] = mud;
      let sh = 1 - 0.38 * TR.f - 0.18 * smooth(0.3, 1.0, -ch); const ed = smooth(50, 64, Math.abs(x));
      Cc[k * 3] = sh * (1 - 0.1 * ed); Cc[k * 3 + 1] = sh * (1 - 0.02 * ed); Cc[k * 3 + 2] = sh * (1 - 0.18 * ed);
    }
    for (let j = 0, k = 0; j < vz; j++) for (let i = 0; i < vx; i++, k++) {
      const hl = H[j * vx + Math.max(i - 1, 0)], hr = H[j * vx + Math.min(i + 1, vx - 1)], hd = H[Math.max(j - 1, 0) * vx + i], hu = H[Math.min(j + 1, vz - 1) * vx + i];
      let a = hl - hr, b = 2 * sx, c = hd - hu; const l = Math.hypot(a, b, c); Nn[k * 3] = a / l; Nn[k * 3 + 1] = b / l; Nn[k * 3 + 2] = c / l;
    }
    const idx = new Uint32Array(nx * nz * 6); let q = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('normal', new T.BufferAttribute(Nn, 3)); g.setAttribute('uv', new T.BufferAttribute(U, 2));
    g.setAttribute('aMix', new T.BufferAttribute(M, 2)); g.setAttribute('color', new T.BufferAttribute(Cc, 3)); g.setIndex(new T.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mat = new T.MeshLambertMaterial({ map: tex('laterite'), vertexColors: true });
    const tg = tex('grass_dry'), tm = tex('trench_mud');
    mat.onBeforeCompile = sh => {
      sh.uniforms.mapG = { value: tg }; sh.uniforms.mapM = { value: tm };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aMix; varying vec2 vMix; varying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMix = aMix; vWXZ = position.xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D mapG; uniform sampler2D mapM; varying vec2 vMix; varying vec2 vWXZ;')
        .replace('#include <map_fragment>', [
          'vec4 tl = texture2D(map, vMapUv);',
          'vec4 tg = texture2D(mapG, vWXZ / 4.0);',
          'vec4 tm = texture2D(mapM, vWXZ / 3.0);',
          'float macro = texture2D(map, vWXZ * 0.021 + vec2(0.37, 0.11)).g;',
          'vec4 texel = mix(tl, tg, clamp(vMix.x, 0.0, 1.0));',
          'texel = mix(texel, tm, clamp(vMix.y, 0.0, 1.0));',
          'texel.rgb *= 0.7 + 0.6 * macro;',
          'diffuseColor *= texel;'].join('\n'));
    };
    mat.customProgramCacheKey = () => 'dbp_terrain';
    const mesh = new T.Mesh(g, mat);
    mesh.name = 'terrain'; mesh.receiveShadow = true; mesh.userData.surface = 'dirt';
    // fast analytic ray-march against the same height function (instead of testing ~130k triangles)
    const nrm = new T.Vector3();
    function hAt(x, z) { return groundHeightAt(x, z); }
    mesh.raycast = function (rc, out) {
      const o = rc.ray.origin, d = rc.ray.direction, far = Math.min(rc.far, 500);
      let t = Math.max(rc.near, 0), cl = o.y + d.y * t - hAt(o.x + d.x * t, o.z + d.z * t);
      if (cl <= 0) return;
      while (t < far) {
        const y = o.y + d.y * t; if (y > 48 && d.y >= 0) return;
        const step = clamp(cl * 0.45, 0.1, 4), t2 = Math.min(t + step, far + 0.0001);
        const c2 = o.y + d.y * t2 - hAt(o.x + d.x * t2, o.z + d.z * t2);
        if (c2 <= 0) {
          let lo = t, hi = t2;
          for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (o.y + d.y * mid - hAt(o.x + d.x * mid, o.z + d.z * mid) > 0) lo = mid; else hi = mid; }
          const td = (lo + hi) / 2; if (td > far) return;
          const px = o.x + d.x * td, pz = o.z + d.z * td, e = 0.25;
          nrm.set(hAt(px - e, pz) - hAt(px + e, pz), 2 * e, hAt(px, pz - e) - hAt(px, pz + e)).normalize();
          out.push({ distance: td, point: new T.Vector3(px, hAt(px, pz), pz), object: mesh, face: { a: 0, b: 0, c: 0, normal: nrm.clone(), materialIndex: 0 }, faceIndex: 0 });
          return;
        }
        t = t2; cl = c2;
      }
    };
    scene.add(mesh);
    return mesh;
  }

  // ======================= build =======================
  function build(scene) {
    BATCH = {}; R = mkRng(1954); colliders.length = 0; ROCKGEO = null;
    const tex = n => G.Tex.get(n);

    // lights, fog, sky
    scene.fog = new T.FogExp2(0xd6c6a6, 0.0058);
    scene.background = skyTex();
    const hemi = new T.HemisphereLight(0xbcd0ea, 0x7a5c3c, 1.35); scene.add(hemi);
    const sun = new T.DirectionalLight(0xffe2b4, 2.5);
    const focus = new T.Vector3(0, 6, -5);
    sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(SUN, 200);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -125, right: 125, top: 125, bottom: -125, near: 10, far: 440 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06;
    scene.add(sun); scene.add(sun.target);

    const terrain = buildTerrain(scene, tex);
    buildMountains(scene);

    // structures
    buildTrenches();
    BUNKERS.forEach(buildBunker);
    buildTank();
    WIRES.forEach(buildWire);
    TARPS.forEach(t => tarpShelter(t[0], t[1], t[2]));
    CRATES.forEach((c, i) => crateGroup(c[0], c[1], i));

    // vegetation & scatter
    let n = 0, tries = 0;
    while (n < 16 && tries++ < 400) { const x = (R() * 2 - 1) * 54, z = 70 + R() * 25; if (free(x, z, 1.2) && Math.abs(x) > 8) { bambooClump(x, z, true); n++; } }
    n = 0; tries = 0;
    while (n < 24 && tries++ < 400) { const sg = R() < 0.5 ? -1 : 1, x = sg * (54 + R() * 14), z = -92 + R() * 182; bambooClump(x, z, Math.abs(x) < 59); n++; }
    n = 0; tries = 0;
    while (n < 14 && tries++ < 400) { const x = (R() * 2 - 1) * 54, z = 60 + R() * 34; if (free(x, z, 1) && Math.abs(x) > 7) { bananaTree(x, z, true); n++; } }
    n = 0; tries = 0;
    while (n < 6 && tries++ < 200) { const x = (R() * 2 - 1) * 50, z = -60 + R() * 110; if (free(x, z, 1.5)) { bananaTree(x, z, true); n++; } }
    n = 0; tries = 0;
    while (n < 30 && tries++ < 600) { const x = (R() * 2 - 1) * 54, z = -86 + R() * 130; if (free(x, z, 1.2)) { burntTree(x, z, true); n++; } }
    for (let i = 0; i < 12; i++) { const sg = R() < 0.5 ? -1 : 1; burntTree(sg * (56 + R() * 8), -90 + R() * 150, false); }
    n = 0; tries = 0;
    while (n < 9 && tries++ < 300) { const x = (R() * 2 - 1) * 50, z = -80 + R() * 150; if (free(x, z, 2.5)) { fallenLog(x, z, R() * Math.PI, 3 + R() * 2.5, 0.14 + R() * 0.1); n++; } }
    n = 0; tries = 0;
    while (n < 28 && tries++ < 600) {
      const x = (R() * 2 - 1) * 56, z = -86 + R() * 178, r = 0.45 + R() * R() * 1.1;
      if (!free(x, z, r + 0.5)) continue;
      const y = groundHeightAt(x, z); addRock(x, y + r * 0.1, z, r, 0.55 + R() * 0.3, R() * TAU, 0.85 + R() * 0.3);
      if (r > 0.75) box3(x - r * 0.85, y - 0.2, z - r * 0.85, x + r * 0.85, y + r * 0.75, z + r * 0.85);
      n++;
    }
    n = 0; tries = 0;
    while (n < 420 && tries++ < 3000) {
      const x = (R() * 2 - 1) * 58, z = -90 + R() * 184;
      if (vn2(x * 0.09 + 3, z * 0.09) < 0.4 || nearTrench(x, z, HW + WALL_T + 0.4) || inPads(x, z, -1) || nearWire(z, 0.5)) continue;
      const y = groundHeightAt(x, z) - 0.03, w = 0.6 + R() * 0.5, h = 0.4 + R() * 0.35, yw = R() * Math.PI, g = 0.75 + R() * 0.4;
      addCard('foliage', x, y, z, w, h, yw, 0.1, LEAF.grass, [g, g, g * 0.9]); addCard('foliage', x, y, z, w, h, yw + 1.57, 0.1, LEAF.grass, [g, g, g * 0.9]); n++;
    }

    // map boundary walls (invisible)
    box3(60, -30, -104, 66, 80, 104); box3(-66, -30, -104, -60, 80, 104); box3(-66, -30, 98, 66, 80, 104); box3(-66, -30, -104, 66, 80, -98);

    // ---- materials & meshes
    const lam = (map, extra) => new T.MeshLambertMaterial(Object.assign({ map: map ? tex(map) : null, vertexColors: true }, extra));
    const MAT = {
      log: [lam('log'), 'wood'], plank: [lam('plank'), 'wood'], sand: [lam('sandbag'), 'sandbag'], corr: [lam('corrugated', { side: T.DoubleSide }), 'metal'],
      rock: [lam('rock'), 'dirt'], bamboo: [lam('bamboo'), 'wood'], tank: [lam('tank_metal'), 'metal'], bark: [lam('burnt_bark'), 'wood'],
      tarp: [lam('canvas_tarp', { side: T.DoubleSide }), 'sandbag'], wire: [new T.MeshLambertMaterial({ color: 0x2c2b28, vertexColors: true }), null],
      foliage: [new T.MeshLambertMaterial({ map: leafAtlas(), vertexColors: true, alphaTest: 0.45, side: T.DoubleSide }), null],
    };
    const raycastMeshes = [terrain], meshes = [terrain];
    for (const k of Object.keys(BATCH)) {
      const bt = BATCH[k], a = bt.a; if (!a.i.length) continue;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(a.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(a.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(a.u, 2)); g.setAttribute('color', new T.Float32BufferAttribute(a.c, 3));
      g.setIndex(new T.BufferAttribute(new Uint32Array(a.i), 1)); g.computeBoundingSphere(); g.computeBoundingBox();
      const [mat, surf] = MAT[bt.key], mesh = new T.Mesh(g, mat);
      mesh.name = bt.key + '_' + bt.ch;
      const soft = bt.key === 'foliage' || bt.key === 'wire';
      mesh.castShadow = !soft; mesh.receiveShadow = true;
      if (surf) { mesh.userData.surface = surf; raycastMeshes.push(mesh); }
      scene.add(mesh); meshes.push(mesh);
    }
    BATCH = {};

    // smoke + flag
    buildSmoke(scene, SMOKE);
    const cmd = BUNKERS[BUNKERS.length - 1];
    const flagGeo = new T.PlaneGeometry(1.7, 1.1, 10, 4), flag = new T.Mesh(flagGeo, new T.MeshLambertMaterial({ map: flagTex(), side: T.DoubleSide }));
    flag.name = 'flag'; flag.castShadow = true;
    const fx = cmd.x + 0.07 + 0.85, fyLow = cmd.roofY + 0.9, fyHigh = cmd.roofY + cmd.poleH - 0.75;
    let prog = 0; const base = flagGeo.attributes.position.array.slice();
    flag.position.set(fx, fyLow, cmd.z);
    flag.onBeforeRender = () => {
      const t = performance.now() / 1000, p = flagGeo.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = base[i * 3], k = (x + 0.85) / 1.7; p.setZ(i, Math.sin(x * 4 - t * 4) * 0.09 * k + Math.sin(x * 9 - t * 6) * 0.025 * k); }
      p.needsUpdate = true;
    };
    scene.add(flag); meshes.push(flag);
    function setFlagProgress(v) { prog = clamp(v, 0, 1); flag.position.y = lerp(fyLow, fyHigh, prog); }

    const sp = new T.Vector3(0, groundHeightAt(0, 90), 90);
    const enemySpawns = SPAWNS.map(s => ({ pos: new T.Vector3(s[0], groundHeightAt(s[0], s[1]) + (BUNKERS.some(b => !b.cmd && b.x === s[0] && b.z === s[1]) ? 0.06 : 0), s[1]), yaw: Math.PI, kind: s[2], tier: s[3] }));
    const ammoCrates = CRATES.map(c => new T.Vector3(c[0], groundHeightAt(c[0], c[1]), c[1]));
    const objective = { pos: new T.Vector3(cmd.x, cmd.roofY + 0.2, cmd.z), radius: 8 };

    function setShadowFocus(p, half) {
      half = half || 70; sun.target.position.set(p.x, groundHeightAt(p.x, p.z), p.z); sun.position.copy(sun.target.position).addScaledVector(SUN, 200);
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half }); sun.shadow.camera.updateProjectionMatrix();
    }
    return {
      colliders: colliders.slice(), raycastMeshes, groundHeightAt,
      playerStart: { pos: sp, yaw: 0 }, enemySpawns, ammoCrates, objective,
      // extras (optional for main)
      meshes, sun, flag, setFlagProgress, setShadowFocus, bounds: { minX: -60, maxX: 60, minZ: -98, maxZ: 98 },
      trenchPieces: PIECES.map(p => ({ id: p.id, pts: p.pts.map(q => q.slice()) })), bunkers: BUNKERS.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d, y0: b.y0 })),
    };
  }
  return { build, groundHeightAt };
})();
