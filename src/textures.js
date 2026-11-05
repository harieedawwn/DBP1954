// textures.js — procedural 512px tileable canvas textures (P1)
// G.Tex.get(name) -> THREE.Texture (cached, RepeatWrapping, sRGB, mipmaps). Generated lazily on first get().
window.G = window.G || {};
G.Tex = (function () {
  'use strict';
  const N = 512, TAU = Math.PI * 2;
  const cache = {}, canv = {};

  // ---------- helpers ----------
  function mkRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v);
  const mix = (a, b, t) => a + (b - a) * t;
  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  const rgb = (c, m, a) => 'rgba(' + (clamp8(c[0] * (m || 1)) | 0) + ',' + (clamp8(c[1] * (m || 1)) | 0) + ',' + (clamp8(c[2] * (m || 1)) | 0) + ',' + (a == null ? 1 : a) + ')';

  // periodic value noise: lattice tables are cached so every field tiles seamlessly at N px
  const latC = {};
  function lat(seed, px, py) {
    const key = seed + '_' + px + '_' + py;
    let t = latC[key];
    if (!t) { const r = mkRng(seed * 7919 + px * 131 + py * 17); t = new Float32Array(px * py); for (let i = 0; i < t.length; i++) t[i] = r(); latC[key] = t; }
    return t;
  }
  function vn(x, y, px, py, t) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = ((x0 % px) + px) % px, b = (a + 1) % px, c = ((y0 % py) + py) % py, d = (c + 1) % py;
    const v00 = t[c * px + a], v10 = t[c * px + b], v01 = t[d * px + a], v11 = t[d * px + b];
    return (v00 + (v10 - v00) * fx) * (1 - fy) + (v01 + (v11 - v01) * fx) * fy;
  }
  // fbm field N*N in 0..1; fx/fy = base lattice frequency (anisotropic -> stretched features)
  function field(fx, fy, oct, seed, gain) {
    gain = gain || 0.5;
    const out = new Float32Array(N * N);
    let amp = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const px = Math.max(1, Math.round(fx * (1 << o))), py = Math.max(1, Math.round(fy * (1 << o)));
      const t = lat(seed + o * 31, px, py), inv = 1 / N;
      let k = 0;
      for (let y = 0; y < N; y++) {
        const yy = y * inv * py;
        for (let x = 0; x < N; x++) out[k++] += amp * vn(x * inv * px, yy, px, py, t);
      }
      norm += amp; amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }
  function newCanvas() { const c = document.createElement('canvas'); c.width = N; c.height = N; return [c, c.getContext('2d')]; }
  function paint(ctx, fn) {
    const im = ctx.createImageData(N, N), d = im.data, o = [0, 0, 0];
    let k = 0, i = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, k++, i += 4) {
      fn(k, x, y, o);
      d[i] = clamp8(o[0]); d[i + 1] = clamp8(o[1]); d[i + 2] = clamp8(o[2]); d[i + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  }
  function grain(ctx, amt, seed) {
    const im = ctx.getImageData(0, 0, N, N), d = im.data, r = mkRng(seed);
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() + r() - 1) * amt;
      d[i] = clamp8(d[i] + n); d[i + 1] = clamp8(d[i + 1] + n * 0.92); d[i + 2] = clamp8(d[i + 2] + n * 0.85);
    }
    ctx.putImageData(im, 0, 0);
  }
  // wrap-around drawing so strokes/blobs tile
  function line(ctx, x1, y1, x2, y2) {
    const xs = [0], ys = [0];
    if (Math.min(x1, x2) < 0) xs.push(N); if (Math.max(x1, x2) > N) xs.push(-N);
    if (Math.min(y1, y2) < 0) ys.push(N); if (Math.max(y1, y2) > N) ys.push(-N);
    ctx.beginPath();
    for (const a of xs) for (const b of ys) { ctx.moveTo(x1 + a, y1 + b); ctx.lineTo(x2 + a, y2 + b); }
    ctx.stroke();
  }
  function blob(ctx, x, y, rx, ry, rot, style) {
    const xs = [0], ys = [0], m = Math.max(rx, ry) + 1;
    if (x < m) xs.push(N); if (x > N - m) xs.push(-N); if (y < m) ys.push(N); if (y > N - m) ys.push(-N);
    ctx.fillStyle = style;
    for (const a of xs) for (const b of ys) { ctx.beginPath(); ctx.ellipse(x + a, y + b, rx, ry, rot, 0, TAU); ctx.fill(); }
  }
  function ring(ctx, x, y, rx, ry, rot, style, lw) {
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.stroke();
  }
  function cracks(ctx, R, n, len, style, w, ang, jit) {
    ctx.strokeStyle = style; ctx.lineCap = 'round';
    function walk(x, y, a, l, lw, dep) {
      const st = Math.max(2, (l / 7) | 0);
      for (let s = 0; s < st; s++) {
        const na = a + (R() - 0.5) * 0.9, nx = x + Math.cos(na) * 7, ny = y + Math.sin(na) * 7;
        ctx.lineWidth = Math.max(0.5, lw * (1 - (s / st) * 0.6));
        line(ctx, x, y, nx, ny);
        x = nx; y = ny; a = na;
        if (dep < 2 && R() < 0.06) walk(x, y, a + (R() < 0.5 ? 1 : -1) * (0.5 + R() * 0.7), l * 0.5, lw * 0.7, dep + 1);
      }
    }
    for (let i = 0; i < n; i++) walk(R() * N, R() * N, ang == null ? R() * TAU : ang + (R() - 0.5) * (jit || 0.6), len * (0.5 + R()), w, 0);
  }
  function pebbles(ctx, R, n, pal, rmin, rmax) {
    for (let i = 0; i < n; i++) {
      const x = R() * N, y = R() * N, r = rmin + R() * (rmax - rmin), c = pal[(R() * pal.length) | 0], sq = 0.55 + R() * 0.4, rot = R() * 3;
      blob(ctx, x + 1, y + 1.4, r, r * sq, rot, 'rgba(15,8,4,0.5)');
      blob(ctx, x, y, r, r * sq, rot, rgb(c, 0.85 + R() * 0.3));
      blob(ctx, x - r * 0.25, y - r * 0.3, r * 0.5, r * sq * 0.45, rot, 'rgba(255,240,220,0.18)');
    }
  }
  function scratches(ctx, R, n, style, len) {
    ctx.strokeStyle = style; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) { const x = R() * N, y = R() * N, a = R() * TAU, l = 6 + R() * len; line(ctx, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l); }
  }

  // ---------- generators ----------
  function laterite(ctx) {
    const A = field(3, 3, 5, 11), B = field(9, 9, 4, 12), C = field(2, 2, 3, 13), D = field(40, 40, 2, 14), E = field(6, 6, 4, 15);
    paint(ctx, (k, x, y, o) => {
      const a = A[k], m = 0.78 + 0.44 * B[k], c = C[k];
      let r = mix(92, 158, a) * m, g = mix(54, 96, a) * m, b = mix(38, 66, a) * m;  // muted laterite, less orange
      const pale = smooth(0.6, 0.8, c) * 0.55;
      r = mix(r, 208, pale); g = mix(g, 150, pale); b = mix(b, 110, pale);
      const dm = 1 - 0.34 * smooth(0.4, 0.2, c);
      const gr = (0.9 + 0.2 * D[k]) * dm;
      const iron = smooth(0.66, 0.84, E[k]) * 0.35; // darker iron-rich nodules / stains
      o[0] = r * gr * (1 - iron * 0.5); o[1] = g * gr * (1 - iron * 0.6); o[2] = b * gr * (1 - iron * 0.5);
    });
    const R = mkRng(101);
    pebbles(ctx, R, 800, [[122, 72, 50], [164, 124, 92], [92, 62, 46], [186, 156, 124], [112, 102, 94]], 1, 4.2);
    cracks(ctx, R, 26, 160, 'rgba(46,18,9,0.62)', 1.7);
    cracks(ctx, R, 50, 60, 'rgba(60,26,14,0.5)', 1.0);
    scratches(ctx, R, 120, 'rgba(210,160,120,0.12)', 14);
    grain(ctx, 12, 102);
  }

  function trench_mud(ctx) {
    const A = field(3, 3, 5, 21), B = field(8, 8, 4, 22), C = field(2, 2, 3, 23), D = field(48, 48, 2, 24);
    paint(ctx, (k, x, y, o) => {
      const m = (0.8 + 0.4 * B[k]) * (0.92 + 0.16 * D[k]);
      let r = mix(50, 98, A[k]) * m, g = mix(34, 68, A[k]) * m, b = mix(24, 46, A[k]) * m;
      const c = C[k], pud = smooth(0.58, 0.67, c), dry = smooth(0.38, 0.22, c);
      r = mix(r, 88 * (0.85 + 0.3 * B[k]), pud * 0.85); g = mix(g, 92 * (0.85 + 0.3 * B[k]), pud * 0.85); b = mix(b, 96 * (0.85 + 0.3 * B[k]), pud * 0.85);
      r = mix(r, 134 * m, dry * 0.7); g = mix(g, 102 * m, dry * 0.7); b = mix(b, 74 * m, dry * 0.7);
      o[0] = r; o[1] = g; o[2] = b;
    });
    const R = mkRng(201);
    for (let i = 0; i < 7; i++) { // boot / cart ruts: wavy bands with integer periods so they tile
      const y0 = R() * N, k = 1 + ((R() * 3) | 0), ph = R() * TAU, amp = 6 + R() * 12, wd = 6 + R() * 8;
      for (const [w, st] of [[wd, 'rgba(22,14,9,0.42)'], [wd * 0.35, 'rgba(130,98,66,0.22)']]) {
        ctx.strokeStyle = st; ctx.lineWidth = w; ctx.lineCap = 'round';
        let px = 0, py = y0 + Math.sin(ph) * amp;
        for (let x = 8; x <= N; x += 8) { const yy = y0 + Math.sin((x / N) * TAU * k + ph) * amp + (w < wd ? -wd * 0.4 : 0); line(ctx, px, py, x, yy); px = x; py = yy; }
      }
    }
    for (let i = 0; i < 30; i++) { const x = R() * N, y = R() * N, a = R() * 3; blob(ctx, x, y, 7 + R() * 6, 3 + R() * 3, a, 'rgba(24,15,9,0.35)'); blob(ctx, x - 1, y - 1, 5 + R() * 4, 2 + R() * 2, a, 'rgba(100,72,48,0.25)'); }
    ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (let i = 0; i < 220; i++) { const x = R() * N, y = R() * N, a = R() * TAU, l = 5 + R() * 12; ctx.strokeStyle = rgb([150 + R() * 40, 126 + R() * 30, 76], 0.9, 0.8); line(ctx, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l); }
    pebbles(ctx, R, 260, [[96, 80, 66], [130, 110, 90], [70, 58, 48]], 1, 3.4);
    cracks(ctx, R, 22, 90, 'rgba(34,22,14,0.6)', 1.2);
    grain(ctx, 10, 202);
  }

  function grass_dry(ctx) {
    const A = field(3, 3, 5, 31), B = field(6, 6, 4, 32), M = field(4, 4, 4, 33);
    paint(ctx, (k, x, y, o) => {
      const a = A[k], m = 0.7 + 0.5 * B[k];
      o[0] = mix(66, 118, a) * m; o[1] = mix(46, 84, a) * m; o[2] = mix(28, 52, a) * m;
    });
    const R = mkRng(301);
    const pal = [[176, 152, 86], [154, 130, 70], [196, 174, 108], [128, 114, 58], [98, 108, 50], [140, 106, 64], [212, 192, 132]];
    ctx.lineCap = 'round';
    const passes = [[9000, 0.55], [8000, 0.8], [5000, 1.05]];
    for (let ps = 0; ps < 3; ps++) {
      for (let i = 0; i < passes[ps][0]; i++) {
        const x = R() * N, y = R() * N, dens = M[(y | 0) * N + (x | 0)];
        if (R() > 0.22 + dens * 1.15) continue;
        const c = pal[(R() * pal.length) | 0], sh = passes[ps][1] * (0.85 + R() * 0.3);
        const ang = -Math.PI / 2 + (R() - 0.5) * (0.9 + ps * 0.3), len = 8 + R() * (14 + ps * 6);
        ctx.strokeStyle = rgb(c, sh, 0.92); ctx.lineWidth = 0.8 + R() * 0.9;
        const mx = x + Math.cos(ang) * len * 0.5, my = y + Math.sin(ang) * len * 0.5;
        const a2 = ang + (R() - 0.5) * 0.8;
        line(ctx, x, y, mx, my); line(ctx, mx, my, mx + Math.cos(a2) * len * 0.5, my + Math.sin(a2) * len * 0.5);
      }
    }
    cracks(ctx, R, 10, 60, 'rgba(40,28,16,0.35)', 1);
    grain(ctx, 10, 302);
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function sandbag(ctx) {
    ctx.fillStyle = '#2a2218'; ctx.fillRect(0, 0, N, N);
    const R = mkRng(401), cols = [[152, 136, 100], [134, 122, 92], [170, 152, 112], [112, 106, 80], [142, 130, 102], [104, 88, 64]];
    const bw = 256, bh = 128;
    function bag(x, y, col) {
      const m = 4, w = bw - m * 2, h = bh - m * 2, rad = 22 + R() * 8, py = y + m;
      const draw = px => {
        const gr = ctx.createLinearGradient(0, py, 0, py + h);
        gr.addColorStop(0, rgb(col, 1.18)); gr.addColorStop(0.5, rgb(col, 1)); gr.addColorStop(1, rgb(col, 0.66));
        ctx.fillStyle = gr; rr(ctx, px, py, w, h, rad); ctx.fill();
        ctx.save(); rr(ctx, px, py, w, h, rad); ctx.clip();
        for (let k = 0; k < 6; k++) {
          const x1 = px + R() * w, x2 = px + R() * w, cx = px + R() * w;
          ctx.strokeStyle = 'rgba(30,22,12,0.26)'; ctx.lineWidth = 2 + R() * 3;
          ctx.beginPath(); ctx.moveTo(x1, py); ctx.quadraticCurveTo(cx, py + h * 0.5, x2, py + h); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,240,200,0.12)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x1 + 4, py); ctx.quadraticCurveTo(cx + 4, py + h * 0.5, x2 + 4, py + h); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(40,28,16,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(px + 16, py + 8); ctx.lineTo(px + 16, py + h - 8); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
        ctx.strokeStyle = 'rgba(18,12,6,0.8)'; ctx.lineWidth = 3; rr(ctx, px, py, w, h, rad); ctx.stroke();
      };
      draw(x + m); if (x + bw > N) draw(x + m - N);
    }
    for (let row = 0; row < 4; row++) for (let i = 0; i < 2; i++) {
      const x = (row % 2 ? 128 : 0) + i * bw;
      bag(x % N, row * bh, row === 3 && i === 1 ? cols[5] : cols[(R() * 5) | 0]);
    }
    const S = field(3, 3, 4, 402), D = field(64, 64, 2, 403), V = field(10, 3, 3, 404);
    const im = ctx.getImageData(0, 0, N, N), d = im.data;
    for (let y = 0, k = 0, i = 0; y < N; y++) for (let x = 0; x < N; x++, k++, i += 4) {
      const th = ((x >> 1) + (y >> 1)) & 1 ? 0.9 + 0.1 * Math.sin(x * 2.1) : 0.9 + 0.1 * Math.sin(y * 2.1); // burlap weave
      const st = smooth(0.58, 0.8, S[k]), dirt = 1 - 0.32 * st * (0.5 + 0.5 * V[k]);
      const f = th * (0.86 + 0.28 * D[k]) * dirt;
      d[i] = clamp8(d[i] * f + st * 10); d[i + 1] = clamp8(d[i + 1] * f + st * 4); d[i + 2] = clamp8(d[i + 2] * f);
    }
    ctx.putImageData(im, 0, 0);
    grain(ctx, 9, 405);
  }

  function log(ctx) {
    const A = field(14, 1.6, 5, 41), B = field(5, 5, 3, 42), C = field(32, 3, 2, 43);
    paint(ctx, (k, x, y, o) => {
      const a = A[k], ridge = 1 - Math.abs(2 * a - 1);
      let m = 0.55 + 0.75 * ridge;
      let r = mix(72, 140, a) * m, g = mix(48, 100, a) * m, b = mix(30, 64, a) * m;
      if (ridge < 0.14) { r *= 0.4; g *= 0.4; b *= 0.4; }
      const w = smooth(0.55, 0.78, B[k]) * 0.4;
      r = mix(r, 128, w); g = mix(g, 118, w); b = mix(b, 104, w);
      const gr = 0.88 + 0.24 * C[k];
      o[0] = r * gr; o[1] = g * gr; o[2] = b * gr;
    });
    const R = mkRng(501);
    for (let i = 0; i < 6; i++) { // knots
      const x = R() * N, y = R() * N, rx = 7 + R() * 7, ry = rx * (1.3 + R() * 0.7);
      blob(ctx, x, y, rx + 4, ry + 5, 0, 'rgba(30,20,12,0.35)');
      blob(ctx, x, y, rx, ry, 0, 'rgba(58,38,22,0.95)');
      for (let r = 1; r < 4; r++) ring(ctx, x, y, rx * (1 - r * 0.22), ry * (1 - r * 0.22), 0, 'rgba(120,86,52,0.6)', 1.2);
      blob(ctx, x, y, rx * 0.25, ry * 0.25, 0, 'rgba(20,12,8,0.9)');
    }
    cracks(ctx, R, 28, 120, 'rgba(24,14,8,0.75)', 1.8, Math.PI / 2, 0.35);
    for (let i = 0; i < 60; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 2 + R() * 6, 1 + R() * 3, 0, 'rgba(150,160,100,0.18)'); } // lichen
    grain(ctx, 12, 502);
  }

  function plank(ctx) {
    const rows = 6, bh = N / rows;
    const G1 = field(2, 24, 4, 51, 0.55), H1 = field(6, 48, 3, 52), S = field(3, 3, 4, 53);
    const pal = [[134, 108, 76], [112, 92, 66], [148, 122, 88], [98, 84, 64], [126, 102, 74], [106, 88, 62]];
    const R = mkRng(601), jx = [];
    for (let i = 0; i < rows; i++) jx.push((60 + R() * 392) | 0);
    paint(ctx, (k, x, y, o) => {
      const row = (y / bh) | 0, yy = y - row * bh, p = pal[row];
      const s = smooth(0.55, 0.78, S[k]);
      let m = (0.7 + 0.58 * G1[k]) * (0.88 + 0.24 * H1[k]) * (1 - 0.3 * s);
      let r = mix(p[0] * m, 120, s * 0.35), g = mix(p[1] * m, 116, s * 0.35), b = mix(p[2] * m, 108, s * 0.35);
      if (yy < 3 || yy > bh - 4) { r *= 0.26; g *= 0.26; b *= 0.26; } else if (yy < 6) { r *= 1.12; g *= 1.12; b *= 1.12; }
      if (Math.abs(x - jx[row]) < 2) { r *= 0.3; g *= 0.3; b *= 0.3; }
      o[0] = r; o[1] = g; o[2] = b;
    });
    for (let i = 0; i < 9; i++) {
      const x = R() * N, y = R() * N, rx = 6 + R() * 8, ry = 3 + R() * 3;
      blob(ctx, x, y, rx + 3, ry + 3, 0, 'rgba(40,26,16,0.3)'); blob(ctx, x, y, rx, ry, 0, 'rgba(62,42,26,0.9)');
      ring(ctx, x, y, rx * 0.6, ry * 0.6, 0, 'rgba(130,96,60,0.6)', 1);
    }
    for (let row = 0; row < rows; row++) for (let i = 0; i < 3; i++) {
      const nx = 22 + i * 170 + R() * 10;
      for (const ny of [row * bh + 10, row * bh + bh - 11]) {
        ctx.strokeStyle = 'rgba(112,62,30,0.4)'; ctx.lineWidth = 2; line(ctx, nx, ny, nx + (R() - 0.5) * 3, ny + 12 + R() * 8);
        blob(ctx, nx, ny, 2.8, 2.8, 0, 'rgb(58,50,44)'); blob(ctx, nx - 0.8, ny - 0.8, 1, 1, 0, 'rgba(210,200,190,0.55)');
      }
    }
    cracks(ctx, R, 14, 70, 'rgba(30,20,12,0.7)', 1.2, 0, 0.15);
    grain(ctx, 9, 602);
  }

  function corrugated(ctx) {
    const rib = 32;
    const A = field(3, 3, 5, 61), Rr = field(4, 4, 5, 62), V = field(18, 1.4, 3, 63, 0.55), D = field(2, 2, 3, 64);
    paint(ctx, (k, x, y, o) => {
      const ph = ((x % rib) / rib) * TAU, sh = 0.76 + 0.34 * Math.cos(ph - 0.9);
      const a = 0.8 + 0.4 * A[k];
      let r = 118 * a, g = 124 * a, b = 108 * a;
      const rust = Math.min(1, smooth(0.5, 0.68, Rr[k]) * (0.55 + 0.9 * V[k]));
      const rm = 0.7 + 0.5 * Rr[k];
      r = mix(r, 140 * rm, rust * 0.95); g = mix(g, 78 * rm, rust * 0.95); b = mix(b, 40 * rm, rust * 0.95);
      let f = sh * (0.86 + 0.28 * D[k]);
      if (y >= 254 && y <= 258) f *= 0.3; else if (y > 258 && y < 274) f *= 0.6 + 0.4 * ((y - 258) / 16);
      o[0] = r * f; o[1] = g * f; o[2] = b * f;
    });
    const R = mkRng(701);
    for (const yy of [18, 236, 280, 494]) for (let i = 0; i < 8; i++) {
      const x = i * 64 + 16 + 2; blob(ctx, x + 1, yy + 1.5, 3.6, 3.6, 0, 'rgba(0,0,0,0.4)'); blob(ctx, x, yy, 3.4, 3.4, 0, 'rgb(96,92,86)'); blob(ctx, x - 1, yy - 1, 1.2, 1.2, 0, 'rgba(230,225,215,0.6)');
      ctx.strokeStyle = 'rgba(120,60,26,0.35)'; ctx.lineWidth = 2; line(ctx, x, yy + 3, x, yy + 16 + R() * 14);
    }
    for (let i = 0; i < 10; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 14 + R() * 18, 10 + R() * 14, R() * 3, 'rgba(0,0,0,0.10)'); blob(ctx, x - 4, y - 4, 10 + R() * 12, 6 + R() * 8, R() * 3, 'rgba(255,255,255,0.07)'); }
    scratches(ctx, R, 90, 'rgba(210,205,190,0.2)', 40);
    cracks(ctx, R, 5, 40, 'rgba(30,20,14,0.5)', 1);
    grain(ctx, 9, 702);
  }

  function rock(ctx) {
    const A = field(4, 4, 6, 81), S = field(1.5, 9, 4, 82), L = field(7, 7, 3, 83), V = field(18, 1.5, 3, 84);
    paint(ctx, (k, x, y, o) => {
      const a = A[k], ridge = 1 - Math.abs(2 * a - 1);
      let m = (0.78 + 0.42 * S[k]) * (0.7 + 0.5 * ridge * ridge + 0.1);
      let r = mix(84, 166, a) * m, g = mix(80, 158, a) * m, b = mix(74, 144, a) * m;
      const lich = smooth(0.62, 0.74, L[k]) * smooth(0.3, 0.5, a) * 0.55;
      r = mix(r, 94, lich); g = mix(g, 106, lich); b = mix(b, 58, lich);
      const st = 1 - 0.26 * smooth(0.55, 0.8, V[k]);
      o[0] = r * st; o[1] = g * st; o[2] = b * st;
    });
    const R = mkRng(801);
    cracks(ctx, R, 14, 200, 'rgba(26,24,22,0.85)', 2.4);
    cracks(ctx, R, 36, 70, 'rgba(34,30,28,0.7)', 1.2);
    for (let i = 0; i < 80; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 3 + R() * 6, 1 + R() * 3, R() * 3, 'rgba(210,200,180,0.12)'); }
    for (let i = 0; i < 40; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 2 + R() * 5, 2 + R() * 4, 0, 'rgba(170,150,70,0.2)'); }
    grain(ctx, 12, 802);
  }

  function bamboo(ctx) {
    const F = field(60, 2, 3, 91), B = field(4, 4, 3, 92), K = field(30, 30, 2, 93);
    const per = N / 3;
    paint(ctx, (k, x, y, o) => {
      let r = mix(96, 178, B[k]), g = mix(126, 170, B[k]), b = mix(44, 78, B[k]);
      const fb = 0.84 + 0.32 * F[k]; r *= fb; g *= fb; b *= fb;
      const py = (((y - 40) % per) + per) % per, dn = Math.min(py, per - py);
      if (dn < 7) { const t = 1 - dn / 7; r = mix(r, 80, t * 0.85); g = mix(g, 86, t * 0.85); b = mix(b, 36, t * 0.85); }
      else if (dn < 12) { const t = 1 - (dn - 7) / 5; r *= 1 + 0.18 * t; g *= 1 + 0.18 * t; b *= 1 + 0.18 * t; }
      if (K[k] > 0.8) { r *= 0.55; g *= 0.55; b *= 0.55; }
      o[0] = r; o[1] = g; o[2] = b;
    });
    const R = mkRng(901);
    for (let i = 0; i < 40; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 1.2 + R() * 2, 5 + R() * 18, 0, 'rgba(60,70,24,0.22)'); }
    for (let i = 0; i < 24; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 2 + R() * 3, 6 + R() * 10, 0, 'rgba(204,184,96,0.25)'); }
    cracks(ctx, R, 10, 80, 'rgba(60,48,20,0.55)', 1.2, Math.PI / 2, 0.15);
    grain(ctx, 9, 902);
  }

  function tank_metal(ctx) {
    const A = field(3, 3, 5, 101), S = field(3, 6, 4, 102), Rr = field(5, 5, 5, 103), V = field(24, 1.5, 3, 104), D = field(60, 60, 1, 105);
    paint(ctx, (k, x, y, o) => {
      const a = 0.8 + 0.4 * A[k];
      let r = 72 * a, g = 78 * a, b = 52 * a;
      const rust = smooth(0.58, 0.74, Rr[k]) * 0.8, rm = 0.7 + 0.6 * Rr[k];
      r = mix(r, 124 * rm, rust); g = mix(g, 66 * rm, rust); b = mix(b, 34 * rm, rust);
      const soot = Math.min(1, smooth(0.42, 0.68, S[k]) * 0.9 + smooth(0.55, 0.9, V[k]) * 0.35);
      r = mix(r, 22, soot * 0.88); g = mix(g, 21, soot * 0.88); b = mix(b, 20, soot * 0.88);
      const f = (0.88 + 0.24 * D[k]) * (1 - 0.15 * smooth(0.6, 0.9, V[k]));
      o[0] = r * f; o[1] = g * f; o[2] = b * f;
    });
    const R = mkRng(1001);
    ctx.lineCap = 'butt';
    for (const yy of [0, 170, 341]) { ctx.fillStyle = 'rgba(8,8,6,0.8)'; ctx.fillRect(0, yy - 1, N, 3); ctx.fillStyle = 'rgba(170,170,150,0.16)'; ctx.fillRect(0, yy + 2, N, 1); }
    for (const xx of [0, 256]) { ctx.fillStyle = 'rgba(8,8,6,0.8)'; ctx.fillRect(xx - 1, 0, 3, N); ctx.fillStyle = 'rgba(170,170,150,0.16)'; ctx.fillRect(xx + 2, 0, 1, N); }
    for (const yy of [8, 178, 349]) for (let i = 0; i < 16; i++) {
      const x = i * 32 + 14; blob(ctx, x + 1, yy + 1, 3, 3, 0, 'rgba(0,0,0,0.45)'); blob(ctx, x, yy, 2.8, 2.8, 0, 'rgb(60,62,50)'); blob(ctx, x - 0.8, yy - 0.8, 1, 1, 0, 'rgba(200,200,180,0.5)');
    }
    for (let i = 0; i < 130; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 1 + R() * 4, 1 + R() * 3, R() * 3, 'rgba(158,156,148,0.62)'); }
    scratches(ctx, R, 100, 'rgba(190,186,170,0.28)', 36);
    cracks(ctx, R, 4, 50, 'rgba(10,10,8,0.6)', 1);
    grain(ctx, 10, 1002);
  }

  function burnt_bark(ctx) {
    const A = field(8, 2.5, 6, 111), B = field(3, 3, 4, 112), E = field(20, 6, 2, 113);
    paint(ctx, (k, x, y, o) => {
      const ridge = 1 - Math.abs(2 * A[k] - 1), plate = smooth(0.1, 0.4, ridge);
      let v = mix(8, 74, plate) * (0.68 + 0.64 * E[k]);
      let r = v, g = v * 0.96, b = v * 0.92;
      const ash = smooth(0.62, 0.8, B[k]) * plate * 0.6;
      r = mix(r, 150, ash); g = mix(g, 148, ash); b = mix(b, 142, ash);
      if (plate < 0.3 && E[k] > 0.58) { r += 36 * (1 - plate); g += 11 * (1 - plate); b += 4 * (1 - plate); } // dull glowless red-brown deep in fissures
      o[0] = r; o[1] = g; o[2] = b;
    });
    const R = mkRng(1101);
    cracks(ctx, R, 46, 110, 'rgba(6,5,5,0.75)', 1.6, Math.PI / 2, 0.5);
    for (let i = 0; i < 260; i++) { const x = R() * N, y = R() * N; blob(ctx, x, y, 0.8 + R() * 2.6, 0.8 + R() * 2.2, 0, 'rgba(200,198,190,' + (0.1 + R() * 0.25) + ')'); }
    grain(ctx, 11, 1102);
  }

  function canvas_tarp(ctx) {
    const F = field(2, 1, 3, 121), Fd = field(3, 8, 3, 122), S = field(4, 4, 4, 123), M = field(40, 40, 2, 124);
    paint(ctx, (k, x, y, o) => {
      const a = 0.5 + 0.5 * Math.sin(x * 1.5708), b = 0.5 + 0.5 * Math.sin(y * 1.5708);
      const wv = 0.84 + 0.16 * ((((x >> 1) + (y >> 1)) & 1) ? a : b);
      const fold = 0.72 + 0.5 * F[k] + 0.18 * (Fd[k] - 0.5);
      let r = 112 * fold * wv, g = 110 * fold * wv, bl = 70 * fold * wv;
      const st = smooth(0.58, 0.76, S[k]), edge = smooth(0.56, 0.6, S[k]) * (1 - smooth(0.6, 0.66, S[k])); // tide-line water stains
      r *= 1 - 0.28 * st - 0.2 * edge; g *= 1 - 0.26 * st - 0.2 * edge; bl *= 1 - 0.18 * st - 0.2 * edge;
      if (M[k] > 0.8) { r *= 0.62; g *= 0.74; bl *= 0.55; } // mildew speckle
      o[0] = r; o[1] = g; o[2] = bl;
    });
    const R = mkRng(1201);
    for (const sx of [170, 341]) {
      for (const dx of [-5, 5]) { ctx.strokeStyle = 'rgba(36,32,18,0.7)'; ctx.lineWidth = 1.2; line(ctx, sx + dx, 0, sx + dx, N); }
      ctx.strokeStyle = 'rgba(190,180,130,0.55)'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); line(ctx, sx, 0, sx, N); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(sx + 6, 0, 3, N);
    }
    for (let i = 0; i < 22; i++) { // frayed threads and small patches
      const x = R() * N, y = R() * N; ctx.strokeStyle = 'rgba(170,160,110,0.4)'; ctx.lineWidth = 0.8; line(ctx, x, y, x + (R() - 0.5) * 18, y + (R() - 0.5) * 18);
    }
    for (let i = 0; i < 4; i++) { const x = R() * N, y = R() * N, w = 30 + R() * 30; ctx.fillStyle = 'rgba(80,92,60,0.35)'; ctx.fillRect(x, y, w, w * 0.8); ctx.strokeStyle = 'rgba(30,28,16,0.6)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeRect(x + 2, y + 2, w - 4, w * 0.8 - 4); ctx.setLineDash([]); }
    for (const [gx, gy] of [[60, 60], [450, 120], [120, 420]]) { blob(ctx, gx, gy, 9, 9, 0, 'rgba(0,0,0,0.35)'); blob(ctx, gx, gy, 7, 7, 0, 'rgb(130,122,100)'); blob(ctx, gx, gy, 3.5, 3.5, 0, 'rgb(30,28,22)'); }
    grain(ctx, 10, 1202);
  }

  const GEN = { laterite, trench_mud, grass_dry, sandbag, log, plank, corrugated, rock, bamboo, tank_metal, burnt_bark, canvas_tarp };

  function get(name) {
    if (cache[name]) return cache[name];
    const gen = GEN[name];
    if (!gen) throw new Error('G.Tex: unknown texture "' + name + '"');
    const [c, ctx] = newCanvas();
    gen(ctx);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    canv[name] = c;
    return (cache[name] = t);
  }
  return { get, names: Object.keys(GEN), canvas: n => canv[n] || (get(n), canv[n]), preload() { Object.keys(GEN).forEach(get); } };
})();
