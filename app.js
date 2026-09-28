/* 손글씨 영상 메이커 — 화면 */
"use strict";
const $ = id => document.getElementById(id);
const tick = () => new Promise(r => setTimeout(r, 30));
const isTouch = () => matchMedia("(hover:none) and (pointer:coarse)").matches;

const DEF = { paper: "원본", ink: "원본", bg: "단색", bgColor: "#e4e0da", ratio: "9:16", size: 92, speed: "보통", hold: 2.5, soundOn: false, vol: 80, sens: 50, rule: "자동", outside: "빼기", sign: false, signText: "", signPos: "종이 밖 아래" };
const S = { step: 1, bitmap: null, name: "", corners: null, paper: null, paperKey: "", an: null, surf: null, surfKey: "",
  bgBitmap: null, fixes: [], force: [], sel: -1, tool: "", toast: "", sound: null, soundName: "", player: null, blob: null, stop: false, playing: false, busy: false };
let opt = { ...DEF };
try { Object.assign(opt, JSON.parse(localStorage.getItem("hwv-opt") || "{}")); } catch (e) {}
const saveOpt = () => { try { localStorage.setItem("hwv-opt", JSON.stringify(opt)); } catch (e) {} };

/* 머리말 높이, 작업 칸이 시작하는 높이 */
const setTops = () => {
  document.documentElement.style.setProperty("--hh", document.querySelector("header").offsetHeight + "px");
  document.documentElement.style.setProperty("--wt", Math.round(document.querySelector(".work").getBoundingClientRect().top + scrollY + 14) + "px");
};
const ro = new ResizeObserver(setTops);
ro.observe(document.querySelector("header")); ro.observe($("steps")); ro.observe($("inapp"));
addEventListener("resize", setTops);

/* ───────── 단계 ───────── */
function go(n) {
  stopPlay();
  if (S.tool) setTool("");
  S.step = n;
  document.querySelectorAll("[data-step]").forEach(el => el.hidden = +el.dataset.step !== n);
  paintSteps();
  $("drop").hidden = !(n === 1 && !S.bitmap);
  $("photo").hidden = !(n === 1 && S.bitmap);
  $("shot").hidden = n !== 2;
  $("view").hidden = n !== 3;
  $("out").hidden = n !== 4;
  if (n !== 4) $("out").pause();
  dock();
  window.scrollTo(0, 0);
}
/* 단계 표시: 갈 수 있는 단계는 눌러서 바로 돌아간다(완성 뒤 인식으로 가서 고치기 등) */
const STEP_NAMES = ["사진", "인식", "꾸미기", "저장"];
const canGo = k => k === 1 || (k === 2 && S.bitmap) || (k === 3 && S.an) || (k === 4 && S.blob);
function paintSteps() {
  document.querySelectorAll("#steps li").forEach(li => {
    const k = +li.dataset.s, cur = k === S.step;
    li.toggleAttribute("aria-current", cur); if (cur) li.setAttribute("aria-current", "step");
    li.classList.toggle("done", k < S.step);
    const inner = `<i>${k}</i><span>${STEP_NAMES[k - 1]}</span>`;
    if (!cur && canGo(k)) { li.innerHTML = `<button type="button">${inner}</button>`; li.firstChild.onclick = () => goStep(k); }
    else li.innerHTML = inner;
  });
}
function goStep(k) {
  if (S.busy || !canGo(k)) return;
  if (k === 2) { go(2); if (!S.an) analyze(); }
  else if (k === 3) { go(3); buildUI3(); preview(); }
  else go(k);
}
function dock() {
  const b = $("dockBtn");
  const m = { 1: S.bitmap ? ["다음", () => $("go2").click()] : ["사진 고르기", () => $("fileIn").click()],
    2: ["다음", () => $("go3").click()], 3: ["영상 만들기", () => $("make").click()], 4: ["MP4 저장", () => $("save").click()] }[S.step];
  b.textContent = m[0]; b.onclick = m[1];
  $("dock").hidden = S.busy;
}
function busy(msg) { const b = $("busy"); b.hidden = !msg; if (msg) b.textContent = msg; }

