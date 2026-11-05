/* enemies.js — French Union infantry, Dien Bien Phu 1954: model, animation, AI.
   Plain script: reads global THREE, registers G.Enemies.
   Conventions: model front = local -Z; yaw is a rotation about +Y (same as a THREE camera),
   so forward = (-sin yaw, 0, -cos yaw). */
window.G = window.G || {};
(function () {
'use strict';
const T = THREE;

/* ------------------------------------------------------------------ helpers */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rgb = (c, f) => { f = f === undefined ? 1 : f; return 'rgb(' + clamp(Math.round(c[0] * f), 0, 255) + ',' + clamp(Math.round(c[1] * f), 0, 255) + ',' + clamp(Math.round(c[2] * f), 0, 255) + ')'; };
const rgba = (c, a, f) => { f = f === undefined ? 1 : f; return 'rgba(' + clamp(Math.round(c[0] * f), 0, 255) + ',' + clamp(Math.round(c[1] * f), 0, 255) + ',' + clamp(Math.round(c[2] * f), 0, 255) + ',' + a + ')'; };
function snd(name, opt) {
  const A = G.Audio;
  if (A && A.play) { try { A.play(name, opt); } catch (e) { /* audio must never break AI */ } }
}

/* ------------------------------------------------------------------ rig layout */
const B = { hips: 0, torso: 1, head: 2, uArmL: 3, lArmL: 4, uArmR: 5, lArmR: 6, thighL: 7, shinL: 8, thighR: 9, shinR: 10, weapon: 11 };
const NB = 12;
const REST = [[0, .95, 0], [0, 1.05, 0], [0, 1.47, 0], [-.21, 1.43, 0], [-.21, 1.16, 0], [.21, 1.43, 0], [.21, 1.16, 0],
  [-.10, .92, 0], [-.10, .47, 0], [.10, .92, 0], [.10, .47, 0], [.15, 1.28, -.10]];
const PARENT = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9, 1];
const L1 = .45, L2 = .40;           // thigh, shin (ankle to hip joint)
const ARM_A = .27, ARM_B = .26;     // upper arm, forearm+hand centre
const W0 = [.15, .23, -.10];        // weapon pivot in torso space (rest)
const SH_Y = .38;                   // shoulder height in torso space

/* ------------------------------------------------------------------ procedural atlas */
const TILE = 256, ATLAS = 1024;
const TL = { jacketFront: 0, jacketBack: 1, trousers: 2, face: 3, hair: 4, helmet: 5, bushhat: 6, webbing: 7, boot: 8, wood: 9, metal: 10, liner: 11, skin: 12 };
function tileUV(i) { const c = i % 4, r = (i / 4) | 0, e = 0.004; return [c / 4 + e, 1 - (r + 1) / 4 + e, (c + 1) / 4 - e, 1 - r / 4 - e]; }

const VARIANTS = [
  { fab: [88, 94, 58], trs: [96, 98, 64], skin: [214, 168, 138], hair: [48, 36, 28], web: [140, 128, 90], boot: [66, 46, 32], net: [74, 80, 52], hat: [104, 104, 70] },
  { fab: [82, 88, 55], trs: [90, 92, 60], skin: [196, 146, 110], hair: [30, 24, 20], web: [128, 118, 84], boot: [58, 40, 28], net: [66, 72, 46], hat: [98, 96, 66] },
  { fab: [98, 102, 66], trs: [104, 104, 72], skin: [150, 104, 74], hair: [20, 16, 14], web: [150, 138, 98], boot: [72, 52, 36], net: [82, 86, 58], hat: [110, 108, 76] }
];

function noise(ctx, S, rng, n, a) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rng() < .5 ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + (a * .7) + ')';
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
}
function weave(ctx, S, step, a) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,' + a + ')';
  ctx.beginPath();
  for (let x = 0; x < S; x += step) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, S); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,' + (a * .6) + ')';
  ctx.beginPath();
  for (let y = 0; y < S; y += step) { ctx.moveTo(0, y + .5); ctx.lineTo(S, y + .5); }
  ctx.stroke();
}
function folds(ctx, S, rng, n, strength) {
  for (let i = 0; i < n; i++) {
    const sx = rng() * S, sy = rng() * S * .35, ex = sx + (rng() - .5) * 70, ey = S * (.5 + rng() * .5), cx = sx + (rng() - .5) * 50, cy = (sy + ey) / 2;
    const w = 3 + rng() * 5;
    ctx.lineCap = 'round';
    ctx.lineWidth = w; ctx.strokeStyle = 'rgba(0,0,0,' + (strength * (.6 + rng() * .6)) + ')';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    ctx.lineWidth = w * .7; ctx.strokeStyle = 'rgba(255,255,230,' + (strength * .55) + ')';
    ctx.beginPath(); ctx.moveTo(sx + w, sy); ctx.quadraticCurveTo(cx + w, cy, ex + w, ey); ctx.stroke();
  }
}
function blotches(ctx, S, rng, n, col, aMax, bias, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    const x = rng() * S, y = (bias ? (1 - Math.pow(rng(), 2.2)) : rng()) * S, r = rMin + rng() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, aMax * (.5 + rng() * .5)));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function stitch(ctx, x1, y1, x2, y2, col) {
  ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function fabricBase(ctx, S, col, rng, grain) {
  ctx.fillStyle = rgb(col); ctx.fillRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(255,255,235,.08)'); g.addColorStop(1, 'rgba(0,0,0,.16)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  weave(ctx, S, 3, grain || .05);
  noise(ctx, S, rng, 2600, .07);
}
function strap(ctx, x1, y1, x2, y2, w, col) {
  ctx.save(); ctx.lineCap = 'butt';
  ctx.strokeStyle = rgb(col, .7); ctx.lineWidth = w + 3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = rgb(col); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = rgba([0, 0, 0], .28); ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1, ox = nx / nl * (w / 2 - 2), oy = ny / nl * (w / 2 - 2);
  ctx.beginPath(); ctx.moveTo(x1 + ox, y1 + oy); ctx.lineTo(x2 + ox, y2 + oy); ctx.moveTo(x1 - ox, y1 - oy); ctx.lineTo(x2 - ox, y2 - oy); ctx.stroke();
  ctx.restore();
}
function pouch(ctx, x, y, w, h, col) {
  ctx.fillStyle = rgb(col, .78); ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgb(col, .95); ctx.fillRect(x, y, w, h * .42);
  ctx.strokeStyle = rgba([0, 0, 0], .45); ctx.lineWidth = 1.5; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.beginPath(); ctx.moveTo(x, y + h * .42); ctx.lineTo(x + w, y + h * .42); ctx.stroke();
  ctx.fillStyle = 'rgb(150,130,60)'; ctx.beginPath(); ctx.arc(x + w / 2, y + h * .42, 3, 0, TAU); ctx.fill();
}
function button(ctx, x, y) {
  ctx.fillStyle = 'rgba(30,26,18,.9)'; ctx.beginPath(); ctx.arc(x, y, 4.2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(200,190,150,.45)'; ctx.beginPath(); ctx.arc(x - 1.2, y - 1.2, 1.6, 0, TAU); ctx.fill();
}

const PAINT = [];
PAINT[TL.jacketFront] = function (ctx, S, V, rng) {
  fabricBase(ctx, S, V.fab, rng);
  // V-neck with skin, collar lapels
  ctx.fillStyle = rgb(V.skin, .8); ctx.beginPath(); ctx.moveTo(S * .36, 0); ctx.lineTo(S * .5, S * .2); ctx.lineTo(S * .64, 0); ctx.fill();
  ctx.fillStyle = rgb(V.fab, .7); ctx.beginPath(); ctx.moveTo(S * .3, 0); ctx.lineTo(S * .36, 0); ctx.lineTo(S * .5, S * .2); ctx.lineTo(S * .44, S * .24); ctx.fill();
  ctx.beginPath(); ctx.moveTo(S * .7, 0); ctx.lineTo(S * .64, 0); ctx.lineTo(S * .5, S * .2); ctx.lineTo(S * .56, S * .24); ctx.fill();
  // placket + buttons
  stitch(ctx, S * .5, S * .22, S * .5, S, rgba([0, 0, 0], .5));
  for (let i = 0; i < 4; i++) button(ctx, S * .5, S * (.3 + i * .15));
  // chest pockets
  for (let s = 0; s < 2; s++) {
    const px = s ? S * .66 : S * .12, pw = S * .22, py = S * .3;
    ctx.fillStyle = rgb(V.fab, .88); ctx.fillRect(px, py, pw, S * .2);
    ctx.strokeStyle = rgba([0, 0, 0], .5); ctx.lineWidth = 1.5; ctx.strokeRect(px, py, pw, S * .2);
    ctx.fillStyle = rgb(V.fab, .75); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw, py + S * .08); ctx.lineTo(px + pw / 2, py + S * .11); ctx.lineTo(px, py + S * .08); ctx.fill();
    ctx.stroke();
    button(ctx, px + pw / 2, py + S * .075);
    stitch(ctx, px + 4, py + S * .2 - 4, px + pw - 4, py + S * .2 - 4, rgba([0, 0, 0], .35));
  }
  // H-harness straps and belt with pouches
  strap(ctx, S * .16, 0, S * .60, S * .86, 15, V.web);
  strap(ctx, S * .84, 0, S * .40, S * .86, 15, V.web);
  ctx.fillStyle = rgb(V.web, .85); ctx.fillRect(0, S * .86, S, S * .14);
  stitch(ctx, 0, S * .88, S, S * .88, rgba([0, 0, 0], .4)); stitch(ctx, 0, S * .97, S, S * .97, rgba([0, 0, 0], .4));
  pouch(ctx, S * .14, S * .82, S * .2, S * .17, V.web); pouch(ctx, S * .66, S * .82, S * .2, S * .17, V.web);
  ctx.fillStyle = 'rgb(160,140,70)'; ctx.fillRect(S * .46, S * .875, S * .08, S * .08);
  folds(ctx, S, rng, 6, .11);
  blotches(ctx, S, rng, 14, [60, 46, 30], .28, true, 8, 30);
  blotches(ctx, S, rng, 5, [30, 30, 20], .2, false, 10, 26);
};
PAINT[TL.jacketBack] = function (ctx, S, V, rng) {
  fabricBase(ctx, S, V.fab, rng);
  stitch(ctx, S * .5, 0, S * .5, S, rgba([0, 0, 0], .4));
  stitch(ctx, 0, S * .22, S, S * .22, rgba([0, 0, 0], .3));
  stitch(ctx, 4, 0, 4, S, rgba([0, 0, 0], .35)); stitch(ctx, S - 4, 0, S - 4, S, rgba([0, 0, 0], .35));
  folds(ctx, S, rng, 10, .13);
  blotches(ctx, S, rng, 6, [40, 36, 22], .22, false, 14, 40);   // sweat / damp
  blotches(ctx, S, rng, 16, [66, 50, 32], .32, true, 8, 32);    // dirt
};
PAINT[TL.trousers] = function (ctx, S, V, rng) {
  fabricBase(ctx, S, V.trs, rng);
  stitch(ctx, 5, 0, 5, S, rgba([0, 0, 0], .4)); stitch(ctx, S - 5, 0, S - 5, S, rgba([0, 0, 0], .4));
  // thigh pocket
  ctx.fillStyle = rgb(V.trs, .86); ctx.fillRect(S * .2, S * .1, S * .6, S * .25);
  ctx.strokeStyle = rgba([0, 0, 0], .5); ctx.lineWidth = 1.5; ctx.strokeRect(S * .2, S * .1, S * .6, S * .25);
  button(ctx, S * .5, S * .2);
  // knee wrinkles
  for (let i = 0; i < 6; i++) {
    const y = S * (.55 + rng() * .15);
    ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 3 + rng() * 3; ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(S / 2, y + 10 + rng() * 10, S, y + rng() * 8); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,230,.07)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, y + 4); ctx.quadraticCurveTo(S / 2, y + 14 + rng() * 10, S, y + 4); ctx.stroke();
  }
  folds(ctx, S, rng, 5, .1);
  blotches(ctx, S, rng, 26, [70, 52, 34], .42, true, 8, 36);   // mud toward the hem
};
PAINT[TL.face] = function (ctx, S, V, rng) {
  ctx.fillStyle = rgb(V.skin); ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S * .5, S * .45, S * .1, S * .5, S * .5, S * .75);
  g.addColorStop(0, 'rgba(255,230,200,.18)'); g.addColorStop(1, 'rgba(60,20,10,.4)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // hairline shadow under helmet
  const h = ctx.createLinearGradient(0, 0, 0, S * .3); h.addColorStop(0, 'rgba(20,10,5,.7)'); h.addColorStop(1, 'rgba(20,10,5,0)');
  ctx.fillStyle = h; ctx.fillRect(0, 0, S, S * .3);
  // brows, eyes, nose, mouth
  ctx.fillStyle = rgb(V.hair, 1.1);
  ctx.fillRect(S * .2, S * .33, S * .24, S * .035); ctx.fillRect(S * .56, S * .33, S * .24, S * .035);
  for (let s = 0; s < 2; s++) {
    const ex = s ? S * .56 : S * .2;
    ctx.fillStyle = 'rgba(70,35,25,.45)'; ctx.fillRect(ex - 2, S * .38, S * .24 + 4, S * .1);
    ctx.fillStyle = 'rgb(225,215,200)'; ctx.fillRect(ex + S * .03, S * .41, S * .18, S * .045);
    ctx.fillStyle = 'rgb(50,34,22)'; ctx.fillRect(ex + S * .09, S * .41, S * .06, S * .045);
  }
  ctx.fillStyle = 'rgba(80,35,20,.35)'; ctx.beginPath(); ctx.moveTo(S * .5, S * .42); ctx.lineTo(S * .43, S * .64); ctx.lineTo(S * .57, S * .64); ctx.fill();
  ctx.fillStyle = 'rgba(40,10,10,.7)'; ctx.fillRect(S * .38, S * .74, S * .24, S * .028);
  ctx.fillStyle = 'rgba(120,50,40,.4)'; ctx.fillRect(S * .4, S * .765, S * .2, S * .03);
  blotches(ctx, S, rng, 40, V.hair, .18, true, 3, 9);          // stubble / grime
  noise(ctx, S, rng, 1800, .06);
};
PAINT[TL.hair] = function (ctx, S, V, rng) {
  ctx.fillStyle = rgb(V.skin, .92); ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = rgb(V.hair); ctx.fillRect(0, 0, S, S * .42);
  for (let i = 0; i < 160; i++) { ctx.fillStyle = rgba(V.hair, .5, 1.4 + rng() * .5); ctx.fillRect(rng() * S, rng() * S * .42, 1, 3 + rng() * 6); }
  const g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(50,20,10,.3)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  noise(ctx, S, rng, 1400, .06);
};
PAINT[TL.skin] = function (ctx, S, V, rng) {
  ctx.fillStyle = rgb(V.skin, .95); ctx.fillRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, 0, S, 0); g.addColorStop(0, 'rgba(255,230,200,.12)'); g.addColorStop(1, 'rgba(60,25,10,.32)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) { ctx.fillStyle = rgba(V.hair, .28); ctx.fillRect(rng() * S, rng() * S, 4 + rng() * 5, 1); }   // arm hair
  blotches(ctx, S, rng, 14, [70, 54, 38], .3, true, 6, 20);
  noise(ctx, S, rng, 1400, .06);
};
PAINT[TL.helmet] = function (ctx, S, V, rng) {
  ctx.fillStyle = rgb(V.net, .85); ctx.fillRect(0, 0, S, S);
  // diamond net mesh
  ctx.lineWidth = 2;
  for (let k = -S; k < S * 2; k += 14) {
    ctx.strokeStyle = 'rgba(20,24,12,.55)'; ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + S, S); ctx.stroke();
    ctx.strokeStyle = 'rgba(140,150,100,.35)'; ctx.beginPath(); ctx.moveTo(k + S, 0); ctx.lineTo(k, S); ctx.stroke();
  }
  // burlap / foliage strips
  const cols = [[96, 90, 56], [58, 70, 38], [110, 92, 58], [48, 54, 34]];
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = rgba(cols[(rng() * 4) | 0], .85); ctx.save();
    ctx.translate(rng() * S, rng() * S); ctx.rotate(rng() * Math.PI);
    ctx.fillRect(0, 0, 10 + rng() * 26, 3 + rng() * 4); ctx.restore();
  }
  blotches(ctx, S, rng, 12, [30, 26, 16], .35, false, 10, 28);
  noise(ctx, S, rng, 2200, .08);
  // rust specks and scuffs
  for (let i = 0; i < 30; i++) { ctx.fillStyle = 'rgba(120,70,30,.45)'; ctx.fillRect(rng() * S, rng() * S, 2, 2); }
};
PAINT[TL.bushhat] = function (ctx, S, V, rng) {
  fabricBase(ctx, S, V.hat, rng, .06);
  ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1.2;
  for (let r = 20; r < S * .7; r += 16) { ctx.beginPath(); ctx.arc(S / 2, S / 2, r, 0, TAU); ctx.setLineDash([4, 3]); ctx.stroke(); }
  ctx.setLineDash([]);
  blotches(ctx, S, rng, 10, [60, 50, 30], .35, false, 12, 36);
  folds(ctx, S, rng, 4, .08);
};
PAINT[TL.webbing] = function (ctx, S, V, rng) {
  fabricBase(ctx, S, V.web, rng, .09);
  for (let i = 0; i < 4; i++) stitch(ctx, 8, S * (.15 + i * .22), S - 8, S * (.15 + i * .22), 'rgba(0,0,0,.35)');
  stitch(ctx, 8, 8, 8, S - 8, 'rgba(0,0,0,.35)'); stitch(ctx, S - 8, 8, S - 8, S - 8, 'rgba(0,0,0,.35)');
  ctx.fillStyle = 'rgb(150,130,60)';
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(S * (.25 + i * .25), S * .5, 5, 0, TAU); ctx.fill(); }
  folds(ctx, S, rng, 4, .1);
  blotches(ctx, S, rng, 14, [60, 46, 30], .32, true, 8, 28);
};
PAINT[TL.boot] = function (ctx, S, V, rng) {
  ctx.fillStyle = rgb(V.boot); ctx.fillRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(255,230,200,.12)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) { const y = rng() * S; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5 + rng() * 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(S / 2, y + rng() * 14 - 7, S, y + rng() * 8); ctx.stroke(); }
  for (let i = 0; i < 6; i++) { ctx.strokeStyle = 'rgba(210,200,170,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(S * .35, S * (.1 + i * .08)); ctx.lineTo(S * .65, S * (.14 + i * .08)); ctx.stroke(); }
  ctx.fillStyle = 'rgba(15,12,10,.9)'; ctx.fillRect(0, S * .86, S, S * .14);
  blotches(ctx, S, rng, 26, [78, 58, 38], .5, true, 6, 26);
  noise(ctx, S, rng, 1600, .07);
};
PAINT[TL.wood] = function (ctx, S, V, rng) {
  ctx.fillStyle = 'rgb(104,70,40)'; ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) { const v = (rng() - .5) * 30; ctx.fillStyle = 'rgba(' + (v > 0 ? '255,220,170' : '30,15,5') + ',' + Math.abs(v) / 110 + ')'; ctx.fillRect(0, y, S, 2); }
  for (let i = 0; i < 6; i++) { const y = rng() * S; ctx.strokeStyle = 'rgba(40,20,8,.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(S * .3, y + 8, S * .6, y - 8, S, y + 3); ctx.stroke(); }
  blotches(ctx, S, rng, 10, [20, 14, 8], .35, false, 8, 26);   // oil / grime
  for (let i = 0; i < 12; i++) { ctx.fillStyle = 'rgba(200,170,120,.35)'; ctx.fillRect(rng() * S, rng() * S, 6 + rng() * 14, 1.5); }   // scratches
};
PAINT[TL.metal] = function (ctx, S, V, rng) {
  ctx.fillStyle = 'rgb(44,46,48)'; ctx.fillRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, 0, S, 0); g.addColorStop(0, 'rgba(255,255,255,.1)'); g.addColorStop(.5, 'rgba(255,255,255,.02)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) { ctx.strokeStyle = 'rgba(190,190,180,' + (.1 + rng() * .25) + ')'; ctx.lineWidth = 1; const x = rng() * S, y = rng() * S; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - .5) * 40, y + (rng() - .5) * 8); ctx.stroke(); }
  blotches(ctx, S, rng, 8, [110, 62, 30], .3, false, 6, 20);   // rust
  noise(ctx, S, rng, 2000, .08);
};
PAINT[TL.liner] = function (ctx, S, V, rng) {
  fabricBase(ctx, S, [52, 56, 36], rng, .06);
  blotches(ctx, S, rng, 8, [20, 18, 10], .3, false, 10, 30);
};

