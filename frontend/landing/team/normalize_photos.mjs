// S15P31E105-770 랜딩 Team 사진 맞추기. 원본 사진을 3:4 webp(member-NN.webp)로 만든다. 사진 원본은 저장소에 두지 않는다.
// 사용: node frontend/landing/team/normalize_photos.mjs <원본 폴더> [기준점 JSON = team/photo_points.json] [출력 폴더 = team/] [대조표.png]
//   그다음 python frontend/landing/team/embed_photos.py 로 index.html에 넣는다.
// 기준점에 eye·chin·cx가 있으면 '눈 = 위에서 _eye, 눈~턱 = 틀 높이의 _ec'가 되게 잘라 카드마다 눈높이·얼굴 크기를 맞춘다.
// 기준점이 없으면(AI로 처음부터 같은 구도로 만든 사진) 가운데 3:4로 자르고 줄이기만 한다.
// mask: true 이면 밝은 배경을 가장자리에서 채워 투명하게 한다(기본은 하지 않음). Chrome이 필요하다(CHROME 환경변수로 경로 지정).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const [rawDir, lmPath = path.join(here, 'photo_points.json'), outDir = here, sheet] = process.argv.slice(2);
const LM = JSON.parse(fs.readFileSync(lmPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const prof = fs.mkdtempSync(process.env.TEMP + '/normprof-');
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const eval_ = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value; };

const HEAD = LM._head ?? 0.60, EYE = LM._eye ?? 0.36, RATIO = LM._ratio ?? 0.75, OUT_W = LM._w ?? 600, OUT_H = Math.round(OUT_W / RATIO);   // _ratio: 너비÷높이(1 = 정사각 아바타)
const out = [];
for (const [name, lm] of Object.entries(LM).filter(([k]) => !k.startsWith('_'))) {
  const f = lm.file;
  const mime = /png$/i.test(f) ? 'image/png' : 'image/jpeg';
  const src = `data:${mime};base64,` + fs.readFileSync(path.join(rawDir, f)).toString('base64');
  const expr = `(async () => {
    const lm = ${JSON.stringify(lm)}, HEAD = ${HEAD}, EC = ${LM._ec ?? 0.28}, EYE = ${EYE}, OW = ${OUT_W}, OH = ${OUT_H};
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    // 얼굴 크기 기준 = 눈~턱(머리숱 차이를 빼려고). EC는 그 길이가 틀 높이에서 차지하는 몫
    const fixed = lm.eye == null || lm.chin == null || lm.cx == null;   // 기준점 없음: 가운데 3:4
    let ch = fixed ? Math.min(H, W / ${RATIO}) : (lm.chin - lm.eye) / ${LM._ec ?? 0.28};
    ch = Math.min(ch, H, W / ${RATIO});                       // 원본 밖으로 나가면 줄인다(얼굴이 조금 커진다)
    const cw = ch * ${RATIO};
    let sy = fixed ? (H - ch) / 2 : lm.eye - EYE * ch; sy = Math.max(0, Math.min(sy, H - ch));
    let sx = fixed ? (W - cw) / 2 : lm.cx - cw / 2;    sx = Math.max(0, Math.min(sx, W - cw));
    const c = document.createElement('canvas'); c.width = OW; c.height = OH;
    const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, cw, ch, 0, 0, OW, OH);
    let maskNote = 'none';
    if (lm.mask === true && !fixed) {
      const d = g.getImageData(0, 0, OW, OH), p = d.data;
      // 배경색: 원본 위쪽 두 귀퉁이 근처의 평균
      const s = document.createElement('canvas'); s.width = W; s.height = H; const sg = s.getContext('2d'); sg.drawImage(img, 0, 0);
      const pick = (x, y, n) => { const q = sg.getImageData(x, y, n, n).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < q.length; i += 4) { r += q[i]; gg += q[i + 1]; b += q[i + 2]; } const k = q.length / 4; return [r / k, gg / k, b / k]; };
      const n = Math.max(2, Math.round(W * 0.04));
      const a = pick(2, 2, n), b2 = pick(W - n - 2, 2, n);
      const bg = [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2, (a[2] + b2[2]) / 2];
      const T = lm.tol ?? 34;
      const dist = (i) => Math.hypot(p[i] - bg[0], p[i + 1] - bg[1], p[i + 2] - bg[2]);
      const isBg = new Uint8Array(OW * OH), stack = [];
      // 턱 아래 가운데(옷깃·셔츠)는 배경으로 보지 않는다
      const chinY = (lm.chin - sy) / ch * OH, cxO = (lm.cx - sx) / cw * OW;
      const push = (x, y) => { const k = y * OW + x; if (isBg[k]) return; if (y > chinY + OH * 0.04 && Math.abs(x - cxO) < OW * (lm.collar ?? 0.11)) return; if (dist(k * 4) < T) { isBg[k] = 1; stack.push(k); } };
      for (let x = 0; x < OW; x++) { push(x, 0); }
      for (let y = 0; y < OH * 0.85; y++) { push(0, y); push(OW - 1, y); }   // 아래쪽(옷)에서는 시작하지 않는다
      while (stack.length) { const k = stack.pop(), x = k % OW, y = (k / OW) | 0;
        if (x > 0) push(x - 1, y); if (x < OW - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < OH - 1) push(x, y + 1); }
      // 경계 부드럽게: 전경 비율을 반지름 R 상자 평균으로 → 알파
      const R = Math.max(1, Math.round(OW / 300 * (lm.lowres ? 2.5 : 1))), fg = new Float32Array(OW * OH);
      for (let k = 0; k < fg.length; k++) fg[k] = isBg[k] ? 0 : 1;
      const tmp = new Float32Array(fg.length);
      for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) { let s2 = 0, c2 = 0; for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx >= 0 && xx < OW) { s2 += fg[y * OW + xx]; c2++; } } tmp[y * OW + x] = s2 / c2; }
      for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) { let s2 = 0, c2 = 0; for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy >= 0 && yy < OH) { s2 += tmp[yy * OW + x]; c2++; } } fg[y * OW + x] = s2 / c2; }
      let bgCount = 0;
      for (let k = 0; k < fg.length; k++) { const al = Math.min(1, Math.max(0, (fg[k] - 0.45) / 0.5)); p[k * 4 + 3] = Math.round(al * 255); if (isBg[k]) bgCount++; }
      g.putImageData(d, 0, 0);
      maskNote = 'bg ' + (100 * bgCount / fg.length).toFixed(1) + '% ref ' + bg.map(v => Math.round(v)).join(',');
    }
    return JSON.stringify({ W, H, crop: [Math.round(sx), Math.round(sy), Math.round(cw), Math.round(ch)], ecFrac: fixed ? null : +((lm.chin - lm.eye) / ch).toFixed(3), mask: maskNote,
      data: c.toDataURL('image/webp', 0.8).split(',')[1] });
  })()`;
  const v = JSON.parse(await eval_(expr));
  fs.writeFileSync(path.join(outDir, name + '.webp'), Buffer.from(v.data, 'base64'));
  out.push({ name, crop: v.crop, ecFrac: v.ecFrac, mask: v.mask, bytes: fs.statSync(path.join(outDir, name + '.webp')).size });
}
if (sheet) {
  // 대조표: 결과를 체커 배경 위에 나란히, 눈·머리 위·턱 기준선
  const names = out.map(o => o.name);
  const imgs = names.map(n => 'data:image/webp;base64,' + fs.readFileSync(path.join(outDir, n + '.webp')).toString('base64'));
  const cw = 200, ch = Math.round(cw / RATIO);
  const html = `<body style="margin:0;background:#222;display:flex;gap:8px;padding:8px;font:12px sans-serif;color:#fff">${imgs.map((s, i) =>
    `<div style="position:relative;width:${cw}px;height:${ch}px;background:repeating-conic-gradient(#555 0 25%,#777 0 50%) 0 0/16px 16px"><img src="${s}" style="width:100%;height:100%;display:block">
     <i style="position:absolute;left:0;right:0;top:${(EYE * 100).toFixed(1)}%;border-top:1px solid red"></i>
     <i style="position:absolute;left:0;right:0;top:${((EYE - 0.20) * 100).toFixed(1)}%;border-top:1px dashed yellow"></i>
     <i style="position:absolute;left:0;right:0;top:${((EYE - 0.20 + HEAD) * 100).toFixed(1)}%;border-top:1px dashed yellow"></i>
     <b style="position:absolute;left:4px;bottom:4px">${names[i]}</b></div>`).join('')}</body>`;
  await send('Emulation.setDeviceMetricsOverride', { width: (cw + 8) * imgs.length + 8, height: ch + 16, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(sheet, Buffer.from(shot.result.data, 'base64'));
}
ws.close(); chrome.kill();
console.log(JSON.stringify(out.map(o => ({ ...o })), null, 0));