/* ───────── 1. 사진 ───────── */
$("pick").onclick = $("repick").onclick = $("drop").onclick = () => $("fileIn").click();
$("fileIn").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) loadPhoto(f); };
const stage = $("stage");
stage.addEventListener("dragover", e => { if (S.step !== 1) return; e.preventDefault(); stage.classList.add("drag"); });
stage.addEventListener("dragleave", () => stage.classList.remove("drag"));
stage.addEventListener("drop", e => {
  if (S.step !== 1) return; e.preventDefault(); stage.classList.remove("drag");
  const f = [...e.dataTransfer.files].find(f => f.type.startsWith("image/") || isHeic(f)); if (f) loadPhoto(f);
});
document.addEventListener("paste", e => {
  if (S.step !== 1) return;
  const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
  if (it) loadPhoto(it.getAsFile());
});

/* 아이폰 HEIC: 엣지·크롬이 못 읽어서, 넣을 때만 변환 프로그램을 받아 JPG 로 바꾼다 */
async function heicToJpeg(file) {
  if (!window.heic2any) await new Promise((ok, no) => {
    const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
    sc.onload = ok; sc.onerror = () => no(new Error("변환 프로그램을 받지 못했습니다")); document.head.appendChild(sc);
  });
  const out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: .92 });
  return Array.isArray(out) ? out[0] : out;
}
const isHeic = f => /\.(heic|heif)$/i.test(f.name || "") || /heic|heif/i.test(f.type || "");
async function loadPhoto(file) {
  let bm;
  if (isHeic(file)) {
    showStatus("아이폰 사진 바꾸는 중", 0, false, true);
    try { const name = file.name; file = await heicToJpeg(file); file.name = name; hideStatus(); }
    catch (e) { showStatus("HEIC 사진을 열지 못했습니다 — JPG 로 바꿔 올려 주세요", 0, true); return; }
  }
  try { bm = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) {
    try { bm = await createImageBitmap(file); } catch (e2) { showStatus("이 사진은 열 수 없습니다 (HEIC 는 JPG 로)", 0, true); return; }
  }
  S.bitmap = bm; S.name = file.name || "붙여넣은 사진"; S.an = null; S.paper = null; S.paperKey = "";
  S.corners = [[.03, .03], [.97, .03], [.97, .97], [.03, .97]];
  const cv = $("photoImg"), k = Math.min(1, 1600 / Math.max(bm.width, bm.height));
  cv.width = Math.round(bm.width * k); cv.height = Math.round(bm.height * k);
  cv.getContext("2d").drawImage(bm, 0, 0, cv.width, cv.height);
  $("fname").textContent = S.name; $("fileRow").hidden = false; $("pick").hidden = true; $("cornerGrp").hidden = false;
  placeHandles(); go(1);
}
function placeHandles() {
  document.querySelectorAll(".hdl").forEach(h => {
    const [x, y] = S.corners[+h.dataset.k]; h.style.left = x * 100 + "%"; h.style.top = y * 100 + "%";
  });
  const q = $("quad"); q.setAttribute("viewBox", "0 0 100 100"); q.setAttribute("preserveAspectRatio", "none");
  $("poly").setAttribute("points", S.corners.map(([x, y]) => `${x * 100},${y * 100}`).join(" "));
}
document.querySelectorAll(".hdl").forEach(h => {
  const k = +h.dataset.k;
  h.addEventListener("pointerdown", e => { h.setPointerCapture(e.pointerId); e.preventDefault(); });
  h.addEventListener("pointermove", e => {
    if (!h.hasPointerCapture(e.pointerId)) return;
    const r = $("photoImg").getBoundingClientRect();
    S.corners[k] = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    S.an = null; placeHandles();
  });
  h.addEventListener("keydown", e => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return;
    e.preventDefault(); const s = e.shiftKey ? .02 : .004;
    S.corners[k] = [Math.min(1, Math.max(0, S.corners[k][0] + d[0] * s)), Math.min(1, Math.max(0, S.corners[k][1] + d[1] * s))];
    S.an = null; placeHandles();
  });
});
$("cAll").onclick = () => { S.corners = [[0, 0], [1, 0], [1, 1], [0, 1]]; S.an = null; placeHandles(); };
$("cInset").onclick = () => { S.corners = [[.06, .06], [.94, .06], [.94, .94], [.06, .94]]; S.an = null; placeHandles(); };
$("go2").onclick = () => { if (!S.bitmap) return; go(2); if (!S.an) analyze(); };