const atlasCache = {};
function getAtlas(vi) {
  if (atlasCache[vi]) return atlasCache[vi];
  const cv = document.createElement('canvas'); cv.width = cv.height = ATLAS;
  const ctx = cv.getContext('2d');
  const rng = mulberry32(1954 + vi * 77);
  for (let i = 0; i < 13; i++) {
    const x = (i % 4) * TILE, y = ((i / 4) | 0) * TILE;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, TILE, TILE); ctx.clip(); ctx.translate(x, y);
    PAINT[i](ctx, TILE, VARIANTS[vi], rng);
    ctx.restore();
  }
  const tex = new T.CanvasTexture(cv);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  atlasCache[vi] = tex;
  return tex;
}
const matCache = {};
function getMaterial(vi) {
  if (!matCache[vi]) matCache[vi] = new T.MeshLambertMaterial({ map: getAtlas(vi) });
  return matCache[vi];
}

/* ------------------------------------------------------------------ geometry builder (all rigid-bound to one bone) */
function GeoBuilder() { this.p = []; this.n = []; this.u = []; this.si = []; this.sw = []; this.ix = []; this.nv = 0; }
GeoBuilder.prototype.vert = function (b, x, y, z, nx, ny, nz, u, v) {
  const r = REST[b];
  this.p.push(x + r[0], y + r[1], z + r[2]); this.n.push(nx, ny, nz); this.u.push(u, v);
  this.si.push(b, 0, 0, 0); this.sw.push(1, 0, 0, 0); return this.nv++;
};
// planar polygon, flat normal, wound so the normal points away from `inside`
GeoBuilder.prototype.poly = function (b, pts, uvs, inside) {
  const a = pts[0], bb = pts[1], c = pts[2];
  const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = c[0] - bb[0], vy = c[1] - bb[1], vz = c[2] - bb[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (inside) {
    let cx = 0, cy = 0, cz = 0; for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    if (nx * (cx - inside[0]) + ny * (cy - inside[1]) + nz * (cz - inside[2]) < 0) { pts = pts.slice().reverse(); uvs = uvs.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
  }
  const base = this.nv;
  for (let i = 0; i < pts.length; i++) this.vert(b, pts[i][0], pts[i][1], pts[i][2], nx, ny, nz, uvs[i][0], uvs[i][1]);
  for (let i = 1; i < pts.length - 1; i++) this.ix.push(base, base + i, base + i + 1);
};
GeoBuilder.prototype.face = function (b, tile, BL, BR, TR, TLp, inside) {
  const t = tileUV(tile);
  this.poly(b, [BL, BR, TR, TLp], [[t[0], t[1]], [t[2], t[1]], [t[2], t[3]], [t[0], t[3]]], inside);
};
// vertical frustum box centred at (cx,cy,cz); wt/dt = top width/depth, wb/db = bottom
GeoBuilder.prototype.box = function (b, cx, cy, cz, wt, dt, wb, db, h, tSide, tFront, tTop) {
  tFront = tFront === undefined ? tSide : tFront; tTop = tTop === undefined ? tSide : tTop;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const c = (sx, sz, top) => top ? [cx + sx * wt / 2, y1, cz + sz * dt / 2] : [cx + sx * wb / 2, y0, cz + sz * db / 2];
  const ins = [cx, cy, cz];
  this.face(b, tFront, c(1, -1, 0), c(-1, -1, 0), c(-1, -1, 1), c(1, -1, 1), ins);
  this.face(b, tSide, c(-1, 1, 0), c(1, 1, 0), c(1, 1, 1), c(-1, 1, 1), ins);
  this.face(b, tSide, c(-1, -1, 0), c(-1, 1, 0), c(-1, 1, 1), c(-1, -1, 1), ins);
  this.face(b, tSide, c(1, 1, 0), c(1, -1, 0), c(1, -1, 1), c(1, 1, 1), ins);
  this.face(b, tTop, c(-1, 1, 1), c(1, 1, 1), c(1, -1, 1), c(-1, -1, 1), ins);
  this.face(b, tSide, c(-1, -1, 0), c(1, -1, 0), c(1, 1, 0), c(-1, 1, 0), ins);
};
// n-sided tapered tube between two points; sx/sz flatten the ring
GeoBuilder.prototype.tube = function (b, p0, p1, r0, r1, n, tSide, tCap, sx, sz, capA, capB) {
  sx = sx || 1; sz = sz || 1;
  let ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2]; const len = Math.hypot(ax, ay, az) || 1; ax /= len; ay /= len; az /= len;
  let rx = 0, ry = 1, rz = 0; if (Math.abs(ay) > .9) { rx = 1; ry = 0; }
  const d = rx * ax + ry * ay + rz * az; let ux = rx - ax * d, uy = ry - ay * d, uz = rz - az * d; const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
  const ring = (p, r, i) => { const a = i / n * TAU, ca = Math.cos(a) * r * sx, sa = Math.sin(a) * r * sz; return [p[0] + ux * ca + vx * sa, p[1] + uy * ca + vy * sa, p[2] + uz * ca + vz * sa]; };
  const t = tileUV(tSide), mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  const v0 = p0[1] >= p1[1] ? t[3] : t[1], v1 = p0[1] >= p1[1] ? t[1] : t[3];
  for (let i = 0; i < n; i++) {
    const ua = lerp(t[0], t[2], i / n), ub = lerp(t[0], t[2], (i + 1) / n);
    this.poly(b, [ring(p0, r0, i), ring(p0, r0, i + 1), ring(p1, r1, i + 1), ring(p1, r1, i)], [[ua, v0], [ub, v0], [ub, v1], [ua, v1]], mid);
  }
  const tc = tileUV(tCap || tSide);
  const cap = (p, r, inside) => {
    const pts = [], uvs = [];
    for (let i = 0; i < n; i++) { pts.push(ring(p, r, i)); const a = i / n * TAU; uvs.push([lerp(tc[0], tc[2], .5 + .45 * Math.cos(a)), lerp(tc[1], tc[3], .5 + .45 * Math.sin(a))]); }
    this.poly(b, pts, uvs, inside);
  };
  if (capA !== false) cap(p0, r0, p1);
  if (capB !== false) cap(p1, r1, p0);
};
// smooth-shaded dome / sphere
GeoBuilder.prototype.dome = function (b, cx, cy, cz, rx, ry, rz, seg, rings, phiMax, tile) {
  const t = tileUV(tile), base = this.nv;
  for (let r = 0; r <= rings; r++) {
    const phi = r / rings * phiMax, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let i = 0; i <= seg; i++) {
      const th = i / seg * TAU, x = rx * sp * Math.cos(th), y = ry * cp, z = rz * sp * Math.sin(th);
      let nx = x / (rx * rx), ny = y / (ry * ry), nz = z / (rz * rz); const l = Math.hypot(nx, ny, nz) || 1;
      this.vert(b, cx + x, cy + y, cz + z, nx / l, ny / l, nz / l, lerp(t[0], t[2], i / seg), lerp(t[3], t[1], r / rings));
    }
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < seg; i++) {
    const a = base + r * (seg + 1) + i, bb = a + 1, c = a + seg + 1, d = c + 1;
    if (r > 0) this.ix.push(a, bb, c);
    if (r < rings - 1 || phiMax < Math.PI - 1e-3) this.ix.push(bb, d, c);
  }
};
GeoBuilder.prototype.finish = function () {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
  g.setAttribute('skinIndex', new T.Uint16BufferAttribute(this.si, 4));
  g.setAttribute('skinWeight', new T.Float32BufferAttribute(this.sw, 4));
  g.setIndex(this.ix);
  g.userData.tris = this.ix.length / 3;
  return g;
};

