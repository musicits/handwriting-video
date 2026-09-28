/* 손글씨 영상 메이커 — 엔진
   사진 → 종이 펴기(네 모서리) → 분석(잉크·공책 줄·글줄·쓰는 순서) → 종이 템플릿 → 프레임 → MP4
   모든 처리는 브라우저 안에서 끝납니다. 사진은 어디로도 보내지 않습니다. */
"use strict";
const HW = (() => {

const W = 1000;               // 펴낸 종이 폭(px). 아래 기준값이 전부 이 폭에 맞춰져 있다
const FPS = 30;
const INTRO = 0.8;            // 빈 종이로 시작하는 시간(초)
const SPEED = { "느리게": [200, 1.3], "보통": [300, 1.0], "빠르게": [450, 0.7] };  // px/s, 쉼 배수
const RATIO = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080] };

const tick = () => new Promise(r => setTimeout(r, 0));

/* ───────────── 보조 ───────────── */
function boxBlur(src, w, h, r) {          // 상자 흐림 3번 = 가우스 근사
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let p = 0; p < 3; p++) {
    for (let y = 0; y < h; y++) {          // 가로
      const o = y * w; let s = 0;
      for (let x = -r - 1; x < r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        s += a[o + Math.min(w - 1, x + r)] - a[o + Math.max(0, x - r - 1)];
        b[o + x] = s / n;
      }
    }
    for (let x = 0; x < w; x++) {          // 세로
      let s = 0;
      for (let y = -r - 1; y < r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        s += b[Math.min(h - 1, y + r) * w + x] - b[Math.max(0, y - r - 1) * w + x];
        a[y * w + x] = s / n;
      }
    }
  }
  return a;
}
function maxFilterF(src, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = -1e9; const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r), row = y * w;
    for (let k = x0; k <= x1; k++) if (src[row + k] > m) m = src[row + k];
    t[row + x] = m;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let m = -1e9; const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let k = y0; k <= y1; k++) if (t[k * w + x] > m) m = t[k * w + x];
    o[y * w + x] = m;
  }
  return o;
}
function dilate(mask, w, h, r) {           // 네모 팽창(최대 필터)
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // 앞뒤 두 번 훑어 반경 안에 1이 있는지
    let near = -1e9;
    for (let x = 0; x < w; x++) { if (mask[row + x]) near = x; if (x - near <= r) t[row + x] = 1; }
    near = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (mask[row + x]) near = x; if (near - x <= r) t[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let near = -1e9;
    for (let y = 0; y < h; y++) { if (t[y * w + x]) near = y; if (y - near <= r) o[y * w + x] = 1; }
    near = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) near = y; if (near - y <= r) o[y * w + x] = 1; }
  }
  return o;
}
function vrun(mask, w, h) {                // 화소마다 세로로 이어진 길이
  const out = new Int32Array(w * h);
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) { y++; continue; }
      let e = y; while (e < h && mask[e * w + x]) e++;
      for (let k = y; k < e; k++) out[k * w + x] = e - y;
      y = e;
    }
  }
  return out;
}
function otsu(vals) {
  if (vals.length < 500) return 60;
  let mn = Infinity, mx = -Infinity;
  for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const B = 128, hist = new Float64Array(B), step = (mx - mn) / B || 1;
  for (const v of vals) hist[Math.min(B - 1, Math.floor((v - mn) / step))]++;
  let tot = 0, sumAll = 0;
  for (let i = 0; i < B; i++) { tot += hist[i]; sumAll += hist[i] * (mn + (i + .5) * step); }
  let w0 = 0, s0 = 0, best = -1, bi = 0;
  for (let i = 0; i < B; i++) {
    w0 += hist[i]; s0 += hist[i] * (mn + (i + .5) * step);
    const w1 = tot - w0; if (!w0 || !w1) continue;
    const m0 = s0 / w0, m1 = (sumAll - s0) / w1, v = w0 * w1 * (m0 - m1) ** 2;
    if (v > best) { best = v; bi = i; }
  }
  return mn + (bi + .5) * step;
}
function period(prof, lo, hi) {            // 자기상관으로 반복 간격 찾기 → [간격, 세기]
  const n = prof.length; let mean = 0;
  for (const v of prof) mean += v; mean /= n;
  const p = prof.map(v => v - mean);
  let a0 = 0; for (const v of p) a0 += v * v;
  if (!a0) return [0, 0];
  hi = Math.min(hi, n - 1);
  let bl = 0, bv = -1;
  for (let lag = lo; lag < hi; lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += p[i] * p[i + lag];
    s /= a0; if (s > bv) { bv = s; bl = lag; }
  }
  return [bl, bv];
}
function interpSum(arr, start, stepv) {
  let s = 0;
  for (let f = start; f < arr.length - 1; f += stepv) {
    const i = Math.floor(f), t = f - i; s += arr[i] * (1 - t) + arr[i + 1] * t;
  }
  return s;
}
function hexRGB(h) { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noiseField(w, h, cell, seed) {    // 부드러운 값 잡음(0~1)
  const r = rng(seed), gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      o[y * w + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return o;
}

/* ───────────── 사진 → 종이 펴기 ───────────── */
function solve(A, b) {                     // 가우스 소거
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}
function homography(src, dst) {            // 출력 좌표 → 원본 좌표
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}
function warp(bitmap, corners) {
  const iw = bitmap.width, ih = bitmap.height;
  let P = corners.map(([x, y]) => [x * iw, y * ih]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const top = d(P[0], P[1]), bot = d(P[3], P[2]), left = d(P[0], P[3]), right = d(P[1], P[2]);
  const H = Math.max(200, Math.min(Math.round(W * (left + right) / Math.max(top + bot, 1)), W * 2.5 | 0));
  let f = 1; const k = (top + bot) / 2 / W;
  if (k > 2) f = Math.floor(k / 1.5);
  const sw = Math.max(1, Math.round(iw / f)), sh = Math.max(1, Math.round(ih / f));
  const cv = document.createElement("canvas"); cv.width = sw; cv.height = sh;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.imageSmoothingQuality = "high"; cx.drawImage(bitmap, 0, 0, sw, sh);
  const src = cx.getImageData(0, 0, sw, sh).data;
  P = P.map(([x, y]) => [x * sw / iw, y * sh / ih]);
  const h8 = homography(P, [[0, 0], [W, 0], [W, H], [0, H]]);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xx = x + .5, yy = y + .5, den = h8[6] * xx + h8[7] * yy + 1;
    let u = (h8[0] * xx + h8[1] * yy + h8[2]) / den - .5, v = (h8[3] * xx + h8[4] * yy + h8[5]) / den - .5;
    u = Math.min(sw - 1.001, Math.max(0, u)); v = Math.min(sh - 1.001, Math.max(0, v));
    const x0 = u | 0, y0 = v | 0, tx = u - x0, ty = v - y0, o = (y * W + x) * 4;
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
    for (let c = 0; c < 3; c++)
      out[o + c] = (src[i00 + c] * (1 - tx) + src[i10 + c] * tx) * (1 - ty) + (src[i01 + c] * (1 - tx) + src[i11 + c] * tx) * ty;
    out[o + 3] = 255;
  }
  return { rgba: out, W, H };
}

/* ───────────── 공책 줄 찾기 ───────────── */
function findRules(dark, w, h, thr) {
  const low = new Uint8Array(w * h), lt = Math.max(12, thr * .45);
  for (let i = 0; i < w * h; i++) low[i] = dark[i] > lt;
  const vr = vrun(low, w, h), thin = new Uint8Array(w * h);
  const ys = [], xs = [];
  for (let i = 0; i < w * h; i++) if (low[i] && vr[i] <= 7) { thin[i] = 1; ys.push(i / w | 0); xs.push(i % w); }
  if (ys.length < w) return null;
  const stride = Math.max(1, Math.ceil(ys.length / 250000));
  let best = null;
  for (let sl = -0.04; sl <= 0.04001; sl += 0.0005) {
    const prof = new Float64Array(h + 120);
    for (let i = 0; i < ys.length; i += stride) prof[Math.round(ys[i] - sl * xs[i]) + 60]++;
    let sc = 0; for (const v of prof) sc += v * v;
    if (!best || sc > best[0]) best = [sc, sl, prof];
  }
  const SL = best[1], raw = best[2], sm = new Float64Array(raw.length);
  for (let i = 1; i < raw.length - 1; i++) sm[i] = (raw[i - 1] + raw[i] + raw[i + 1]) / 3;
  const [P0, st] = period(Array.from(sm), 18, 160);
  if (!P0 || st < .15) return null;
  let bp = null;
  for (let Pc = P0 - 1.5; Pc <= P0 + 1.5001; Pc += .05)
    for (let ph = 0; ph < Pc; ph += .5) {
      const sc = interpSum(sm, ph, Pc);
      if (!bp || sc > bp[0]) bp = [sc, Pc, ph];
    }
  const P = bp[1], ph = bp[2], y0s = [];
  for (let k = 0; k <= sm.length / P + 1; k++) {
    const y0 = ph + k * P - 60;
    if (!(y0 > -P * .5 && y0 < h + P * .5)) continue;
    let hit = 0;
    for (let x = 0; x < w; x++) {
      const yl = Math.round(y0 + SL * x); let any = 0;
      for (let dy = -2; dy <= 2 && !any; dy++) { const y = yl + dy; if (y >= 0 && y < h && thin[y * w + x]) any = 1; }
      hit += any;
    }
    if (hit / w > .3) y0s.push(y0);
  }
  // 줄 간격은 일정하다: 글씨에 가려 놓친 줄은 사이에 채운다
  const full = [];
  for (let i = 0; i < y0s.length; i++) {
    if (i) { const a = y0s[i - 1], b = y0s[i], m = Math.round((b - a) / P); for (let k = 1; k < m; k++) full.push(a + k * (b - a) / m); }
    full.push(y0s[i]);
  }
  const lines = full.map(y0 => { const l = new Float32Array(w); for (let x = 0; x < w; x++) l[x] = y0 + SL * x; return l; });
  if (lines.length < 3) return null;
  const R = [];
  const cs = []; for (let c = 50; c < w; c += 100) cs.push(c);
  for (const yl of lines) {           // 휜 곳 맞추기: 100px 띠마다 가까운 봉우리로
    const yv = cs.map(c => {
      const a = Math.max(0, c - 50), b = Math.min(w, c + 50), y = Math.round(yl[c]);
      let bv = -1, by = yl[c];
      for (let yy = Math.max(0, y - 6); yy < Math.min(h, y + 7); yy++) {
        let s = 0; for (let x = a; x < b; x++) s += thin[yy * w + x];
        if (s > bv) { bv = s; by = yy; }
      }
      return bv >= .25 * (b - a) ? by : yl[c];
    });
    const l = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      if (x <= cs[0]) l[x] = yv[0];
      else if (x >= cs[cs.length - 1]) l[x] = yv[yv.length - 1];
      else { const j = Math.floor((x - cs[0]) / 100), t = (x - cs[j]) / 100; l[x] = yv[j] * (1 - t) + yv[j + 1] * t; }
    }
    R.push(l);
  }
  return { R, P };
}

/* 쓰는 순서: 줄 → 글자(x 가 겹치면 같은 글자) → 위·왼쪽 먼저 */
function buildOrder(keep, lineOf, info) {
  const order = [];
  const Ls = [...new Set(lineOf.values())].sort((a, b) => a - b);
  for (const L of Ls) {
    const cs = keep.filter(id => lineOf.get(id) === L).sort((a, b) => info[a].x0 - info[b].x0);
    const sy = [];
    for (const id of cs) {
      const f = info[id], s = sy[sy.length - 1];
      if (s) {
        const ov = Math.min(s.x1, f.x1) - Math.max(s.x0, f.x0);
        if (ov > .3 * (Math.min(s.x1 - s.x0, f.x1 - f.x0) + 1)) { s.c.push(id); s.x0 = Math.min(s.x0, f.x0); s.x1 = Math.max(s.x1, f.x1); continue; }
      }
      sy.push({ c: [id], x0: f.x0, x1: f.x1 });
    }
    for (const s of sy) {
      const yt = Math.min(...s.c.map(i => info[i].y0)), yb = Math.max(...s.c.map(i => info[i].y1));
      const mid = yt + .62 * (yb - yt);
      s.c.sort((a, b) => ((info[a].cy > mid) - (info[b].cy > mid)) || (info[a].x0 - info[b].x0));
      order.push([L, s.c]);
    }
  }
  return order;
}

/* ───────────── 분석 ───────────── */
async function analyze(paper, sens = 50, ruleMode = "자동", say = () => {}, keepOutside = false) {
  const { rgba, W: w, H: h } = paper, N = w * h;
  const gray = new Float32Array(N);
  for (let i = 0; i < N; i++) gray[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
  say("잉크 찾는 중"); await tick();
  const bg = boxBlur(maxFilterF(gray, w, h, 10), w, h, 7);
  const dark = new Float32Array(N), vals = [];
  for (let i = 0; i < N; i++) { dark[i] = bg[i] - gray[i]; if (dark[i] > 8 && (i % 3 === 0)) vals.push(dark[i]); }
  const thr = Math.max(15, otsu(vals) * (1.5 - sens / 100));
  let core = new Uint8Array(N);
  for (let i = 0; i < N; i++) core[i] = dark[i] > thr;

  say("공책 줄 찾는 중"); await tick();
  const rule = ruleMode === "없음" ? null : findRules(dark, w, h, thr);
  const R = rule ? rule.R : null;
  let Pd = 1;
  let P = rule ? rule.P : 0;
  if (R) {
    const vr = vrun(core, w, h);
    // 줄 두께를 잰다: 줄 위 화소의 세로 길이 중앙값. 이보다 두꺼운 것은 줄 위에 겹친 획이라 남긴다
    const runs = [];
    for (const yl of R) for (let x = 0; x < w; x += 2) {
      const y = Math.round(yl[x]); if (y < 0 || y >= h) continue;
      const i = y * w + x; if (core[i]) runs.push(vr[i]);
    }
    runs.sort((a, b) => a - b);
    const cut = Math.max(3, Math.min(9, (runs[runs.length >> 1] || 5) + 2));
    const before = core.slice();
    for (const yl of R) for (let x = 0; x < w; x++) {
      const y0 = Math.ceil(yl[x] - 4.5), y1 = Math.floor(yl[x] + 4.5);
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) { const i = y * w + x; if (core[i] && vr[i] <= cut) core[i] = 0; }
    }
    // 점선 공책이면 줄은 짧게 끊긴 점, 획은 길게 이어진 선이다 — 줄 위에 겹친 가로획을 되살린다
    Pd = dotPeriod(gray, R, w, h);
    if (Pd >= 3) {
      const hr = new Int32Array(N);
      for (let y = 0; y < h; y++) { let x = 0; const row = y * w;
        while (x < w) { if (!before[row + x]) { x++; continue; } let e = x; while (e < w && before[row + e]) e++; for (let k = x; k < e; k++) hr[row + k] = e - x; x = e; } }
      const body = dilate(core, w, h, 6);          // 글씨 근처에 있는 것만(떨어진 줄 조각은 그대로 줄)
      for (let i = 0; i < N; i++) if (before[i] && !core[i] && body[i] && hr[i] >= 2 * Pd + 2 && hr[i] <= 200) core[i] = 1;
    }
    const near = dilate(core, w, h, 4);
    for (let i = 0; i < N; i++) if (dark[i] > thr && near[i]) core[i] = 1;   // 획 끝이 줄에 닿은 부분은 살린다
  }
  const D = dilate(core, w, h, 3);

  // 글줄 번호
  const LM = new Int32Array(N);
  let lineYs = [];
  if (R) {
    for (let x = 0; x < w; x++) {
      const bs = R.map(l => l[x] + .14 * P).sort((a, b) => a - b);
      let k = 0;
      for (let y = 0; y < h; y++) { while (k < bs.length && y >= bs[k]) k++; LM[y * w + x] = k; }
    }
    lineYs = R.map(l => { let s = 0; for (const v of l) s += v; return s / w; });
  } else {
    const rows = new Float64Array(h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) s += core[y * w + x]; rows[y] = s; }
    const prof = rows.map((_, y) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) if (y + k >= 0 && y + k < h) { s += rows[y + k]; n++; } return s / n; });
    const [Pt, st] = period(Array.from(prof), 15, 220);
    if (Pt && st > .2) {
      P = Pt; let bf = 0, bs = Infinity;
      for (let f = 0; f < Pt; f += .5) { const s = interpSum(prof, f, Pt); if (s < bs) { bs = s; bf = f; } }
      for (let y = 0; y < h; y++) { const L = Math.floor((y - bf) / Pt); for (let x = 0; x < w; x++) LM[y * w + x] = L; }
      for (let y = bf; y < h; y += Pt) lineYs.push(y);
    } else {
      P = 50; let cut = 0, prevGap = true;
      for (let y = 0; y < h; y++) {
        const gap = prof[y] <= 2;
        if (prevGap && !gap) cut++;
        prevGap = gap;
        for (let x = 0; x < w; x++) LM[y * w + x] = cut;
      }
    }
  }

  // 연결 요소(같은 글줄 안에서만). 넓힌 D 로 묶으면 떨어진 윗줄 받침과 아랫줄 윗획이 붙어 버려서, 실제 잉크(1px)로 묶는다
  say("글자 나누는 중"); await tick();
  const C1 = dilate(core, w, h, 1);
  const lab = new Int32Array(N).fill(-1), comps = [];
  const q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!C1[s] || lab[s] >= 0) continue;
    const id = comps.length, L0 = LM[s]; let qh = 0, qt = 0;
    q[qt++] = s; lab[s] = id;
    while (qh < qt) {
      const i = q[qh++], y = i / w | 0, x = i - y * w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dy && !dx) continue;
        const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (C1[j] && lab[j] < 0 && LM[j] === L0) { lab[j] = id; q[qt++] = j; }
      }
    }
    comps.push(q.slice(0, qt));
  }
  const info = comps.map(p => {
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sy = 0;
    for (const i of p) { const y = i / w | 0, x = i - y * w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sy += y; }
    return { x0, x1, y0, y1, cy: sy / p.length, n: p.length };
  });
  const drop = (id) => {
    const p = comps[id], f = info[id];
    if (p.length < 4) return true;
    if (R && f.y1 - f.y0 <= 14 && (f.x1 - f.x0 > 50 || f.y1 - f.y0 <= 6)) {   // 공책 줄 찌꺼기
      const ds = [];
      for (let k = 0; k < p.length; k += 3) {
        const y = p[k] / w | 0, x = p[k] - y * w; let m = 1e9;
        for (const l of R) m = Math.min(m, Math.abs(l[x] - y));
        ds.push(m);
      }
      ds.sort((a, b) => a - b);
      if (ds[ds.length >> 1] <= 7) return true;
    }
    if (p.length < 300) {                                          // 흐린 티끌
      const dv = Array.from(p, i => dark[i]).sort((a, b) => a - b);
      if (dv[Math.floor(dv.length * .9)] < thr * 1.4) return true;
    }
    return false;
  };
  let keep = [];
  for (let id = 0; id < comps.length; id++) {
    if (drop(id)) { for (const i of comps[id]) lab[i] = -1; } else keep.push(id);
  }
  if (!keepOutside && keep.length > 3) {       // 종이 밖(인스타 좋아요·프로필 줄, 사진 테두리): 바탕 밝기가 종이와 크게 다른 덩어리는 뺀다
    const all = [], mb = new Map();
    for (const id of keep) {
      const p = comps[id], v = [];
      for (let k = 0; k < p.length; k += 3) v.push(bg[p[k]]);
      v.sort((x, y) => x - y); mb.set(id, v[v.length >> 1]);
      for (let k = 0; k < v.length; k += 2) all.push(v[k]);
    }
    all.sort((x, y) => x - y); const m0 = all[all.length >> 1];
    const out = keep.filter(id => Math.abs(mb.get(id) - m0) > 30);
    if (out.length < keep.length / 2) {
      for (const id of out) for (const i of comps[id]) lab[i] = -1;
      const o = new Set(out); keep = keep.filter(id => !o.has(id));
    }
  }
  if (!keep.length) throw new Error("글씨를 찾지 못했습니다");

  const lineOf = new Map(keep.map(id => [id, LM[comps[id][0]]]));
  const nb = new Map();                       // 조각 → (이웃 → 맞닿은 화소 수)
  const touch = (a, b) => {
    if (!nb.has(a)) nb.set(a, new Map()); if (!nb.has(b)) nb.set(b, new Map());
    nb.get(a).set(b, (nb.get(a).get(b) || 0) + 1); nb.get(b).set(a, (nb.get(b).get(a) || 0) + 1);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = lab[y * w + x]; if (a < 0) continue;
    if (x + 1 < w) { const b = lab[y * w + x + 1]; if (b >= 0 && b !== a) touch(a, b); }
    if (y + 1 < h) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx; if (xx < 0 || xx >= w) continue;
      const b = lab[(y + 1) * w + xx]; if (b >= 0 && b !== a) touch(a, b);
    }
    // 공책 줄을 지우며 끊긴 세로획: 바로 아래 칸이 비었으면 8px 까지 내려가 이어지는 조각을 찾는다
    if (y + 1 < h && lab[(y + 1) * w + x] < 0) {
      for (let k = 2; k <= 8 && y + k < h; k++) {
        const b = lab[(y + k) * w + x];
        if (b >= 0) { if (b !== a) touch(a, b); break; }
      }
    }
  }
  // 줄 경계에서 잘린 꼭지·꼬리 조각은 가장 많이 맞닿은 조각(= 원래 붙어 있던 글자)의 줄로 보낸다
  for (const id of [...nb.keys()].sort((a, b) => info[a].n - info[b].n)) {
    if (info[id].y1 - info[id].y0 >= .5 * P) continue;
    let best = -1, bc = 0;
    for (const [j, c] of nb.get(id)) if (c > bc || (c === bc && info[j].n > info[best].n)) { best = j; bc = c; }
    if (best >= 0 && info[best].n > info[id].n) lineOf.set(id, lineOf.get(best));
  }

  {                                                                          // 조각만 남은 줄은 가장 가까운 줄로
    const tot = new Map(), ysum = new Map();
    for (const id of keep) { const L = lineOf.get(id); tot.set(L, (tot.get(L) || 0) + info[id].n); ysum.set(L, (ysum.get(L) || 0) + info[id].cy * info[id].n); }
    const med = [...tot.values()].sort((a, b) => a - b)[tot.size >> 1];
    const my = L => ysum.get(L) / tot.get(L);
    const big = [...tot.keys()].filter(L => tot.get(L) >= .1 * med);
    for (const L of tot.keys()) {
      if (tot.get(L) >= .1 * med || !big.length) continue;
      const to = big.reduce((a, b) => Math.abs(my(a) - my(L)) <= Math.abs(my(b) - my(L)) ? a : b);
      for (const id of keep) if (lineOf.get(id) === L) lineOf.set(id, to);
    }
  }

  {                                           // 넓힌 테두리(D)는 가장 가까운 글자에 붙인다 — 드러낼 때 번짐까지 덮는다
    const dd = new Uint8Array(N); let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (lab[i] >= 0) q[qt++] = i;
    while (qh < qt) {
      const i = q[qh++]; if (dd[i] >= 3) continue;
      const y = i / w | 0, x = i - y * w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        const j = yy * w + xx; if (D[j] && lab[j] < 0) { lab[j] = lab[i]; dd[j] = dd[i] + 1; q[qt++] = j; }
      }
    }
  }

  const order = buildOrder(keep, lineOf, info);

  // 획 안에서: 왼쪽 위 끝점부터 잉크를 따라 퍼지는 거리(다익스트라)
  say("쓰는 순서 계산 중"); await tick();
  const dist = new Float32Array(N).fill(Infinity), lens = new Map();
  const hk = new Float32Array(N * 2 + 16), hv = new Int32Array(N * 2 + 16);
  for (const id of keep) {
    const p = comps[id]; let s0 = p[0], sb = Infinity;
    for (const i of p) { const y = i / w | 0, x = i - y * w, v = x + .8 * y; if (v < sb) { sb = v; s0 = i; } }
    let n = 0;
    const push = (k, v) => { let c = n++; hk[c] = k; hv[c] = v; while (c > 0) { const pa = (c - 1) >> 1; if (hk[pa] <= hk[c]) break; [hk[pa], hk[c]] = [hk[c], hk[pa]]; [hv[pa], hv[c]] = [hv[c], hv[pa]]; c = pa; } };
    const pop = () => { const k = hk[0], v = hv[0]; n--; hk[0] = hk[n]; hv[0] = hv[n]; let c = 0;
      for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < n && hk[l] < hk[m]) m = l; if (r < n && hk[r] < hk[m]) m = r; if (m === c) break;
        [hk[m], hk[c]] = [hk[c], hk[m]]; [hv[m], hv[c]] = [hv[c], hv[m]]; c = m; } return [k, v]; };
    dist[s0] = 0; push(0, s0); let far = 0;
    while (n) {
      const [dd, i] = pop(); if (dd > dist[i]) continue; if (dd > far) far = dd;
      const y = i / w | 0, x = i - y * w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dy && !dx) continue;
        const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        const j = yy * w + xx; if (lab[j] !== id) continue;
        const nd = dd + (dy && dx ? 1.4142 : 1);
        if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
      }
    }
    lens.set(id, far + 1);
  }

  // 잉크 진하기와 색(템플릿에 옮겨 얹을 때)
  const inkA = new Float32Array(N), strong = [[], [], []];
  for (let i = 0; i < N; i++) if (lab[i] >= 0) {
    inkA[i] = Math.min(1, Math.max(0, (dark[i] - thr * .35) / (thr * 1.1)));
    if (dark[i] > thr * 1.5 && (i % 2 === 0)) for (let c = 0; c < 3; c++) strong[c].push(rgba[i * 4 + c]);
  }
  const med = a => { if (!a.length) return 40; a.sort((x, y) => x - y); return a[a.length >> 1]; };
  const inkColor = strong.map(med);

  say("빈 종이 만드는 중"); await tick();
  const blank = makeBlank(rgba, gray, D, R, w, h, Pd);
  const an = { W: w, H: h, rgba, blank, lab, dist, lens, order, inkA, inkColor, lineYs, pitch: P, ruled: !!R, keep, lineOf, info };
  an.lines = new Set(order.map(o => o[0])).size;
  return an;
}