/* ───────── 2. 인식 ───────── */
$("sens").value = opt.sens; $("sensV").textContent = opt.sens;
let sensTimer = 0;
$("sens").oninput = () => { opt.sens = +$("sens").value; $("sensV").textContent = opt.sens; saveOpt(); clearTimeout(sensTimer); sensTimer = setTimeout(analyze, 350); };
segBind("ruleSeg", () => opt.rule, v => { opt.rule = v; saveOpt(); analyze(); });
segBind("outSeg", () => opt.outside, v => { opt.outside = v; saveOpt(); analyze(); });

async function analyze() {
  if (!S.bitmap) return;
  S.busy = true; dock(); busy("사진 펴는 중"); await tick();
  try {
    const key = JSON.stringify(S.corners);
    if (S.paperKey !== key) { S.paper = HW.warp(S.bitmap, S.corners); S.paperKey = key; S.fixes = []; S.force = []; }
    S.an = await HW.analyze(S.paper, opt.sens, opt.rule, m => busy(m), opt.outside === "넣기", S.force);
    if (S.fixes.length) HW.applyFixes(S.an, S.fixes);
    S.surf = null; S.surfKey = ""; S.sel = -1;
    drawShot(); fixUI(); guide();
    $("lineCount").textContent = S.an.lines + "줄";
    $("ruleFound").textContent = S.an.ruled ? "있음" : "없음";
    busy("");
  } catch (e) {
    console.error(e); S.an = null;
    busy(e.message === "글씨를 찾지 못했습니다" ? "글씨를 찾지 못했습니다 — 감도를 올려 보세요" : "인식하지 못했습니다");
    $("lineCount").textContent = "—"; $("ruleFound").textContent = "—";
  }
  S.busy = false; dock();
}
function drawShot() {
  const an = S.an, cv = $("shot"); cv.width = an.W; cv.height = an.H;
  const img = new ImageData(new Uint8ClampedArray(an.rgba), an.W, an.H), d = img.data;
  const lineIdx = new Map(); const Ls = [...new Set(an.order.map(o => o[0]))].sort((a, b) => a - b);
  for (const [L, cs] of an.order) for (const c of cs) lineIdx.set(c, Ls.indexOf(L));
  const A = [233, 105, 44], B = [40, 110, 220];
  for (let i = 0; i < an.W * an.H; i++) {
    const c = an.lab[i]; if (c < 0 || !lineIdx.has(c)) continue;
    const a = Math.min(1, an.inkA[i] * 1.6); if (a < .08) continue;      // 넓힌 테두리가 아니라 실제 잉크만 칠한다
    const col = c === S.sel ? [222, 40, 140] : lineIdx.get(c) % 2 ? B : A;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = d[i * 4 + k] * (1 - a * .85) + col[k] * a * .85;
  }
  const g0 = cv.getContext("2d"); g0.putImageData(img, 0, 0);
  g0.save(); g0.strokeStyle = "rgba(123,92,240,.9)"; g0.lineWidth = 2; g0.setLineDash([8, 5]);
  for (const [x0, y0, x1, y1] of S.force) g0.strokeRect(x0, y0, x1 - x0, y1 - y0);
  g0.restore();
  S.shotImg = g0.getImageData(0, 0, cv.width, cv.height);
  if (S.sel >= 0) {                               // 고른 조각은 보라색 + 테두리 상자
    const f = an.info[S.sel], g = cv.getContext("2d");
    g.strokeStyle = "#DE288C"; g.lineWidth = 4; g.setLineDash([]);
    g.strokeRect(f.x0 - 9, f.y0 - 9, f.x1 - f.x0 + 18, f.y1 - f.y0 + 18);
  }
}
/* 손으로 고치기: 조각을 누르고 → 가야 할 문장의 글씨를 누른다 */
/* 고치기 도구: 줄 옮기기(누르고 → 들어갈 줄 누르기) · 글씨 추가(끌어서 네모). 고른 도구만 동작하고 순서를 보여 준다 */
const GUIDE = {
  move: ["잘못된 색으로 칠해진 글씨를 누르세요 — 분홍색으로 바뀝니다", "그 글씨가 들어갈 줄의 높이 아무 데나 누르세요 — 빈 곳도 됩니다"],
  add: ["인식 안 된 글씨를 끌어서 네모로 감싸세요", "손을 떼면 그 안을 다시 인식합니다"],
};
function setTool(t) {
  S.tool = t; S.sel = -1; S.toast = "";
  $("shot").classList.toggle("move", t === "move"); $("shot").classList.toggle("add", t === "add");
  $("toolSeg")._paint(); guide(); if (S.an) drawShot();
}
function guide() {
  const g = GUIDE[S.tool], box = $("guide"), hint = $("toolHint");
  box.hidden = !g; hint.hidden = !g || S.step !== 2;
  if (!g) return;
  const now = S.tool === "move" ? (S.sel >= 0 ? 1 : 0) : 0;
  box.innerHTML = g.map((t, i) => `<li class="${i === now ? "now" : ""}">${t}</li>`).join("");
  hint.textContent = S.toast || `${now + 1}. ${g[now].split(" — ")[0]}`;
}
function toast(msg) { S.toast = msg; guide(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = ""; guide(); }, 1600); }
segBind("toolSeg", () => S.tool, v => setTool(v));