const GRIP = {   // grip points in weapon space, and muzzle
  rifle: { R: [0, -.035, .03], L: [0, -.035, -.22], M: [0, .012, -.82] },
  smg: { R: [0, -.07, .02], L: [0, -.12, -.20], M: [0, .015, -.55] }
};

function buildGeometry(kind, hat, rolled, pack) {
  const g = new GeoBuilder();
  const J = TL.jacketBack, TR = TL.trousers, SK = TL.skin;
  // pelvis, torso, belt, kit
  g.box(B.hips, 0, -.015, 0, .35, .22, .33, .21, .19, TR);
  g.box(B.torso, 0, .20, 0, .40, .23, .33, .21, .44, J, TL.jacketFront);
  g.box(B.torso, 0, -.005, 0, .36, .235, .36, .235, .05, TL.webbing);
  g.box(B.torso, -.085, .04, -.13, .075, .05, .075, .05, .085, TL.webbing);
  g.box(B.torso, .085, .04, -.13, .075, .05, .075, .05, .085, TL.webbing);
  g.tube(B.torso, [.19, -.10, .03], [.19, .03, .03], .04, .04, 8, TL.liner, TL.metal);              // canteen
  g.tube(B.torso, [0, .38, -.015], [0, .45, -.015], .056, .05, 8, J, J, 1, 1.2, false, false);       // collar
  g.box(B.torso, -.17, .425, 0, .09, .07, .09, .07, .018, J); g.box(B.torso, .17, .425, 0, .09, .07, .09, .07, .018, J);   // epaulettes
  g.box(B.torso, -.10, .24, -.113, .085, .02, .085, .02, .09, J); g.box(B.torso, .10, .24, -.113, .085, .02, .085, .02, .09, J);   // chest pockets
  g.box(B.torso, 0, -.07, 0, .37, .24, .39, .25, .07, J);                                                                  // jacket hem
  if (pack) {
    g.box(B.torso, 0, .17, .15, .27, .09, .27, .09, .26, TL.webbing);
    g.tube(B.torso, [-.15, .33, .15], [.15, .33, .15], .045, .045, 8, TL.liner, TL.liner);
  }
  // neck, head, face details
  g.tube(B.head, [0, -.03, 0], [0, .07, 0], .042, .04, 8, SK, SK);
  g.box(B.head, 0, .13, 0, .15, .18, .125, .155, .20, TL.hair, TL.face);
  g.box(B.head, 0, .115, -.098, .022, .03, .03, .04, .045, SK);                                        // nose
  g.box(B.head, -.082, .12, .005, .02, .05, .02, .05, .06, SK); g.box(B.head, .082, .12, .005, .02, .05, .02, .05, .06, SK);
  if (hat === 'helmet') {
    g.dome(B.head, 0, .185, 0, .118, .09, .135, 10, 4, 1.82, TL.helmet);
    g.box(B.head, 0, .205, -.12, .09, .04, .09, .04, .05, TL.helmet);                                                          // net bunch
    g.tube(B.head, [-.075, .115, -.01], [-.04, .02, -.075], .006, .006, 4, TL.boot, TL.boot);                                 // chin strap
    g.tube(B.head, [.075, .115, -.01], [.04, .02, -.075], .006, .006, 4, TL.boot, TL.boot);
    g.tube(B.head, [0, .168, 0], [0, .112, 0], .133, .148, 10, TL.helmet, TL.liner, .9, 1, false, true);
  } else {
    g.dome(B.head, 0, .18, 0, .104, .075, .115, 8, 3, 1.6, TL.bushhat);
    g.tube(B.head, [0, .17, 0], [0, .158, 0], .205, .205, 10, TL.bushhat, TL.bushhat, .95, 1);
  }
  // arms: shoulder ball, upper arm, elbow ball, forearm, hand
  for (const s of [0, 1]) {
    const ua = s ? B.uArmR : B.uArmL, la = s ? B.lArmR : B.lArmL;
    g.dome(ua, 0, 0, 0, .06, .055, .06, 6, 2, Math.PI, J);
    g.tube(ua, [0, 0, 0], [0, -.27, 0], .047, .041, 8, J, J, 1, 1, false, false);
    g.dome(la, 0, 0, 0, .045, .04, .045, 6, 2, Math.PI, J);
    if (rolled) {
      g.tube(la, [0, -.01, 0], [0, -.085, 0], .047, .047, 8, J, J, 1, 1, true, true);
      g.tube(la, [0, -.085, 0], [0, -.19, 0], .036, .031, 8, SK, SK, 1, 1, false, false);
    } else {
      g.tube(la, [0, -.01, 0], [0, -.19, 0], .041, .033, 8, J, J, 1, 1, false, true);
    }
    g.box(la, 0, -.235, 0, .075, .05, .07, .05, .09, SK);
  }
  // legs: hip ball, thigh, knee ball, trouser leg, boot
  for (const s of [0, 1]) {
    const th = s ? B.thighR : B.thighL, sh = s ? B.shinR : B.shinL;
    g.dome(th, 0, 0, 0, .075, .07, .075, 6, 2, Math.PI, TR);
    g.tube(th, [0, 0, 0], [0, -.45, 0], .07, .053, 8, TR, TR, 1, 1, false, false);
    g.box(th, s ? .075 : -.075, -.17, -.01, .02, .09, .02, .09, .11, TR);                                                      // thigh pocket
    g.dome(sh, 0, 0, 0, .056, .05, .056, 6, 2, Math.PI, TR);
    g.tube(sh, [0, 0, 0], [0, -.28, 0], .053, .045, 8, TR, TR, 1, 1, false, true);
    g.tube(sh, [0, -.27, 0], [0, -.40, 0], .052, .05, 8, TL.boot, TL.boot, 1, 1, true, false);
    g.tube(sh, [0, -.20, 0], [0, -.30, 0], .056, .058, 8, TL.webbing, TL.webbing, 1, 1, false, false);                           // gaiter
    g.box(sh, 0, -.435, -.045, .085, .25, .09, .26, .07, TL.boot);
  }
  // weapon (rest geometry is relative to the weapon pivot)
  const W = B.weapon, Wd = TL.wood, Mt = TL.metal;
  if (kind === 'rifle') {          // MAS-36
    g.box(W, 0, -.03, .11, .03, .26, .034, .26, .085, Wd);
    g.box(W, 0, 0, -.10, .03, .16, .03, .16, .045, Mt);
    g.tube(W, [0, .012, -.18], [0, .012, -.82], .011, .009, 6, Mt, Mt);
    g.box(W, 0, -.003, -.36, .034, .30, .034, .30, .045, Wd);
    g.tube(W, [0, .03, -.03], [.055, .045, -.03], .006, .006, 4, Mt, Mt);
    g.box(W, .06, .047, -.03, .02, .02, .02, .02, .02, Mt);
    g.box(W, 0, .03, -.80, .01, .015, .01, .015, .03, Mt);
    g.box(W, 0, .035, -.06, .02, .03, .02, .03, .03, Mt);
    g.tube(W, [0, .012, -.46], [0, .012, -.47], .02, .02, 6, Mt, Mt); g.tube(W, [0, .012, -.62], [0, .012, -.63], .016, .016, 6, Mt, Mt);   // barrel bands
    g.tube(W, [.03, -.02, .30], [.03, -.02, -.60], .004, .004, 4, TL.boot, TL.boot);                                                    // sling
  } else {                          // MAT-49
    g.tube(W, [0, .015, .02], [0, .015, -.38], .032, .032, 8, Mt, Mt);
    g.tube(W, [0, .015, -.38], [0, .015, -.55], .019, .017, 6, Mt, Mt);
    g.box(W, 0, -.12, -.20, .03, .05, .03, .05, .22, Mt);
    g.box(W, 0, -.075, .03, .03, .04, .035, .045, .10, Wd);
    g.box(W, 0, .01, .13, .012, .22, .012, .22, .03, Mt);
    g.box(W, 0, .025, -.52, .01, .012, .01, .012, .03, Mt);
    g.box(W, 0, .038, -.02, .02, .04, .02, .04, .02, Mt);
    g.tube(W, [0, -.01, -.12], [0, -.01, -.30], .036, .036, 8, Mt, Mt, 1, .6, false, false);                                           // ventilated jacket
    g.tube(W, [.03, -.02, .22], [.03, -.02, -.50], .004, .004, 4, TL.boot, TL.boot);                                                    // sling
  }
  return g.finish();
}
const geoCache = {};
function getGeometry(kind, hat, rolled, pack) {
  const k = kind + hat + rolled + pack;
  if (!geoCache[k]) geoCache[k] = buildGeometry(kind, hat, rolled, pack);
  return geoCache[k];
}