/* 손으로 고치기: 조각 하나를 다른 조각의 줄로 옮긴다(좌표로 기록해 다시 인식해도 적용) */
function pieceAt(an, x, y, r = 6) {
  x = Math.round(x); y = Math.round(y);
  for (let d = 0; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
    const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= an.W || yy >= an.H) continue;
    const c = an.lab[yy * an.W + xx]; if (c >= 0 && an.lineOf.has(c)) return c;
  }
  return -1;
}
function applyFixes(an, fixes) {
  let n = 0;
  for (const f of fixes) {
    const a = pieceAt(an, f.a[0], f.a[1]), b = pieceAt(an, f.b[0], f.b[1]);
    if (a >= 0 && b >= 0 && a !== b) { an.lineOf.set(a, an.lineOf.get(b)); n++; }
  }
  an.order = buildOrder(an.keep, an.lineOf, an.info);
  an.lines = new Set(an.order.map(o => o[0])).size;
  return n;
}

function dotPeriod(gray, R, w, h) {      // 공책 점선의 반복 간격(점선이 아니면 1)
  const rows = [];
  for (const yl of R) {
    const g = new Float32Array(w); let s = 0;
    for (let x = 0; x < w; x++) { const y = Math.min(h - 1, Math.max(0, Math.round(yl[x]))); g[x] = gray[y * w + x]; s += g[x]; }
    const m = s / w; rows.push(g.map(v => v - m));
  }
  let a0 = 0; for (const r of rows) for (const v of r) a0 += v * v; a0 /= rows.length * w;
  let bk = 1, bv = -Infinity;
  for (let k = 2; k <= 20; k++) { let s = 0, n = 0; for (const r of rows) for (let x = 0; x + k < w; x++) { s += r[x] * r[x + k]; n++; } s /= n; if (s > bv) { bv = s; bk = k; } }
  return a0 > 0 && bv > .2 * a0 ? bk : 1;
}