const shotXY = e => { const r = $("shot").getBoundingClientRect(); return [(e.clientX - r.left) / r.width * S.an.W, (e.clientY - r.top) / r.height * S.an.H]; };
let drag = null;
$("shot").addEventListener("pointerdown", e => {
  if (!S.an || S.busy || !S.tool) return;
  e.preventDefault();
  drag = { p0: shotXY(e) };
  $("shot").setPointerCapture(e.pointerId);
});
$("shot").addEventListener("pointermove", e => {
  if (!drag || S.tool !== "add") return;
  const [x, y] = shotXY(e), [x0, y0] = drag.p0, g = $("shot").getContext("2d");
  if (S.shotImg) g.putImageData(S.shotImg, 0, 0);
  g.save(); g.fillStyle = "rgba(123,92,240,.14)"; g.strokeStyle = "#7B5CF0"; g.lineWidth = 3; g.setLineDash([10, 6]);
  g.fillRect(Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0));
  g.strokeRect(Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0)); g.restore();
});
$("shot").addEventListener("pointerup", async e => {
  if (!drag) return;
  const [x, y] = shotXY(e), [x0, y0] = drag.p0; drag = null;
  if (S.tool === "add") {
    if (Math.abs(x - x0) > 6 && Math.abs(y - y0) > 6) {
      S.force.push([Math.min(x0, x), Math.min(y0, y), Math.max(x0, x), Math.max(y0, y)]);
      await analyze(); toast("추가했습니다 — 더 있으면 또 감싸세요");
    } else { drawShot(); toast("누르지 말고 끌어서 네모로 감싸세요"); }
    return;
  }
  // 줄 옮기기
  if (S.sel < 0) {
    const c = HW.pieceAt(S.an, x, y, 10);
    if (c < 0) { toast("글씨 위를 눌러 주세요"); return; }
    S.sel = c; S.selPt = [x, y]; drawShot(); guide();
  } else {
    const c = nearestLinePiece(y);                 // 들어갈 줄: 가로 위치는 상관없이 높이로 고른다
    if (c >= 0 && S.an.lineOf.get(c) !== S.an.lineOf.get(S.sel)) {
      const [bx, by] = pieceCenter(c);
      S.fixes.push({ a: S.selPt, b: [bx, by] });
      HW.applyFixes(S.an, [{ a: S.selPt, b: [bx, by] }]);
      S.surf = null; S.surfKey = ""; S.sel = -1; drawShot(); fixUI(); toast("옮겼습니다");
    } else { S.sel = -1; drawShot(); toast("이미 그 줄에 있습니다 — 처음부터 다시 누르세요"); }
  }
});
/* 누른 높이에서 가장 가까운 글줄의 대표 조각(그 줄에서 가장 큰 조각) */
function nearestLinePiece(y) {
  const an = S.an, byL = new Map();
  for (const id of an.keep) {
    const L = an.lineOf.get(id), f = an.info[id]; if (!byL.has(L)) byL.set(L, { s: 0, n: 0, big: id });
    const o = byL.get(L); o.s += f.cy * f.n; o.n += f.n; if (f.n > an.info[o.big].n) o.big = id;
  }
  let best = -1, bd = Infinity;
  for (const o of byL.values()) { const d = Math.abs(o.s / o.n - y); if (d < bd) { bd = d; best = o.big; } }
  return best;
}
function pieceCenter(id) {                        // 조각 안의 실제 화소 하나(좌표로 기록하려고)
  const an = S.an, f = an.info[id], cx = Math.round((f.x0 + f.x1) / 2), cy = Math.round(f.cy);
  for (let d = 0; d < 60; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
    const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < an.W && y < an.H && an.lab[y * an.W + x] === id) return [x, y];
  }
  return [cx, cy];
}
$("shot").addEventListener("pointercancel", () => { drag = null; if (S.an) drawShot(); });
function fixUI() {
  $("forceRow").hidden = !S.force.length;
  $("forceCount").textContent = S.force.length + "곳";
  $("fixRow").hidden = !S.fixes.length;
  $("fixCount").textContent = S.fixes.length + "곳";
  if (S.an) $("lineCount").textContent = S.an.lines + "줄";
}
$("forceUndo").onclick = () => { if (!S.force.length) return; S.force.pop(); analyze(); };
$("fixUndo").onclick = () => {
  if (!S.fixes.length) return;
  S.fixes.pop(); analyze();
};
$("back1").onclick = () => go(1);
$("go3").onclick = () => { if (!S.an) return; go(3); buildUI3(); preview(); };