/* ------------------------------------------------------------------ rig + vfx assets */
let flashGeo = null, flashMat = null;
function makeRig(geo, mat, kind) {
  const bones = [];
  for (let i = 0; i < NB; i++) {
    const b = new T.Bone();
    const r = REST[i], pr = PARENT[i] >= 0 ? REST[PARENT[i]] : [0, 0, 0];
    b.position.set(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2]);
    bones.push(b);
  }
  for (let i = 1; i < NB; i++) bones[PARENT[i]].add(bones[i]);
  const mesh = new T.SkinnedMesh(geo, mat);
  mesh.add(bones[0]);
  const group = new T.Group();
  group.add(mesh);
  group.updateMatrixWorld(true);
  mesh.bind(new T.Skeleton(bones));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  if (!flashGeo) {
    const p = [], ix = [];
    // two crossed pyramids pointing forward (-z)
    p.push(0, 0, 0, .05, 0, -.06, 0, .05, -.06, -.05, 0, -.06, 0, -.05, -.06, 0, 0, -.28);
    ix.push(0, 1, 5, 0, 2, 5, 0, 3, 5, 0, 4, 5, 0, 5, 1, 0, 5, 2, 0, 5, 3, 0, 5, 4);
    flashGeo = new T.BufferGeometry();
    flashGeo.setAttribute('position', new T.Float32BufferAttribute(p, 3)); flashGeo.setIndex(ix);
    flashMat = new T.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: .9, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending });
  }
  const flash = new T.Mesh(flashGeo, flashMat);
  const m = GRIP[kind].M;
  flash.position.set(m[0], m[1], m[2]);
  flash.visible = false;
  bones[B.weapon].add(flash);
  return { group, mesh, bones, flash };
}

function makePuffs(scene, n) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
  const pool = [];
  for (let i = 0; i < n; i++) {
    const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0xb5a888 });
    const s = new T.Sprite(mat); s.visible = false; scene.add(s);
    pool.push({ s, age: 1, life: .5, vy: 0, size: .2 });
  }
  let cursor = 0;
  return {
    spawn(x, y, z, count, size) {
      for (let k = 0; k < count; k++) {
        const p = pool[cursor]; cursor = (cursor + 1) % pool.length;
        p.age = 0; p.life = .38 + Math.random() * .22; p.vy = .25 + Math.random() * .3; p.size = size * (.7 + Math.random() * .6);
        p.s.position.set(x + (Math.random() - .5) * .12, y + (Math.random() - .5) * .08, z + (Math.random() - .5) * .12);
        p.s.visible = true; p.s.material.opacity = .5;
      }
    },
    update(dt) {
      for (const p of pool) {
        if (!p.s.visible) continue;
        p.age += dt;
        if (p.age >= p.life) { p.s.visible = false; p.s.material.opacity = 0; continue; }
        const k = p.age / p.life;
        p.s.position.y += p.vy * dt;
        const sc = p.size * (.6 + k * 1.6);
        p.s.scale.set(sc, sc, sc);
        p.s.material.opacity = .5 * (1 - k);
      }
    }
  };
}