function makeBlank(rgba, gray, D, R, w, h, Pd = 1) {   // 글씨 자리를 옆 종이로 메운다(공책 줄은 점선 주기에 맞춰)
  const Dm = dilate(D, w, h, 1), N = w * h;
  const out = new Uint8ClampedArray(rgba);
  const wgt = new Float32Array(N); for (let i = 0; i < N; i++) wgt[i] = Dm[i] ? 0 : 1;
  const den = boxBlur(wgt, w, h, 6);
  const soft = [0, 1, 2].map(c => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgba[i * 4 + c] * wgt[i]; return boxBlur(a, w, h, 6); });
  for (let y = 0; y < h; y++) {
    const row = y * w; let x = 0;
    while (x < w) {
      if (!Dm[row + x]) { x++; continue; }
      let e = x; while (e < w && Dm[row + e]) e++;
      const L = e - x, sh = Math.ceil(L / Pd) * Pd; let done = false;
      for (const s of [-sh, sh, -2 * sh, 2 * sh]) {
        const a2 = x + s, b2 = e + s; if (a2 < 0 || b2 > w) continue;
        let clear = true; for (let k = a2; k < b2; k++) if (Dm[row + k]) { clear = false; break; }
        if (!clear) continue;
        for (let k = 0; k < L; k++) for (let c = 0; c < 3; c++) out[(row + x + k) * 4 + c] = rgba[(row + a2 + k) * 4 + c];
        done = true; break;
      }
      if (!done) for (let k = x; k < e; k++) { const d = Math.max(den[row + k], 1e-3); for (let c = 0; c < 3; c++) out[(row + k) * 4 + c] = soft[c][row + k] / d; }
      x = e;
    }
  }
  return out;
}