/* ───────── 3. 꾸미기 ───────── */
function segBind(id, get, set) {
  const box = $(id);
  const paint = () => box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === String(get()))));
  box.querySelectorAll("button").forEach(b => b.onclick = () => { set(b.dataset.v); paint(); });
  paint(); box._paint = paint;
}
function buildUI3() {
  const pBox = $("papers"); pBox.innerHTML = "";
  for (const p of HW.PAPERS) {
    const b = document.createElement("button"); b.type = "button"; b.className = "sw";
    b.innerHTML = `<i style="background:${p.sw}"></i><span>${p.name}</span>`;
    b.setAttribute("aria-pressed", String(opt.paper === p.id));
    b.onclick = () => { opt.paper = p.id; if (p.ink) opt.ink = p.ink; saveOpt(); buildUI3(); preview(); };
    pBox.appendChild(b);
  }
  $("inkGrp").hidden = opt.paper === "원본";
  const iBox = $("inks"); iBox.innerHTML = "";
  for (const name of HW.INK_LIST) {
    const c = HW.INKS[name] || S.an.inkColor;
    const b = document.createElement("button"); b.type = "button"; b.className = "sw";
    b.innerHTML = `<i style="background:rgb(${c.map(Math.round).join(",")})"></i><span>${name}</span>`;
    b.setAttribute("aria-pressed", String(opt.ink === name));
    b.onclick = () => { opt.ink = name; saveOpt(); buildUI3(); preview(); };
    iBox.appendChild(b);
  }
  $("bgColorRow").hidden = opt.bg !== "단색"; $("bgImgRow").hidden = opt.bg !== "이미지";
  $("bgColor").value = opt.bgColor;
  $("signPosSeg").hidden = !(opt.sign && opt.signText.trim()); if (document.activeElement !== $("signText")) $("signText").value = opt.signText;
  $("size").value = opt.size; $("sizeV").textContent = opt.size + "%";
  $("vol").value = opt.vol; $("volV").textContent = opt.vol;
  $("sndSeg").hidden = !S.sound; $("volRow").hidden = !(S.sound && opt.soundOn);
  $("sndName").textContent = S.sound ? S.soundName : "소리 파일 없음";
  ["bgSeg", "ratioSeg", "speedSeg", "holdSeg", "sndSeg", "signSeg", "signPosSeg"].forEach(id => $(id)._paint && $(id)._paint());
}
segBind("bgSeg", () => opt.bg, v => { opt.bg = v; saveOpt(); buildUI3(); if (v === "이미지" && !S.bgBitmap) $("bgIn").click(); else preview(); });
segBind("ratioSeg", () => opt.ratio, v => { opt.ratio = v; saveOpt(); preview(); });
segBind("speedSeg", () => opt.speed, v => { opt.speed = v; saveOpt(); preview(); });
segBind("holdSeg", () => opt.hold, v => { opt.hold = +v; saveOpt(); preview(); });
segBind("signSeg", () => opt.sign ? "1" : "0", v => { opt.sign = v === "1"; saveOpt(); buildUI3(); preview(); });
segBind("signPosSeg", () => opt.signPos, v => { opt.signPos = v; saveOpt(); preview(); });
$("signText").oninput = () => { opt.signText = $("signText").value; opt.sign = !!opt.signText.trim(); $("signSeg")._paint(); $("signPosSeg").hidden = !opt.sign; saveOpt(); preview(); };
segBind("sndSeg", () => opt.soundOn ? "1" : "0", v => { opt.soundOn = v === "1"; saveOpt(); buildUI3(); });
$("bgColor").oninput = () => { opt.bgColor = $("bgColor").value; saveOpt(); preview(); };
$("size").oninput = () => { opt.size = +$("size").value; $("sizeV").textContent = opt.size + "%"; saveOpt(); preview(); };
$("vol").oninput = () => { opt.vol = +$("vol").value; $("volV").textContent = opt.vol; saveOpt(); };
$("bgPick").onclick = () => $("bgIn").click();
$("bgIn").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try { S.bgBitmap = await createImageBitmap(f); $("bgName").textContent = f.name; opt.bg = "이미지"; buildUI3(); preview(); }
  catch (err) { showStatus("이 이미지는 열 수 없습니다", 0, true); }
};
$("sndPick").onclick = () => $("sndIn").click();
$("sndIn").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (await loadSound(f)) { idbPut(f).catch(() => {}); opt.soundOn = true; saveOpt(); buildUI3(); }
};
async function loadSound(f) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    const buf = await ctx.decodeAudioData(await f.arrayBuffer()); ctx.close();
    S.sound = HW.mono(buf); S.soundName = f.name || "소리";
    return true;
  } catch (err) { showStatus("이 파일에서 소리를 꺼내지 못했습니다", 0, true); return false; }
}