/* ------------------------------------------------------------------ hit volumes (bone-local) */
const VOLS = [
  { b: B.head, sphere: true, c: [0, .15, 0], r: .14, part: 'head' },
  { b: B.torso, c: [0, .18, 0], h: [.20, .25, .12], part: 'body' },
  { b: B.hips, c: [0, -.01, 0], h: [.18, .11, .12], part: 'body' },
  { b: B.uArmL, c: [0, -.135, 0], h: [.055, .15, .055], part: 'limb' },
  { b: B.lArmL, c: [0, -.15, 0], h: [.05, .17, .05], part: 'limb' },
  { b: B.uArmR, c: [0, -.135, 0], h: [.055, .15, .055], part: 'limb' },
  { b: B.lArmR, c: [0, -.15, 0], h: [.05, .17, .05], part: 'limb' },
  { b: B.thighL, c: [0, -.225, 0], h: [.08, .24, .08], part: 'limb' },
  { b: B.shinL, c: [0, -.23, -.02], h: [.065, .25, .12], part: 'limb' },
  { b: B.thighR, c: [0, -.225, 0], h: [.08, .24, .08], part: 'limb' },
  { b: B.shinR, c: [0, -.23, -.02], h: [.065, .25, .12], part: 'limb' }
];

/* ------------------------------------------------------------------ scratch objects */
const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _v4 = new T.Vector3();
const _S = new T.Vector3(), _D = new T.Vector3(), _E = new T.Vector3(), _P = new T.Vector3(), _perp = new T.Vector3(), _G = new T.Vector3();
const _q1 = new T.Quaternion(), _q2 = new T.Quaternion(), _qa = new T.Quaternion(), _qb = new T.Quaternion(), _qw = new T.Quaternion();
const _eul = new T.Euler(), _m4 = new T.Matrix4();
const _down = new T.Vector3(0, -1, 0), _AX = new T.Vector3(1, 0, 0), _AY = new T.Vector3(0, 1, 0);
const _fling = [new T.Quaternion(), new T.Quaternion(), new T.Quaternion(), new T.Quaternion()];
_fling[0].setFromEuler(_eul.set(.25, 0, -1.0, 'XYZ'));   // upper L
_fling[1].setFromEuler(_eul.set(-.5, 0, -.15, 'XYZ'));   // lower L
_fling[2].setFromEuler(_eul.set(.25, 0, 1.0, 'XYZ'));    // upper R
_fling[3].setFromEuler(_eul.set(-.5, 0, .15, 'XYZ'));    // lower R

// two-bone arm IK in torso space; writes the upper / lower arm quaternions
function solveArm(qUp, qLow, sx, tx, ty, tz, poleX, poleY, poleZ) {
  _S.set(sx, SH_Y, 0);
  _D.set(tx - sx, ty - SH_Y, tz);
  let d = _D.length();
  if (d < 1e-5) { _D.set(0, 0, -1); d = 1e-5; } else _D.multiplyScalar(1 / d);
  const dc = clamp(d, Math.abs(ARM_A - ARM_B) + .02, ARM_A + ARM_B - .004);
  const x = (ARM_A * ARM_A - ARM_B * ARM_B + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, ARM_A * ARM_A - x * x));
  _P.set(poleX, poleY, poleZ);
  _perp.copy(_P).addScaledVector(_D, -_P.dot(_D));
  if (_perp.lengthSq() < 1e-6) _perp.set(0, -1, 0);
  _perp.normalize();
  _E.copy(_S).addScaledVector(_D, x).addScaledVector(_perp, h);
  _v1.copy(_E).sub(_S).normalize();
  qUp.setFromUnitVectors(_down, _v1);
  _v2.copy(_S).addScaledVector(_D, dc).sub(_E).normalize();
  _q1.copy(qUp).invert();
  _v2.applyQuaternion(_q1);
  qLow.setFromUnitVectors(_down, _v2);
  return d - (ARM_A + ARM_B);   // >0 means the hand could not reach
}

/* ------------------------------------------------------------------ AI constants */
const IDLE = 0, ALERT = 1, ENGAGE = 2, DEAD = 3;
const LEASH = [0, 16, 8, 0];            // by tier (index 1..3); tier 3 holds
const RELOC = [null, [5, 9], [9, 15], null];
const WALK = 1.7, RUN = 3.4, R_BODY = .38, VIEW_COS = Math.cos(55 * Math.PI / 180);
const PEEK = .2;