/* ───────────── 종이 템플릿 ───────────── */
const PAPERS = [
  { id: "원본", name: "원본 사진", sw: "linear-gradient(135deg,#e9e7e2,#d7d4cc)" },
  { id: "공책", name: "줄공책", sw: "repeating-linear-gradient(180deg,#fbfaf5 0 9px,#9fb8d8 9px 10px)", ink: "원본" },
  { id: "모눈", name: "모눈 노트", sw: "repeating-linear-gradient(0deg,#c9d6e3 0 1px,transparent 1px 7px),repeating-linear-gradient(90deg,#c9d6e3 0 1px,#fbfbf8 1px 7px)", ink: "원본" },
  { id: "편지지", name: "편지지", sw: "linear-gradient(180deg,#f8f1e3,#efe3cb)", ink: "세피아" },
  { id: "양피지", name: "양피지", sw: "radial-gradient(circle at 50% 45%,#f0dfb4,#d4b27a 75%,#9c7040)", ink: "세피아" },
  { id: "엽서", name: "항공 엽서", sw: "repeating-linear-gradient(135deg,#d64545 0 5px,#fdfcf8 5px 10px,#2f5fa8 10px 15px,#fdfcf8 15px 20px)", ink: "파랑" },
  { id: "크라프트", name: "크라프트지", sw: "linear-gradient(135deg,#caa77b,#b48d5f)", ink: "검정" },
  { id: "메모지", name: "노란 메모지", sw: "linear-gradient(180deg,#fff3a0,#f7e274)", ink: "검정" },
  { id: "한지", name: "한지", sw: "radial-gradient(circle at 40% 40%,#f6f1e4,#e9dfc8)", ink: "먹" },
  { id: "화이트보드", name: "화이트보드", sw: "linear-gradient(135deg,#ffffff,#eef1f4 60%,#dfe4ea)", ink: "마커 파랑" },
  { id: "칠판", name: "초록 칠판", sw: "linear-gradient(135deg,#35523f,#263d2f)", ink: "분필" },
  { id: "흑판", name: "검은 칠판", sw: "linear-gradient(135deg,#34373a,#1f2123)", ink: "분필" },
];
const INKS = {
  "원본": null, "검정": [28, 28, 32], "먹": [18, 16, 14], "파랑": [32, 58, 150], "세피아": [92, 58, 30], "연필": [70, 70, 74],
  "마커 파랑": [22, 64, 186], "마커 빨강": [196, 36, 40], "마커 검정": [20, 22, 26],
  "분필": [238, 236, 226], "노란 분필": [244, 222, 120],
};
const INK_LIST = ["원본", "검정", "먹", "파랑", "세피아", "연필", "마커 파랑", "마커 빨강", "마커 검정", "분필", "노란 분필"];