let pvTimer = 0;
function preview() { clearTimeout(pvTimer); pvTimer = setTimeout(buildPlayer, 120); }
function buildPlayer() {
  if (!S.an) return;
  stopPlay();
  const key = opt.paper + "|" + opt.ink;
  try {
    if (S.surfKey !== key) { S.surf = HW.surfaces(S.an, opt.paper, opt.ink); S.surfKey = key; }
    S.player = new HW.Player(S.an, opt, $("view"), S.bitmap, S.bgBitmap, S.surf);
    const p = S.player; p.seek(p.total);
    $("lenV").textContent = p.total.toFixed(1) + "초";
    busy("");
  } catch (e) {                                   // 하얀 화면으로 두지 않는다
    console.error(e); S.player = null;
    busy("미리보기를 그리지 못했습니다 — Ctrl+Shift+R 로 새로고침해 보세요 (" + (e.message || e) + ")");
  }
}
function stopPlay() {
  S.playing = false; $("play").textContent = "미리 재생";
  if (S.src) { try { S.src.stop(); } catch (e) {} S.src = null; }
  if (S.actx) { S.actx.close().catch(() => {}); S.actx = null; }
}
$("play").onclick = async () => {
  if (S.playing) { stopPlay(); return; }
  if (!S.player) buildPlayer();
  const p = S.player; p.reset();
  S.playing = true; $("play").textContent = "멈춤";
  if (S.sound && opt.soundOn) {
    try {
      S.actx = new AudioContext({ sampleRate: 48000 });
      const pcm = HW.makeSound(p.seq, p.total, S.sound, 48000, opt.vol / 100);
      const ab = S.actx.createBuffer(1, pcm.length, 48000); ab.copyToChannel(pcm, 0);
      S.src = S.actx.createBufferSource(); S.src.buffer = ab; S.src.connect(S.actx.destination); S.src.start();
    } catch (e) { console.warn(e); }
  }
  const t0 = performance.now();
  const loop = () => {
    if (!S.playing || S.player !== p) return;
    const t = (performance.now() - t0) / 1000;
    p.seek(Math.min(t, p.total));
    if (t < p.total) requestAnimationFrame(loop); else stopPlay();
  };
  requestAnimationFrame(loop);
};
$("back2").onclick = () => go(2);