/* ================================================================== manager */
G.Enemies = {
  create(scene, map, diff) {
    if (typeof diff === 'string' && G.CFG && G.CFG.difficulty) diff = G.CFG.difficulty[diff];
    diff = Object.assign({ enemyCount: 16, enemyAccuracy: .5, reactionTime: .6, enemyDamage: 10, playerHealth: 100 }, diff || {});
    const acc = clamp(diff.enemyAccuracy > 1 ? diff.enemyAccuracy / 100 : diff.enemyAccuracy, 0, 1);
    const sightRange = 55 + 45 * acc;
    const groundAt = map.groundHeightAt ? (x, z) => map.groundHeightAt(x, z) : () => 0;
    const boxes = (map.colliders || []).map(b => ({ x0: b.min.x, y0: b.min.y, z0: b.min.z, x1: b.max.x, y1: b.max.y, z1: b.max.z }));
    const rng = mulberry32(0xD1E4B1E);
    const puffs = makePuffs(scene, 18);
    let list = [];
    let total = 0, time = 0;
    const lastPlayer = new T.Vector3(); let havePlayer = false, playerSpeed = 0;

    /* ---- geometry queries on colliders ---- */
    function segHit(ax, ay, az, bx, by, bz) {       // first hit t in [0,1] or -1
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sz0 = Math.min(az, bz), sz1 = Math.max(az, bz);
      let best = -1;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.x1 < sx0 || b.x0 > sx1 || b.z1 < sz0 || b.z0 > sz1) continue;
        let t0 = 0, t1 = 1, ta, tb, s;
        if (Math.abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) continue; }
        else { ta = (b.x0 - ax) / dx; tb = (b.x1 - ax) / dx; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        if (Math.abs(dy) < 1e-9) { if (ay < b.y0 || ay > b.y1) continue; }
        else { ta = (b.y0 - ay) / dy; tb = (b.y1 - ay) / dy; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        if (Math.abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) continue; }
        else { ta = (b.z0 - az) / dz; tb = (b.z1 - az) / dz; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        if (best < 0 || t0 < best) best = t0;
      }
      return best;
    }
    const blocked = (ax, ay, az, bx, by, bz) => segHit(ax, ay, az, bx, by, bz) >= 0;
    // does a box obstruct a walker standing on ground height gy?
    const isObst = (b, gy) => b.y1 > gy + .3 && b.y0 < gy + 1.8;
    function circleFree(x, z, gy, r) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]; if (!isObst(b, gy)) continue;
        const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) return false;
      }
      return true;
    }
    function segFree(x0, z0, x1, z1, gy, r) {       // 2D segment vs boxes expanded by r
      const dx = x1 - x0, dz = z1 - z0;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]; if (!isObst(b, gy)) continue;
        let t0 = 0, t1 = 1, ta, tb, s;
        if (Math.abs(dx) < 1e-9) { if (x0 < b.x0 - r || x0 > b.x1 + r) continue; }
        else { ta = (b.x0 - r - x0) / dx; tb = (b.x1 + r - x0) / dx; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        if (Math.abs(dz) < 1e-9) { if (z0 < b.z0 - r || z0 > b.z1 + r) continue; }
        else { ta = (b.z0 - r - z0) / dz; tb = (b.z1 + r - z0) / dz; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        return false;
      }
      return true;
    }
    function resolve(e) {                           // push the soldier out of colliders (circle vs AABB)
      const p = e.group.position, gy = p.y;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i]; if (!isObst(b, gy)) continue;
          if (p.x < b.x0 - R_BODY || p.x > b.x1 + R_BODY || p.z < b.z0 - R_BODY || p.z > b.z1 + R_BODY) continue;
          const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
          let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
          if (d2 >= R_BODY * R_BODY) continue;
          moved = true;
          if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (R_BODY + .002 - d) / d; p.x += dx * k; p.z += dz * k; }
          else {   // centre inside the box: leave through the nearest face
            const l = p.x - b.x0, r = b.x1 - p.x, f = p.z - b.z0, bk = b.z1 - p.z, m = Math.min(l, r, f, bk);
            if (m === l) p.x = b.x0 - R_BODY - .002; else if (m === r) p.x = b.x1 + R_BODY + .002; else if (m === f) p.z = b.z0 - R_BODY - .002; else p.z = b.z1 + R_BODY + .002;
          }
        }
        if (!moved) break;
      }
    }

    /* ---- spawning ---- */
    function pickSpawns() {
      const src = (map.enemySpawns || []).slice();
      const want = Math.max(1, Math.round(diff.enemyCount));
      const r = mulberry32(777);
      for (let i = src.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = src[i]; src[i] = src[j]; src[j] = t; }
      const out = src.slice(0, want);
      let k = 0;
      while (out.length < want && src.length) {      // fewer spawns than enemies: add soldiers beside existing ones
        const s = src[k++ % src.length], a = r() * TAU, d = 1.6 + r() * 1.4;
        const x = s.pos.x + Math.cos(a) * d, z = s.pos.z + Math.sin(a) * d;
        if (circleFree(x, z, groundAt(x, z), R_BODY + .1)) out.push({ pos: new T.Vector3(x, s.pos.y, z), yaw: s.yaw, kind: s.kind, tier: s.tier });
        if (k > 400) break;
      }
      return out;
    }
    function makeEnemy(sp, idx) {
      const r = mulberry32(5000 + idx * 131);
      const kind = sp.kind === 'smg' ? 'smg' : 'rifle';
      const hat = r() < .72 ? 'helmet' : 'bush';
      const rolled = r() < .45, pack = r() < .6;
      const vi = Math.floor(r() * VARIANTS.length);
      const rig = makeRig(getGeometry(kind, hat, rolled, pack), getMaterial(vi), kind);
      const e = {
        id: idx, kind, tier: sp.tier || 2, group: rig.group, mesh: rig.mesh, bones: rig.bones, flashMesh: rig.flash,
        pos: rig.group.position, home: new T.Vector3(sp.pos.x, 0, sp.pos.z), homeYaw: sp.yaw || 0, yaw: sp.yaw || 0, yawT: sp.yaw || 0,
        health: 100, dead: false, state: IDLE, sub: '', t: 0,
        crouch: 0, crouchT: 0, aim: 0, aimT: 0, speed: 0, walkPhase: r() * TAU, recoil: 0, flinch: 0, flinchDir: 1, boltT: -1, boltSnd: false, flash: 0,
        shotTimer: 0, burstLeft: 0, shots: 0, senseT: r() * .15, see: false, inCone: false, canFire: false, noFireT: 0, hasCover: false,
        alertT: 0, wake: 0, advT: 0, relocT: 3 + r() * 4, timeSinceSeen: 99, moveTarget: null, moveSpeed: WALK, stuckT: 0, stuckX: 0, stuckZ: 0,
        lastKnown: new T.Vector3(), lookT: 0, lookTimer: 1 + r() * 3, headYaw: 0, pitch: 0, deathP: 0, deathSign: 1, frozen: false,
        breath: r() * TAU, acc: acc * (.85 + r() * .3), reactMul: .8 + r() * .6, lastHit: { x: 0, y: 0, z: 0, t: -9 }, var: vi, hat, rolled, pack
      };
      e.pos.set(sp.pos.x, groundAt(sp.pos.x, sp.pos.z), sp.pos.z);
      resolve(e);
      e.pos.y = groundAt(e.pos.x, e.pos.z);
      e.group.quaternion.setFromAxisAngle(_AY, e.yaw);
      scene.add(e.group);
      applyPose(e, 0);
      e.group.updateMatrixWorld(true);
      return e;
    }
    function spawnAll() {
      for (const e of list) scene.remove(e.group);
      list = pickSpawns().map(makeEnemy);
      total = list.length;
    }

    /* ---- weapon / IK pose ---- */
    const poleR = [.7, -1, .25], poleL = [-.7, -1, .2];
    function applyPose(e, dt) {
      const bn = e.bones, c = e.crouch, aim = e.aim;
      const mv = clamp(e.speed / 1.1, 0, 1), run = clamp((e.speed - 1.9) / 1.8, 0, 1), ph = e.walkPhase;
      const fl = e.flinch * e.flinch, dead = e.state === DEAD;
      // legs
      const drop = .58 * c, hh = L1 + L2 - drop;
      const a = Math.acos(clamp((L1 * L1 + hh * hh - L2 * L2) / (2 * L1 * hh), -1, 1));
      const bb = Math.asin(clamp(L1 * Math.sin(a) / L2, -1, 1));
      const amp = (.34 + .34 * run) * mv * (1 - .75 * c);
      bn[B.hips].position.set(.012 * Math.sin(ph) * mv, REST[0][1] - drop - .03 * mv * Math.abs(Math.sin(ph)) * (1 - c), 0);
      for (let s = 0; s < 2; s++) {
        const p2 = ph + s * Math.PI;
        const th = a + amp * Math.sin(p2);
        const sh = -(a + bb) - (.1 + .75 * run + .5 * mv) * mv * Math.max(0, Math.cos(p2)) * (1 - .8 * c);
        bn[s ? B.thighR : B.thighL].quaternion.setFromEuler(_eul.set(th, 0, 0, 'XYZ'));
        bn[s ? B.shinR : B.shinL].quaternion.setFromEuler(_eul.set(sh, 0, 0, 'XYZ'));
      }
      // torso
      const twist = -.30 * aim + .07 * Math.sin(ph) * mv + .22 * fl * e.flinchDir;
      const lean = e.lean || 0;
      const trx = -(.05 * mv + .20 * c) + .012 * Math.sin(e.breath) + e.pitch * .45 * aim + .35 * fl + .03 * e.recoil;
      bn[B.torso].quaternion.setFromEuler(_eul.set(trx, twist, lean + .03 * Math.sin(ph) * mv + .12 * fl * e.flinchDir, 'YXZ'));
      bn[B.head].quaternion.setFromEuler(_eul.set(-trx * .55 - e.pitch * .3 * aim, clamp(e.headYaw, -.9, .9) - twist * .8, 0, 'YXZ'));
      // weapon pose (torso space)
      const w = smooth(aim);
      let px = lerp(-.03, -.05, w), py = lerp(-.07, .12, w), pz = lerp(-.10, .02, w);
      py += (1 - w) * .015 * Math.sin(ph * 2) * mv;
      pz += .06 * e.recoil;
      let wrx = lerp(-.75, e.pitch * .55, w) + .10 * e.recoil, wry = lerp(.12, .30, w), wrz = 0;
      if (e.boltT >= 0) wrz = -.7 * Math.sin(clamp((e.boltT - .12) / .7, 0, 1) * Math.PI);
      wrx += .06 * fl;
      let wq = _qw.setFromEuler(_eul.set(wrx, wry, wrz, 'YXZ'));
      const wbone = bn[B.weapon];
      const gp = GRIP[e.kind];
      // arms hold the weapon through IK
      _G.set(gp.R[0], gp.R[1], gp.R[2]).applyQuaternion(wq);
      solveArm(_qa, _qb, .21, W0[0] + px + _G.x, W0[1] + py + _G.y, W0[2] + pz + _G.z, poleR[0], poleR[1], poleR[2]);
      bn[B.uArmR].quaternion.copy(_qa); bn[B.lArmR].quaternion.copy(_qb);
      _G.set(gp.L[0], gp.L[1], gp.L[2]).applyQuaternion(wq);
      solveArm(_qa, _qb, -.21, W0[0] + px + _G.x, W0[1] + py + _G.y, W0[2] + pz + _G.z, poleL[0], poleL[1], poleL[2]);
      bn[B.uArmL].quaternion.copy(_qa); bn[B.lArmL].quaternion.copy(_qb);
      wbone.position.set(W0[0] + px, W0[1] + py, W0[2] + pz);
      wbone.quaternion.copy(wq);
      // death: arms go limp, rifle drops, body tips over
      let fall = 0, lift = 0;
      if (dead) {
        const p = e.deathP, k = smooth(p);
        bn[B.uArmL].quaternion.slerp(_fling[0], k); bn[B.lArmL].quaternion.slerp(_fling[1], k);
        bn[B.uArmR].quaternion.slerp(_fling[2], k); bn[B.lArmR].quaternion.slerp(_fling[3], k);
        wbone.position.set(lerp(W0[0] + px, .30, k), lerp(W0[1] + py, -.02, k), lerp(W0[2] + pz, -.18, k));
        _q2.setFromEuler(_eul.set(-1.2, .5, 0, 'YXZ')); wbone.quaternion.slerp(_q2, k);
        const e1 = 1 - Math.pow(1 - p, 2.4);
        fall = e.deathSign * (1.5 * e1 + .05 * Math.sin(p * Math.PI * 2.5) * (1 - p));
        lift = .12 * e1;
      }
      _qa.setFromAxisAngle(_AY, e.yaw);
      if (fall !== 0) { _qb.setFromAxisAngle(_AX, fall); _qa.multiply(_qb); }
      e.group.quaternion.copy(_qa);
      e.lift = lift;
    }

    /* ---- perception ---- */
    function eyeY(e) { return e.pos.y + 1.62 - .58 * e.crouch; }
    function muzzle(e, out) {
      const m = GRIP[e.kind].M;
      return out.set(m[0], m[1], m[2]).applyMatrix4(e.bones[B.weapon].matrixWorld);
    }
    function doSense(e, player) {
      const p = e.pos, tp = player.pos;
      const dx = tp.x - p.x, dz = tp.z - p.z, d = Math.hypot(dx, dz);
      e.dist = d;
      e.see = false; e.inCone = false;
      if (!player.alive || d > sightRange) { e.canFire = false; return; }
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      e.inCone = d < .01 || (dx * fx + dz * fz) / d >= VIEW_COS;
      e.see = !blocked(p.x, p.y + 1.62, p.z, tp.x, tp.y, tp.z);
      // cover: low obstacle close by that hides a crouched soldier but not a standing one
      if (e.see) {
        const th = segHit(p.x, p.y + 1.0, p.z, tp.x, tp.y, tp.z);
        if (th >= 0) {
          const len = Math.hypot(dx, tp.y - p.y - 1.0, dz);
          e.hasCover = th * len <= 4;
        } else e.hasCover = false;
      }
      if (e.state === ENGAGE) {
        muzzle(e, _v3);
        const maxR = e.kind === 'smg' ? 60 : 110;
        e.canFire = d <= maxR && !blocked(_v3.x, _v3.y, _v3.z, tp.x, tp.y - .25, tp.z);
      } else e.canFire = false;
    }
    function alertEnemy(e, pos, wake) {
      if (e.dead) return;
      if (e.state === IDLE) {
        e.state = ALERT; e.alertT = 0; e.wake = wake === undefined ? .15 + rng() * .55 : wake;
        e.lastKnown.copy(pos); e.aimT = .7; e.advT = 1.2;
      } else if (e.state === ALERT) { e.lastKnown.copy(pos); e.alertT = 0; }
    }
    function broadcast(e, pos) {
      for (const o of list) {
        if (o === e || o.dead || o.state !== IDLE) continue;
        const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z;
        if (dx * dx + dz * dz < 20 * 20) alertEnemy(o, pos, .3 + rng() * .9);
      }
    }

    /* ---- movement ---- */
    function pickMove(e, goal, mode, targetPos) {
      const leash = LEASH[e.tier];
      if (leash <= 0) return false;
      const gy0 = e.pos.y;
      let best = null, bs = -1e9;
      const ga = goal ? Math.atan2(goal.z - e.pos.z, goal.x - e.pos.x) : 0;
      for (let k = 0; k < 9; k++) {
        const ang = mode === 'advance' ? ga + (rng() - .5) * 2.2 : rng() * TAU;
        const r = 2.5 + rng() * 4.5;
        const cx = e.pos.x + Math.cos(ang) * r, cz = e.pos.z + Math.sin(ang) * r;
        const hx = cx - e.home.x, hz = cz - e.home.z;
        if (hx * hx + hz * hz > leash * leash) continue;
        const gy = groundAt(cx, cz);
        if (Math.abs(gy - gy0) > 1.2) continue;
        if (!circleFree(cx, cz, gy, R_BODY + .12)) continue;
        if (!segFree(e.pos.x, e.pos.z, cx, cz, gy0, R_BODY + .05)) continue;
        let s = rng();
        if (goal && mode === 'advance') s += (Math.hypot(goal.x - e.pos.x, goal.z - e.pos.z) - Math.hypot(goal.x - cx, goal.z - cz)) * .6;
        if (targetPos && mode === 'reposition') {
          const los = !blocked(cx, gy + 1.62, cz, targetPos.x, targetPos.y, targetPos.z);
          const losLow = !blocked(cx, gy + 1.0, cz, targetPos.x, targetPos.y, targetPos.z);
          if (los) { s += 2; if (!losLow) s += 1.5; } else s -= 1;
          const dd = Math.hypot(targetPos.x - cx, targetPos.z - cz);
          if (dd < 12) s -= (12 - dd) * .25;
        }
        if (s > bs) { bs = s; best = [cx, cz]; }
      }
      if (!best) return false;
      e.moveTarget = e.moveTarget || new T.Vector3();
      e.moveTarget.set(best[0], 0, best[1]);
      e.stuckT = 0; e.stuckX = e.pos.x; e.stuckZ = e.pos.z;
      return true;
    }
    function stepMove(e, dt) {
      const mt = e.moveTarget, p = e.pos;
      const dx = mt.x - p.x, dz = mt.z - p.z, d = Math.hypot(dx, dz);
      if (d < .3) { e.moveTarget = null; return; }
      const s = Math.min(e.moveSpeed, d / dt);
      p.x += dx / d * s * dt; p.z += dz / d * s * dt;
      resolve(e);
      e.yawT = Math.atan2(-dx, -dz);
      e.stuckT += dt;
      if (e.stuckT > .6) {
        if (Math.hypot(p.x - e.stuckX, p.z - e.stuckZ) < .25 * e.moveSpeed * .6) e.moveTarget = null;   // blocked: give up
        e.stuckT = 0; e.stuckX = p.x; e.stuckZ = p.z;
      }
    }

    /* ---- shooting ---- */
    const tmpMuz = new T.Vector3();
    function hitChance(e, d, player) {
      const range = 1 / (1 + Math.pow(d / 38, 1.5));
      const mvF = 1 - .45 * clamp(playerSpeed / 3.5, 0, 1);
      let p = e.acc * range * mvF;
      p *= e.kind === 'smg' ? .8 : 1.1;
      if (e.kind === 'smg' && d > 60) p *= .4;
      if (e.shots < 1) p *= .65;                       // first shot after reacting
      p *= Math.pow(.88, Math.min(e.burstIdx || 0, 5)); // muzzle climb in a burst
      if (e.speed > .6) p *= .6;
      if (e.flinch > .2) p *= .5;
      if (e.crouch > .3) p *= .9;
      return clamp(p, .02, .92);
    }
    function fire(e, player) {
      muzzle(e, tmpMuz);
      const tp = player.pos, d = Math.hypot(tp.x - e.pos.x, tp.y - e.pos.y, tp.z - e.pos.z);
      snd('enemy_shot', { position: tmpMuz.clone() });
      e.flash = .06; e.flashMesh.visible = true;
      e.recoil = 1;
      if (e.kind === 'rifle') { e.boltT = 0; e.boltSnd = false; e.boltDur = rangeBolt(e); }
      e.burstIdx = (e.burstIdx || 0) + 1;
      const hit = rng() < hitChance(e, d, player);
      e.shots++;
      if (hit) {
        player.damage(diff.enemyDamage, new T.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z));
      } else {
        const ox = (rng() - .5) * 2, oz = (rng() - .5) * 2, l = Math.hypot(ox, oz) || 1, off = .5 + rng() * 1.3;
        snd('bullet_whiz', { position: new T.Vector3(tp.x + ox / l * off, tp.y - .1 + (rng() - .5) * .6, tp.z + oz / l * off), volume: clamp(1.1 - d / 90, .35, 1) });
      }
    }
    function rangeBolt(e) { return (1.25 + rng() * .65) * (1.25 - .5 * acc); }

    /* ---- state logic ---- */
    function startBurst(e) { e.burstLeft = e.kind === 'smg' ? 3 + Math.floor(rng() * 4) : 1; e.burstIdx = 0; e.sub = 'shoot'; e.noFireT = 0; }
    function enterEngage(e, player, halfReact) {
      e.state = ENGAGE; e.shots = 0; e.moveTarget = null;
      e.sub = 'react'; e.t = Math.max(.05, diff.reactionTime * e.reactMul * (halfReact ? .5 : 1));
      e.aimT = 1; e.crouchT = e.hasCover ? 1 : 0; e.timeSinceSeen = 0;
      e.lastKnown.copy(player.pos);
      broadcast(e, player.pos);
    }
    function toIdle(e) {
      e.state = IDLE; e.aimT = 0; e.crouchT = 0; e.moveTarget = null; e.sub = '';
      const dx = e.home.x - e.pos.x, dz = e.home.z - e.pos.z;
      if (dx * dx + dz * dz > 2.25 && segFree(e.pos.x, e.pos.z, e.home.x, e.home.z, e.pos.y, R_BODY + .05)) {
        e.moveTarget = e.moveTarget || new T.Vector3(); e.moveTarget.set(e.home.x, 0, e.home.z); e.moveSpeed = WALK * .8; e.stuckT = 0; e.stuckX = e.pos.x; e.stuckZ = e.pos.z;
      }
    }
    function facePoint(e, x, z) { e.yawT = Math.atan2(-(x - e.pos.x), -(z - e.pos.z)); }

    function logicIdle(e, dt, player) {
      e.aimT = 0; e.crouchT = 0;
      e.lookTimer -= dt;
      if (e.lookTimer <= 0) { e.lookTimer = 2 + rng() * 4; e.lookT = (rng() - .5) * 1.3; }
      e.headYaw = damp(e.headYaw, e.lookT, 2, dt);
      if (!e.moveTarget) e.yawT = e.homeYaw + e.lookT * .35;
      if (e.see && (e.inCone || e.dist < 8)) { e.moveTarget = null; alertEnemy(e, player.pos, 0); }
    }
    function logicAlert(e, dt, player) {
      e.alertT += dt;
      e.aimT = .75; e.crouchT = 0; e.headYaw = damp(e.headYaw, 0, 3, dt);
      if (!e.moveTarget) facePoint(e, e.lastKnown.x, e.lastKnown.z);
      if (e.wake > 0) { e.wake -= dt; return; }
      if (e.see && (e.inCone || e.dist < 8)) { enterEngage(e, player, false); return; }
      e.advT -= dt;
      if (e.tier < 3 && !e.moveTarget && e.advT <= 0 && e.alertT > 1) {
        e.advT = 3 + rng() * 2;
        e.moveSpeed = WALK * 1.15;
        pickMove(e, e.lastKnown, 'advance', null);
      }
      if (e.alertT > 20 && !e.see) toIdle(e);
    }
    function logicEngage(e, dt, player) {
      if (!player.alive) { toIdle(e); return; }
      if (e.see) { e.timeSinceSeen = 0; e.lastKnown.copy(player.pos); } else e.timeSinceSeen += dt;
      e.headYaw = damp(e.headYaw, 0, 4, dt);
      // aim pitch toward the player's chest
      muzzle(e, _v4);
      const hd = Math.max(1, Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z));
      e.pitch = damp(e.pitch, clamp(Math.atan2(player.pos.y - .25 - _v4.y, hd), -.5, .5), 6, dt);
      e.relocT -= dt; e.advT -= dt;
      if (e.moveTarget) { e.aimT = .55; e.crouchT = .12; return; }
      facePoint(e, player.pos.x, player.pos.z);
      if (e.sub === 'move') { e.sub = 'cool'; e.t = .3 + rng() * .4; }
      // lost the player: advance to last known position, give up after a while
      if (e.timeSinceSeen > 1.2) {
        e.aimT = .8; e.crouchT = 0;
        if (e.tier < 3 && e.advT <= 0) { e.advT = 2.5; e.moveSpeed = WALK * 1.5; pickMove(e, e.lastKnown, 'advance', null); }
        if (e.timeSinceSeen > 7) { e.state = ALERT; e.alertT = 0; e.wake = 0; e.sub = ''; }
        return;
      }
      switch (e.sub) {
        case 'react':
          e.t -= dt; e.aimT = 1; e.crouchT = e.hasCover ? 1 : 0;
          if (e.t <= 0) { if (e.hasCover) { e.sub = 'rise'; } else startBurst(e); }
          break;
        case 'rise':
          e.aimT = 1; e.crouchT = PEEK;
          if (!e.hasCover) { startBurst(e); break; }
          if (e.crouch <= .32) startBurst(e);
          break;
        case 'shoot': {
          e.aimT = 1;
          e.crouchT = e.hasCover ? PEEK : 0;
          const ready = e.aim > .85 && (!e.hasCover || e.crouch <= .34);
          if (e.burstLeft > 0) {
            if (e.canFire) e.noFireT = 0; else e.noFireT += dt;
            if (ready && e.canFire && e.shotTimer <= 0) {
              fire(e, player); e.burstLeft--;
              e.shotTimer = e.kind === 'smg' ? .1 : rangeBolt(e);
            } else if (e.noFireT > 1.2) {
              e.burstLeft = 0; e.shotTimer = 0;
              if (e.tier < 3 && e.relocT <= 0 && pickMove(e, null, 'reposition', player.pos)) { e.moveSpeed = RUN; e.relocT = 2; e.sub = 'move'; return; }
            }
          }
          if (e.burstLeft <= 0) {
            const base = e.kind === 'smg' ? (.9 + rng() * 1.4) * (1.45 - acc * .7) : .15 + rng() * .6;
            e.t = Math.max(base, e.shotTimer);
            e.sub = e.hasCover ? 'hide' : 'cool';
          }
          break;
        }
        case 'cool':
          e.t -= dt; e.aimT = .9; e.crouchT = 0;
          if (e.t <= 0) {
            const iv = RELOC[e.tier];
            if (iv && e.relocT <= 0 && pickMove(e, null, 'reposition', player.pos)) { e.moveSpeed = RUN; e.relocT = iv[0] + rng() * (iv[1] - iv[0]); e.sub = 'move'; }
            else startBurst(e);
          }
          break;
        case 'hide':
          e.t -= dt; e.aimT = .3; e.crouchT = 1;
          if (e.t <= 0) { if (!e.hasCover) startBurst(e); else e.sub = 'rise'; }
          break;
        default: startBurst(e);
      }
    }

    function updateEnemy(e, dt, player) {
      if (e.state === DEAD) {
        if (e.frozen) return;
        e.deathP = Math.min(1, e.deathP + dt / .9);
        e.crouch = lerp(e.crouch, .8, smooth(e.deathP));
        e.aim = e.aim * (1 - smooth(e.deathP));
        e.speed = 0;
        applyPose(e, dt);
        e.group.position.y = e.baseY + e.lift;
        e.group.updateMatrixWorld(true);
        if (e.deathP >= 1) e.frozen = true;
        return;
      }
      // timers
      e.flinch = Math.max(0, e.flinch - dt * 3.2);
      e.recoil = Math.max(0, e.recoil - dt * 7);
      if (e.flash > 0) { e.flash -= dt; if (e.flash <= 0) e.flashMesh.visible = false; }
      if (e.shotTimer > 0) e.shotTimer -= dt;
      if (e.boltT >= 0) {
        e.boltT += dt / (e.boltDur * .7 || 1);
        if (!e.boltSnd && e.boltT > .35) { e.boltSnd = true; snd('bolt', { position: e.pos.clone(), volume: .5 }); }
        if (e.boltT >= 1) e.boltT = -1;
      }
      e.breath += dt * 1.6;
      e.senseT -= dt;
      if (e.senseT <= 0) { e.senseT = .12 + rng() * .06; doSense(e, player); }
      const px = e.pos.x, pz = e.pos.z;
      switch (e.state) {
        case IDLE: logicIdle(e, dt, player); break;
        case ALERT: logicAlert(e, dt, player); break;
        case ENGAGE: logicEngage(e, dt, player); break;
      }
      if (e.moveTarget && e.state !== DEAD) stepMove(e, dt);
      // facing
      const rate = e.moveTarget ? 6 : (e.state === ENGAGE ? 5 : (e.state === ALERT ? 3.5 : 1.6));
      e.yaw += clamp(angDiff(e.yaw, e.yawT), -rate * dt, rate * dt);
      // ground + speed
      const moved = Math.hypot(e.pos.x - px, e.pos.z - pz) / Math.max(dt, 1e-4);
      e.speed = damp(e.speed, moved, 10, dt);
      if (moved > .01) e.pos.y = groundAt(e.pos.x, e.pos.z);
      e.baseY = e.pos.y;
      e.walkPhase += dt * e.speed * 4.4;
      e.crouch = damp(e.crouch, e.crouchT, 7, dt);
      e.aim = damp(e.aim, e.aimT, 6, dt);
      applyPose(e, dt);
      e.group.updateMatrixWorld(true);
    }

    /* ---- public ---- */
    function kill(e, dir) {
      e.state = DEAD; e.dead = true; e.moveTarget = null; e.burstLeft = 0; e.shotTimer = 0; e.boltT = -1;
      e.flash = 0; e.flashMesh.visible = false; e.baseY = e.pos.y; e.deathP = 0; e.frozen = false;
      let sign = 1;                                   // +1 = fall backwards
      if (dir) sign = (dir.x * -Math.sin(e.yaw) + dir.z * -Math.cos(e.yaw)) > 0 ? -1 : 1;
      const fx = -Math.sin(e.yaw) * sign * -1, fz = -Math.cos(e.yaw) * sign * -1;   // direction the body lands in (-forward when sign=+1)
      const lx = e.pos.x + fx * 1.1, lz = e.pos.z + fz * 1.1;
      const gy = e.pos.y;
      if (!circleFree(lx, lz, gy, .3)) {
        const ox = e.pos.x - fx * 1.1, oz = e.pos.z - fz * 1.1;
        if (circleFree(ox, oz, gy, .3)) sign = -sign;
      }
      e.deathSign = sign;
    }
    function bonePoint(e, part, out) {
      const b = part === 'head' ? B.head : (part === 'limb' ? B.thighL : B.torso);
      const off = part === 'head' ? .15 : (part === 'limb' ? -.2 : .18);
      return out.set(0, off, 0).applyMatrix4(e.bones[b].matrixWorld);
    }

    const api = {
      spawnAll,
      update(dt, player) {
        dt = clamp(dt, 0, .05);
        time += dt;
        if (havePlayer && dt > 0) playerSpeed = damp(playerSpeed, Math.hypot(player.pos.x - lastPlayer.x, player.pos.z - lastPlayer.z) / dt, 8, dt);
        lastPlayer.copy(player.pos); havePlayer = true;
        for (let i = 0; i < list.length; i++) updateEnemy(list[i], dt, player);
        puffs.update(dt);
      },
      hitTest(raycaster) {
        const ray = raycaster.ray, near = raycaster.near || 0, far = raycaster.far === undefined ? Infinity : raycaster.far;
        const o = ray.origin, d = ray.direction;
        let best = null;
        for (let i = 0; i < list.length; i++) {
          const e = list[i]; if (e.dead) continue;
          // bounding sphere reject
          const cx = e.pos.x - o.x, cy = e.pos.y + .9 - o.y, cz = e.pos.z - o.z;
          const tc = cx * d.x + cy * d.y + cz * d.z;
          const c2 = cx * cx + cy * cy + cz * cz - tc * tc;
          if (c2 > 1.5 * 1.5 || (tc < -1.5) || (tc > far + 1.5)) continue;
          for (let k = 0; k < VOLS.length; k++) {
            const v = VOLS[k];
            _m4.copy(e.bones[v.b].matrixWorld).invert();
            _v1.copy(o).applyMatrix4(_m4);
            _v2.copy(d).transformDirection(_m4);
            let t = -1;
            if (v.sphere) {
              const ox = _v1.x - v.c[0], oy = _v1.y - v.c[1], oz = _v1.z - v.c[2];
              const bq = ox * _v2.x + oy * _v2.y + oz * _v2.z, cq = ox * ox + oy * oy + oz * oz - v.r * v.r, disc = bq * bq - cq;
              if (disc >= 0) { const sq = Math.sqrt(disc); t = -bq - sq; if (t < near) t = -bq + sq; if (t < near) t = -1; }
            } else {
              let t0 = near, t1 = far, ok = true;
              const oo = [_v1.x - v.c[0], _v1.y - v.c[1], _v1.z - v.c[2]], dd = [_v2.x, _v2.y, _v2.z];
              for (let a = 0; a < 3 && ok; a++) {
                if (Math.abs(dd[a]) < 1e-9) { if (Math.abs(oo[a]) > v.h[a]) ok = false; }
                else {
                  let ta = (-v.h[a] - oo[a]) / dd[a], tb = (v.h[a] - oo[a]) / dd[a];
                  if (ta > tb) { const s = ta; ta = tb; tb = s; }
                  if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
                  if (t0 > t1) ok = false;
                }
              }
              if (ok) t = t0;
            }
            if (t >= near && t <= far && (!best || t < best.distance)) {
              best = { enemy: e, part: v.part, point: new T.Vector3().copy(o).addScaledVector(d, t), distance: t };
            }
          }
        }
        if (best) { const lh = best.enemy.lastHit; lh.x = best.point.x; lh.y = best.point.y; lh.z = best.point.z; lh.t = time; }
        return best;
      },
      damage(enemy, amount, part, dir) {
        const e = enemy; if (!e || e.dead) return false;
        e.health -= amount;
        // dust / cloth puff only
        if (time - e.lastHit.t < .25) puffs.spawn(e.lastHit.x, e.lastHit.y, e.lastHit.z, 3, .22);
        else { bonePoint(e, part, _v3); puffs.spawn(_v3.x, _v3.y, _v3.z, 3, .22); }
        if (e.health <= 0) { e.health = 0; kill(e, dir); return true; }
        e.flinch = 1; e.flinchDir = rng() < .5 ? -1 : 1;
        e.shotTimer = Math.max(e.shotTimer, .35);
        if (e.state === IDLE || e.state === ALERT) {
          if (dir) { e.lastKnown.set(e.pos.x - dir.x * 30, e.pos.y, e.pos.z - dir.z * 30); }
          e.state = ALERT; e.alertT = 0; e.wake = 0; e.aimT = .8; e.moveTarget = null;
          if (dir) facePoint(e, e.lastKnown.x, e.lastKnown.z);
        }
        return false;
      },
      alertAt(pos, radius) {
        const r2 = radius * radius;
        for (const e of list) {
          if (e.dead) continue;
          const dx = e.pos.x - pos.x, dy = e.pos.y - pos.y, dz = e.pos.z - pos.z;
          if (dx * dx + dy * dy + dz * dz <= r2) alertEnemy(e, pos);
        }
      },
      aliveCount() { let n = 0; for (const e of list) if (!e.dead) n++; return n; },
      totalCount() { return total; },
      list() { return list; },
      triCount() { return list.length ? list[0].mesh.geometry.userData.tris : 0; }
    };
    return api;
  }
};
})();