function drawPaper(id, an, seed = 7) {
  const w = an.W, h = an.H, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  const pitch = an.pitch || 50;
  let ys = an.lineYs.length >= 2 ? an.lineYs.slice() : [];
  if (ys.length >= 2) {   // 글줄 간격을 종이 끝까지 늘린다
    let a = ys[0]; while (a - pitch > pitch * .6) { a -= pitch; ys.unshift(a); }
    let b = ys[ys.length - 1]; while (b + pitch < h - pitch * .4) { b += pitch; ys.push(b); }
  } else { for (let y = pitch * 1.5; y < h - pitch * .4; y += pitch) ys.push(y); }
  let inkLeft = w;
  { const lab = an.lab; for (let y = 0; y < h; y += 2) for (let x = 0; x < inkLeft; x++) if (lab[y * w + x] >= 0) { inkLeft = x; break; } }
  const grain = (amt, cell, sd) => {               // 종이 결
    const nf = noiseField(w, h, cell, sd), fine = rng(sd + 11), im = g.getImageData(0, 0, w, h), d = im.data;
    for (let i = 0; i < w * h; i++) { const v = (nf[i] - .5) * amt + (fine() - .5) * amt * .5; d[i * 4] += v; d[i * 4 + 1] += v; d[i * 4 + 2] += v; }
    g.putImageData(im, 0, 0);
  };
  const lineAt = (y, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke(); };
  switch (id) {
    case "공책": {
      g.fillStyle = "#fbfaf4"; g.fillRect(0, 0, w, h); grain(6, 60, seed);
      for (const y of ys) lineAt(y, "rgba(110,150,205,.75)", 1.6);
      const mx = inkLeft > 70 ? Math.min(inkLeft - 24, 110) : 0;
      if (mx > 20) { g.strokeStyle = "rgba(226,110,110,.8)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, h); g.stroke(); }
      break;
    }
    case "모눈": {
      g.fillStyle = "#fbfbf7"; g.fillRect(0, 0, w, h); grain(5, 60, seed);
      const c = pitch / 2, y0 = ys[0] % c;
      g.strokeStyle = "rgba(120,160,200,.38)"; g.lineWidth = 1;
      g.beginPath();
      for (let y = y0; y < h; y += c) { g.moveTo(0, Math.round(y) + .5); g.lineTo(w, Math.round(y) + .5); }
      for (let x = (w % c) / 2; x < w; x += c) { g.moveTo(Math.round(x) + .5, 0); g.lineTo(Math.round(x) + .5, h); }
      g.stroke();
      break;
    }
    case "편지지": {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#faf4e7"); gr.addColorStop(1, "#f1e6d0");
      g.fillStyle = gr; g.fillRect(0, 0, w, h); grain(7, 80, seed);
      g.setLineDash([2, 5]); for (const y of ys) lineAt(y, "rgba(170,140,95,.55)", 1.2); g.setLineDash([]);
      g.strokeStyle = "rgba(170,135,85,.7)"; g.lineWidth = 2; g.strokeRect(18, 18, w - 36, h - 36);
      g.lineWidth = 1; g.strokeRect(26, 26, w - 52, h - 52);
      break;
    }
    case "양피지": {
      g.fillStyle = "#ead7a8"; g.fillRect(0, 0, w, h);
      const im = g.getImageData(0, 0, w, h), d = im.data;
      const n1 = noiseField(w, h, 140, seed), n2 = noiseField(w, h, 35, seed + 3), fr = rng(seed + 5);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, ex = Math.min(x, w - 1 - x) / w, ey = Math.min(y, h - 1 - y) / h;
        const edge = Math.max(0, 1 - Math.min(ex, ey) * 9);           // 가장자리 탄 자국
        const v = (n1[i] - .5) * 38 + (n2[i] - .5) * 16 + (fr() - .5) * 8;
        const burn = edge * edge * (80 + n2[i] * 60);
        d[i * 4] += v - burn * .9; d[i * 4 + 1] += v - burn * 1.15; d[i * 4 + 2] += v - burn * 1.4;
      }
      g.putImageData(im, 0, 0);
      break;
    }
    case "엽서": {
      g.fillStyle = "#fdfbf6"; g.fillRect(0, 0, w, h); grain(5, 70, seed);
      const b = 16; g.save(); g.beginPath(); g.rect(0, 0, w, h); g.rect(b, b, w - 2 * b, h - 2 * b); g.clip("evenodd");
      g.translate(0, 0);
      for (let k = -h; k < w + h; k += 44) {
        g.fillStyle = (k / 44) % 2 === 0 ? "#d64545" : "#2f5fa8";
        g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 22, 0); g.lineTo(k + 22 - h, h); g.lineTo(k - h, h); g.closePath(); g.fill();
      }
      g.restore();
      // 우표 자리: 오른쪽 위가 비어 있을 때만
      const sw = 92, shh = 112, sx = w - b - 24 - sw, sy = b + 24;
      let free = true; const lab = an.lab;
      for (let y = sy - 8; y < sy + shh + 8 && free; y += 3) for (let x = sx - 8; x < sx + sw + 8; x += 3) if (y >= 0 && y < h && lab[y * w + x] >= 0) { free = false; break; }
      if (free) {
        g.setLineDash([5, 4]); g.strokeStyle = "rgba(120,120,130,.7)"; g.lineWidth = 1.5; g.strokeRect(sx, sy, sw, shh); g.setLineDash([]);
        g.fillStyle = "rgba(120,120,130,.75)"; g.font = "600 13px sans-serif"; g.textAlign = "center"; g.fillText("STAMP", sx + sw / 2, sy + shh / 2 + 4);
      }
      break;
    }
    case "크라프트": {
      g.fillStyle = "#c7a377"; g.fillRect(0, 0, w, h); grain(14, 90, seed);
      const im = g.getImageData(0, 0, w, h), d = im.data, fr = rng(seed + 9);   // 섬유
      for (let k = 0; k < w * h / 900; k++) {
        let x = fr() * w, y = fr() * h; const a = fr() * Math.PI, L = 8 + fr() * 26, dv = (fr() - .5) * 26;
        for (let t = 0; t < L; t++) { const xi = x + Math.cos(a) * t | 0, yi = y + Math.sin(a) * t | 0; if (xi < 0 || yi < 0 || xi >= w || yi >= h) break; const i = (yi * w + xi) * 4; d[i] += dv; d[i + 1] += dv * .9; d[i + 2] += dv * .7; }
      }
      g.putImageData(im, 0, 0);
      break;
    }
    case "메모지": {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#fff4a6"); gr.addColorStop(1, "#f8e37a");
      g.fillStyle = gr; g.fillRect(0, 0, w, h); grain(5, 70, seed);
      const top = g.createLinearGradient(0, 0, 0, h * .12);             // 붙는 띠(윗부분이 살짝 진함)
      top.addColorStop(0, "rgba(200,160,20,.16)"); top.addColorStop(1, "rgba(200,160,20,0)");
      g.fillStyle = top; g.fillRect(0, 0, w, h * .12);
      const curl = g.createLinearGradient(0, h * .82, 0, h);              // 아래가 살짝 들린 그늘
      curl.addColorStop(0, "rgba(120,90,0,0)"); curl.addColorStop(1, "rgba(120,90,0,.14)");
      g.fillStyle = curl; g.fillRect(0, h * .82, w, h * .18);
      break;
    }
    case "한지": {
      g.fillStyle = "#f4eee0"; g.fillRect(0, 0, w, h);
      const im = g.getImageData(0, 0, w, h), d = im.data;
      const n1 = noiseField(w, h, 90, seed), fr = rng(seed + 21);
      for (let i = 0; i < w * h; i++) { const v = (n1[i] - .5) * 14 + (fr() - .5) * 6; d[i * 4] += v; d[i * 4 + 1] += v; d[i * 4 + 2] += v * .9; }
      for (let k = 0; k < w * h / 500; k++) {                               // 닥나무 섬유: 가늘고 긴 올
        let x = fr() * w, y = fr() * h, a = fr() * Math.PI * 2; const L = 20 + fr() * 70, dv = -(10 + fr() * 22);
        for (let t = 0; t < L; t++) {
          a += (fr() - .5) * .25; x += Math.cos(a); y += Math.sin(a);
          const xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= w || yi >= h) break;
          const i = (yi * w + xi) * 4; d[i] += dv; d[i + 1] += dv; d[i + 2] += dv * .85;
        }
      }
      g.putImageData(im, 0, 0);
      break;
    }
    case "화이트보드": {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#ffffff"); gr.addColorStop(.55, "#f1f4f7"); gr.addColorStop(1, "#e3e8ee");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const sh = g.createLinearGradient(0, 0, w, 0);                    // 비스듬한 반사광
      sh.addColorStop(.18, "rgba(255,255,255,0)"); sh.addColorStop(.3, "rgba(255,255,255,.75)"); sh.addColorStop(.42, "rgba(255,255,255,0)");
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
      g.globalAlpha = .06; grain(40, 160, seed); g.globalAlpha = 1;
      const f = 14; g.lineWidth = f; g.strokeStyle = "#b9c0c8"; g.strokeRect(f / 2, f / 2, w - f, h - f);   // 알루미늄 틀
      g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.8)"; g.strokeRect(2, 2, w - 4, h - 4);
      g.strokeStyle = "rgba(90,100,110,.5)"; g.strokeRect(f, f, w - 2 * f, h - 2 * f);
      break;
    }
    case "칠판": case "흑판": {
      g.fillStyle = id === "칠판" ? "#2e4a38" : "#2a2c2e"; g.fillRect(0, 0, w, h);
      const im = g.getImageData(0, 0, w, h), d = im.data;
      const n1 = noiseField(w, h, 180, seed), n2 = noiseField(w, h, 22, seed + 4), fr = rng(seed + 2);
      for (let i = 0; i < w * h; i++) {                                 // 지운 분필 자국
        const v = Math.max(0, n1[i] - .45) * 70 + (n2[i] - .5) * 10 + (fr() - .5) * 7;
        d[i * 4] += v; d[i * 4 + 1] += v; d[i * 4 + 2] += v;
      }
      g.putImageData(im, 0, 0);
      const f = 22, wood = g.createLinearGradient(0, 0, 0, f);          // 나무 틀
      wood.addColorStop(0, "#9b6b3f"); wood.addColorStop(1, "#6e4526");
      g.lineWidth = f; g.strokeStyle = "#7c5230"; g.strokeRect(f / 2, f / 2, w - f, h - f);
      g.lineWidth = 2; g.strokeStyle = "rgba(0,0,0,.35)"; g.strokeRect(f, f, w - 2 * f, h - 2 * f);
      g.strokeStyle = "rgba(255,220,170,.25)"; g.strokeRect(1, 1, w - 2, h - 2);
      break;
    }
  }
  return g.getImageData(0, 0, w, h).data;
}