/* ───────── 영상 만들기 ───────── */
$("make").onclick = async () => {
  if (S.busy || !S.an || !S.player) return;
  if (!(await HW.pickVideo(1080, 1080))) { showStatus("이 브라우저는 영상 저장을 못 합니다 — 엣지·크롬 최신판에서 열어 주세요", 0, true); return; }
  stopPlay(); buildPlayer();
  if (!S.player) return;
  S.busy = true; S.stop = false; dock();
  showStatus("영상 만드는 중 0%", 0);
  try {
    const p = S.player;
    const audio = S.sound && opt.soundOn ? HW.makeSound(p.seq, p.total, S.sound, 48000, opt.vol / 100) : null;
    S.blob = await HW.encode(p, audio, 48000, f => showStatus(`영상 만드는 중 ${Math.round(f * 100)}%`, f), () => S.stop);
    hideStatus();
    const v = $("out"); if (v.src) URL.revokeObjectURL(v.src);
    v.addEventListener("loadedmetadata", () => { v.currentTime = Math.max(0, v.duration - .1); }, { once: true });   // 다 쓴 장면을 표지로
    v.src = URL.createObjectURL(S.blob);
    $("outDim").textContent = `${p.L.CW} × ${p.L.CH}`;
    $("outLen").textContent = p.total.toFixed(1) + "초";
    $("outSize").textContent = (S.blob.size / 1048576).toFixed(1) + " MB";
    S.fileName = fileName();
    S.busy = false; go(4);
    if (!isTouch() && !inApp) download();
    if (audio && HW.encode.noAudio) showStatus("이 브라우저는 소리를 넣지 못해 영상만 저장했습니다 — 크롬에서 다시 만들어 보세요", 0, true);
  } catch (e) {
    S.busy = false; dock();
    if (e.message === "STOP") hideStatus();
    else { console.error(e); showStatus("영상을 만들지 못했습니다 — " + (e.message || e), 0, true); }
  }
};
$("stop").onclick = () => { S.stop = true; };
function fileName() {
  const d = new Date(), z = n => String(n).padStart(2, "0");
  return `손글씨_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}.mp4`;
}
function download() {
  const a = document.createElement("a"); a.href = URL.createObjectURL(S.blob); a.download = S.fileName;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("save").onclick = async () => {
  if (!S.blob) return;
  if (inApp && !isTouch()) { $("inapp").scrollIntoView({ block: "center" }); showStatus("이 창에서는 저장이 안 됩니다 — 엣지·크롬으로 열어 주세요", 0, true); return; }
  if (isTouch() && navigator.canShare) {
    const f = new File([S.blob], S.fileName, { type: "video/mp4" });
    if (navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); return; } catch (e) { if (e.name === "AbortError") return; } }
  }
  download();
};
$("back3").onclick = () => { go(3); preview(); };
$("restart").onclick = () => { S.bitmap = null; S.an = null; S.blob = null; S.fixes = []; S.force = []; $("fileRow").hidden = true; $("pick").hidden = false; $("cornerGrp").hidden = true; go(1); };