/* 템플릿 종이는 글씨 크기에 맞춘다: 글씨 둘레 + 여백만큼 잘라 낸 분석 보기 */
function fitView(an) {
  const W0 = an.W, H0 = an.H;
  let bx0 = W0, bx1 = -1, by0 = H0, by1 = -1;
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (an.lab[y * W0 + x] >= 0) {
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 < 0) return an;
  const pad = Math.round(Math.max(56, (an.pitch || 50) * 1.2));
  const x0 = bx0 - pad, y0 = by0 - pad, w = bx1 - bx0 + 1 + 2 * pad, h = by1 - by0 + 1 + 2 * pad;
  const lab = new Int32Array(w * h).fill(-1), dist = new Float32Array(w * h), inkA = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y + y0; if (sy < 0 || sy >= H0) continue;
    for (let x = 0; x < w; x++) {
      const sx = x + x0; if (sx < 0 || sx >= W0) continue;
      const i = y * w + x, j = sy * W0 + sx;
      lab[i] = an.lab[j]; dist[i] = an.dist[j]; inkA[i] = an.inkA[j];
    }
  }
  return { ...an, W: w, H: h, lab, dist, inkA, lineYs: an.lineYs.map(v => v - y0).filter(v => v > -pad && v < h + pad) };
}

/* 겉(다 쓴 모습)과 속(빈 종이) 두 장을 만든다 */
function surfaces(an, paperId, inkName) {
  if (paperId === "원본") return { base: an.blank, top: an.rgba, view: an };
  an = fitView(an);
  const N = an.W * an.H;
  const base = drawPaper(paperId, an);
  const top = new Uint8ClampedArray(base);
  let col = INKS[inkName] || an.inkColor;
  const chalk = inkName && inkName.includes("분필"), marker = inkName && inkName.includes("마커");
  const gr = chalk ? rng(5) : null, nf = chalk ? noiseField(an.W, an.H, 3, 13) : null;
  for (let i = 0; i < N; i++) {
    let a = an.inkA[i]; if (!a) continue;
    if (chalk) a *= .45 + .75 * Math.min(1, nf[i] * .8 + gr() * .5);   // 분필 결: 군데군데 빈다
    if (marker) a = Math.min(1, a * 1.25);
    a = Math.min(1, a);
    for (let c = 0; c < 3; c++) top[i * 4 + c] = base[i * 4 + c] * (1 - a) + col[c] * a;
  }
  return { base, top, view: an };
}

/* ───────────── 시간표 ───────────── */
function timeline(an, speed = "보통") {
  const [V, gk] = SPEED[speed] || SPEED["보통"];
  const seq = []; let t = INTRO, prev = null;
  for (const [L, cs] of an.order) {
    cs.forEach((c, j) => {
      if (seq.length) t += (j ? .05 : (L !== prev ? .5 : .14)) * gk;
      const du = an.lens.get(c) / V; seq.push([c, t, du]); t += du;
    });
    prev = L;
  }
  return { seq, end: t, V };
}

/* ───────────── 화면 짜기 ───────────── */
function layout(an, opt, bitmap, bgBitmap) {
  const pw = an.W, ph = an.H, ps = (opt.size || 92) / 100;
  let CW, CH, sc;
  if (RATIO[opt.ratio]) {
    [CW, CH] = RATIO[opt.ratio];
    const availH = CH * (opt.ratio === "9:16" ? .74 : .9);
    sc = Math.min(CW * ps / pw, availH * ps / ph);
  } else {
    CW = 1080; sc = CW * ps / pw; CH = Math.round((ph * sc + (CW - pw * sc)) / 2) * 2;
  }
  const dw = Math.round(pw * sc), dh = Math.round(ph * sc);
  const px = Math.round((CW - dw) / 2), cy = CH * (opt.ratio === "9:16" ? .45 : .5), py = Math.round(cy - dh / 2);
  const bg = document.createElement("canvas"); bg.width = CW; bg.height = CH;
  const g = bg.getContext("2d");
  const cover = (im, blur) => {
    const s = Math.max(CW / im.width, CH / im.height), iw = im.width * s, ih = im.height * s;
    g.save(); if (blur) g.filter = `blur(${blur}px)`;
    const m = blur ? blur * 2 : 0;
    g.drawImage(im, (CW - iw) / 2 - m, (CH - ih) / 2 - m, iw + 2 * m, ih + 2 * m); g.restore();
  };
  if (opt.bg === "사진" && bitmap) { cover(bitmap, 40); g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, 0, CW, CH); }
  else if (opt.bg === "이미지" && bgBitmap) cover(bgBitmap, 0);
  else {
    const [r, gg, b] = hexRGB(opt.bgColor || "#e4e0da");
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(0, 0, CW, CH);
    const v = g.createRadialGradient(CW / 2, CH * .45, 0, CW / 2, CH * .45, Math.hypot(CW, CH) * .6);
    v.addColorStop(0, "rgba(255,255,255,.06)"); v.addColorStop(1, "rgba(0,0,0,.10)");
    g.fillStyle = v; g.fillRect(0, 0, CW, CH);
  }
  g.save(); g.shadowColor = "rgba(0,0,0,.28)"; g.shadowBlur = 36; g.shadowOffsetX = 4; g.shadowOffsetY = 14;
  g.fillStyle = "#888"; g.fillRect(px, py, dw, dh); g.restore();
  return { CW, CH, px, py, dw, dh, sc, bg };
}

function scaled(rgba, w, h, dw, dh) {
  const s = document.createElement("canvas"); s.width = w; s.height = h;
  s.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  if (dw === w && dh === h) return s.getContext("2d").getImageData(0, 0, w, h).data;
  const d = document.createElement("canvas"); d.width = dw; d.height = dh;
  const g = d.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(s, 0, 0, dw, dh);
  return g.getImageData(0, 0, dw, dh).data;
}