/* ───────── 상태줄 ───────── */
let stTimer = 0;
function showStatus(msg, frac, isError, note) {
  clearTimeout(stTimer);
  $("statusbar").hidden = false; $("stMsg").textContent = msg; $("stBar").style.transform = `scaleX(${frac})`;
  $("stBar").parentElement.hidden = !!(isError || note); $("stop").hidden = !!(isError || note);
  if (isError) stTimer = setTimeout(hideStatus, 5000);
}
function hideStatus() { $("statusbar").hidden = true; }

/* ───────── 도움말 ───────── */
function openHelp() { $("help").hidden = false; document.body.style.overflow = "hidden"; }
function closeHelp() { $("help").hidden = true; document.body.style.overflow = ""; }
$("helpBtn").onclick = openHelp; $("helpClose").onclick = closeHelp;
$("help").addEventListener("click", e => { if (e.target === $("help")) closeHelp(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("help").hidden) closeHelp(); });

/* ───────── 소리 파일 기억(이 브라우저에만) ───────── */
function idb() {
  return new Promise((ok, no) => { const r = indexedDB.open("hwv", 1); r.onupgradeneeded = () => r.result.createObjectStore("f"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
}
async function idbPut(file) { const db = await idb(); return new Promise((ok, no) => { const t = db.transaction("f", "readwrite"); t.objectStore("f").put(file, "sound"); t.oncomplete = ok; t.onerror = no; }); }
async function idbGet() { const db = await idb(); return new Promise((ok, no) => { const r = db.transaction("f").objectStore("f").get("sound"); r.onsuccess = () => ok(r.result); r.onerror = no; }); }
(async () => { try { const f = await idbGet(); if (f) await loadSound(f); } catch (e) {} })();

/* 앱 안 브라우저(카카오톡 등): 만든 영상을 내려받지 못한다 */
const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|SamsungBrowser\/.*CrossApp|; wv\)/i.test(navigator.userAgent);
if (inApp) {
  $("inapp").hidden = false;
  if (/KAKAOTALK/i.test(navigator.userAgent) && /Android|iPhone|iPad/i.test(navigator.userAgent))   // 휴대폰 카카오톡은 기본 브라우저로 바로 넘긴다
    location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href);
}
$("inappCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(location.href.split("#")[0]); showStatus("주소를 복사했습니다 — 엣지·크롬 주소창에 붙여 넣으세요", 0, true); }
  catch (e) { prompt("이 주소를 복사해 엣지·크롬에 붙여 넣으세요", location.href.split("#")[0]); }
};

window.addEventListener("beforeunload", e => { if (S.busy) { e.preventDefault(); e.returnValue = ""; } });
go(1);