/* 재생기: 시간을 앞으로 돌리며 달라지는 화소만 고친다 */
class Player {
  constructor(an0, opt, canvas, bitmap, bgBitmap, surf) {
    this.opt = opt; this.canvas = canvas;
    const tl = timeline(an0, opt.speed); Object.assign(this, tl);
    surf = surf || surfaces(an0, opt.paper, opt.ink);
    const an = surf.view || an0;
    this.total = tl.end + (+opt.hold || 2.5);
    const L = this.L = layout(an, opt, bitmap, bgBitmap);
    canvas.width = L.CW; canvas.height = L.CH;
    this.g = canvas.getContext("2d", { willReadFrequently: false });
    const { base, top } = surf;
    this.base = scaled(base, an.W, an.H, L.dw, L.dh);
    this.top = scaled(top, an.W, an.H, L.dw, L.dh);
    // 화소마다 도착 시각(표시 크기, 가까운 화소로)
    const start = new Map(tl.seq.map(([c, st]) => [c, st]));
    const n = L.dw * L.dh, T = new Float32Array(n).fill(-Infinity);
    const fx = an.W / L.dw, fy = an.H / L.dh;
    for (let y = 0; y < L.dh; y++) {
      const sy = Math.min(an.H - 1, (y + .5) * fy | 0);
      for (let x = 0; x < L.dw; x++) {
        const si = sy * an.W + Math.min(an.W - 1, (x + .5) * fx | 0), c = an.lab[si];
        if (c >= 0 && start.has(c)) T[y * L.dw + x] = start.get(c) + an.dist[si] / tl.V;
      }
    }
    const idx = []; for (let i = 0; i < n; i++) if (T[i] > -Infinity) idx.push(i);
    idx.sort((a, b) => T[a] - T[b]);
    this.idx = Int32Array.from(idx); this.Ts = Float32Array.from(idx, i => T[i]);
    this.soft = 4 / tl.V; this.T = T;
    // 서명: 다 쓴 뒤 고른 자리에 나타난다
    const txt = opt.sign && (opt.signText || "").trim();
    this.sign = null;
    if (txt) {
      const fs = Math.max(18, Math.round(L.dw * .032)), pad = Math.round(L.dw * .06);
      this.g.font = `600 ${fs}px 'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif`;
      const tw = Math.ceil(this.g.measureText(txt).width), rw = tw + 8, rh = fs + 12;
      let pos = opt.signPos || "종이 밖 아래";
      // 종이 안 자리는 글씨 맨 아래보다 밑에만 둔다. 자리가 모자라면 종이 밖으로
      let inkB = 0; for (let i = 0; i < L.dw * L.dh; i++) if (T[i] > -Infinity) { const y = (i / L.dw) | 0; if (y > inkB) inkB = y; }
      const cyIn = L.py + L.dh - Math.round(pad * .5) - rh;
      if (pos !== "종이 밖 아래" && cyIn < L.py + inkB + Math.round(fs * .4)) pos = "종이 밖 아래";
      let cx, cy;                                  // 캔버스 좌표
      if (pos === "왼쪽 아래") { cx = L.px + pad - 4; cy = cyIn; }
      else if (pos === "가운데 아래") { cx = L.px + (L.dw - rw) / 2; cy = cyIn; }
      else if (pos === "종이 밖 아래") { cx = L.px + (L.dw - rw) / 2; cy = Math.min(L.CH - rh - 8, L.py + L.dh + Math.round(fs * 1.2)); }
      else { cx = L.px + L.dw - pad - rw; cy = cyIn; }
      cx = Math.round(cx); cy = Math.round(cy);
      const inside = pos !== "종이 밖 아래";
      let lum = 0, n = 0;                          // 그 자리 밝기로 글자색을 정한다
      const bgd = inside ? null : L.bg.getContext("2d").getImageData(cx, cy, rw, rh).data;
      for (let y = 0; y < rh; y += 3) for (let x = 0; x < rw; x += 3) {
        let o, d;
        if (inside) { const yy = cy - L.py + y, xx = cx - L.px + x; if (yy < 0 || xx < 0 || yy >= L.dh || xx >= L.dw) continue; o = (yy * L.dw + xx) * 4; d = this.top; }
        else { o = (y * rw + x) * 4; d = bgd; }
        lum += .3 * d[o] + .59 * d[o + 1] + .11 * d[o + 2]; n++;
      }
      this.sign = { txt, fs, cx, cy, rw, rh, inside, col: (n && lum / n < 110) ? "236,234,226" : "40,40,46", t0: tl.end + .15 };
    }
    this.reset();
  }
  reset() {
    const L = this.L, n = L.dw * L.dh;
    this.img = new ImageData(L.dw, L.dh); const d = this.img.data;
    for (let i = 0; i < n; i++) { const s = this.T[i] > -Infinity ? this.base : this.top; const o = i * 4; d[o] = s[o]; d[o + 1] = s[o + 1]; d[o + 2] = s[o + 2]; d[o + 3] = 255; }
    this.g.drawImage(L.bg, 0, 0);
    this.g.putImageData(this.img, L.px, L.py);
    this.full = 0; this.t = -1;
  }
  seek(t) {
    if (t < this.t) this.reset();
    const d = this.img.data, idx = this.idx, Ts = this.Ts, base = this.base, top = this.top, L = this.L;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const mark = i => { const y = i / L.dw | 0, x = i - y * L.dw; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    let j = this.full;
    while (j < idx.length && Ts[j] <= t - this.soft) {
      const i = idx[j], o = i * 4; d[o] = top[o]; d[o + 1] = top[o + 1]; d[o + 2] = top[o + 2]; mark(i); j++;
    }
    this.full = j;
    while (j < idx.length && Ts[j] <= t) {
      const i = idx[j], o = i * 4, a = (t - Ts[j]) / this.soft;
      for (let c = 0; c < 3; c++) d[o + c] = base[o + c] * (1 - a) + top[o + c] * a;
      mark(i); j++;
    }
    if (x1 >= 0) this.g.putImageData(this.img, L.px, L.py, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const sg = this.sign;
    if (sg && t >= sg.t0) {
      const a = Math.min(1, (t - sg.t0) / .7) * .78, g = this.g;
      if (sg.inside) g.putImageData(this.img, L.px, L.py, sg.cx - L.px, sg.cy - L.py, sg.rw, sg.rh);   // 밑바탕을 되살린 뒤 겹쳐 그린다
      else g.drawImage(L.bg, sg.cx, sg.cy, sg.rw, sg.rh, sg.cx, sg.cy, sg.rw, sg.rh);
      g.save(); g.font = `600 ${sg.fs}px 'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = `rgba(${sg.col},${a})`;
      g.fillText(sg.txt, sg.cx + sg.rw / 2, sg.cy + sg.rh / 2 + 1); g.restore();
    }
    this.t = t;
  }
}

/* ───────────── 소리 ───────────── */
function mono(buf) {
  const n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}
function makeSound(seq, total, sample, sr, vol) {   // 녹음에서 소리 나는 부분만 모아 획이 써질 때만 이어 붙인다
  const fr = Math.round(.02 * sr), nf = Math.floor(sample.length / fr), rms = new Float32Array(nf);
  for (let k = 0; k < nf; k++) { let s = 0; for (let i = k * fr; i < (k + 1) * fr; i++) s += sample[i] * sample[i]; rms[k] = Math.sqrt(s / fr); }
  const sorted = Float32Array.from(rms).sort(), p95 = sorted[Math.floor(nf * .95)] || 0, th = Math.max(.25 * p95, 1e-4);
  const segs = []; let k = 0;
  while (k < nf) { if (rms[k] <= th) { k++; continue; } let e = k; while (e < nf && rms[e] > th) e++; if (e - k >= 3) segs.push(sample.subarray(k * fr, e * fr)); k = e; }
  if (!segs.length) segs.push(sample);
  const r = rng(3), n = Math.ceil(total * sr) + 1, out = new Float32Array(n), xf = Math.round(.008 * sr);
  for (const [, st, du] of seq) {
    const need = Math.round(du * sr); if (need < 8) continue;
    const buf = new Float32Array(need); let filled = 0, guard = 0;
    while (filled < need && guard++ < 1000) {
      const s = segs[Math.floor(r() * segs.length)]; if (s.length <= xf * 2) continue;
      const o = Math.floor(r() * Math.max(1, s.length - xf * 2)), take = Math.min(s.length - o, need - filled + xf);
      if (take <= xf * 2) continue;
      if (filled >= xf) {
        for (let i = 0; i < xf; i++) { const a = i / xf; buf[filled - xf + i] = buf[filled - xf + i] * (1 - a) + s[o + i] * a; }
        const rest = Math.min(take - xf, need - filled); buf.set(s.subarray(o + xf, o + xf + rest), filled); filled += rest;
      } else { const t2 = Math.min(take, need); buf.set(s.subarray(o, o + t2), 0); filled = t2; }
    }
    const at = Math.min(Math.round(.01 * sr), need / 3 | 0), rl = Math.min(Math.round(.03 * sr), need / 3 | 0), i0 = Math.round(st * sr);
    for (let i = 0; i < need && i0 + i < n; i++) {
      let e = 1; if (i < at) e = i / at; else if (i > need - rl) e = (need - i) / rl;
      out[i0 + i] += buf[i] * e;
    }
  }
  let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v));
  if (pk > 0) { const g = .7 * vol / pk; for (let i = 0; i < n; i++) out[i] *= g; }
  const fo = Math.round(.4 * sr); for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
  return out;
}

/* ───────────── MP4 만들기 ───────────── */
async function pickVideo(w, h) {
  if (!("VideoEncoder" in window)) return null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.640032"])
    for (const hw of ["prefer-hardware", "no-preference", "prefer-software"]) {
      const c = { codec, width: w, height: h, bitrate: 8e6, framerate: FPS, hardwareAcceleration: hw, avc: { format: "avc" } };
      try { const s = await VideoEncoder.isConfigSupported(c); if (s.supported) return s.config; } catch (e) {}
    }
  return null;
}
async function pickAudio(sr) {
  if (!("AudioEncoder" in window)) return null;
  for (const [codec, mux] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
    const c = { codec, sampleRate: sr, numberOfChannels: 1, bitrate: 128000 };
    try { const s = await AudioEncoder.isConfigSupported(c); if (s.supported) return [s.config, mux]; } catch (e) {}
  }
  return null;
}
async function encode(player, audio, sr, onProgress, stopped) {
  const L = player.L, vc = await pickVideo(L.CW, L.CH);
  if (!vc) throw new Error("NOENC");
  const ac = audio ? await pickAudio(sr) : null;
  encode.noAudio = !!(audio && !ac);          // 소리를 넣으려 했는데 이 브라우저가 못 넣는 경우
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: L.CW, height: L.CH, frameRate: FPS },
    audio: ac ? { codec: ac[1], numberOfChannels: 1, sampleRate: sr } : undefined,
    fastStart: "in-memory",
  });
  let err = null;
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e; } });
  ve.configure(vc);
  const n = Math.round(player.total * FPS);
  player.reset();
  for (let i = 0; i < n; i++) {
    if (stopped()) { ve.close(); throw new Error("STOP"); }
    if (err) throw err;
    player.seek(i / FPS);
    const vf = new VideoFrame(player.canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    ve.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close();
    while (ve.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
    if (i % 6 === 0) { onProgress(i / n); await tick(); }
  }
  await ve.flush(); ve.close();
  if (ac && audio) {
    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e; } });
    ae.configure(ac[0]);
    const step = 4800;
    for (let i = 0; i < audio.length; i += step) {
      const part = audio.slice(i, Math.min(audio.length, i + step));
      const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round(i * 1e6 / sr), data: part });
      ae.encode(ad); ad.close();
    }
    await ae.flush(); ae.close();
  }
  if (err) throw err;
  muxer.finalize();
  onProgress(1);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

return { pieceAt, applyFixes, W, FPS, INTRO, SPEED, RATIO, PAPERS, INKS, INK_LIST, warp, analyze, surfaces, timeline, Player, mono, makeSound, encode, pickVideo };
})();
