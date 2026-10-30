/* RUNWAY v13 — 프로토타입 흐름 계층: 세션 상태 · 호출 화면 복귀 · 역할 · 입력 검증 · 시연 상태 */
(function () {
  const res = (k, p) => (window.__resources && window.__resources[k]) || p;
  const mk = (name, km, min, k, p, rec, x) => Object.assign({ name, km, min, rec, meta: km.toFixed(1) + 'km · ' + min + '분', get map() { return res(k, p); } }, x);
  const COURSES = [
    mk('민락수변공원 출발 5.0km', 5.0, 30, 'rm30', 'assets/runmap-30.png', true, { kind: '순환', env: '공원 · 하천변 · 평지', elev: '↑12', bars: [20, 24, 30, 46, 58, 40, 28, 24, 22, 20], why: '목표 6′00″에 맞는 평지 순환이에요. 2km 지점 짧은 오르막만 조절하면 돼요.' }),
    mk('광안리해수욕장 출발 5.4km', 5.4, 33, 'rm31', 'assets/runmap-31.png', true, { kind: '왕복', env: '해변 · 평지', elev: '↑6', bars: [18, 20, 22, 22, 24, 24, 22, 20, 20, 18], why: '고도 차가 거의 없어 페이스를 일정하게 유지하기 좋아요. 아침에는 그늘이 적어요.' }),
    mk('수영강 APEC나루 출발 4.8km', 4.8, 29, 'rm32', 'assets/runmap-32.png', false, { kind: '왕복', env: '하천변 · 공원', elev: '↑8', bars: [22, 26, 28, 30, 28, 26, 24, 26, 24, 22], why: '처음 달리는 코스예요. 강변 산책로라 신호 대기 없이 이어 달릴 수 있어요.' }),
    mk('이기대 입구 출발 5.6km', 5.6, 38, 'rm33', 'assets/runmap-33.png', false, { kind: '편도 순환', env: '해안길 · 언덕', elev: '↑64', bars: [20, 34, 52, 70, 88, 76, 60, 48, 36, 24], why: '준비도 82로 오르막 훈련도 가능해요. 3~4km 언덕 구간은 걷듯이 넘어가세요.' })
  ];
  COURSES.forEach((c, i) => { c.id = 'c' + i; });
  const CR = [{ date: '10.13', best: true, time: '29:41', pace: '5′56″/km' }, { date: '09.28', time: '30:12', pace: '6′02″/km' }, { date: '09.14', time: '31:05', pace: '6′13″/km' }, { date: '08.31', time: '31:40', pace: '6′20″/km' }, { date: '08.17', time: '32:26', pace: '6′29″/km' }];
  const CREWS = {
    '광안리 새벽 크루': { n: 18, cap: 30, area: '광안리' },
    '민락 야경 러너스': { n: 24, cap: 30, area: '민락수변' },
    '남천 회복 조깅': { n: 9, cap: 15, area: '남천' },
    '수영강 하프 크루': { n: 200, cap: 200, area: '수영강' }
  };
  const PLACES = [
    { name: '광안리해수욕장 입구', addr: '부산 수영구 광안해변로 219', dist: '320m', dx: 0, dy: 0 },
    { name: '민락수변공원', addr: '부산 수영구 민락수변로 1', dist: '1.2km', dx: -60, dy: 40 },
    { name: '삼익비치 앞', addr: '부산 수영구 광안해변로 100', dist: '640m', dx: 50, dy: -30 },
    { name: '수영강 APEC나루공원', addr: '부산 해운대구 수영강변대로 84', dist: '2.4km', dx: -90, dy: -60 }
  ];
  const POSTC = { p0: '민락수변공원 출발 5.0km · seoyun.run', p1: '광안리해수욕장 출발 5.0km · sungyoon.k', p2: '남천해변 출발 5.2km · eunseo_jog', mine: '민락수변공원 출발 5.0km · 내 게시물' };
  const PAST = [
    { id: 'p0', base: true, date: '10.19', day: '일', clock: '07:12', name: '민락수변공원 출발', pub: '민락수변공원 출발 5.0km', cid: 'c0', mode: 'course', dist: 5.02, time: 1781, goalKm: 5, goalPace: 360, achieved: true, hr: true, hrAvg: 158, cad: 170 },
    { id: 'p1', date: '10.15', day: '수', clock: '07:10', name: '민락수변공원 출발', pub: '민락수변공원 출발 5.0km', cid: 'c0', mode: 'course', dist: 5.02, time: 1781, goalKm: 5, goalPace: 360, achieved: true, hr: true, hrAvg: 158, cad: 170 },
    { id: 'p2', date: '10.13', day: '월', clock: '06:52', name: '민락수변공원 출발', pub: '민락수변공원 출발 5.0km', cid: 'c0', mode: 'course', dist: 5.02, time: 1788, goalKm: 5, goalPace: 360, achieved: true, hr: false },
    { id: 'p3', date: '10.08', day: '수', clock: '07:05', name: '남천 해변 언덕길', pub: '남천해변 출발 5.2km', cid: null, mode: 'free', dist: 5.2, time: 1982, goalKm: null, goalPace: null, achieved: null, hr: true, hrAvg: 162, cad: 168 },
    { id: 'h1', date: '10.13', day: '월', clock: '19:40', name: '민락수변 왕복', pub: '광안리해수욕장 출발 5.4km', cid: 'c1', mode: 'course', dist: 5.4, time: 1930, goalKm: 5.4, goalPace: 360, achieved: true, hr: true, hrAvg: 155, cad: 171 },
    { id: 'h2', date: '10.09', day: '목', clock: '07:02', name: '남천 해변 언덕길', pub: '남천해변 출발 5.2km', cid: null, mode: 'free', dist: 5.2, time: 1985, goalKm: null, goalPace: null, achieved: null, hr: true, hrAvg: 161, cad: 168 },
    { id: 'h3', date: '10.05', day: '월', clock: '06:48', name: '해운대 백사장', pub: '해운대해수욕장 출발 4.1km', cid: null, mode: 'free', dist: 4.1, time: 1470, goalKm: null, goalPace: null, achieved: null, hr: false }
  ];
  const GDEF = { today: { title: '토요일 아침, 함께 5km', cid: 'c0' }, d4: { title: '토요일 아침, 함께 5km', cid: 'c0' }, d8: { title: '수요일 회복 조깅', cid: null }, d6: { title: '월요일 야경 7km', cid: 'c0' }, pn: { title: '광안리 입문 크루', cid: 'c0' } };
  const MUSIC = ['s2-7', 's2-7s', 's2-7a', 's2-7b', 's2-8', 's2-8b', 's6-3m'];
  const SETTINGS = ['s8-1', 's8-3', 's8-4', 's8-5'];
  const FORMS = { 's6-new': ['s6-1'], 's6-8': ['s6-9', 's6-9b', 's3-1c', 's3-1b'], 's7-3': [], 's7-3e': [], 's8-2': ['s1-6'] };
  const ROOTS = ['s2-1', 's2-1la', 's2-pn', 's2-0m', 's6-0', 's6-0b', 's7-1', 's7-1d'];
  let S, api = window.__rwApi || null;
  const reset = () => {
    S = {
      user: { isNew: false, watch: true, health: true, nick: '민준', level: '중급', runs: 0 },
      onb: { pick: null, agree: null },
      course: 0, courseFor: null, grpCourse: null,
      run: { mode: null, goalKm: 5, goalSec: 1800, dist: 2.4, time: 859, active: false, partial: false, noGps: false, weak: false, lost: false, save: 'none', resultId: null },
      music: 'melon', org: {}, setFlow: false,
      gps: 'ok', loc: '광안리해수욕장 · 현재 위치',
      place: PLACES[0], cand: PLACES[0], placeMode: 'meet',
      gd: { key: 'd4' }, gjoin: { today: true, d4: true, d8: false, d6: false, pn: false, mine: true },
      g: { role: 'member', ready: false, goalChanged: false, end: null },
      crewSel: '광안리 새벽 크루', crewJoin: { '광안리 새벽 크루': 'member', '민락 야경 러너스': 'member', '남천 회복 조깅': 'none', '수영강 하프 크루': 'none' },
      crewPol: { '남천 회복 조깅': 'approve' }, ap: { me: 'pending', do: 'pending' }, notes: [],
      newCrew: null, myRun: null,
      post: { owner: 'other' }, myPost: { body: '오늘 목표 30분 안쪽으로 성공! 다음엔 남천 언덕길 도전', exists: false },
      share: true, saved: {}, rows: [],
      login: { fails: 2, locked: false },
      dirty: {}, demo: { localFail: false, loginFail: false, saveFail: false, syncFail: false, cmtFail: false, submitFail: false },
      watchOnly: false
    };
    v13reset();
  };
  reset();

  /* ---------- DOM helpers ---------- */
  const scr = id => { const o = document.getElementById(id); return o && o.querySelector('[data-screen-label]'); };
  const cur = () => api && api.cur();
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const tnodes = (root, text) => { const out = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue.trim() === text) out.push(n); return out; };
  const T = (id, key, val, nth = 0) => {
    const s = typeof id === 'string' ? scr(id) : id; if (!s) return null; s.__rw = s.__rw || {}; const k = key + '#' + nth; let n = s.__rw[k];
    if (!n) { n = tnodes(s, key)[nth]; if (!n) return null; n.__orig = n.nodeValue; s.__rw[k] = n; }
    n.nodeValue = val == null ? n.__orig : n.__orig.replace(key, val); return n.parentElement;
  };
  const TS = (id, pre, val) => { const s = scr(id); if (!s) return; s.__rw = s.__rw || {}; const k = 'pre:' + pre; let n = s.__rw[k]; if (!n) { const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT); let x; while ((x = w.nextNode())) if (x.nodeValue.trim().startsWith(pre)) { n = x; break; } if (!n) return; n.__orig = n.nodeValue; s.__rw[k] = n; } n.nodeValue = val == null ? n.__orig : val; };
  const V = (id, k, val) => { const s = scr(id); s && s.querySelectorAll('[data-rwv="' + k + '"]').forEach(e => { e.textContent = val; }); };
  const Q = (id, sel) => { const s = scr(id); return s ? s.querySelector(sel) : null; };
  const QA = (id, sel) => { const s = scr(id); return s ? [...s.querySelectorAll(sel)] : []; };
  const show = (el, on, disp) => { if (el) el.style.display = on ? (disp || '') : 'none'; };
  const fmtT = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; };
  const fmtP = s => { s = Math.round(s); return Math.floor(s / 60) + '′' + String(s % 60).padStart(2, '0') + '″'; };
  const parseT = v => { const n = String(v).replace(/["″']/g, ':').split(':').filter(x => x !== '').map(Number); if (!n.length || n.some(isNaN)) return NaN; return n.length === 1 ? n[0] * 60 : n.reduce((a, x) => a * 60 + x, 0); };
  const ALLC = () => COURSES.concat(S.recC || []);
  const C = () => ALLC()[S.course] || COURSES[0];
  const CN = c => (S.alias && S.alias[c.id]) || c.name;
  const dK = d => d == null ? '– –' : d.toFixed(2);
  const pcOf = r => r.dist ? fmtP(r.time / r.dist) : '– –';
  const goalLabel = r => r.goalKm && r.goalPace ? `목표 ${r.goalKm.toFixed(1)}km · ${fmtP(r.goalPace)}` : r.goalKm ? `목표 ${r.goalKm.toFixed(1)}km` : r.goalPace ? `목표 페이스 ${fmtP(r.goalPace)}` : '목표 없음';
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const rel = s => { if (s && getComputedStyle(s).position === 'static') s.style.position = 'relative'; };
  const once = (s, key, make) => { let e = s && s.querySelector('[data-rwi="' + key + '"]'); if (!e && s) { e = make(); if (e) e.setAttribute('data-rwi', key); } return e; };

  /* ---------- toast / sheet / countdown ---------- */
  let toastT;
  const toast = (msg, action) => {
    let t = document.getElementById('rw-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rw-toast'; document.body.appendChild(t); }
    t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:90;display:flex;align-items:center;gap:12px;max-width:340px;padding:12px 16px 12px 18px;border-radius:99px;background:#191C27;color:#fff;font:700 13px/1.4 'Noto Sans KR',sans-serif;box-shadow:0 10px 24px rgba(25,28,39,.3)";
    t.innerHTML = '';
    const sp = document.createElement('span'); sp.textContent = msg; t.appendChild(sp);
    if (action) { const b = document.createElement('button'); b.textContent = action.label; b.style.cssText = "flex:none;height:32px;padding:0 12px;border:0;border-radius:99px;background:#A7F6EC;color:#191C27;font:700 12px 'Noto Sans KR',sans-serif;cursor:pointer"; b.onclick = () => { t.style.display = 'none'; action.fn(); }; t.appendChild(b); }
    clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, action ? 3600 : 2000);
  };
  const closeSheet = () => document.querySelectorAll('[data-rwsheet]').forEach(e => e.remove());
  const sheet = ({ title, body, actions, onOpen }) => {
    closeSheet(); const s = scr(cur()); if (!s) return; rel(s);
    const ov = document.createElement('div'); ov.setAttribute('data-rwsheet', '1');
    ov.style.cssText = "position:absolute;inset:0;z-index:95;background:rgba(11,12,16,.58);display:flex;flex-direction:column;justify-content:flex-end;font-family:'Noto Sans KR',sans-serif";
    ov.__rwfn = closeSheet;
    const p = document.createElement('div'); p.__rwfn = () => {};
    p.style.cssText = 'background:#16181F;color:#fff;border-radius:30px 30px 0 0;padding:22px 18px 26px;display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(255,255,255,.12);box-shadow:0 -12px 32px rgba(0,0,0,.35)';
    p.innerHTML = '<span style="align-self:center;width:36px;height:4px;border-radius:99px;background:rgba(255,255,255,.2);margin:-8px 0 6px"></span>' + (title ? '<div style="font:800 18px/1.4 \'Noto Sans KR\',sans-serif">' + title + '</div>' : '') + (body ? '<div data-rwsbody="1" style="font-size:13px;line-height:1.6;color:rgba(255,255,255,.72);margin-bottom:6px">' + body + '</div>' : '');
    (actions || []).forEach(a => {
      const b = document.createElement('button'); b.textContent = a.label;
      const k = a.kind || 'sec';
      b.style.cssText = "height:52px;border-radius:99px;font:700 15px 'Noto Sans KR',sans-serif;cursor:pointer;" + (k === 'pri' ? 'border:0;background:#A7F6EC;color:#191C27' : k === 'danger' ? 'border:1px solid rgba(255,158,138,.6);background:rgba(255,158,138,.1);color:#FF9E8A' : 'border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff');
      b.__rwfn = () => { if (!a.keep) closeSheet(); a.fn && a.fn(); };
      p.appendChild(b);
    });
    ov.appendChild(p); s.appendChild(ov); onOpen && onOpen(p);
    return p;
  };
  const countdown = (done, lbl) => {
    const s = scr(cur()); if (!s) return done(); rel(s);
    const ov = document.createElement('div'); ov.setAttribute('data-rwsheet', '1'); ov.__rwfn = () => {};
    ov.style.cssText = "position:absolute;inset:0;z-index:96;background:rgba(11,12,16,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#fff;font-family:'Noto Sans KR',sans-serif";
    ov.innerHTML = '<span style="font-size:14px;color:rgba(255,255,255,.7)">' + (lbl || '곧 시작해요') + '</span><span data-n="1" style="font:400 140px/1 Bahnschrift,\'DIN Alternate\',Barlow,sans-serif;color:#A7F6EC">3</span>';
    s.appendChild(ov); let n = 3; const num = ov.querySelector('[data-n]');
    const tick = () => { n--; if (n <= 0) { ov.remove(); done(); return; } num.textContent = n; num.animate([{ transform: 'scale(1.3)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300 }); setTimeout(tick, 750); };
    num.animate([{ transform: 'scale(1.3)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300 }); setTimeout(tick, 750);
  };
  const guard = (btn, fn) => {
    if (!btn || btn.__busy) return; btn.__busy = true; const t = btn.textContent; btn.textContent = '처리 중…'; btn.style.opacity = '.6';
    setTimeout(() => { btn.__busy = false; btn.textContent = t; btn.style.opacity = ''; if (S.demo.submitFail) { S.demo.submitFail = false; refresh(); toast(/^s7-3/.test(cur()) ? '게시하지 못했어요 · 쓴 글과 공유 설정은 그대로예요. 다시 눌러 주세요' : '저장하지 못했어요 · 입력은 그대로예요. 다시 눌러 주세요'); return; } fn(); }, 700);
  };
  const refresh = () => api && api.refresh();

  /* ---------- run session ---------- */
  const goalFromFree = () => { const s = scr('s2-0f'); const dv = s ? (s.querySelector('[data-fg="d"]') || {}).value : ''; const pv = s ? (s.querySelector('[data-fg="p"]') || {}).value : ''; const d = parseFloat(dv); const p = pv && String(pv).trim() ? parseT(pv) : NaN; return { km: d > 0 ? d : null, pace: p > 0 ? p : null }; };
  const courseGoal = () => { const c = C(); const pace = S.cgoal && S.cgoal.pace ? S.cgoal.pace : c.min * 60 / c.km; return { km: c.km, pace }; };
  const startRun = (mode, target) => {
    const go = (extra) => countdown(() => {
      const g = mode === 'free' ? goalFromFree() : courseGoal();
      Object.assign(S.run, { id: 'run' + (++S.seq), mode, cid: mode === 'free' ? null : C().id, goalKm: g.km, goalPace: g.pace, goalSec: g.km && g.pace ? Math.round(g.km * g.pace) : null, dist: 2.4, time: 859, active: true, partial: false, achieved: null, lost: false, save: 'none', rec: null, guidePace: null, gctx: null, noGps: false, weak: false, recCid: null, booked: false, logged: false, startLoc: S.loc }, extra || {});
      if (S.run.noGps) S.run.dist = null;
      api.reset(target);
    });
    if (S.gps === 'denied') return sheet({ title: '위치 권한이 꺼져 있어요', body: '거리와 경로를 기록하려면 위치 권한이 필요해요. 위치 없이 시작하면 시간만 기록돼요.', actions: [
      { label: '설정에서 위치 허용하기', kind: 'pri', fn: () => { S.gps = 'ok'; paint(cur()); toast('위치 권한을 허용했어요 (시연)'); } },
      { label: '위치 없이 시작 · 시간만 기록', fn: () => go({ noGps: true }) },
      { label: '취소' }] });
    if (S.gps === 'waiting') {
      let tm; const p = sheet({ title: 'GPS 신호를 찾는 중이에요', body: '하늘이 트인 곳에서 잠시 기다려 주세요. 신호를 잡으면 바로 출발해요.', actions: [
        { label: '기다리지 않고 시작', fn: () => { clearTimeout(tm); go({ weak: true }); } },
        { label: '취소', fn: () => clearTimeout(tm) }] });
      const bar = el('<div style="height:4px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin:-2px 0 6px"><div style="width:30%;height:100%;background:#A7F6EC;border-radius:99px"></div></div>');
      p.insertBefore(bar, p.querySelector('button')); bar.firstChild.animate([{ marginLeft: '-30%' }, { marginLeft: '100%' }], { duration: 1100, iterations: Infinity });
      tm = setTimeout(() => { if (!document.querySelector('[data-rwsheet]')) return; closeSheet(); S.gps = 'ok'; paint(cur()); toast('GPS 신호를 잡았어요'); go(); }, 2600);
      return;
    }
    go();
  };
  const resultId = () => S.run.mode === 'free' ? 's4-5f' : 's4-5';
  const autoReflect = () => { const r = S.run; if (r.noGps || r.dist == null || r.mode !== 'free' || r.recCid) return; const base = (r.startLoc || '현재 위치').split(' · ')[0]; const rc = { id: 'r' + r.id, name: base + ' 출발 ' + r.dist.toFixed(2) + 'km', km: r.dist, min: Math.max(1, Math.round(r.time / 60)), rec: true, kind: '내가 달린 경로', env: '—', elev: '', bars: COURSES[0].bars, why: '', mine: true, mapSrc: (Q('s4-5f', 'img') || {}).src || '' }; rc.meta = rc.km.toFixed(2) + 'km · ' + rc.min + '분'; Object.defineProperty(rc, 'map', { get: () => rc.mapSrc || COURSES[0].map }); S.recC.push(rc); r.recCid = rc.id; };
  const finishRun = (complete) => {
    const r = S.run; if (complete && r.dist != null) { r.dist = r.goalKm ? +(r.goalKm + 0.02).toFixed(2) : 5.02; r.time = Math.round(r.dist * (r.goalPace || 355) * 0.987); }
    r.achieved = r.goalKm ? (r.dist != null && r.dist >= r.goalKm - 0.05) : null; r.partial = r.achieved === false; r.active = false; autoReflect(); S.run.resultId = resultId(); S.run.rec = mkRec(S.run);
    api.reset(S.run.resultId);
  };
  const doSave = (rec) => {
    rec = rec || S.run.rec; if (!rec) return; rec.local = 'saving'; paintSave(cur());
    setTimeout(() => { if (S.demo.localFail) { S.demo.localFail = false; rec.local = 'fail'; paint(cur()); refresh(); return; } rec.local = 'ok'; if (!S.recs.includes(rec)) S.recs.unshift(rec); S.user.runs = S.recs.length; doSync(rec, true); }, 900);
  };
  const doSync = (rec, first) => { rec.sync = 'sending'; paint(cur());
    setTimeout(() => { if (S.demo.saveFail) { S.demo.saveFail = false; rec.sync = 'pending'; } else rec.sync = 'done'; paint(cur()); refresh(); if (!first) toast(rec.sync === 'done' ? '기록을 보냈어요 · 동기화 완료' : '아직 보내지 못했어요 · 휴대폰에 그대로 보관 중이에요'); }, 700); };
  const endSheet = () => {
    const r = S.run, short = r.dist != null && r.dist < 1, pct = r.goalKm && r.dist != null ? Math.round(r.dist / r.goalKm * 100) : null;
    const head = r.noGps ? `위치 없이 ${fmtT(r.time)}` : `${dK(r.dist)}km · ${fmtT(r.time)}`;
    sheet({ title: short ? '1km보다 짧은 기록이에요' : '러닝을 끝낼까요?', body: short ? `${head} · 짧은 기록은 저장하거나 버릴 수 있어요.` : pct != null ? `${head} · 목표 ${r.goalKm.toFixed(1)}km의 ${pct}%예요. 지금 끝내면 개인 운동 종료 · 목표 미달성으로 저장돼요.` : `${head} · 지금 끝내면 개인 운동이 종료되고 기록이 저장돼요.`, actions: [
      { label: short ? '그래도 저장하기' : '저장하고 끝내기', kind: 'pri', fn: () => finishRun(false) },
      { label: '기록 버리기', kind: 'danger', fn: () => sheet({ title: '이 기록을 버릴까요?', body: '버린 기록은 되돌릴 수 없어요.', actions: [
        { label: '버리기', kind: 'danger', fn: () => { S.run.active = false; api.reset(S.user.isNew ? 's2-pn' : 's2-1'); toast('기록을 버렸어요'); } }, { label: '취소' }] }) },
      { label: '계속 달리기', fn: () => resume() }] });
  };
  const resume = () => { const t = S.run.mode === 'group' ? 's6-5' : 's4-2'; const st = api.stack(); if (st.length && /^s4-2|^s6-5$/.test(st[st.length - 1])) api.back(); else api.replace(t); };

  /* ---------- painters ---------- */
  const svgNote = (c) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
  const svgSpot = '<svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1DB954"></circle><path d="M6.5 9.3c3.6-1 7.6-.7 11 1M7.2 12.4c2.9-.8 6.1-.5 8.8.9M7.9 15.3c2.3-.6 4.6-.4 6.6.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"></path></svg>';
  const paintMusicBtn = (id) => {
    QA(id, 'a[href="#s2-7"],a[href="#s6-3m"]').forEach(b => {
      if (b.__o == null) b.__o = b.innerHTML;
      const dark = id !== 's2-0';
      if (S.music === 'none') { b.innerHTML = svgNote(dark ? '#fff' : '#191C27'); b.setAttribute('aria-label', '음악 · 연결 안 함'); }
      else if (S.music === 'spotify') { b.innerHTML = svgSpot; b.setAttribute('aria-label', 'Spotify 음악'); }
      else { b.innerHTML = b.__o; b.setAttribute('aria-label', '멜론 음악'); }
    });
  };
  const paintMini = (id) => { const c = Q(id, '[aria-label="재생 제어"]'); const row = c && c.parentElement; if (row) show(row, S.music !== 'none', 'flex'); };
  const banner = (id, key, on, html, top) => {
    const s = scr(id); if (!s) return; let b = s.querySelector('[data-rwi="' + key + '"]');
    if (!on) { if (b) b.remove(); return; }
    if (!b) { rel(s); b = el('<div style="position:absolute;left:14px;right:14px;top:' + (top || 40) + 'px;z-index:20;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:16px;font:500 12px/1.5 \'Noto Sans KR\',sans-serif"></div>'); b.setAttribute('data-rwi', key); s.appendChild(b); }
    b.innerHTML = html.html; b.style.background = html.bg || 'rgba(255,158,138,.95)'; b.style.color = html.fg || '#191C27';
  };
  const paintRun = (id) => {
    const r = S.run, c = C(), free = r.mode === 'free', cm = S.cmp;
    const compete = !free && cm.on && c.rec;
    T(id, '민락수변공원 출발 5.0km · 경쟁 모드', free ? '자유 러닝 · ' + goalLabel(r) : CN(c) + (compete ? ' · 경쟁 모드' : ''));
    const cmp = T(id, '10.13 기록보다', CR[cm.i].date + ' 기록보다'); if (cmp && cmp.parentElement) show(cmp.parentElement, compete, 'flex');
    V(id, 'hDist', dK(r.dist)); V(id, 'hTime', fmtT(r.time));
    const hasLeft = !!r.goalKm && r.dist != null;
    V(id, 'hLeft', hasLeft ? Math.max(0, r.goalKm - r.dist).toFixed(2) : '– –'); V(id, 'hLeftL', free ? '목표까지' : '남은 거리');
    const lv = Q(id, '[data-rwv="hLeft"]'), ll = Q(id, '[data-rwv="hLeftL"]'); let col = ll; while (col && lv && !col.contains(lv)) col = col.parentElement; if (col && !col.matches('[data-rw="hud"]')) col.style.visibility = hasLeft ? '' : 'hidden';
    const bar = Q(id, '[data-rwbar]'); if (bar) { bar.style.width = hasLeft ? Math.min(100, r.dist / r.goalKm * 100).toFixed(0) + '%' : '0%'; if (bar.parentElement) bar.parentElement.style.visibility = hasLeft ? '' : 'hidden'; }
    T(id, '58', r.noGps ? '– –' : null); T(id, '5', r.noGps ? '' : null); T(id, '′', r.noGps ? '' : null); T(id, '″', r.noGps ? '' : null);
    T(id, '목표 6′00″', r.goalPace ? '목표 ' + fmtP(r.goalPace) : '목표 페이스 없음');
    show(Q(id, '[data-rw="turn"]'), !free && !r.noGps, 'flex');
    const img = Q(id, 'img[data-pan]'); if (img) { if (img.__o == null) img.__o = img.getAttribute('src'); img.src = (!free && S.course) ? c.map : img.__o; }
    paintMini(id); bpmCtl(id);
    banner(id, 'gpsb', r.lost || r.noGps || r.weak, { html: r.noGps ? '<b>위치 없이 기록 중</b> · 시간만 기록해요. 거리·페이스·경로는 만들지 않아요.' : r.lost ? '<b>GPS 신호가 약해요</b> · 시간은 계속 기록하고, 거리는 신호가 돌아오면 이어서 보정해요.' : '<b>GPS 수신 대기</b> · 첫 구간 거리는 신호를 잡은 뒤 보정해요.' }, 44);
  };
  const paintSave = (id) => {
    if (id !== 's4-5' && id !== 's4-5f') return; const s = scr(id); rel(s);
    const b = once(s, 'save', () => { const e = el("<div style=\"position:absolute;left:50%;top:40px;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:8px;height:34px;padding:0 6px 0 14px;border-radius:99px;font:700 12px 'Noto Sans KR',sans-serif;white-space:nowrap;box-shadow:0 6px 16px rgba(0,0,0,.25)\"></div>"); s.appendChild(e); return e; });
    const rc = S.run.rec, st = !rc ? 'none' : (rc.local === 'new' || rc.local === 'saving') ? 'saving' : rc.local === 'fail' ? 'lfail' : rc.sync === 'pending' ? 'pending' : rc.sync === 'done' ? 'saved' : 'sending', warn = st === 'pending' || st === 'lfail';
    b.style.background = warn ? '#FF9E8A' : '#16181F'; b.style.color = warn ? '#191C27' : '#fff'; b.style.paddingRight = warn ? '6px' : '14px';
    b.innerHTML = st === 'saving' ? '<span style="width:8px;height:8px;border-radius:50%;background:#A7F6EC"></span>기록 저장 중…' : st === 'sending' ? '<span style="width:8px;height:8px;border-radius:50%;background:#A7F6EC"></span>휴대폰에 저장됨 · 보내는 중…' : st === 'saved' ? '<span style="color:#A7F6EC">✓</span>기록 저장됨 · 동기화 완료' : st === 'pending' ? '휴대폰에 보관됨 · 전송 대기' : st === 'lfail' ? '휴대폰에 저장하지 못했어요' : '';
    show(b, st !== 'none', 'flex');
    if (warn) { const r = document.createElement('button'); r.textContent = st === 'lfail' ? '다시 저장' : '다시 시도'; r.style.cssText = "height:26px;padding:0 10px;border:0;border-radius:99px;background:#191C27;color:#fff;font:700 11px 'Noto Sans KR',sans-serif;cursor:pointer"; r.setAttribute('data-act', 'retrySave'); b.appendChild(r); }
  };
  const routeSvg = (s) => s ? [...s.querySelectorAll('svg')].find(v => { const vb = (v.getAttribute('viewBox') || '').split(' ').map(Number); return vb[2] >= 150 && v.querySelector('path'); }) : null;
  const paintResult = (id) => {
    const r = S.run, c = C(), pace = pcOf(r);
    const st = r.goalKm ? (r.achieved ? '목표 완주' : '목표 미달성') : (r.goalPace ? '페이스 목표만' : '목표 없음');
    if (id === 's4-5') {
      T(id, '민락수변공원 출발 5.0km · 완주', CN(c) + ' · 개인 종료 · ' + st);
      T(id, '목표 30:00', r.achieved ? `목표 ${r.goalKm.toFixed(1)}km 완주` : `목표 ${r.goalKm.toFixed(1)}km 중 ${dK(r.dist)}km`);
      T(id, '달성', r.achieved ? '달성' : '미달성'); const cmpOn = S.cmp.on && c.rec && r.achieved; T(id, '· 10.13 기록보다', cmpOn ? '· ' + CR[S.cmp.i].date + ' 기록보다' : '· 비교 기록 없이 달렸어요'); T(id, '7초 빨랐어요', cmpOn ? null : '');
    } else T(id, '자유 러닝 · 종료', '자유 러닝 · 개인 종료 · ' + st);
    T(id, '5′55″', pace); T(id, '29:41', fmtT(r.time)); T(id, '5.02', dK(r.dist));
    const hw = r.rec ? r.rec.hr : S.user.watch; T(id, '158', hw ? null : '– –'); T(id, 'bpm', hw ? null : '워치 없음', 0);
    T(id, '170', hw ? null : '– –');
    T(id, '목표 6′00″', r.goalPace ? '목표 ' + fmtP(r.goalPace) : '목표 페이스 없음');
    const rs = routeSvg(scr(id)); if (rs) rs.style.visibility = r.noGps ? 'hidden' : '';
    
    paintBookRun(id); paintSave(id);
  };
  const crew = () => Object.assign({ name: S.crewSel }, CREWS[S.crewSel] || CREWS['광안리 새벽 크루']);
  const paintCrew = (id) => {
    const c = crew(), pol = (S.crewPol[c.name] || 'approve') === 'open' ? '바로 가입' : '승인제';
    T(id, '광안리 새벽 크루', c.name); T(id, '모집 중 18/30', `${c.n >= c.cap ? '정원 마감' : '모집 중'} ${c.n}/${c.cap} · ${pol}`); T(id, '18', String(c.n)); T(id, ' / 30명', ` / ${c.cap}명`); T(id, '/ 30명', `/ ${c.cap}명`);
    T(id, '18명', c.n + '명'); T(id, '구성원 18명 모두 보기', `구성원 ${c.n}명 모두 보기`); T(id, '광안리', c.area); T(id, '18 / 30명', `${c.n} / ${c.cap}명`);
    TS(id, '주로 평일 아침 6시 반', c.mine ? (c.intro || '아직 소개가 없어요 · 크루 관리에서 쓸 수 있어요') : null);
    if (c.mine) { V(id, 'apN2', '0'); const s = scr(id); const n = s && tnodes(s, '성윤 크루장')[0]; if (n) T(id, '성윤 크루장', S.user.nick + ' 크루장'); }
  };
  const paintGroupDetail = () => {
    const id = 's6-2', k = S.gd.key, mr = S.myRun, joined = !!S.gjoin[k], today = k === 'today';
    const D = { today: ['15분 뒤', '토요일 아침, 함께 5km', '10.25 토 07:00', 6], d4: ['D-4', '토요일 아침, 함께 5km', '10.25 토 07:00', 6], d8: ['D-8', '수요일 회복 조깅', '10.29 수 06:30', 3], d6: ['D-6', '월요일 야경 7km', '10.27 월 20:00', 9], pn: ['D-2', '광안리 입문 크루', '10.21 07:00', 3] };
    const mrr = k === 'mine' ? S.myRuns.find(x => x.id === S.gd.rid) : null; const d = mrr ? [mrr.cancelled ? '취소됨' : mrr.soon ? '25분 뒤' : mrr.dday, mrr.title, mrr.when, mrr.cancelled ? 0 : 1] : (D[k] || D.d4);
    const baseJoined = { today: true, d4: true, mine: true }[k] || false; const n = d[3] + (joined && !baseJoined ? 1 : 0) - (!joined && baseJoined ? 1 : 0);
    T(id, 'D-4', d[0]); T(id, '토요일 아침, 함께 5km', d[1]); T(id, '10.25 토 07:00', d[2]); T(id, '참가 6명', `참가 ${n}명`); T(id, '6명 참가', `${n}명 참가`);
    T(id, '광안리 새벽 크루', k === 'd6' ? '민락 야경 러너스' : null);
    T(id, '부산 수영구 광안해변로 219', mrr ? mrr.place.addr : null); T(id, '광안리해수욕장 입구', mrr ? mrr.place.name : null); const pl = planOf(k, S.gd.rid); T(id, '5.0', pl.km ? pl.km.toFixed(1) : '–'); T(id, '30:00', pl.sec ? fmtT(pl.sec) : '–'); T(id, '6′00″', fmtP(pl.pace)); banner(id, 'pchg', !!S.g.paceChg && !(mrr && mrr.cancelled), { html: '<b>예상 공동 페이스가 6′00″ → ' + fmtP(pl.pace) + '로 바뀌었어요</b> · 참가자가 바뀌어 다시 계산했어요. 참가 여부를 다시 확인해 주세요', bg: 'rgba(167,246,236,.95)' }, 96);
    T(id, '민락수변공원 출발 5.0km', mrr ? (mrr.mode === 'free' ? '자유 러닝 · 코스 없음' : mrr.course) : k === 'd8' ? '자유 러닝 · 코스 없음' : null);
    const own = Q(id, 'a[href="#s6-4c"]'); show(own, !!mrr && !mrr.cancelled, 'flex'); if (own) T(own, '성', '민');
    const b = Q(id, 'a[href="#s6-3"]'); if (!b) return; if (b.__o == null) b.__o = b.style.cssText;
    b.style.cssText = b.__o;
    if (mrr && mrr.cancelled) { b.textContent = '취소된 그룹런이에요'; b.style.background = 'rgba(255,255,255,.08)'; b.style.color = 'rgba(255,255,255,.6)'; b.style.boxShadow = 'none'; }
    else if (k === 'mine' && mrr && mrr.soon) b.textContent = '대기방 입장 · 그룹장';
    else if (k === 'mine') { b.textContent = '내가 만든 그룹런 · 출발 30분 전부터 대기방 열림'; b.style.background = 'rgba(167,246,236,.16)'; b.style.color = '#A7F6EC'; }
    else if (today && joined) b.textContent = '대기방 입장';
    else if (joined) { b.textContent = '참가 취소'; b.style.background = 'rgba(255,255,255,.08)'; b.style.color = '#fff'; b.style.border = '1px solid rgba(255,255,255,.25)'; b.style.boxShadow = 'none'; }
    else b.textContent = '참가하기';
    const s = scr(id); const host = b.parentElement;
    let st = host && host.querySelector('[data-rwi="jst"]');
    if (!st && host) { st = el('<div style="font-size:12px;text-align:center;color:#A7F6EC;margin:0 0 8px"></div>'); st.setAttribute('data-rwi', 'jst'); host.insertBefore(st, host.firstChild); if (getComputedStyle(host).display === 'flex' && getComputedStyle(host).flexDirection === 'row') host.style.flexWrap = 'wrap', st.style.width = '100%'; }
    if (st) { st.textContent = k === 'mine' && mrr && !mrr.cancelled ? (mrr.soon ? '✓ 내가 만든 그룹런 · 지금 대기방에 들어갈 수 있어요' : '대기방은 ' + openAt(mrr) + '부터 열려요 · 출발 30분 전') : joined && !today && k !== 'mine' ? '✓ 참가 중이에요 · 출발 30분 전부터 대기방에 들어갈 수 있어요' : today && joined ? '✓ 참가 중 · 지금 대기방에 들어갈 수 있어요' : ''; show(st, !!st.textContent, 'block'); }
  };
  const rowOf = (s, n, pad) => { if (!s) return null; for (const x of tnodes(s, n)) { let r = x.parentElement; while (r && r !== s && !(r.style && (r.style.padding === pad + ' 0px' || r.style.padding === pad + ' 0'))) r = r.parentElement; if (r && r !== s) return r; } return null; };
  const paintReady = () => {
    const id = 's6-3', g = S.g, lead = g.role === 'leader', mine = !!(g.ctx && g.ctx.key === 'mine'), s = scr(id);
    const oth = g.mem.filter(m => !m.me), oReady = oth.filter(m => m.room === 'ready').length, oRoom = oth.filter(m => m.room !== 'out').length, readyN = oReady + (lead || g.ready ? 1 : 0), roomN = oRoom + 1, outN = oth.filter(m => m.room === 'out').map(m => m.n);
    ['성윤', '은서', '서연'].forEach(n => show(rowOf(s, n, '8px'), !mine, 'flex'));
    T(id, '참가 신청 5명 · 대기방 4명', `참가 신청 ${g.mem.length}명 · 대기방 ${roomN}명`);
    const my = Q(id, '[data-rwv="myReady"]'); if (my) { my.textContent = lead ? '그룹장' : g.ready ? '준비 완료' : '대기 중'; my.style.color = lead || g.ready ? '#A7F6EC' : 'rgba(255,255,255,.58)'; }
    V(id, 'readyCnt', `${readyN}명 준비 완료` + (outN.length ? ' · ' + outN.join('·') + ' 미입장' : ''));
    V(id, 'readyTip', lead ? '출발하면 준비 완료한 멤버의 기록이 3초 뒤 함께 시작돼요 · 이 그룹런의 그룹장만 출발할 수 있어요' : g.ready ? '준비 완료는 운동 시작이 아니에요 · 그룹장 성윤님이 출발하면 3초 뒤 내 기록이 시작돼요' : (g.role === 'crew' ? '크루장이지만 이 그룹런의 그룹장은 성윤님이에요 · 출발은 그룹장이 해요' : '준비 완료를 눌러야 그룹장이 출발할 때 내 기록이 함께 시작돼요'));
    const b = Q(id, '[data-rw="readyBtn"]'); if (b) { if (b.__o == null) b.__o = b.style.cssText; b.style.cssText = b.__o; b.textContent = lead ? `출발하기 (${readyN}/${roomN} 준비)` : g.ready ? '준비 취소' : '준비 완료'; if (!lead && g.ready) { b.style.background = 'rgba(255,255,255,.1)'; b.style.color = '#fff'; b.style.boxShadow = 'none'; b.style.border = '1px solid rgba(255,255,255,.25)'; } }
    paintMusicBtn(id);
  };
  const paintGroup0 = () => {
    const id = 's6-0', s = scr(id); if (!s) return;
    const joins = tnodes(s, '참가하기').concat(tnodes(s, '참가 중')).filter(n => !n.parentElement.closest('[data-rwi]'));
    s.__jn = s.__jn || tnodes(s, '참가하기');
    s.__jn.forEach((n, i) => { const k = i === 0 ? 'd8' : 'd6'; n.nodeValue = S.gjoin[k] ? '✓ 참가 중' : '참가하기'; n.parentElement.style.color = S.gjoin[k] ? '#A7F6EC' : ''; n.parentElement.style.cursor = 'pointer'; n.parentElement.__rwfn = () => { S.gjoin[k] = !S.gjoin[k]; toast(S.gjoin[k] ? '참가했어요' : '참가를 취소했어요'); paintGroup0(); }; });
    const nam = [...s.querySelectorAll('a[href="#s6-cr"]')].find(a => a.textContent.includes('남천 회복 조깅'));
    if (nam) { const st = S.crewJoin['남천 회복 조깅']; show(nam, st === 'pending' || st === 'member', 'flex'); T(nam, '승인 대기', st === 'member' ? '멤버' : null); T(nam, '남천 · 크루장이 승인하면 그룹런이 보여요', st === 'member' ? `남천 · 멤버 ${CREWS['남천 회복 조깅'].n} · 예정된 그룹런이 아직 없어요` : null); nam.style.opacity = st === 'member' ? '1' : ''; nam.style.filter = st === 'member' ? 'none' : ''; }
    s.querySelectorAll('[data-rwi^="new"]').forEach(e => e.remove());
    const first = s.querySelector('a[href="#s6-cr"]');
    if (S.newCrews.length && first) S.newCrews.forEach(nc => { const host = first.closest('[data-scroller] > *') || first.parentElement; const e = el(`<a href="#s6-crm" data-rwnewcrew="1" style="flex:none;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:22px;background:rgba(167,246,236,.1);border:1.5px solid #A7F6EC;color:#fff;text-decoration:none"><span style="flex:none;width:44px;height:44px;border-radius:14px;background:#A7F6EC;color:#191C27;display:grid;place-items:center;font:800 16px 'Noto Sans KR',sans-serif">${nc.name.slice(0, 1)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:700">${nc.name}</span><span style="font-size:11px;color:rgba(255,255,255,.65)">새로 만든 크루 · 크루장 · 멤버 ${CREWS[nc.name].n} / ${CREWS[nc.name].cap} · ${(S.crewPol[nc.name] || nc.pol) === 'open' ? '바로 가입' : '승인제'}</span></span><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;background:#A7F6EC;color:#191C27">NEW</span></a>`); e.setAttribute('data-rwi', 'newcrew'); e.setAttribute('data-rwnewcrew', nc.name); host.parentElement.insertBefore(e, host); });
    const fold = s.querySelector('[data-fold]');
    if (fold) S.myRuns.forEach(mr => { const proto = fold.querySelector(':scope > :not([data-rwi])'); if (!proto) return; const c = proto.cloneNode(true); c.setAttribute('data-rwi', 'newrun'); c.querySelectorAll('[data-rwi]').forEach(x => x.remove());
      const lk = c.querySelector('a[href="#s6-2"]'); if (lk) lk.setAttribute('data-rwmine', mr.id);
      const rp = (a, b) => tnodes(c, a).forEach(n => { n.nodeValue = n.nodeValue.replace(a, b); });
      rp('D-4', mr.cancelled ? '취소됨' : mr.dday); rp('성윤님이 만듦', '내가 만듦 · 그룹장'); rp('토요일 아침, 함께 5km', mr.title); rp('10.25 토 07:00', mr.when); rp('광안리해수욕장 입구 · 편의점 앞', mr.place.name); rp('코스 러닝 · 민락수변공원 출발 5.0km', mr.mode === 'free' ? '자유 러닝 · 코스 없음' : '코스 러닝 · ' + mr.course); rp('참가 6명', mr.cancelled ? '그룹런 취소됨' : '참가 1명');
      c.style.outline = mr.cancelled ? '1px dashed rgba(255,255,255,.3)' : '1.5px solid #A7F6EC'; c.style.opacity = mr.cancelled ? '.55' : ''; c.style.borderRadius = '18px'; fold.insertBefore(c, fold.firstChild); });
  };
  const paintPlace = (id) => {
    const loc = S.placeMode === 'loc', p = S.cand;
    if (id === 's6-9') {
      T(id, '크루가 자주 만난 곳', loc ? '최근 기준 위치' : null); T(id, '지도를 움직여 위치를 맞추세요', loc ? '코스를 추천받을 출발 기준 위치예요' : null);
      T(id, '광안리해수욕장 입구', p.name, 0); T(id, '부산 수영구 광안해변로 219', p.addr); T(id, '320m', p.dist);
      T(id, '이 위치로 정하기', loc ? '이 위치를 기준으로' : null);
      const s = scr(id); rel(s);
      const g = once(s, 'gps', () => { const b = el('<button aria-label="현재 위치로" style="position:absolute;right:16px;top:300px;z-index:8;width:44px;height:44px;border-radius:50%;border:0;background:#16181F;box-shadow:0 6px 16px rgba(0,0,0,.3);display:grid;place-items:center;cursor:pointer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A7F6EC" stroke-width="2" stroke-linecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg></button>'); b.__rwfn = () => pickPlace({ name: '현재 위치 · 광안리해수욕장', addr: '부산 수영구 광안해변로 219 부근', dist: '0m', dx: 0, dy: 0 }); s.appendChild(b); return b; });
      const img = s.querySelector('img[data-pan]'); if (img) { img.dataset.tx = p.dx; img.dataset.ty = p.dy; img.style.transform = `translate(${p.dx}px,${p.dy}px)`; }
    }
    if (id === 's6-9b') { T(id, '광안리해수욕장 입구', p.name); T(id, '부산 수영구 광안해변로 219', p.addr); }
    if (id === 's6-8') { T(id, '광안리해수욕장 입구', S.place.name); T(id, '부산 수영구 광안해변로 219', S.place.addr); const gc = S.grpCourse != null ? ALLC()[S.grpCourse] : COURSES[0]; T(id, '민락수변공원 출발', gc.name.replace(/ [\d.]+km$/, '')); T(id, '5.0km · 평지', gc.km.toFixed(1) + 'km · 평지'); }
    if (id === 's3-1' || id === 's3-1p') T(id, '광안리해수욕장 · 현재 위치', S.loc);
  };
  const pickPlace = (p) => { S.cand = p; paintPlace('s6-9'); };
  const statusOf = r => r.resultId ? '개인 종료 · ' + (r.goalKm ? (r.achieved ? '목표 완주' : '목표 미달성') : '목표 없음') : '목표 완주';
  const runName = r => r.mode === 'free' ? ((ALLC().find(x => x.id === r.recCid) || {}).name || '자유 러닝') : C().name;
  const snapOf = () => S.myPost.snap || { dist: 5.02, time: 1781, pace: '5′55″', status: '목표 완주', hr: true, hrAvg: 158, cad: 170, name: COURSES[0].name, share: true, noGps: false, cid: 'c0', when: '2026.10.19 07:12' };
  const otherLocked = () => S.other.priv && S.other.f !== 'following';
  const lockCard = (s, key, on, after, msg) => { let e = s && s.querySelector('[data-rwi="' + key + '"]'); if (!on) { if (e) e.remove(); return; } if (!e && after) { e = el('<div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin:12px 16px;padding:26px 16px;border-radius:22px;background:rgba(22,24,31,.72);border:1px solid rgba(255,255,255,.14);text-align:center;color:#fff;font-family:\'Noto Sans KR\',sans-serif"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A7F6EC" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg><b style="font-size:15px">비공개 계정이에요</b><span style="font-size:12px;line-height:1.5;color:rgba(255,255,255,.7)">' + msg + '</span></div>'); e.setAttribute('data-rwi', key); after.after(e); } };
  const paintPost = (id) => {
    const mine = id === 's7-2b' || id === 's7-2c' || S.post.owner === 'mine';
    T(id, 'seoyun.run', mine ? 'minjun.run' : null); T(id, '서', mine ? '민' : null);
    T(id, '오늘 광안대교 루프 처음으로 30분 안에 들어왔어요. 3km에서 코칭대로 페이스 늦춘 게 신의 한 수였네요', mine ? S.myPost.body : null);
    const sn = mine && S.myPost.snap ? snapOf() : null; T(id, '2026.10.19 07:12', sn ? sn.when : null); T(id, '10월 19일', mine ? '방금' : null);
    T(id, '민락수변공원 출발 5.0km · 완주', sn ? (sn.share ? sn.name : '러닝') + ' · ' + sn.status : null);
    T(id, '5′55″', sn ? sn.pace : null); T(id, '29:41', sn ? fmtT(sn.time) : null); T(id, '5.02', sn ? dK(sn.dist) : null);
    T(id, '158', sn ? (sn.hr ? String(sn.hrAvg || 158) : '– –') : null); T(id, 'bpm', sn && !sn.hr ? '워치 없음' : null, 0); T(id, '170', sn ? (sn.hr ? String(sn.cad || 170) : '– –') : null);
    const hide = !!sn && (!sn.share || sn.noGps);
    const rs = routeSvg(scr(id)); if (rs) rs.style.visibility = hide ? 'hidden' : '';
    QA(id, 'a[aria-label="코스 저장"]').forEach(b => show(b, !hide, ''));
    if (id === 's7-2') { const s = scr(id), sc = s && s.querySelector('[data-scroller]'); const lk = !mine && otherLocked(); if (sc) sc.style.visibility = lk ? 'hidden' : ''; const hd = sc && sc.previousElementSibling; let ov = s && s.querySelector('[data-rwi="plock"]'); if (lk && !ov && s) { rel(s); ov = el('<div style="position:absolute;left:0;right:0;top:120px;z-index:9"></div>'); ov.setAttribute('data-rwi', 'plock'); s.appendChild(ov); lockCard(ov, 'plock2', true, ov.appendChild(document.createElement('span')), 'seoyun.run 님이 승인한 팔로워만 게시물을 볼 수 있어요'); } if (!lk && ov) ov.remove(); }
  };
  const postCid = k => /^mine:/.test(k) ? ((S.myPosts.find(p => p.id === k.slice(5)) || S.myPost).snap || snapOf()).cid : k === 'mine' ? snapOf().cid || 'c0' : ({ p0: 'c0', p1: 'c1', p2: 'c2' })[k] || 'c0';
  const paintBook = (id) => { QA(id, 'a[aria-label="코스 저장"]').forEach((b, i) => { const mineCard = b.closest('[data-rwpost]'); const k = mineCard ? 'mine:' + mineCard.getAttribute('data-rwpost') : id.startsWith('s7-1') ? 'p' + (i - (id === 's7-1' ? S.myPosts.length : 0)) : (S.post.owner === 'mine' ? 'mine' : 'p0'); setBook(b, !!S.bookC[postCid(k)]); }); };
  const setBook = (b, on) => { const sv = b.querySelector('svg'); if (!sv) return; if (sv.__f == null) sv.__f = sv.getAttribute('fill') || 'none'; const stc = sv.getAttribute('stroke') || '#191C27'; sv.setAttribute('fill', on ? (stc === 'currentColor' ? '#A7F6EC' : stc) : sv.__f); b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  const bookOf32 = () => QA('s3-2', 'a[href="#"]').find(a => !norm(a.textContent));
  const toggleBook = (b, k) => { const cid = postCid(k); toggleCourse(cid); setBook(b, !!S.bookC[cid]); };
  const paintRows = () => {
    const s = scr('s3-1c'); if (!s) return; s.querySelectorAll('[data-rwi="row"]').forEach(e => e.remove());
    const st = [...s.querySelectorAll('[data-scroller] a[data-rwcourse]')].filter(x => !x.hasAttribute('data-rwi')); if (!st.length) return;
    st.forEach((c, i) => { c.style.display = 'none'; });
    const host = st[0].parentElement;
    const ids = S.bookOrder.filter(k => S.bookC[k]);
    ids.forEach((cid, n) => { const all = ALLC(), ci = all.findIndex(x => x.id === cid); const co = all[ci]; if (!co) return; const src = st[Math.min(st.length - 1, /^c\d$/.test(cid) ? +cid.slice(1) : 0)];
      const c = src.cloneNode(true); c.setAttribute('data-rwi', 'row'); c.setAttribute('data-rwcid', cid); c.style.display = '';
      const nm = [...c.querySelectorAll('span')].find(x => x.style.fontWeight === '700' && x.style.fontSize === '14px'); if (nm) nm.textContent = CN(co);
      const meta = nm && nm.nextElementSibling; if (meta && meta.children.length >= 2) { meta.children[0].textContent = co.km.toFixed(co.mine ? 2 : 1) + ' km'; meta.children[1].textContent = co.min + '분'; }
      if (co.mine) { c.querySelectorAll('svg').forEach((v, k) => { if (k > 0) v.style.display = 'none'; }); const im = document.createElement('img'); im.src = co.map; im.alt = ''; im.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.85'; c.insertBefore(im, c.firstChild); }
      if (S.alias[cid] && nm) { const sub = document.createElement('span'); sub.textContent = co.name; sub.style.cssText = 'font-size:10px;color:rgba(255,255,255,.62)'; nm.after(sub); }
      const ed = el('<span role="button" aria-label="별명 수정" style="position:absolute;right:8px;top:8px;z-index:3;display:flex;align-items:center;gap:4px;height:30px;padding:0 10px;border-radius:99px;background:rgba(11,12,16,.7);border:1px solid rgba(255,255,255,.25);color:#fff;font:700 11px \'Noto Sans KR\',sans-serif;cursor:pointer">별명</span>');
      ed.__rwfn = () => aliasSheet(cid); c.appendChild(ed);
      if (S.hl === cid) { c.style.outline = '2px solid #A7F6EC'; c.style.outlineOffset = '-2px'; }
      host.insertBefore(c, st[0]); });
    let em = s.querySelector('[data-rwi="rowEmpty"]'); if (!em) { em = el('<div style="grid-column:1/-1;padding:28px 12px;text-align:center;font-size:13px;color:rgba(255,255,255,.65)">저장한 코스가 없어요 · 추천 코스나 결과 화면에서 저장할 수 있어요</div>'); em.setAttribute('data-rwi', 'rowEmpty'); host.insertBefore(em, st[0]); }
    show(em, !ids.length, 'block');
  };
  const paintNotes = () => {
    const s = scr('s2-9'); if (!s) return; s.querySelectorAll('[data-rwi="note"]').forEach(e => e.remove());
    const first = s.querySelector('[data-scroller] a'); if (!first) return;
    S.notes.forEach(nt => { const c = first.cloneNode(true); c.setAttribute('data-rwi', 'note'); c.setAttribute('href', '#' + nt.to); const ns = tnodes(c, '‘토요일 아침, 함께 5km’ 그룹런이 곧 시작해요'); ns.forEach(n => { n.nodeValue = nt.t; }); tnodes(c, '3분 전').forEach(n => { n.nodeValue = '방금'; }); c.style.background = 'rgba(167,246,236,.1)'; c.style.borderRadius = '18px'; first.parentElement.insertBefore(c, first); });
  };
  const paintFeed = (id) => {
    const s = scr(id); if (!s) return; s.querySelectorAll('[data-rwi="mypost"]').forEach(e => e.remove());
    [...s.querySelectorAll('[data-scroller] [data-goto="#s7-2"]')].filter(x => !x.closest('[data-rwi]') && x.textContent.includes('seoyun.run')).forEach(x => { x.style.display = otherLocked() ? 'none' : ''; });
    if (id !== 's7-1' || !S.myPosts.length) return;
    const first = s.querySelector('[data-scroller] [data-goto="#s7-2"]'); if (!first) return;
    S.myPosts.forEach(P => {
    const c = first.cloneNode(true); c.style.display = ''; c.setAttribute('data-rwi', 'mypost'); c.setAttribute('data-rwpost', P.id); const sn = P.snap || snapOf(), hide = !sn.share || sn.noGps;
    const rp = (a, b) => tnodes(c, a).forEach(n => { n.nodeValue = n.nodeValue.replace(a, b); });
    rp('seoyun.run', 'minjun.run'); rp('서', '민'); rp('10.19', '방금'); rp('10월 19일', '방금'); rp('오늘 광안대교 루프 처음으로 30분 안에 들어왔어요. 3km에서 코칭대로 페이스 늦춘 게 신의 한 수였네요', P.body);
    rp('5.02', dK(sn.dist)); rp('29:41', fmtT(sn.time)); rp('5′55″', sn.pace); rp('민락수변공원 출발 5.0km · 완주', (sn.share ? sn.name : '러닝') + ' · ' + sn.status); rp('2026.10.19 07:12', sn.when || '2026.10.19 07:12'); if (!sn.hr) { rp('158', '– –'); rp('bpm', '워치 없음'); rp('170', '– –'); } else { rp('158', String(sn.hrAvg || 158)); rp('170', String(sn.cad || 170)); }
    c.querySelectorAll('[data-goto="#s7-4"]').forEach(x => x.setAttribute('data-goto', '#s7-4b'));
    if (hide) { c.querySelectorAll('svg').forEach((v, i) => { if (v.getAttribute('viewBox') && /0 0 (1\d\d|2\d\d|3\d\d)/.test(v.getAttribute('viewBox'))) v.style.visibility = 'hidden'; }); c.querySelectorAll('a[aria-label="코스 저장"]').forEach(b => { b.style.display = 'none'; }); }
    first.parentElement.insertBefore(c, first); });
  };
  const paintShare = (id) => {
    const s = scr(id); if (!s) return; const sw = s.querySelector('[data-act="shareToggle"]'); if (!sw) return; const on = S.share; sw.setAttribute('aria-checked', String(on));
    sw.style.background = on ? '#0B0C10' : '#C9CBD8'; const k = sw.firstElementChild; if (k) { k.style.right = on ? '3px' : ''; k.style.left = on ? '' : '3px'; k.style.background = on ? '#A7F6EC' : '#fff'; }
    const r = (id === 's7-3' ? S.shareRec : null) || S.past[0], can = !r.noGps;
    if (id === 's7-3') T(id, '민락수변공원 출발 5.0km · 완주', (on && can ? r.pub : '러닝 ' + (r.noGps ? '시간 ' + fmtT(r.time) : dK(r.dist) + 'km')) + ' · ' + recSt(r));
    const routeSvg = [...s.querySelectorAll('svg')].find(v => v.querySelector('path') && /0 0 (1\d\d|2\d\d|3\d\d)/.test(v.getAttribute('viewBox') || '') && v.getBoundingClientRect().width > 60);
    if (routeSvg) routeSvg.style.visibility = on && can ? '' : 'hidden';
    let note = s.querySelector('[data-rwi="shnote"]'); if (!note && sw.parentElement) { note = el('<div style="font-size:11px;color:#6B7186;padding:0 0 8px"></div>'); note.setAttribute('data-rwi', 'shnote'); sw.parentElement.after(note); }
    if (note) note.textContent = !can ? '위치 기록이 없어 공유할 경로가 없어요 · 시간만 보여요' : on ? '이 게시물에 경로·출발/도착 지점과 코스 설명(출발지+거리)이 보여요 · 내 별명은 보이지 않아요 · 이 게시물을 볼 수 있는 사람이 내 코스에 저장할 수 있어요' : '이 게시물에서 경로·출발/도착 지점·코스 설명과 코스 저장을 모두 숨겨요 · 거리·시간·페이스만 보여요';
    if (id === 's7-3') { T(id, '기록 공유', S.shareFrom === 's6-7' ? '내 그룹런 기록 공유' : null); T(id, '5′55″', pcOf(r)); T(id, '29:41', fmtT(r.time)); T(id, '5.02', dK(r.dist)); T(id, '158', r.hr ? String(r.hrAvg) : '– –'); T(id, 'bpm', r.hr ? null : '워치 없음', 0); T(id, '170', r.hr ? String(r.cad) : '– –'); T(id, '2026.10.20 07:10', '2026.' + r.date + ' ' + r.clock); }
  };
  const hsOf = () => S.hsDemo || (!S.user.watch ? 'none' : !S.user.health ? 'denied' : S.user.isNew ? 'collect' : 'ok');
  const paintHs = (id) => {
    const h = hsOf(), ok = h === 'ok';
    const M = { ok: ['', '', ''], collect: ['데이터 모으는 중', '점수 산출 전 · 점수가 없어도 바로 달릴 수 있어요', '점수가 없어도 바로 달릴 수 있어요. 지금 추천은 러닝 수준·목표 기준이에요.'], stale: ['마지막 평가 10.16', '오늘 데이터가 아니라 점수로 쓰지 않아요', '워치를 동기화하면 오늘 기준으로 다시 평가해요. 지금 추천은 러닝 수준·목표 기준이에요.'], denied: ['권한 없음', '건강 데이터 권한이 없어 점수를 표시하지 않아요', '설정 > Health Connect에서 권한을 켜면 평가해요. 러닝·기록은 그대로 쓸 수 있어요.'], none: ['워치 미연결', '워치를 연결하면 평가해요', '워치 없이도 러닝·기록은 휴대폰으로 그대로 쓸 수 있어요.'] }[h];
    T(id, '82', ok ? null : '– –'); T(id, '양호', ok ? null : '점수 없음'); T(id, '· 계획한 강도로 달려도 좋아요', ok ? null : '· ' + M[1]);
    T(id, '06:42 동기화', ok ? null : M[0], 0); T(id, '06:42 동기화', ok ? null : M[0], 1); T(id, '10월 19일 · 06:42 동기화', ok ? null : '10월 19일 · ' + M[0]); T(id, 'Galaxy Watch7', h === 'none' ? '워치 없음' : null); T(id, '● 연결됨 · 82%', h === 'none' ? '설정에서 연결할 수 있어요' : null);
    T(id, '오늘은 5km를 6′00″ 페이스로 시작해도 좋아요.', ok ? null : M[2]); T(id, '건강·활동 정보로 자동 평가', ok ? null : '평가 정보 없음');
    ['7h 12m', '58', '적정'].forEach(k => T(id, k, ok ? null : '– –')); ['충분', '평소 수준', '과부하 없음'].forEach(k => T(id, k, ok ? null : ''));
    const s = scr(id); if (s) s.querySelectorAll('div[style*="width:82%"]').forEach(x => { x.style.visibility = ok ? '' : 'hidden'; });
  };
  const coachRow = (id) => { const s = scr(id); if (!s) return; const e = once(s, 'coach', () => { const tip = tnodes(s, '종료는 1초 길게 눌러야 동작해요')[0]; if (!tip) return null; const b = el("<button style=\"align-self:center;height:44px;padding:0 18px;border-radius:99px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font:500 13px 'Noto Sans KR',sans-serif;cursor:pointer\"></button>"); b.__rwfn = () => { S.coachOff = !S.coachOff; coachRow(id); toast(S.coachOff ? '코칭 음성을 껐어요 · 목표와 안내 페이스는 그대로예요' : '코칭 음성을 켰어요'); }; tip.parentElement.after(b); return b; }); if (e) e.textContent = S.coachOff ? '코칭 음성 꺼짐 · 켜기' : '코칭 음성 켜짐 · 끄기'; };
  const paintPace63 = () => { const id = 's6-3', c = !!S.g.paceChg, pl = planOf(S.g.ctx.key, S.g.ctx.rid); T(id, '6′00″', fmtP(pl.pace)); T(id, '/km · 예상 30:00', pl.sec ? '/km · 예상 ' + fmtT(pl.sec) : '/km · 자유 러닝 · 거리 목표 없음'); banner(id, 'pchg', c, { html: '<b>참가할 때 예상 6′00″ → 지금 ' + fmtP(pl.pace) + '</b> · 대기방 참가자 기준으로 다시 제안했어요', bg: 'rgba(167,246,236,.95)' }, 96); };
  const paintPn = () => {
    const id = 's2-pn', u = S.user, w = u.watch, h = u.health;
    T(id, '워치 연결됨', w ? null : '휴대폰만 사용');
    T(id, '준비도 수집 중', w && h ? null : '준비도 꺼짐'); T(id, '점수 산출 전', w && h ? null : (w ? '건강 데이터 동의 시 측정' : '워치 연결 시 측정'));
    T(id, '수집 중', w && h ? null : '꺼짐');
    T(id, '워치를 차고 지내면 데이터가 모여요', w && h ? null : w ? '건강 데이터 이용에 동의하지 않았어요' : '워치 없이 휴대폰으로 기록해요');
    T(id, '점수에 필요한 데이터가 모이면', w && h ? null : w ? '오늘의 컨디션·준비도는 표시하지 않아요' : '거리·시간·페이스는 휴대폰 GPS로 기록하고');
    T(id, '첫 준비도를 보여 드려요 · 점수가 없어도 바로 달릴 수 있어요', w && h ? null : w ? '설정 > Health Connect에서 언제든 켤 수 있어요' : '준비도는 워치를 연결하면 시작돼요');
    T(id, 'Galaxy Watch7', w ? null : '워치 없음'); T(id, '● 연결됨 · 82%', w ? null : '설정에서 연결할 수 있어요');
    const L = S.recs.filter(x => x.local === 'ok'), km = L.reduce((a, x) => a + (x.dist || 0), 0), withD = L.filter(x => x.dist), avg = withD.length ? fmtP(withD.reduce((a, x) => a + x.time, 0) / withD.reduce((a, x) => a + x.dist, 0)) : '– –'; T(id, '0', String(S.bookOrder.filter(k => S.bookC[k]).length), 1); T(id, '0', String(L.length), 0); T(id, '0.0', L.length ? km.toFixed(1) : null); T(id, '– –', L.length ? avg : null, 1); T(id, '첫 러닝을 마치면 여기에 쌓여요', L.length ? `기록 ${L.length}개 · ${km.toFixed(2)}km가 저장됐어요` : null);
    const rc = S.recC[S.recC.length - 1]; T(id, '아직 달린 코스가 없어요', rc ? rc.name + ' · 방금' : null); 
    T(id, '민준 · 중급', `${u.nick} · ${u.level}`);
  };
  const pausePill = (id) => {
    const s = scr(id); if (!s) return; let p = s.querySelector('[data-rwi="pill"]');
    if (!S.run.active) { if (p) p.remove(); return; }
    if (!p) { rel(s); p = el(`<button style="position:absolute;left:50%;top:84px;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:99px;border:1px solid #A7F6EC;background:#16181F;color:#fff;font:700 13px 'Noto Sans KR',sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.35)"><span style="width:8px;height:8px;border-radius:50%;background:#FF9E8A"></span><span data-t="1"></span><span style="color:#A7F6EC">이어서 달리기 ›</span></button>`); p.setAttribute('data-rwi', 'pill'); p.__rwfn = () => api.reset(S.run.mode === 'group' ? 's6-6c' : 's4-3'); s.appendChild(p); }
    p.querySelector('[data-t]').textContent = `일시정지 · ${S.run.dist.toFixed(2)}km`;
  };
  const hitFix = (id) => {
    const s = scr(id); if (!s) return;
    s.querySelectorAll('a,button,[role="button"],[data-act]').forEach(b => {
      if (b.__hit || norm(b.textContent)) return; const w = b.offsetWidth, h = b.offsetHeight; if (!w || (w >= 44 && h >= 44)) return;
      b.__hit = 1; const cs = getComputedStyle(b); if (cs.position === 'static') b.style.position = 'relative';
      const dx = Math.max(0, (44 - w) / 2), dy = Math.max(0, (44 - h) / 2);
      const sp = document.createElement('span'); sp.setAttribute('data-rwhit', '1'); sp.style.cssText = `position:absolute;left:-${dx}px;right:-${dx}px;top:-${dy}px;bottom:-${dy}px`; b.appendChild(sp);
    });
  };
  const paintLogin = () => {
    const id = 's1-2', s = scr(id); if (!s) return; rel(s);
    const ban = (tnodes(s, '아이디 또는 비밀번호가 맞지 않아요.')[0] || {}).parentElement; const box = ban && ban.closest('div');
    show(box, S.login.shown, 'flex');
    if (S.login.shown) T(id, '5회 실패 시 10분간 제한돼요 (2/5)', S.login.locked ? '5회 실패해서 10분 동안 로그인할 수 없어요' : `5회 실패 시 10분간 제한돼요 (${S.login.fails}/5)`);
    const btn = s.querySelector('button[data-goto]'); if (btn) { const sv = btn.querySelector('svg'); if (sv) sv.style.display = btn.__busy ? '' : 'none'; T(id, '로그인 중', btn.__busy ? '로그인 중' : S.login.locked ? '10분 뒤 다시 시도' : '로그인'); btn.style.opacity = btn.__busy || S.login.locked ? '.6' : '1'; }
    once(s, 'back', () => { const a = el('<a href="#s1-1" aria-label="뒤로" style="position:absolute;left:16px;top:42px;z-index:6;width:44px;height:44px;border-radius:50%;background:rgba(11,12,16,.45);border:1px solid rgba(255,255,255,.14);display:grid;place-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="m15 18-6-6 6-6"></path></svg></a>'); s.appendChild(a); return a; });
    const fg = s.querySelector('a[href="#s1-2p"]'); if (fg) once(s, 'join', () => { const a = el('<a href="#s1-3" style="align-self:center;order:99;padding:10px 8px;font-size:13px;color:rgba(255,255,255,.75);text-decoration:none">처음이신가요? · <span style="color:#fff;font-weight:700">회원가입</span></a>'); fg.parentElement.appendChild(a); return a; });
  };
  const checkRow = (row, on) => { const sv = row && row.querySelector('svg'); const c = sv && sv.parentElement; if (!c) return; c.style.background = on ? '#A7F6EC' : 'transparent'; c.style.boxShadow = on ? 'none' : 'inset 0 0 0 1.5px rgba(255,255,255,.4)'; sv.style.visibility = on ? 'visible' : 'hidden'; row.dataset.on = on ? '1' : '0'; };
  const AGREE = ['[필수] 서비스 이용약관', '[필수] 개인정보 수집·이용', '[필수] 위치 정보 수집·이용', '[선택] 건강 데이터 이용'];
  const agreeRow = (t) => { const n = tnodes(scr('s1-4'), t)[0]; let r = n && n.parentElement; while (r && !r.querySelector('svg')) r = r.parentElement; return r; };
  const paintAgree = () => { if (!S.onb.agree) S.onb.agree = [false, false, false, false]; AGREE.forEach((t, i) => checkRow(agreeRow(t), S.onb.agree[i])); checkRow(agreeRow('전체 동의'), S.onb.agree.every(Boolean)); };
  const paintWatchPick = () => { const s = scr('s1-6w'); if (!s) return; const [a, b] = [...s.querySelectorAll('a[href="#s1-7"],a[href="#s2-1"]')].filter(x => norm(x.textContent).length > 4); if (!a || !b) return; if (a.__o == null) { a.__o = a.style.cssText; b.__o = b.style.cssText; } const p = S.onb.pick; a.style.cssText = p === 'phone' ? b.__o : a.__o; b.style.cssText = p === 'phone' ? a.__o : b.__o; if (!p) { b.style.cssText = b.__o; a.style.cssText = b.__o; } };

  const paint = (id) => {
    if (!id || !scr(id)) return;
    if (['s2-0f', 's2-0', 's2-0n'].includes(id)) { paintMusicBtn(id); T(id, 'GPS 양호', S.gps === 'denied' ? '위치 권한 꺼짐' : S.gps === 'waiting' ? 'GPS 찾는 중' : null); }
    if (id === 's2-0' || id === 's2-0n') { const g = courseGoal(); V(id, 'cName', CN(C())); T(id, `목표 6'00" · 예상 30:00 ·`, `목표 ${fmtP(g.pace)} · 예상 ${fmtT(g.pace * g.km)}` + (S.course ? '' : ' ·')); T(id, '2km 오르막 주의', S.course ? '' : null); prepRow(id); const img = Q(id, 'img'); if (img) { if (img.__o == null) img.__o = img.getAttribute('src'); img.src = S.course ? C().map : img.__o; } }
    if (id === 's3-2') {
      const c = C(); T(id, '민락수변공원 출발 5.0km', c.name); T(id, '5.0', c.km.toFixed(1)); T(id, '30', String(c.min));
      const img = Q(id, 'img[data-pan]'); if (img) { if (img.__o == null) img.__o = img.getAttribute('src'); img.src = S.course ? c.map : img.__o; }
      const lab = (tnodes(scr(id), '경쟁 모드')[0] || {}).parentElement; let tg = lab; while (tg && !Object.keys(tg).some(k => k.startsWith('__reactProps') && tg[k] && tg[k].onClick) && !/겨뤄요|crSub/.test(tg.textContent)) tg = tg.parentElement;
      if (!c.rec && api.get().cron) api.setDC({ cron: false });
      if (tg) show(tg, c.rec, 'flex');
      const s = scr(id); let nt = s.querySelector('[data-rwi="norec"]'); if (!nt && tg) { nt = el('<div style="padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.06);border:1px dashed rgba(255,255,255,.2);font-size:12px;line-height:1.5;color:rgba(255,255,255,.75)"><b style="color:#fff">아직 이 코스 기록이 없어요</b><br>이번 러닝이 첫 기록이 돼요. 기록이 생기면 경쟁 모드를 켤 수 있어요.</div>'); nt.setAttribute('data-rwi', 'norec'); tg.after(nt); }
      show(nt, !c.rec, 'block'); paintBook(id);
    }
    if (id === 's3-1' || id === 's3-1p' || id === 's6-8' || id === 's6-9' || id === 's6-9b') paintPlace(id);
    if (id === 's3-1c') paintRows();
    if (id === 's4-2' || id === 's4-2n') paintRun(id);
    if (id === 's4-3' || id === 's6-6c') { T(id, '14:19', fmtT(S.run.time)); T(id, '2.40km · 평균 5′58″/km', S.run.noGps ? '위치 없이 시간만 기록 중 · 거리·페이스 없음' : `${dK(S.run.dist)}km · 평균 ${pcOf(S.run)}/km`); lockLine(id); bpmCtl(id);
      if (id === 's4-3') { const s = scr(id); once(s, 'home', () => { const b = el("<button style=\"align-self:center;height:44px;padding:0 16px;border:0;background:transparent;color:rgba(255,255,255,.75);font:500 13px 'Noto Sans KR',sans-serif;cursor:pointer\">홈 보기 · 일시정지 상태로 둘게요</button>"); b.__rwfn = () => api.reset(S.user.isNew ? 's2-pn' : 's2-1'); const tip = tnodes(s, '종료는 1초 길게 눌러야 동작해요')[0]; tip && tip.parentElement.after(b); return b; }); } }
    if (id === 's4-5' || id === 's4-5f') paintResult(id);
    if (id === 's5-2') paint52();
    if (id === 's6-0') paintGroup0();
    if (id === 's6-2') paintGroupDetail();
    if (id === 's6-3') paintReady();
    if (id === 's6-5') { paintMini(id); const r = S.run, chg = r.mode === 'group' && r.guidePace && r.guidePace !== r.goalPace; banner(id, 'goal', !!chg, { html: chg ? '<b>안내 페이스를 ' + fmtP(r.goalPace) + ' → ' + fmtP(r.guidePace) + '로 조정했어요</b> · 멤버 1명의 부담이 높아 1분 전에 알린 뒤 바꿨어요 · 출발 목표는 그대로예요' : '', bg: 'rgba(167,246,236,.95)' }, 96); }
    if (['s6-5', 's6-5b', 's6-6r'].includes(id)) paintGrun(id);
    if (/^s9-/.test(id)) paintWatch(id);
    if (id === 's8-1' || id === 's8-3') paintCoach(id);
    if (id === 's6-7') paintGroupResult();
    if (['s6-cr', 's6-2b', 's6-crm', 's6-crf'].includes(id)) { paintCrew(id); if (id === 's6-cr') { const b = Q(id, 'a[href="#s6-2b"]'); const st = S.crewJoin[S.crewSel]; if (b) b.textContent = st === 'member' ? '가입한 크루예요 · 내 크루에서 보기' : (S.crewPol[S.crewSel] === 'open' ? '바로 가입하기' : '가입 신청'); }
      if (id === 's6-2b') { const b = Q(id, 'a[href="#s6-0"]'); if (b && !b.hasAttribute('data-scrollto')) b.textContent = '신청 철회'; } V(id, 'apN2', String(['me', 'do'].filter(k => S.ap[k] === 'pending').length)); }
    if (id === 's6-ap') { const n = CREWS['남천 회복 조깅'].n; V(id, 'apCount', String(n)); V(id, 'apN', String(['me', 'do'].filter(k => S.ap[k] === 'pending').length)); V(id, 'apPol', S.crewPol['남천 회복 조깅'] === 'open' ? '바로 가입' : '승인제');
      ['me', 'do'].forEach(k => { const st = Q(id, '[data-apst="' + k + '"]'); const v = S.ap[k]; if (st) { st.textContent = v === 'approved' ? '✓ 승인됨' : v === 'rejected' ? '거절됨' : ''; st.style.color = v === 'rejected' ? '#FF9E8A' : '#A7F6EC'; show(st, v !== 'pending', 'inline'); } QA(id, '[data-who="' + k + '"]').forEach(b => show(b, v === 'pending', 'inline-block')); }); }
    if (id === 's2-9') paintNotes();
    if (id === 's7-1' || id === 's7-1d') { paintFeed(id); paintBook(id); }
    if (id === 's7-2' || id === 's7-2b' || id === 's7-2c') { paintPost(id); paintBook(id); }
    if (id === 's7-3' || id === 's7-3e') paintShare(id);
    if (id === 's7-4b') T(id, '중급', S.user.level);
    if (id === 's8-1' || id === 's8-3') V(id, 'nick', S.user.nick);
    if (id === 's2-1' || id === 's2-1la' || id === 's2-p') { T(id, '민준님,', S.user.nick + '님,'); V(id, 'condV', hsOf() === 'ok' ? '보통' : '평가 정보 없음'); T(id, '오늘 달리기 좋은 날이에요', hsOf() === 'ok' ? null : '오늘도 달려 볼까요'); }
    if (id === 's8-1' || id === 's8-3') paintAcct(id);
    if (id === 's7-4') paintOther();
    if (id === 's7-4b') paintMe();
    if (['s6-4c', 's6-4d', 's6-4e'].includes(id)) paintCancel(id);
    if (id === 's6-8') paintGmode();
    if (MUSIC.includes(id) && /^s2-7|^s6-3m/.test(id)) bpmCtl(id);
    if (id === 's2-pn') paintPn();
    if (['s2-1', 's2-1la', 's2-p'].includes(id)) paintHs(id);
    if (['s3-1', 's3-1p', 's6-2', 's6-3'].includes(id)) T(id, '준비도 82', hsOf() === 'ok' ? null : '준비도 미반영');
    if (id === 's4-3' || id === 's6-6c') coachRow(id);
    if (id === 's2-0' || id === 's2-0n') banner(id, 'appr', true, { html: S.atStart ? '<b>출발점에 있어요</b> · 바로 시작할 수 있어요' : '<b>출발점까지 350m</b> · 걸어서 약 5분 · 지도의 출발 표시로 가요', bg: 'rgba(22,24,31,.88)', fg: '#fff' }, 108);
    if (id === 's6-3') paintPace63();
    if (id === 's5-1') { const n = S.recs.filter(r => r.local === 'ok' && r.sync === 'pending').length; banner(id, 'unsync', n > 0 || !!S.watchPend, { html: (n ? '<span><b>전송 대기 ' + n + '건</b> · 휴대폰에 보관 중이에요 · 아래 기록에서 다시 보낼 수 있어요</span>' : '') + (n && S.watchPend ? '<br>' : '') + (S.watchPend ? '<span><b>워치 기록 동기화 대기 1건</b> · 워치와 다시 연결되면 보내요</span>' : '') }, 104); paint51(); }
    if (id === 's1-6') T(id, '2 / 2', S.org.prof ? '수정' : null);
    if (id === 's1-2') paintLogin();
    if (id === 's1-4') paintAgree();
    if (id === 's1-6w') paintWatchPick();
    if (id === 's1-7') { const s = scr(id); rel(s); const b = once(s, 'back', () => { const a = el('<a href="#s1-6w" aria-label="뒤로" style="position:absolute;left:16px;top:38px;z-index:6;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);display:grid;place-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="m15 18-6-6 6-6"></path></svg></a>'); s.appendChild(a); return a; }); }
    if (id === 's1-8') { const s = scr(id); T(id, '권한 거부', S.permFixed ? '허용됨' : null); once(s, 'perm', () => { const later = s.querySelector('a[href="#s2-1"]'); if (!later) return null; const b = el("<button style=\"height:48px;margin:0 18px 8px;border-radius:99px;border:1px solid rgba(255,158,138,.6);background:rgba(255,158,138,.1);color:#FF9E8A;font:700 14px 'Noto Sans KR',sans-serif;cursor:pointer\">심박수 권한 설정 열기</button>"); b.__rwfn = () => sheet({ title: '심박수 권한이 꺼져 있어요', body: '연결 끊김과 달리 권한은 휴대폰 설정에서 직접 켜야 해요. 켜고 돌아오면 다시 확인해요.', actions: [{ label: '설정에서 허용하기 (시연)', kind: 'pri', fn: () => { S.permFixed = true; paint('s1-8'); toast('심박수 권한을 허용했어요'); } }, { label: '나중에' }] }); later.parentElement.insertBefore(b, later); return b; }); }
    if (id === 's9-4') { clearTimeout(S._sync); S._sync = setTimeout(() => { if (cur() === 's9-4') api.replace(S.watchOnly || S.demo.syncFail ? 's9-4c' : 's9-4b'); }, 1600); }
    if (id === 's9-4c') { const s = scr(id); once(s, 'later', () => { const n = tnodes(s, '다시 시도')[0]; const t = n && n.parentElement; if (!t) return null; const c = t.cloneNode(true); c.textContent = '나중에 보내기'; c.style.background = 'transparent'; c.style.border = '1px solid rgba(255,255,255,.4)'; c.style.color = '#fff'; c.style.marginTop = '6px'; c.__rwfn = () => { toast('워치에 보관했어요 · 휴대폰과 연결되면 자동으로 보내요'); api.reset('s9-1'); }; t.after(c); return c; }); }
    if (MUSIC.includes(id)) { const s = scr(id); rel(s); once(s, 'mclose', () => { const b = el("<button data-act=\"mclose\" aria-label=\"음악 닫기\" style=\"position:absolute;left:50%;bottom:30px;transform:translateX(-50%);z-index:8;height:48px;min-width:160px;padding:0 22px;border-radius:99px;border:1px solid rgba(255,255,255,.3);background:#16181F;color:#fff;font:700 14px 'Noto Sans KR',sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M18 6 6 18M6 6l12 12\"></path></svg>닫기</button>"); s.appendChild(b); return b; }); }
    if (ROOTS.includes(id)) pausePill(id);
    hitFix(id);
  };

  /* ---------- enter hook ---------- */
  const enter = (id, prev) => {
    closeSheet();
    if (MUSIC.includes(id) && !MUSIC.includes(prev)) S.org.music = prev;
    const inSet = SETTINGS.includes(id) || ((id === 's1-7' || id === 's1-8') && (S.setFlow && (SETTINGS.includes(prev) || prev === 's1-7' || prev === 's1-8')));
    if (inSet && !S.setFlow) { S.org.settings = prev; } S.setFlow = inSet;
    if (id === 's8-1' && !S.user.watch) return setTimeout(() => api.replace('s8-3'), 0);
    if (id === 's5-2' && prev !== 's4-6') S.org.rec = prev;
    if ((id === 's6-cr') && S.crewJoin[S.crewSel] === 'pending') return setTimeout(() => api.replace('s6-2b'), 0);
    if (FORMS[id] && !FORMS[id].includes(prev)) {
      S.dirty[id] = false; const s = scr(id);
      s && s.querySelectorAll('input,textarea').forEach(i => { if (i.__init == null) i.__init = i.value; i.value = i.__init; i.style.borderColor = ''; });
      if (id === 's7-3e') { const t = s && s.querySelector('[data-rw="body"]'); if (t) t.value = S.myPost.body; }
      if (id === 's6-new') V(id, 'introCnt', '0 / 200');
      if (id === 's8-2') { const i = s && s.querySelector('input'); if (i) i.value = S.user.nick; }
      if (id === 's6-8') S.gmode = 'course';
      if (id === 's7-3e') S.share = S.myPost.share !== false;
    }
    if ((id === 's4-5' || id === 's4-5f') && S.run.rec && S.run.rec.local === 'new') doSave(S.run.rec);
    if (id === 's5-2' && S.recSel && !S.recSel.base && !S.recSel.hr) api.setDC({ rgm: 0 });
    if (id === 's6-3' && !MUSIC.includes(prev) && !(S.run.active && S.run.mode === 'group')) { const ctx = prev === 's6-2' ? { key: S.gd.key, rid: S.gd.rid } : { key: 'today' }; if (S.g.ctx.key !== ctx.key || S.g.ctx.rid !== ctx.rid) { S.g.ctx = ctx; S.g.mem = memInit(ctx.key === 'mine'); S.g.ready = false; S.g.state = 'wait'; S.g.role = ctx.key === 'mine' ? 'leader' : 'member'; } }
    if (id === 's6-4e' && prev === 's6-4d') { const run = S.myRuns.find(x => x.id === S.cx); if (run && !run.cancelled) { run.cancelled = true; S.gjoin.mine = false; toast('그룹런을 취소했어요 · 참가자에게 그룹런 취소 알림을 보냈어요'); } }
    if (id === 's7-3') { S.shareFrom = prev; S.shareRec = prev === 's5-2' ? (S.recSel || S.past[0]) : (/^s4-5/.test(prev) && S.run.rec) ? S.run.rec : S.past[0]; S.share = !S.shareRec.noGps; }
    if (id === 's1-6') S.org.prof = prev === 's8-2' ? 's8-2' : prev === 's1-5' ? null : S.org.prof;
    if (id === 's9-4c') S.watchPend = true; if (id === 's9-4b') S.watchPend = false;
    if (id === 's6-9' && prev !== 's6-9b' && S.placeMode === 'loc') S.org.loc = prev;
    if (id === 's6-9' && !['s6-9b'].includes(prev)) S.cand = S.placeMode === 'loc' ? PLACES.find(p => S.loc.startsWith(p.name)) || PLACES[0] : S.place;
    paint(id);
  };

  /* ---------- route (links / data-goto) ---------- */
  const isTab = (a) => a.closest && a.closest('[data-tabnav],[data-arcnav]') && ['홈', '러닝', '그룹', '커뮤니티'].includes(a.getAttribute('aria-label'));
  const dirtyExit = (id, go) => { if (S.dirty[id]) { sheet({ title: '작성 중인 내용이 있어요', body: '지금 나가면 입력한 내용이 사라져요.', actions: [{ label: '계속 작성하기', kind: 'pri' }, { label: '버리고 나가기', kind: 'danger', fn: () => { S.dirty[id] = false; go(); } }] }); return true; } return false; };
  const route = (href, a, id) => {
    const txt = norm(a.getAttribute('aria-label') || a.textContent), to = href.slice(1);
    if (isTab(a)) { const l = a.getAttribute('aria-label');
      if (l === '홈') api.reset(S.user.isNew ? 's2-pn' : 's2-1');
      else if (l === '러닝') { if (S.run.active) { api.reset(S.run.mode === 'group' ? 's6-6c' : 's4-3'); toast('진행 중인 러닝으로 돌아왔어요'); } else api.reset('s2-0m'); }
      else if (l === '그룹') api.reset(S.user.isNew && !S.newCrew ? 's6-0b' : 's6-0');
      else api.reset('s7-1');
      return true; }
    { const r13 = route13(href, a, id, txt, to); if (r13 !== undefined) return r13; }
    // forms: exit / submit
    if (FORMS[id]) {
      const sub = FORMS[id].includes(to);
      const SUBMIT = { 's6-new': '크루 만들기', 's6-8': '그룹런 만들기', 's7-3': '게시', 's7-3e': '저장', 's8-2': '저장', 's4-6': '코스 등록' };
      if (txt === SUBMIT[id]) return submit(id, a);
      if (!sub && dirtyExit(id, () => (id === 's7-3e' ? api.popTo('s7-2') : api.back()))) return true;
      if (id === 's7-3e') { api.popTo('s7-2'); return true; }
      if (id === 's8-2' && !sub) { api.popTo('s7-4b'); return true; }
    }
    // music
    if (MUSIC.includes(id)) {
      if (txt === '닫기') { api.popTo(S.org.music || 's2-0'); return true; }
      if (id === 's2-8' || id === 's2-8b') {
        const card = S.org.music === 's6-3' ? 's6-3m' : 's2-7';
        if (/^멜론/.test(txt)) { if (id === 's2-8b' && /권한/.test(txt)) toast('멜론 권한을 허용했어요 (시연)'); S.music = 'melon'; api.replace(card); return true; }
        if (/^Spotify/.test(txt)) { if (/설치/.test(txt)) { toast('Spotify 앱을 설치한 뒤 다시 눌러 주세요 (시연)'); return true; } S.music = 'spotify'; toast('Spotify에 로그인했어요 (시연)'); api.replace('s2-7s'); return true; }
        if (/^음악 없음/.test(txt)) { S.music = 'none'; api.popTo(S.org.music || 's2-0'); toast('음악 없이 달려요'); return true; }
      }
      if (txt === '다시 연결') { S.music = 'melon'; api.replace('s2-7'); toast('멜론에 다시 연결했어요'); return true; }
      if (href === '#') { toast(txt === '재생 제어' ? '재생 제어 (시연)' : /열기$/.test(txt) ? txt.replace(' 열기', '') + ' 앱을 열어요 (시연)' : '선택한 곡을 재생해요 (시연)'); return true; }
    }
    if (!MUSIC.includes(id) && (to === 's2-7' || to === 's6-3m')) { api.nav(S.music === 'none' ? 's2-8' : S.music === 'spotify' ? 's2-7s' : (id === 's6-3' ? 's6-3m' : 's2-7')); return true; }
    if (href === '#' && txt === '재생 제어') { toast('재생 제어 (시연)'); return true; }
    if (id === 's3-1' && to === 's3-1b' && S.demo.rec) { if (S.demo.rec === 'empty') sheet({ title: '조건에 맞는 코스를 찾지 못했어요', body: '입력한 조건은 그대로예요. 거리나 환경을 바꿔 다시 추천받아 보세요.', actions: [{ label: '조건 수정', kind: 'pri' }] }); else sheet({ title: '추천을 불러오지 못했어요', body: '연결 상태를 확인해 주세요. 입력한 조건은 그대로예요.', actions: [{ label: '다시 시도', kind: 'pri', fn: () => { S.demo.rec = null; api.nav('s3-1b'); } }, { label: '조건 수정' }] }); return true; }
    if (id === 's1-6' && S.org.prof && (txt === '저장' || txt === '이전')) { api.popTo('s8-2'); if (txt === '저장') toast('기본 목표·평소 페이스를 바꿨어요 · 다음 러닝부터 기본값이 돼요'); return true; }
    // settings
    if ((id === 's8-1' || id === 's8-3') && txt === '닫기') { S.setFlow = false; api.popTo(S.org.settings || 's2-1'); return true; }
    if (id === 's8-1' && txt === '연결 해제') { S.user.watch = false; api.replace('s8-3'); return true; }
    if (id === 's8-3' && txt === '실행 취소') { S.user.watch = true; api.replace('s8-1'); return true; }
    if (id === 's1-7' && a.hasAttribute('data-goto')) { S.user.watch = true; if (S.setFlow) { api.popTo('s8-3'); setTimeout(() => api.replace('s8-1'), 0); toast('워치를 연결했어요'); } else finishOnb(); return true; }
    if (id === 's1-8') { if (a.hasAttribute('data-goto')) { toast('다시 연결했어요'); api.replace('s1-7'); return true; } if (txt === '나중에 연결하기') { S.user.watch = false; if (S.setFlow) api.popTo('s8-3'); else finishOnb(); return true; } }
    // onboarding
    if (id === 's1-2' && a.hasAttribute('data-goto')) { if (a.__busy || S.login.locked) return true; a.__busy = true; paintLogin(); setTimeout(() => { a.__busy = false; if (S.demo.loginFail) { S.login.fails++; S.login.shown = true; S.login.locked = S.login.fails >= 5; paintLogin(); } else { S.login = { fails: 0, shown: false, locked: false }; S.user.isNew = false; api.reset('s2-1'); } }, 900); return true; }
    if (id === 's1-3' && a.hasAttribute('data-goto')) { const p = QA(id, 'input[type="password"]'); if (p.length > 1 && p[0].value !== p[1].value) { toast('비밀번호 확인이 일치하지 않아요'); p[1].style.borderColor = '#FF9E8A'; return true; } if (p[0] && p[0].value.length < 8) { toast('비밀번호는 8자 이상이에요'); return true; } }
    if (id === 's1-4' && a.hasAttribute('data-goto')) { const g = S.onb.agree || []; if (!(g[0] && g[1] && g[2])) { toast('필수 항목 3개에 동의해 주세요'); return true; } S.user.health = !!g[3]; S.user.isNew = true; toast('계정을 만들었어요'); }
    if (id === 's1-6w') { if (norm(a.textContent).length > 4 && txt !== '다음') { S.onb.pick = to === 's2-1' ? 'phone' : 'watch'; paintWatchPick(); return true; } if (txt === '다음') { if (!S.onb.pick) { toast('하나를 골라 주세요'); return true; } if (S.onb.pick === 'phone') { S.user.watch = false; finishOnb(); return true; } } }
    // home → course pick / group detail ctx
    if ((id === 's2-1' || id === 's2-1la') && a.hasAttribute('data-rwcourse')) { const i = QA(id, 'a[data-rwcourse]').indexOf(a); S.course = Math.max(0, i) % COURSES.length; }
    if (id === 's3-1c' && a.hasAttribute('data-rwcourse')) { const L = QA(id, 'a[data-rwcourse]').filter(x => !x.hasAttribute('data-rwi')); const i = L.indexOf(a); S.course = i < 0 ? 0 : i % COURSES.length; if (S.courseFor === 'grp') { chooseCourse(); return true; } }
    if (to === 's5-2') { const rid = a.getAttribute('data-rwrec'); S.recSel = rid ? S.recs.find(r => r.id === rid) || null : /^s4-5/.test(id) ? (S.run.rec || null) : recOfRow(a); }
    if (to === 's6-2') { const t = a.textContent; S.gd.key = a.hasAttribute('data-rwmine') ? 'mine' : /15분 뒤/.test(t) ? 'today' : /D-8|수요일/.test(t) ? 'd8' : /D-6|월요일/.test(t) ? 'd6' : id === 's2-pn' ? 'pn' : 'd4'; }
    if (to === 's6-cr' || to === 's6-crf') { const nm = Object.keys(CREWS).find(n => a.textContent.includes(n)); if (nm) S.crewSel = nm; }
    // course
    if (id === 's3-1' || id === 's3-1p') { if (/^기준 위치/.test(txt)) { S.placeMode = 'loc'; api.nav('s6-9'); return true; } }
    if (id === 's6-8' && to === 's6-9') S.placeMode = 'meet';
    if (id === 's6-8' && to === 's3-1c') S.courseFor = 'grp';
    if (id === 's2-0' && to === 's3-1b') S.courseFor = null;
    if (id === 's3-2' && txt === '코스 선택' && S.courseFor === 'grp') { S.grpCourse = S.course; S.courseFor = null; api.popTo('s6-8'); toast('그룹런 코스를 바꿨어요'); return true; }
    if (id === 's3-2' && href === '#' && !txt) { toggleBook(a, 'c' + S.course, C().name); return true; }
    if (a.getAttribute('aria-label') === '코스 저장') { const L = QA(id, 'a[aria-label="코스 저장"]').filter(x => !x.closest('[data-rwpost]')); const k = a.closest('[data-rwpost]') ? 'mine:' + a.closest('[data-rwpost]').getAttribute('data-rwpost') : id.startsWith('s7-1') ? 'p' + L.indexOf(a) : (S.post.owner === 'mine' || id !== 's7-2' ? 'mine' : 'p0'); toggleBook(a, k); return true; }
    if (id === 's6-9' && to === 's6-9b' && S.placeMode === 'loc') { S.loc = S.cand.name + (S.cand.dist === '0m' ? '' : ' · ' + S.cand.addr.replace('부산 ', '')); api.popTo(S.org.loc || 's3-1'); toast('기준 위치를 바꿨어요'); return true; }
    if (id === 's6-9b' && txt === '확정') { S.place = S.cand; api.popTo('s6-8'); toast('만나는 곳을 정했어요'); return true; }
    // run
    if (to === 's4-2' && ['s2-0f', 's2-0', 's2-0n'].includes(id)) { startRun(id === 's2-0f' ? 'free' : 'course', id === 's2-0n' ? 's4-2n' : 's4-2'); return true; }
    if (id === 's4-3' && to === 's4-2') { resume(); return true; }
    if (id === 's4-3' && to === 's4-5') { endSheet(); return true; }
    if ((id === 's4-5' || id === 's4-5f') && txt === '완료') { api.reset(S.user.isNew ? 's2-pn' : 's2-1'); return true; }
    if (id === 's4-5f' && txt === '내 코스에 저장') { const inp = Q(id, 'input[aria-label="코스 이름"]'); const nm = inp && inp.value.trim(); if (!nm) { toast('코스 이름을 입력해 주세요'); inp && (inp.style.borderColor = '#FF9E8A'); return true; } if (S.rows.some(r => r.key === 'free')) { toast('이미 내 코스에 있어요'); return true; } S.rows.unshift({ key: 'free', name: nm, isNew: true }); a.textContent = '✓ 내 코스에 저장됨'; toast('내 코스에 저장했어요', { label: '보기', fn: () => api.nav('s3-1c') }); return true; }
    if (id === 's5-2' && txt === '닫기') { api.popTo(S.org.rec || 's5-1'); return true; }
    // group
    if (id === 's6-2' && to === 's6-3') { const k = S.gd.key;
      if (k === 'mine') { const mr = S.myRuns.find(x => x.id === S.gd.rid); if (!mr || mr.cancelled) return true; if (!mr.soon) { toast('출발 30분 전(' + openAt(mr) + ')부터 대기방이 열려요'); return true; } api.nav('s6-3'); return true; }
      if (!S.gjoin[k]) { S.gjoin[k] = true; paintGroupDetail(); toast('참가했어요 · 내 크루 일정에 추가됐어요'); return true; }
      if (k !== 'today') { sheet({ title: '참가를 취소할까요?', body: '취소하면 참가자 목록에서 빠지고, 다시 참가할 수 있어요.', actions: [{ label: '참가 취소', kind: 'danger', fn: () => { S.gjoin[k] = false; paintGroupDetail(); toast('참가를 취소했어요'); } }, { label: '돌아가기' }] }); return true; }
    }
    if (id === 's6-3' && to === 's6-5') { if (S.g.role === 'leader') { const wt = S.g.mem.filter(m => !m.me && m.room === 'room').map(m => m.n), ot = S.g.mem.filter(m => !m.me && m.room === 'out').map(m => m.n); if (!wt.length && !ot.length) { groupGo(); return true; } sheet({ title: wt.length ? wt.join('·') + '님이 아직 준비 중이에요' : ot.join('·') + '님이 아직 들어오지 않았어요', body: '지금 출발하면 준비 완료한 멤버(나 포함)의 기록이 3초 뒤 시작돼요. 준비하지 않았거나 들어오지 않은 멤버의 기록은 시작되지 않고, 실제로 출발한 사람만 진행·종료 집계에 들어가요. 이들이 나중에 합류하는 방식은 아직 정해지지 않았어요.', actions: [{ label: '지금 출발하기', kind: 'pri', fn: groupGo }, { label: '조금 더 기다리기' }] }); } else { S.g.ready = !S.g.ready; paintReady(); toast(S.g.ready ? '준비 완료 · 그룹장이 출발하면 시작해요' : '준비를 취소했어요'); } return true; }
    if (id === 's6-6c' && to === 's6-5') { resume(); return true; }
    if (id === 's6-6c' && to === 's6-7') { groupEndSheet(); return true; }
    if (id === 's6-7' && txt === '완료' && !(api.stack().includes('s5-1'))) { api.reset('s6-0'); return true; }
    if (id === 's6-cr' && to === 's6-2b') { const st = S.crewJoin[S.crewSel]; if (st === 'member') { api.reset('s6-0'); return true; } if (S.crewPol[S.crewSel] === 'open') { S.crewJoin[S.crewSel] = 'member'; CREWS[S.crewSel].n++; toast('가입했어요 · 내 크루에 추가됐어요'); api.reset('s6-0'); return true; } S.crewJoin[S.crewSel] = 'pending'; api.replace('s6-2b'); return true; }
    if (id === 's6-2b' && to === 's6-0' && !a.hasAttribute('data-scrollto')) { sheet({ title: '가입 신청을 철회할까요?', body: '크루장에게 보낸 신청이 취소돼요. 나중에 다시 신청할 수 있어요.', actions: [{ label: '신청 철회', kind: 'danger', fn: () => { S.crewJoin[S.crewSel] = 'none'; S.ap.me = 'pending'; api.replace('s6-cr'); toast('가입 신청을 철회했어요'); } }, { label: '돌아가기' }] }); return true; }
    if (id === 's6-0' && to === 's6-cr' && /남천 회복 조깅/.test(a.textContent) && S.crewJoin['남천 회복 조깅'] === 'pending') { S.crewSel = '남천 회복 조깅'; api.nav('s6-2b'); return true; }
    if (id === 's6-crm' && txt === '저장') { toast('크루 설정을 저장했어요'); api.back(); return true; }
    // posts
    if ((id === 's7-1' || id === 's7-1d') && to === 's7-2') { const pc = a.closest('[data-rwpost]'); S.post.owner = pc ? 'mine' : 'other'; if (pc) S.myPost = S.myPosts.find(p => p.id === pc.getAttribute('data-rwpost')) || S.myPost; }
    if (id === 's7-2' && to === 's7-2b') { if (S.post.owner !== 'mine') { sheet({ title: 'seoyun.run 님의 게시물', actions: [{ label: '게시물 신고하기', kind: 'danger', fn: () => toast('신고를 접수했어요 · 검토 후 알려 드려요') }, { label: 'seoyun.run 차단하기', fn: () => toast('차단했어요 · 이 사용자의 글이 보이지 않아요') }, { label: '링크 복사', fn: () => toast('링크를 복사했어요') }, { label: '닫기' }] }); return true; } }
    if (id === 's7-2b' && txt === '닫기') { api.back(); return true; }
    if (id === 's7-2c' && txt === '취소') { api.popTo('s7-2'); return true; }
    if (id === 's7-2c' && txt === '삭제') { S.myPosts = S.myPosts.filter(p => p !== S.myPost); S.myPost = S.myPosts[0] || { body: S.myPost.body, exists: false }; S.post.owner = 'other'; api.reset('s7-1'); toast('게시물을 삭제했어요'); return true; }
    if (id === 's2-pn' && to === 's2-pn') { api.reset('s6-0b'); return true; }
    return undefined;
  };
  const chooseCourse = () => { if (S.courseFor === 'grp') { S.grpCourse = S.course; S.courseFor = null; api.popTo('s6-8'); toast('그룹런 코스를 바꿨어요'); } else api.nav('s2-0'); };
  const groupGo = () => { if (S.g.role !== 'leader' && !S.g.ready) { sheet({ title: '그룹장이 출발했어요', body: '준비 완료를 누르지 않아 내 기록은 시작되지 않았어요. 늦게 합류하는 방식은 아직 정해지지 않았어요.', actions: [{ label: '확인' }] }); return; } const pl = planOf(S.g.ctx.key, S.g.ctx.rid); countdown(() => { Object.assign(S.run, { id: 'run' + (++S.seq), mode: 'group', cid: pl.cid, gtitle: pl.title, gctx: Object.assign({}, S.g.ctx), active: true, dist: 2.4, time: 859, goalKm: pl.km, goalPace: pl.pace, guidePace: pl.pace, goalSec: pl.sec, noGps: false, lost: false, weak: false, achieved: null, save: 'none', rec: null, resultId: null }); S.g.session = pl; S.g.goalChanged = false; S.g.mem.forEach(m => { m.st = (m.me ? (S.g.role === 'leader' || S.g.ready) : m.room === 'ready') ? 'run' : 'none'; delete m.dist; delete m.time; delete m.ach; delete m.forced; }); S.g.state = 'run'; S.g.end = null; api.reset('s6-5'); }, '그룹장이 출발했어요 · 내 기록이 함께 시작돼요'); };
  const finishOnb = () => { S.user.isNew = true; newUserData(); S.onb.pick = null; api.reset('s2-pn'); toast(S.user.watch ? '가입을 마쳤어요 · 워치가 연결됐어요' : '가입을 마쳤어요 · 휴대폰만으로 시작해요'); };
  const val = (id, k) => { const e = Q(id, '[data-rw="' + k + '"]'); return e ? e.value.trim() : ''; };
  const polOf = (id) => { const a = Q(id, '[data-rwpol="approve"]'); return a && getComputedStyle(a).backgroundColor === 'rgb(167, 246, 236)' ? 'approve' : 'open'; };
  const dayK = ['일', '월', '화', '수', '목', '금', '토'];
  const submit = (id, btn) => {
    if (id === 's6-new') { const nm = val(id, 'crewName'); if (!nm) { const i = Q(id, '[data-rw="crewName"]'); i.style.borderColor = '#FF9E8A'; V(id, 'crewNameHint', '필수 · 이름을 입력해 주세요'); toast('크루 이름을 입력해 주세요'); return true; }
      guard(btn, () => { const cap = +(Q(id, '[data-rwv="cap"]') || {}).textContent || 20; S.newCrew = { name: nm, pol: polOf(id), cap }; S.newCrews.unshift(S.newCrew); CREWS[nm] = { n: 1, cap, area: '새 크루', mine: true, intro: val(id, 'crewIntro') }; S.crewPol[nm] = S.newCrew.pol; S.crewSel = nm; S.crewJoin[nm] = 'member'; S.dirty[id] = false; api.reset('s6-0'); toast(`‘${nm}’ 크루를 만들었어요`); }); return true; }
    if (id === 's6-8') { const d = val(id, 'gdate'), t = val(id, 'gtime'); if (!d || !t) { toast('날짜와 시간을 정해 주세요'); return true; }
      const dt = new Date(d + 'T' + t), now = new Date('2026-10-23T12:00'); if (dt < now) { toast('지금보다 뒤의 날짜·시간을 골라 주세요'); return true; }
      guard(btn, () => { const md = (dt.getMonth() + 1) + '.' + String(dt.getDate()).padStart(2, '0'); const dd = Math.ceil((dt - now) / 864e5); const gc = S.grpCourse != null ? ALLC()[S.grpCourse] : COURSES[0];
        S.myRun = { id: 'g' + (S.myRuns.length + 1), dday: 'D-' + dd, title: `${dayK[dt.getDay()]}요일 ${t} 그룹런`, when: `${md} ${dayK[dt.getDay()]} ${t}`, place: S.place, mode: S.gmode, cid: S.gmode === 'free' ? null : gc.id, dt: dt.getTime(), soon: false, course: S.gmode === 'free' ? null : gc.name, crew: '광안리 새벽 크루', n: 1, cancelled: false }; S.myRuns.unshift(S.myRun); S.gjoin.mine = true; S.dirty[id] = false; api.reset('s6-0'); toast(S.gmode === 'free' ? '자유 러닝 그룹런을 만들었어요' : '코스 러닝 그룹런을 만들었어요'); }); return true; }
    if (id === 's7-3') { const b = val(id, 'body'); if (!b) { toast('글을 입력해 주세요'); return true; } guard(btn, () => { const r = S.shareRec || S.past[0], can = !r.noGps, sh = S.share && can; S.myPost = { id: 'mp' + (++S.seq), body: b, exists: true, share: sh, snap: { rid: r.id, dist: r.dist, time: r.time, pace: pcOf(r), status: recSt(r), hr: !!r.hr, hrAvg: r.hrAvg, cad: r.cad, name: r.pub, share: sh, noGps: !!r.noGps, cid: can ? ensureCid(r) : null, when: '2026.' + r.date + ' ' + r.clock } }; S.myPosts.unshift(S.myPost); S.dirty[id] = false; api.reset('s7-1'); toast('게시했어요 · 피드 맨 위에 올라갔어요'); }); return true; }
    if (id === 's7-3e') { const b = val(id, 'body'); if (!b) { toast('글을 입력해 주세요'); return true; } guard(btn, () => { S.myPost.body = b; S.myPost.share = S.share; S.myPost.snap = Object.assign({}, snapOf(), { share: S.share && !snapOf().noGps }); S.dirty[id] = false; api.popTo('s7-2'); toast('게시물을 수정했어요'); }); return true; }
    if (id === 's8-2') { const inp = Q(id, 'input'); const nk = inp ? inp.value.trim() : ''; if (!nk) { toast('닉네임을 입력해 주세요'); return true; }
      const lv = ['초급', '중급', '상급'].find(x => { const n = tnodes(scr(id), x)[0]; return n && getComputedStyle(n.parentElement).backgroundColor.startsWith('rgb(167, 246, 236') || (n && getComputedStyle(n.parentElement).backgroundColor === 'rgb(141, 232, 219)'); }) || S.user.level;
      guard(btn, () => { S.user.nick = nk; S.user.level = lv; S.dirty[id] = false; api.popTo('s7-4b'); toast('프로필을 저장했어요'); }); return true; }
    return true;
  };

  /* ---------- clicks on non-link elements ---------- */
  const ACT = {
    recenter: () => { const i = Q(cur(), 'img[data-pan]'); if (i) { i.dataset.tx = 0; i.dataset.ty = 0; i.animate([{ transform: i.style.transform || 'none' }, { transform: 'translate(0,0)' }], { duration: 300 }); i.style.transform = 'translate(0px,0px)'; } toast('내 위치로 돌아왔어요'); },
    mclose: () => api.popTo(S.org.music || 's2-0'),
    retrySave: () => { const r = S.run.rec; if (!r) return; if (r.local === 'fail') doSave(r); else if (r.sync === 'pending') doSync(r); },
    retryRec: (b) => { const r = S.recs.find(x => x.id === b.dataset.rid); if (r && r.sync === 'pending') doSync(r); },
    coachVoice: () => { S.coachOff = !S.coachOff; paintCoach(cur()); toast(S.coachOff ? '코칭 음성을 껐어요 · 목표와 안내 페이스는 그대로예요' : '코칭 음성을 켰어요'); },
    bookRun: () => { const id = cur(); let cid = runCid(id); if (cid && /^new:/.test(cid)) cid = ensureCid(S.recSel); if (!cid) { toast('위치 기록이 없어 코스로 저장할 수 없어요'); return; } toggleCourse(cid); paintBookRun(id); },
    shareToggle: () => { S.share = !S.share; paintShare(cur()); },
    cmtSend: () => { const id = cur(), s = scr(id), inp = s.querySelector('[data-rw="cmt"]'), v = inp && inp.value.trim(); if (!v) { toast('댓글을 입력해 주세요'); inp && inp.focus(); return; }
      if (S.demo.cmtFail) { S.demo.cmtFail = false; refresh(); toast('댓글을 보내지 못했어요 · 입력은 그대로예요. 다시 보내 주세요'); return; }
      const n = tnodes(s, 'jiwoo.runs')[0]; let row = n && n.parentElement; while (row && !(row.style && row.style.padding === '12px 16px')) row = row.parentElement; if (!row) return;
      const c = row.cloneNode(true); c.setAttribute('data-rwi', 'cmt'); tnodes(c, '지').forEach(x => { x.nodeValue = '민'; }); tnodes(c, 'jiwoo.runs').forEach(x => { x.nodeValue = 'minjun.run'; }); tnodes(c, '32분').forEach(x => { x.nodeValue = '방금'; }); tnodes(c, '코칭 알림 진동으로 오나요?').forEach(x => { x.nodeValue = v; });
      const last = [...s.querySelectorAll('[data-rwi="cmt"]')].pop() || row; last.after(c); inp.value = ''; const sc = c.closest('[data-scroller]') || c.parentElement; if (sc) sc.scrollTop = sc.scrollHeight; toast('댓글을 달았어요'); },
    capMinus: () => { const e = Q(cur(), '[data-rwv="cap"]'); e.textContent = Math.max(2, (+e.textContent || 20) - 1); S.dirty[cur()] = true; },
    capPlus: () => { const e = Q(cur(), '[data-rwv="cap"]'); e.textContent = Math.min(200, (+e.textContent || 20) + 1); S.dirty[cur()] = true; },
    apApprove: (b) => { const k = b.dataset.who; const c = CREWS['남천 회복 조깅']; if (c.n >= c.cap) { toast('정원이 찼어요 · 정원을 늘린 뒤 승인할 수 있어요'); return; } S.ap[k] = 'approved'; c.n++; if (k === 'me') { S.crewJoin['남천 회복 조깅'] = 'member'; S.notes.unshift({ t: '‘남천 회복 조깅’ 가입이 승인됐어요 · 이제 크루 그룹런이 보여요', to: 's6-0' }); } paint('s6-ap'); toast((k === 'me' ? '민준' : '도윤') + '님을 승인했어요 · 알림을 보냈어요'); },
    apReject: (b) => { const k = b.dataset.who; sheet({ title: (k === 'me' ? '민준' : '도윤') + '님의 신청을 거절할까요?', body: '신청자에게 거절 알림이 가요. 다른 크루에는 계속 신청할 수 있어요.', actions: [{ label: '거절하기', kind: 'danger', fn: () => { S.ap[k] = 'rejected'; if (k === 'me') { S.crewJoin['남천 회복 조깅'] = 'none'; S.notes.unshift({ t: '‘남천 회복 조깅’ 가입 신청이 거절됐어요 · 다른 크루를 둘러보세요', to: 's6-1' }); } paint('s6-ap'); toast('거절했어요'); } }, { label: '취소' }] }); }
  };
  const TXT = {
    's9-1b': [['다시 연결', () => { toast('휴대폰과 다시 연결하는 중…'); setTimeout(() => { api.replace('s9-1'); toast('휴대폰과 연결됐어요'); }, 1100); }], ['워치만', () => { S.watchOnly = true; api.nav('s9-2'); toast('워치에만 기록해요 · 연결되면 휴대폰으로 보내요'); }]],
    's9-4c': [['다시 시도', () => { S.watchOnly = false; S.demo.syncFail = false; api.replace('s9-4'); }]],
    's9-4b': [[/.*/, () => { api.reset('s4-5'); }]],
    's1-4': [[/^보기 ›$/, (e) => { sheet({ title: '약관 요약', body: '실제 서비스에서는 전문을 보여 줘요. 위치·건강 데이터는 코스 추천·준비도·페이스 전략에만 쓰고, 선택 항목은 설정에서 언제든 끌 수 있어요.', actions: [{ label: '확인', kind: 'pri' }] }); }],
      [/^전체 동의$/, () => { const all = !(S.onb.agree || []).every(Boolean); S.onb.agree = [all, all, all, all]; paintAgree(); }],
      [/^\[(필수|선택)\]/, (e) => { const t = norm(e.textContent); const i = AGREE.findIndex(x => t.startsWith(x)); if (i < 0) return false; S.onb.agree[i] = !S.onb.agree[i]; paintAgree(); }]],
    's6-9': [[/^(광안리해수욕장 입구|민락수변공원|삼익비치 앞)$/, (e) => { pickPlace(PLACES.find(p => p.name === norm(e.textContent))); }],
      [/장소·주소 검색/, () => searchPlace()]],
    's2-pn': [[/^민준 · |^.+ · (초급|중급|상급)$/, () => api.nav('s7-4b')]],
    's8-2': [[/^$/, (e) => { if (e.tagName === 'IMG' || e.querySelector && e.querySelector('svg')) { toast('사진을 바꿨어요 (시연 · 기본 사진 유지)'); S.dirty['s8-2'] = true; return true; } return false; }]]
  };
  const searchPlace = () => sheet({ title: '장소·주소 검색', body: '', actions: [{ label: '닫기' }], onOpen: (p) => {
    const inp = el("<input placeholder=\"예: 민락, 수영강\" style=\"height:48px;padding:0 16px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;font:400 15px 'Noto Sans KR',sans-serif;outline:none\">");
    const list = el('<div style="display:flex;flex-direction:column;gap:6px;min-height:120px"></div>');
    const draw = () => { const q = inp.value.trim(); list.innerHTML = ''; const r = PLACES.filter(x => !q || x.name.includes(q) || x.addr.includes(q)); if (!r.length) { list.innerHTML = '<div style="padding:16px 4px;font-size:13px;color:rgba(255,255,255,.6)">‘' + q + '’ 검색 결과가 없어요 · 다른 이름으로 찾아보세요</div>'; return; } r.forEach(x => { const b = el("<button style=\"text-align:left;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font:400 13px 'Noto Sans KR',sans-serif\"><b style=\"display:block;font-size:14px\">" + x.name + '</b><span style="color:rgba(255,255,255,.6)">' + x.addr + ' · ' + x.dist + '</span></button>'); b.__rwfn = () => { closeSheet(); pickPlace(x); }; list.appendChild(b); }); };
    inp.addEventListener('input', draw); const btn = p.querySelector('button'); p.insertBefore(inp, btn); p.insertBefore(list, btn); draw(); setTimeout(() => inp.focus(), 50); } });
  const click = (e) => {
    const t = e.target; const s = t.closest && t.closest('[data-screen-label]');
    for (let n = t; n && n !== document.body; n = n.parentElement) { if (n.__rwfn) { n.__rwfn(e); return true; } if (n === s) break; }
    const ac = t.closest && t.closest('[data-acct]'); if (ac) { setAcct(ac.getAttribute('data-acct') === 'priv'); return true; }
    const gm = t.closest && t.closest('[data-gmode]'); if (gm) { S.gmode = gm.getAttribute('data-gmode'); S.dirty['s6-8'] = true; paintGmode(); return true; }
    const fw = t.closest && t.closest('[data-follow]'); if (fw && cur() === 's7-4') { followTap(); return true; }
    if (t.closest && t.closest('[data-rwpol]')) { setTimeout(() => { const id = cur(); if (id === 's6-ap') { S.crewPol['남천 회복 조깅'] = polOf(id); paint(id); } }, 0); return false; }
    const a = t.closest && t.closest('[data-act]'); if (a && ACT[a.dataset.act]) { ACT[a.dataset.act](a); return true; }
    const R = TXT[cur()]; if (R && s) for (let n = t; n && n !== s; n = n.parentElement) { if (n.closest('a[href^="#s"],[data-goto]') && !R.some(r => r[0] instanceof RegExp && r[0].source === '.*')) break; const k = norm(n.textContent); for (const [pat, fn] of R) { if ((pat instanceof RegExp ? pat.test(k) : k === pat)) { if (fn(n) !== false) return true; } } }
    return false;
  };
  const input = (e) => {
    const t = e.target, s = t.closest && t.closest('[data-screen-label]'); if (!s || !s.classList.contains('pt-cur')) return; const id = cur();
    if (FORMS[id]) S.dirty[id] = true;
    if (t.matches('[data-rw="crewIntro"]')) V(id, 'introCnt', t.value.length + ' / 200');
    if (t.matches('[data-rw="crewName"]')) { t.style.borderColor = ''; V(id, 'crewNameHint', t.value.trim() ? '' : '필수'); }
    if (t.matches('[data-rw="crewq"]')) crewSearch(t.value.trim());
    if (id === 's1-3' && t.type === 'password') { const p = QA(id, 'input[type="password"]'); const ok = p[0].value === p[1].value && p[1].value; const m = T(id, '비밀번호가 일치하지 않아요', ok ? '✓ 비밀번호가 일치해요' : '비밀번호가 일치하지 않아요'); if (m) m.style.color = ok ? '#A7F6EC' : '#FF9E8A'; p[1].style.borderColor = ok ? '' : '#FF9E8A'; }
  };
  const crewSearch = (q) => {
    const id = 's6-1', s = scr(id); const cards = QA(id, 'a[href^="#s6-cr"]'); let n = 0;
    cards.forEach(c => { const ok = !q || c.textContent.includes(q); show(c, ok, ''); if (ok) n++; });
    let em = s.querySelector('[data-rwi="crewEmpty"]'); const first = cards[0];
    if (!em && first) { em = el('<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 12px;border-radius:22px;border:1px dashed rgba(255,255,255,.2);text-align:center"><span data-t="1" style="font-size:14px;font-weight:700"></span><span style="font-size:12px;color:rgba(255,255,255,.6)">지역 이름(광안리, 민락, 남천)으로도 찾을 수 있어요</span></div>'); em.setAttribute('data-rwi', 'crewEmpty'); const b = el("<button style=\"height:44px;padding:0 18px;border-radius:99px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;font:700 13px 'Noto Sans KR',sans-serif;cursor:pointer\">검색어 지우기</button>"); b.__rwfn = () => { const i = s.querySelector('[data-rw="crewq"]'); i.value = ''; crewSearch(''); }; em.appendChild(b); first.parentElement.insertBefore(em, first); }
    if (em) { em.querySelector('[data-t]').textContent = `‘${q}’와 맞는 크루가 없어요`; show(em, n === 0, 'flex'); }
  };

  /* ---------- demo branches (toolbar) ---------- */
  const B = (label, fn) => ({ label: '시연 · ' + label, go: () => { fn(); paint(cur()); refresh(); } });
  const branches = (id) => {
    const out = [];
    if (id === 's1-2') out.push(B(S.demo.loginFail ? '로그인 성공으로' : '로그인 실패로', () => { S.demo.loginFail = !S.demo.loginFail; }));
    if (id === 's1-7') out.push(B('연결 실패 상태 (1.8)', () => api.nav('s1-8')));
    if (['s2-0f', 's2-0', 's2-0n'].includes(id)) { if (S.gps !== 'ok') out.push(B('GPS 정상', () => { S.gps = 'ok'; })); if (S.gps !== 'waiting') out.push(B('GPS 수신 대기', () => { S.gps = 'waiting'; })); if (S.gps !== 'denied') out.push(B('위치 권한 거부', () => { S.gps = 'denied'; })); }
    if (id === 's4-2' || id === 's4-2n') { out.push(B(S.run.lost ? 'GPS 신호 회복' : '러닝 중 GPS 신호 상실', () => { S.run.lost = !S.run.lost; if (!S.run.lost) toast('신호가 돌아왔어요 · 거리를 이어서 기록해요'); })); out.push(B('목표 지점까지 건너뛰기', () => finishRun(true))); }
    if (id === 's4-3') { out.push(B(S.run.dist < 1 ? '거리 2.40km로' : '짧은 기록 0.6km로', () => { if (S.run.dist < 1) { S.run.dist = 2.4; S.run.time = 859; } else { S.run.dist = 0.6; S.run.time = 221; } })); }
    if (['s4-3', 's4-5', 's4-5f', 's4-2'].includes(id)) { out.push(B(S.demo.saveFail ? '전송 정상으로' : '휴대폰 저장 후 전송 실패', () => { S.demo.saveFail = !S.demo.saveFail; })); out.push(B(S.demo.localFail ? '휴대폰 저장 정상으로' : '휴대폰 저장 실패', () => { S.demo.localFail = !S.demo.localFail; })); }
    if (id === 's6-3' && S.g.ctx.key !== 'mine') { const RN = { member: '일반 멤버', crew: '크루장(이 그룹런 그룹장 아님)', leader: '이 그룹런 그룹장' }, NX = { member: 'crew', crew: 'leader', leader: 'member' }; out.push(B('역할 바꾸기 → ' + RN[NX[S.g.role]], () => { S.g.role = NX[S.g.role]; })); if (S.g.role !== 'leader') out.push(B('그룹장이 출발함 (이벤트)', () => { closeSheet(); groupGo(); })); }
    if (id === 's6-5b') out.push(B('1분 뒤 · 안내 페이스 변경 적용', () => { S.g.goalChanged = true; if (S.run.mode === 'group' && S.run.goalPace) S.run.guidePace = S.run.goalPace + 15; api.replace('s6-5'); }));
    if (id === 's6-5') { if (mem('es') && mem('es').st === 'run') out.push(B('은서 개인 종료 (이벤트)', () => { endMember(mem('es'), 2.1, 760); toast('은서님이 개인 운동을 종료했어요 · 그룹은 계속 진행돼요'); })); out.push(B(S.run.goalKm ? '완주 지점까지 건너뛰기 (출발한 멤버 모두)' : '출발한 멤버 모두 개인 종료 (이벤트)', () => { const g = S.run.goalKm, gp = S.run.guidePace || S.run.goalPace || 360, D = { me: g ? g + 0.02 : 4.21, sy: g ? g + 0.01 : 4.19, es: g ? g + 0.03 : 4.24 }; S.run.dist = D.me; S.run.time = Math.round(D.me * gp * 0.99); S.g.mem.forEach(m => { if (m.st === 'run') { const d = D[m.k] || D.me; endMember(m, d, m.me ? S.run.time : Math.round(d * gp * (m.k === 'sy' ? 0.975 : 1.005))); } }); S.run.active = false; autoEnd(); api.reset('s6-7'); })); }
    if (id === 's6-7' && S.g.state === 'run') out.push(B('남은 멤버 모두 개인 종료 → 자동 전체 종료', () => { S.g.mem.forEach(m => { if (m.st === 'run') endMember(m, S.run.goalKm ? S.run.goalKm + 0.02 : 4.2, 1795); }); autoEnd(); }));
    
    if (id === 's2-1' || id === 's2-1la') { const HS = ['ok', 'collect', 'stale', 'denied', 'none'], HN = { ok: '평가 가능', collect: '데이터 수집 중', stale: '오래된 데이터', denied: '권한 거부', none: '워치 미연결' }; const nx = HS[(HS.indexOf(hsOf()) + 1) % 5]; out.push(B('건강 데이터 상태 → ' + HN[nx], () => { S.hsDemo = nx; })); }
    if (id === 's3-1') out.push(B(!S.demo.rec ? '다음 추천: 결과 없음' : S.demo.rec === 'empty' ? '다음 추천: 불러오기 실패' : '다음 추천: 정상', () => { S.demo.rec = !S.demo.rec ? 'empty' : S.demo.rec === 'empty' ? 'fail' : null; }));
    if (id === 's2-0' || id === 's2-0n') out.push(B(S.atStart ? '출발점에서 떨어진 위치로' : '출발점 도착', () => { S.atStart = !S.atStart; }));
    if (id === 's6-2' || id === 's6-3') out.push(B(S.g.paceChg ? '예상 페이스 원래대로' : '참가자 변경 → 예상 페이스 바뀜 (이벤트)', () => { S.g.paceChg = !S.g.paceChg; }));
    if (['s4-2', 's4-2n', 's6-5'].includes(id) && S.run.active) out.push(B('앱 종료 후 다시 열기', () => { closeSheet(); api.reset(S.run.mode === 'group' ? 's6-6c' : 's4-3'); toast('진행 중이던 기록을 일시정지 상태로 불러왔어요 · ' + S.run.dist.toFixed(2) + 'km (시연)'); }));
    if (id === 's6-2' && S.gd.key === 'mine') { const mr = S.myRuns.find(x => x.id === S.gd.rid); if (mr && !mr.cancelled) out.push(B(mr.soon ? '시간 되돌리기 · 대기방 열리기 전' : '시간 이동 · 출발 25분 전 (대기방 열림)', () => { mr.soon = !mr.soon; })); }
    if (id === 's7-4') { out.push(B(S.other.priv ? '상대 계정을 공개로' : '상대 계정을 비공개로', () => { S.other.priv = !S.other.priv; if (!S.other.priv && S.other.f === 'pending') { S.other.f = 'following'; toast('상대가 공개로 바꿔 요청이 자동 승인됐어요'); } })); if (S.other.f === 'pending') { out.push(B('상대가 요청 승인 (이벤트)', () => { S.other.f = 'following'; S.notes.unshift({ t: 'seoyun.run님이 팔로우 요청을 승인했어요', to: 's7-4' }); })); out.push(B('상대가 요청 거절 (이벤트)', () => { S.other.f = 'none'; })); } }
    if (['s7-4b', 's8-1', 's8-3'].includes(id) && S.acct.priv) out.push(B('팔로우 요청 2건 도착 (이벤트)', () => { const n = S.reqs.length; S.reqs.push({ id: 'q' + (n + 1), name: n ? 'runner_' + (n + 1) : 'jiwoo.runs', st: 'pending' }, { id: 'q' + (n + 2), name: n ? 'runner_' + (n + 2) : 'dohyun_r', st: 'pending' }); S.notes.unshift({ t: '팔로우 요청 2건이 도착했어요', to: 's7-4b' }); }));
    if (id === 's6-2b' || (id === 's6-0' && S.crewJoin['남천 회복 조깅'] === 'pending')) out.push(B('크루장 시점 · 남천 회복 조깅', () => { S.crewSel = '남천 회복 조깅'; api.nav('s6-ap'); }));
    if (id === 's6-ap' || id === 's6-crm') out.push(B('신청자(민준) 시점 · 알림으로', () => { S.crewSel = '남천 회복 조깅'; api.reset('s2-9'); }));
    if (id === 's7-2') out.push(B(S.post.owner === 'mine' ? '다른 사람 게시물로 보기' : '내 게시물로 보기', () => { S.post.owner = S.post.owner === 'mine' ? 'other' : 'mine'; if (S.post.owner === 'mine' && !S.myPosts.length) { S.myPost = Object.assign({}, S.myPost, { id: 'mp0', exists: true }); S.myPosts.push(S.myPost); } }), B(S.demo.cmtFail ? '댓글 전송 정상으로' : '댓글 전송 실패', () => { S.demo.cmtFail = !S.demo.cmtFail; }));
    if (FORMS[id]) out.push(B(S.demo.submitFail ? '제출 정상으로' : '다음 제출 실패', () => { S.demo.submitFail = !S.demo.submitFail; }));
    if (['s9-1', 's9-2', 's9-3', 's9-3b', 's9-4'].includes(id)) out.push(B(S.demo.syncFail ? '동기화 정상으로' : '동기화 실패', () => { S.demo.syncFail = !S.demo.syncFail; }));
    if (id === 's9-1') out.push(B('휴대폰 연결 끊김 (9.1b)', () => api.nav('s9-1b')));
    if (['s2-1', 's2-pn', 's2-1la'].includes(id)) { out.push(B('신규 · 휴대폰만 · 건강 데이터 미동의', () => { S.user = Object.assign(S.user, { isNew: true, watch: false, health: false }); newUserData(); api.reset('s2-pn'); })); out.push(B('신규 · 워치 · 건강 동의', () => { S.user = Object.assign(S.user, { isNew: true, watch: true, health: true }); newUserData(); api.reset('s2-pn'); })); out.push(B('기존 사용자', () => { S.user.isNew = false; S.user.watch = true; S.user.health = true; api.reset('s2-1'); })); }
    return out;
  };


  /* ---------- v13 ---------- */
  function memInit(mine) { if (mine) return [{ k: 'me', n: '민준', me: true, st: 'none', room: 'room' }]; return [{ k: 'sy', n: '성윤', st: 'none', room: 'ready' }, { k: 'me', n: '민준', me: true, st: 'none', room: 'room' }, { k: 'es', n: '은서', st: 'none', room: 'ready' }, { k: 'so', n: '서연', st: 'none', room: 'room' }, { k: 'dy', n: '도윤', st: 'none', room: 'out' }]; }
  function v13reset() {
    Object.assign(S, { recs: [], past: PAST.map(x => Object.assign({}, x)), myPosts: [], recSel: null, shareRec: null, coachOff: false, seq: 0, recC: [], alias: { c0: '광안대교 루프', c1: '민락수변 왕복', c2: '수영강 하천길', c3: '이기대 갈맷길' }, bookC: { c0: true, c1: true, c2: true, c3: true }, bookOrder: ['c0', 'c1', 'c2', 'c3'], hl: null, cgoal: null, cmp: { on: false, i: 0 }, bpm: { v: 168, st: 'auto' }, acct: { priv: false }, reqs: [], myFol: 86, other: { priv: false, f: 'none' }, myRuns: [], newCrews: [], gmode: 'course', log: [], cx: null });
    S.g.mem = memInit(); S.g.state = 'wait'; S.g.ctx = { key: 'today' }; S.g.session = null;
  }
  const mem = k => S.g.mem.find(m => m.k === k);
  const newUserData = () => Object.assign(S, { bookC: {}, bookOrder: [], alias: {}, log: [], recs: [], recC: [], course: 0 });
  const isLead = m => (S.g.role === 'leader' ? m.k === 'me' : m.k === 'sy');
  const grpTitle = () => COURSES[0].name;
  const logRun = () => { const r = S.run; if (r.logged) return; r.logged = true; S.log.push({ id: r.id, dist: r.dist, time: r.time, mode: r.mode, noGps: r.noGps }); S.user.runs = S.log.length; };
  const toggleCourse = (cid) => { if (!cid) return; const on = !S.bookC[cid]; S.bookC[cid] = on; if (on && !S.bookOrder.includes(cid)) S.bookOrder.unshift(cid); if (on) S.hl = cid; toast(on ? '내 코스에 저장했어요' : '저장을 해제했어요', on ? { label: '보기', fn: () => api.nav('s3-1c') } : null); };
  const runCid = (id) => { const r = S.run; if (id === 's5-2') { const x = S.recSel; if (!x || x.base) return 'c0'; if (x.noGps) return null; return x.cid || 'new:' + x.id; } if (r.noGps) return null; return r.mode === 'free' ? r.recCid : r.cid; };
  const paintBookRun = (id) => { const b = Q(id, '[data-act="bookRun"]'); if (!b) return; const cid = runCid(id), on = !!(cid && S.bookC[cid]); b.textContent = !cid ? '저장할 경로 없음' : on ? '✓ 내 코스에 저장됨' : '내 코스에 저장'; b.style.opacity = cid ? '' : '.5'; b.style.color = on ? '#A7F6EC' : '#fff'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  const aliasSheet = (cid) => { const co = ALLC().find(x => x.id === cid); if (!co) return; let inp; sheet({ title: '내 별명', body: '별명은 나에게만 보여요. 다른 사람에게는 ‘' + co.name + '’로 보여요.', onOpen: (p) => { inp = el("<input maxlength=\"20\" placeholder=\"예: 아침 회복 루프\" style=\"height:48px;padding:0 16px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;font:400 15px 'Noto Sans KR',sans-serif;outline:none\">"); inp.value = S.alias[cid] || ''; p.insertBefore(inp, p.querySelector('button')); setTimeout(() => inp.focus(), 50); }, actions: [
      { label: '저장', kind: 'pri', fn: () => { const v = inp.value.trim(); if (v) S.alias[cid] = v; else delete S.alias[cid]; paintRows(); toast(v ? '별명을 저장했어요 · 나에게만 보여요' : '별명을 지웠어요'); } },
      { label: '저장 해제', kind: 'danger', fn: () => { S.bookC[cid] = false; paintRows(); toast('내 코스에서 뺐어요 · 별명은 남겨 둬요'); } }, { label: '취소' }] }); };
  const compSheet = () => { const c = C(); if (!c.rec) { toast('이 코스는 아직 내 기록이 없어요 · 이번 러닝이 첫 기록이 돼요'); return; }
    sheet({ title: '비교할 기록', body: '고른 기록과 실시간으로 비교해요. 꺼도 운동은 그대로 시작할 수 있어요.', actions: [{ label: (S.cmp.on ? '' : '✓ ') + '비교 끄기', fn: () => { S.cmp.on = false; api.setDC({ cron: false }); paint(cur()); } }].concat(CR.map((x, i) => ({ label: (S.cmp.on && S.cmp.i === i ? '✓ ' : '') + x.date + (x.best ? ' · 최고' : '') + ' · ' + x.time + ' · ' + x.pace, fn: () => { S.cmp = { on: true, i }; api.setDC({ cron: true, cri: i }); paint(cur()); toast(x.date + ' 기록과 비교해요'); } }))).concat([{ label: '닫기' }]) }); };
  const prepRow = (id) => { const s = scr(id); if (!s) return; const dark = id === 's2-0n'; const e = once(s, 'prep', () => { const st = Q(id, 'a[href="#s4-2"]'); const row = st && st.parentElement; if (!row) return null; const w = el('<div style="display:flex;gap:8px;margin:0 0 10px"></div>'); const mk = () => { const b = document.createElement('button'); b.style.cssText = "flex:1;min-width:0;height:44px;padding:0 12px;border-radius:99px;font:700 12px 'Noto Sans KR',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;" + (dark ? 'border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff' : 'border:1px solid #D1D4E1;background:#fff;color:#191C27'); w.appendChild(b); return b; }; const a = mk(), b = mk(); a.setAttribute('data-k', 'cmp'); b.setAttribute('data-k', 'bk'); a.__rwfn = compSheet; b.__rwfn = () => { toggleCourse(C().id); prepRow(cur()); }; row.parentElement.insertBefore(w, row); return w; }); if (!e) return;
    const c = C(), on = !!S.bookC[c.id]; e.querySelector('[data-k="cmp"]').textContent = !c.rec ? '비교 기록 없음 · 첫 기록' : S.cmp.on ? '비교 · ' + CR[S.cmp.i].date + ' ' + CR[S.cmp.i].time : '비교 기록 · 꺼짐 ›'; e.querySelector('[data-k="bk"]').textContent = on ? '★ 내 코스에 저장됨' : '☆ 내 코스에 저장'; };
  const BPMS = { auto: '코칭 자동', manual: '수동 · 다음 코칭에 반영', applied: '다음 코칭에 반영됨', readj: '코칭이 다시 조절함' };
  const bpmPaint = () => document.querySelectorAll('[data-rwi="bpm"]').forEach(e => { e.querySelector('[data-v]').textContent = S.bpm.v; e.querySelector('[data-s]').textContent = BPMS[S.bpm.st]; e.style.display = S.music === 'none' ? 'none' : 'flex'; });
  const bpmStep = (d) => { S.bpm.v = Math.max(120, Math.min(200, S.bpm.v + d * 2)); S.bpm.st = 'manual'; bpmPaint(); toast('BPM ' + S.bpm.v + ' · 다음 코칭에 반영돼요'); };
  const coachTick = () => { if (S.bpm.st === 'manual') { S.bpm.st = 'applied'; toast('코칭이 수동 BPM ' + S.bpm.v + '을 반영했어요 · 목표는 그대로예요'); } else { S.bpm.v = Math.max(120, S.bpm.v - 4); S.bpm.st = 'readj'; toast('코칭에 따라 BPM을 ' + S.bpm.v + '으로 다시 조절했어요 · 목표는 그대로예요'); } bpmPaint(); };
  const bpmCtl = (id) => { return; const s = scr(id); if (!s) return; once(s, 'bpm', () => { const e = el("<div style=\"display:flex;align-items:center;gap:8px;padding:4px 4px 4px 14px;border-radius:99px;background:rgba(22,24,31,.82);border:1px solid rgba(255,255,255,.14);color:#fff;font:500 12px 'Noto Sans KR',sans-serif;backdrop-filter:blur(12px)\"><span style=\"font-weight:700\">BPM</span><b data-v=\"1\" style=\"font:400 18px Bahnschrift,'DIN Alternate',Barlow,sans-serif;color:#A7F6EC\"></b><span data-s=\"1\" style=\"flex:1;min-width:0;font-size:11px;color:rgba(255,255,255,.68);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\"></span></div>");
      ['−', '+'].forEach((t, i) => { const b = document.createElement('button'); b.textContent = t; b.setAttribute('aria-label', i ? 'BPM 올리기' : 'BPM 내리기'); b.style.cssText = "flex:none;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font:700 18px/1 'Noto Sans KR',sans-serif;cursor:pointer"; b.__rwfn = () => bpmStep(i ? 1 : -1); e.appendChild(b); });
      const mini = Q(id, '[aria-label="재생 제어"]'); const row = mini && mini.parentElement;
      if (/^s4-2|^s6-5$/.test(id) && row && row.parentElement) { e.style.margin = '0 0 8px'; row.parentElement.insertBefore(e, row); }
      else if (/^s4-3$|^s6-6c$/.test(id)) { lockLine(id); const anc = s.querySelector('[data-rwi="lock"]') || (s.__rw && s.__rw['2.40km · 평균 5′58″/km#0'] && s.__rw['2.40km · 평균 5′58″/km#0'].parentElement); e.style.margin = '12px 0 0'; e.style.alignSelf = 'stretch'; if (anc) anc.after(e); else s.appendChild(e); }
      else { if (row) row.after(e); else s.appendChild(e); }
      return e; }); bpmPaint(); };
  const lockLine = (id) => { return; const s = scr(id); if (!s || !/^s4-3$|^s6-6c$/.test(id)) return; const e = once(s, 'lock', () => { const n = s.__rw && s.__rw['2.40km · 평균 5′58″/km#0']; const p = n && n.parentElement; if (!p) return null; const x = el('<div style="font-size:12px;color:rgba(255,255,255,.62);text-align:center;margin-top:6px"></div>'); p.after(x); return x; }); if (e) e.textContent = goalLabel(S.run) + ' · 시작 후에는 일시정지 중에도 목표를 바꿀 수 없어요'; };
  const groupEndSheet = () => { const others = S.g.mem.filter(m => m.st === 'run' && m.k !== 'me').length; const acts = [{ label: '내 운동 종료', kind: 'pri', fn: endMe }];
    if (S.g.role === 'leader') acts.push({ label: '그룹 전체 강제 종료 · 그룹장', kind: 'danger', fn: () => sheet({ title: '그룹런 전체를 지금 끝낼까요?', body: '달리고 있는 ' + others + '명의 운동도 지금 시점 기록으로 종료돼요. 목표를 채우지 않은 기록은 완주로 바뀌지 않아요.', actions: [{ label: '전체 강제 종료', kind: 'danger', fn: forceEnd }, { label: '돌아가기', fn: groupEndSheet }] }) });
    acts.push({ label: '계속 달리기', fn: () => resume() });
    sheet({ title: '내 운동을 끝낼까요?', body: dK(S.run.dist) + 'km에서 끝내면 내 기록만 개인 종료돼요. ' + (others ? '달리고 있는 ' + others + '명은 계속 달리고, 마지막 사람이 끝나면 그룹런이 자동으로 종료돼요.' : '내가 마지막 주자라 그룹런도 자동으로 종료돼요.'), actions: acts }); };
  const autoEnd = () => { if (S.g.state === 'run' && !S.g.mem.some(m => m.st === 'run')) S.g.state = 'end'; };
  const endMember = (m, d, t) => { const g = S.g.session ? S.g.session.km : 5; m.st = 'end'; m.dist = d; m.time = t; m.ach = g ? d >= g - 0.05 : null; };
  const endMe = () => { const me = mem('me'); endMember(me, S.run.dist, S.run.time); S.run.active = false; S.run.achieved = me.ach; autoEnd(); api.reset('s6-7'); };
  const forceEnd = () => { const me = mem('me'); if (me.st === 'run') endMember(me, S.run.dist, S.run.time); S.g.mem.forEach(m => { if (m.st === 'run') { endMember(m, m.k === 'sy' ? 2.62 : 2.31, m.k === 'sy' ? 921 : 866); m.forced = true; } }); S.run.active = false; S.g.state = 'forced'; api.reset('s6-7'); };
  const DEMO_MEM = () => [{ k: 'sy', n: '성윤', st: 'end', dist: 5.02, time: 1752, ach: true }, { k: 'me', n: '민준', me: true, st: 'end', dist: 5.03, time: 1781, ach: true }, { k: 'es', n: '은서', st: 'end', dist: 3.8, time: 1402, ach: false }, { k: 'so', n: '서연', st: 'none' }, { k: 'dy', n: '도윤', st: 'none' }];
  const paintGroupResult = () => { const id = 's6-7', s = scr(id); if (!s) return; const live = S.g.state !== 'wait'; const M = live ? S.g.mem : DEMO_MEM(), st = live ? S.g.state : 'end';
    const ss = live ? S.g.session : null, gk = ss ? ss.km : 5; T(id, '광안리 새벽런', ss ? ss.title : null); const started = M.filter(m => m.st !== 'none'), running = M.filter(m => m.st === 'run'), done = started.filter(m => m.dist != null), me = M.find(m => m.me), fin = st !== 'run';
    T(id, '4명 중 3명', st === 'run' ? running.length + '명이 아직' : st === 'forced' ? '그룹장이 그룹런을' : gk ? '출발한 ' + started.length + '명 중 ' + started.filter(m => m.ach).length + '명이' : '출발한 ' + started.length + '명이');
    T(id, '완주했어요', st === 'run' ? '달리고 있어요' : st === 'forced' ? '강제 종료했어요' : gk ? '목표를 완주했어요' : '모두 개인 종료했어요');
    T(id, '5.0', fin && done.length ? Math.max(...done.map(m => m.dist)).toFixed(1) : '–'); const td = done.reduce((a, m) => a + m.dist, 0), tt = done.reduce((a, m) => a + m.time, 0); T(id, '5′59″', fin && td ? fmtP(tt / td) : '–'); T(id, '180', fin ? '180' : '–');
    T(id, '함께 달린 거리', fin ? null : '함께 달린 거리 · 집계 중'); T(id, '완주 현황', '멤버 현황'); { const ln = T(id, '이번 내 기록은 내 기록 › 그룹런 탭에 남아요', null); if (ln) ln.style.display = me && me.dist != null ? '' : 'none'; } T(id, '내 기록 29:41', me && me.dist != null ? '내 기록 ' + dK(me.dist) + 'km · ' + fmtT(me.time) : '내 기록 없음');
    const n = tnodes(s, '멤버 현황')[0]; let hd = n && n.parentElement; while (hd && hd.parentElement && !hd.parentElement.textContent.includes('성윤')) hd = hd.parentElement; const host = hd && hd.parentElement; if (!host) return;
    [...host.children].forEach(c => { if (c !== hd && !c.hasAttribute('data-rwi')) c.style.display = 'none'; }); host.querySelectorAll('[data-rwi="mrow"],[data-rwi="gst"]').forEach(e => e.remove());
    const gst = el('<div style="margin:0 0 6px;padding:8px 12px;border-radius:12px;font-size:12px;font-weight:700"></div>'); gst.setAttribute('data-rwi', 'gst'); gst.textContent = (st === 'run' ? '그룹 진행 중 · 통계는 모두 끝나면 확정돼요' : st === 'forced' ? '그룹 전체 강제 종료 · 그 시점까지의 기록만 반영' : '그룹 전체 종료 · 출발한 모든 멤버가 끝나 자동 종료') + (ss ? ' · ' + (ss.km ? '목표 ' + ss.km.toFixed(1) + 'km' : '코스 없음') + ' · 출발 공동 페이스 ' + fmtP(ss.pace) : '') + ' · 아래는 종료·기록 순 정렬이며 순위가 아니에요'; gst.style.background = st === 'run' ? 'rgba(167,246,236,.12)' : st === 'forced' ? 'rgba(255,158,138,.14)' : 'rgba(255,255,255,.08)'; gst.style.color = st === 'forced' ? '#FF9E8A' : '#A7F6EC'; hd.after(gst);
    const ord = M.slice().sort((a, b) => ({ end: 0, run: 1, none: 2 })[a.st] - ({ end: 0, run: 1, none: 2 })[b.st] || (b.ach ? 1 : 0) - (a.ach ? 1 : 0) || (a.time || 0) - (b.time || 0)); let prev = gst;
    ord.forEach(m => { const lead = live ? isLead(m) : m.k === 'sy'; const stt = m.st === 'none' ? '미출발 · 집계 제외' : m.st === 'run' ? '달리는 중' : (m.forced ? '강제 종료 시점 기록' : '개인 종료') + (m.ach === null ? ' · 목표 없음' : m.ach ? ' · 목표 완주 ✓' : ' · 목표 미달성');
      const r = el("<div style=\"display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)\"><span style=\"flex:1;min-width:0;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:" + (m.me ? 700 : 400) + "\">" + m.n + (m.me ? '<span style="padding:1px 7px;border-radius:99px;background:#A7F6EC;color:#191C27;font-size:10px;font-weight:700">나</span>' : '') + (lead ? '<span style="font-size:10px;color:#A7F6EC">그룹장</span>' : '') + "</span><span style=\"display:flex;flex-direction:column;align-items:flex-end;gap:2px\"><span style=\"font:400 14px Bahnschrift,'DIN Alternate',Barlow,sans-serif;color:" + (m.st === 'none' ? 'rgba(255,255,255,.4)' : '#fff') + "\">" + (m.dist != null ? dK(m.dist) + 'km · ' + fmtT(m.time) : '–') + "</span><span style=\"font-size:10px;color:" + (m.ach ? '#A7F6EC' : 'rgba(255,255,255,.58)') + "\">" + stt + "</span></span></div>");
      r.setAttribute('data-rwi', 'mrow'); prev.after(r); prev = r; }); };
  const paintCancel = (id) => { const run = S.myRuns.find(x => x.id === S.cx); const rT = run ? run.title : '토요일 아침, 함께 5km', rW = run ? run.when : '10.25 토 07:00', rP = run ? run.place.name : '광안리해수욕장 입구', n = run ? run.n : 6;
    T(id, '토요일 아침, 함께 5km', rT); T(id, '10.25 토 07:00 · 광안리해수욕장 입구', rW + ' · ' + rP);
    T(id, '참가자 6명과 크루 멤버에게 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.', '참가자 ' + n + '명에게 그룹런 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.');
    T(id, '10.25 토 07:00 ‘토요일 아침, 함께 5km’가 취소되고, 크루 멤버 18명에게 바로 알림이 가요.', rW + ' ‘' + rT + '’가 취소되고, 참가자 ' + n + '명에게 그룹런 취소 알림이 가요. 개인의 참가 취소와는 다른 일정 자체 취소예요.');
    if (id === 's6-4e') { T(id, '10.25 토 07:00', rW); T(id, '광안리해수욕장 입구', rP); T(id, '크루 멤버 18명에게 취소 알림을 보냈어요', '참가자 ' + n + '명에게 그룹런 취소 알림을 보냈어요'); const s = scr(id); const a = tnodes(s, '비 예보가 있어 이번 주는 쉬어요. 다음 주에 다시 열게요.')[0]; let b = a && a.parentElement; while (b && !b.textContent.includes('크루장')) b = b.parentElement; if (b) b.style.display = 'none'; } };
  const paintGmode = () => { const id = 's6-8', ch = QA(id, '[data-gmode]'); if (ch.length < 2) return; if (ch[0].__o == null) { ch[0].__o = ch[0].style.cssText; ch[1].__o = ch[1].style.cssText; } const free = S.gmode === 'free'; ch[0].style.cssText = free ? ch[1].__o : ch[0].__o; ch[1].style.cssText = free ? ch[0].__o : ch[1].__o;
    const lk = Q(id, 'a[href="#s3-1c"]'); show(lk, !free, 'flex'); const s = scr(id); const h = once(s, 'gfree', () => { if (!lk) return null; const x = el('<div style="font-size:12px;line-height:1.5;color:rgba(255,255,255,.72)">코스 없이 만나는 곳에서 함께 출발해요 · 공동 페이스는 참가자 기록으로 자동 안내돼요</div>'); lk.after(x); return x; }); show(h, free, 'block'); };
  const acctChips = (id) => QA(id, '[data-acct]');
  const paintAcct = (id) => { const ch = acctChips(id); if (ch.length < 2) return; if (ch[0].__o == null) { ch[0].__o = ch[0].style.cssText; ch[1].__o = ch[1].style.cssText; } const p = S.acct.priv; ch[0].style.cssText = p ? ch[1].__o : ch[0].__o; ch[1].style.cssText = p ? ch[0].__o : ch[1].__o; ch.forEach(c => { c.style.cursor = 'pointer'; }); };
  const setAcct = (priv) => { if (S.acct.priv === priv) return; if (!priv) { const p = S.reqs.filter(r => r.st === 'pending'); p.forEach(r => { r.st = 'approved'; S.myFol++; }); toast(p.length ? '공개 계정으로 바꿨어요 · 대기 중이던 팔로우 요청 ' + p.length + '건을 자동 승인했어요' : '공개 계정으로 바꿨어요 · 누구나 내 게시물을 볼 수 있어요'); } else toast('비공개 계정으로 바꿨어요 · 승인한 팔로워만 내 게시물을 볼 수 있어요'); S.acct.priv = priv; paintAcct(cur()); };
  const reqSheet = () => { const P = S.reqs.filter(r => r.st === 'pending'); sheet({ title: '팔로우 요청', body: P.length ? '승인하면 맞팔로우 없이도 내 게시물을 볼 수 있어요.' : '대기 중인 요청이 없어요.', onOpen: (p) => { const btn = p.querySelector('button'); P.forEach(r => { const row = el("<div style=\"display:flex;align-items:center;gap:8px;padding:8px 4px\"><b style=\"flex:1;font-size:14px\">" + r.name + "</b></div>"); [['승인', '#A7F6EC', '#191C27', 'approved'], ['거절', 'transparent', '#fff', 'rejected']].forEach(([l, bg, fg, v]) => { const b = document.createElement('button'); b.textContent = l; b.style.cssText = "height:40px;padding:0 16px;border-radius:99px;border:1px solid rgba(255,255,255,.25);background:" + bg + ";color:" + fg + ";font:700 13px 'Noto Sans KR',sans-serif;cursor:pointer"; b.__rwfn = () => { if (r.st !== 'pending') return; r.st = v; if (v === 'approved') S.myFol++; paint('s7-4b'); toast(v === 'approved' ? r.name + '님을 승인했어요 · 승인 알림이 가요' : r.name + '님의 요청을 거절했어요'); reqSheet(); }; row.appendChild(b); }); p.insertBefore(row, btn); }); }, actions: [{ label: '닫기' }] }); };
  const paintMe = () => { const id = 's7-4b', s = scr(id); if (!s) return; V(id, 'myFol', String(S.myFol)); const P = S.reqs.filter(r => r.st === 'pending').length;
    const e = once(s, 'reqs', () => { const f = Q(id, '[data-rwv="myFol"]'); const g = f && f.parentElement && f.parentElement.parentElement; if (!g) return null; const b = el("<button style=\"flex:none;display:flex;align-items:center;gap:8px;height:44px;margin:4px 0;padding:0 16px;border-radius:99px;border:1px solid rgba(255,255,255,.2);background:rgba(22,24,31,.6);color:#fff;font:700 13px 'Noto Sans KR',sans-serif;cursor:pointer\"></button>"); b.__rwfn = reqSheet; g.after(b); return b; });
    if (e) { e.innerHTML = (S.acct.priv ? '<span style="font-size:11px;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.12)">비공개 계정</span>' : '<span style="font-size:11px;padding:2px 8px;border-radius:99px;background:rgba(167,246,236,.16);color:#A7F6EC">공개 계정</span>') + '<span style="flex:1;text-align:left">팔로우 요청</span><b style="color:#A7F6EC">' + P + '건 ›</b>'; } };
  const paintOther = () => { const id = 's7-4', s = scr(id); if (!s) return; const b = Q(id, '[data-follow]'), f = S.other.f; if (b) { b.textContent = f === 'following' ? '팔로잉' : f === 'pending' ? '요청됨' : (S.other.priv ? '팔로우 요청' : '팔로우'); b.setAttribute('data-on', f === 'following' ? '1' : '0'); const on = f !== 'none'; b.style.background = on ? 'rgba(255,255,255,.1)' : '#A7F6EC'; b.style.color = on ? '#fff' : '#191C27'; b.style.border = on ? '1px solid rgba(255,255,255,.3)' : '0'; }
    const sc = s.querySelector('[data-scroller]'); if (!sc || !b) return; let top = b; while (top && top.parentElement !== sc) top = top.parentElement; if (!top) return; let n = top.nextElementSibling; const lk = otherLocked(); while (n) { if (!n.hasAttribute('data-rwi')) n.style.display = lk ? 'none' : ''; n = n.nextElementSibling; }
    lockCard(s, 'olock', lk, top, f === 'pending' ? '팔로우 요청을 보냈어요 · seoyun.run 님이 승인하면 공유한 러닝을 볼 수 있어요' : '승인된 팔로워만 공유한 러닝을 볼 수 있어요 · 팔로우 요청을 보내 보세요'); };
  const followTap = () => { const o = S.other; if (o.f === 'none') { o.f = o.priv ? 'pending' : 'following'; toast(o.priv ? '팔로우 요청을 보냈어요 · 승인되면 게시물을 볼 수 있어요' : '팔로우했어요'); paintOther(); return; }
    sheet({ title: o.f === 'pending' ? '팔로우 요청을 취소할까요?' : '팔로우를 취소할까요?', body: o.priv ? '비공개 계정이라 다시 보려면 요청을 다시 보내야 해요.' : '언제든 다시 팔로우할 수 있어요.', actions: [{ label: o.f === 'pending' ? '요청 취소' : '팔로우 취소', kind: 'danger', fn: () => { o.f = 'none'; paintOther(); toast(o.priv ? '요청을 취소했어요' : '팔로우를 취소했어요'); } }, { label: '돌아가기' }] }); };
  const TODAY = { date: '10.23', day: '금', clock: '12:00' };
  const recStatus = r => r.goalKm ? (r.achieved ? '목표 완주' : '목표 미달성') : r.goalPace ? '페이스 목표만' : '목표 없음';
  const recSt = r => (r.today ? '개인 종료 · ' : '') + recStatus(r);
  const recGoal = r => r.goalKm ? (r.achieved ? '목표 ' + r.goalKm.toFixed(1) + 'km 완주' : '목표 ' + r.goalKm.toFixed(1) + 'km 중 ' + dK(r.dist) + 'km') : '목표 없이 달린 기록';
  const mkRec = (r) => { const c = ALLC().find(x => x.id === (r.mode === 'free' ? r.recCid : r.cid)); return { id: r.id, today: true, date: TODAY.date, day: TODAY.day, clock: TODAY.clock, name: r.mode === 'free' ? '자유 러닝' : CN(c || COURSES[0]), pub: r.mode === 'free' ? (c ? c.name : '자유 러닝') : (c || COURSES[0]).name, cid: r.noGps ? null : (r.mode === 'free' ? r.recCid : r.cid), mode: r.mode, dist: r.dist, time: r.time, goalKm: r.goalKm, goalPace: r.goalPace, achieved: r.achieved, noGps: !!r.noGps, hr: !!S.user.watch, hrAvg: 158, cad: 170, local: 'new', sync: 'none' }; };
  const recOfRow = (a) => { const t = norm(a.textContent); return S.past.find(p => !p.base && t.includes(p.name) && t.includes(p.date) && t.includes(dK(p.dist))) || null; };
  const ensureCid = (r) => { if (!r || r.noGps) return null; if (r.cid) return r.cid; const rc = { id: 'r' + r.id, name: r.pub, km: r.dist, min: Math.max(1, Math.round(r.time / 60)), rec: true, kind: '내가 달린 경로', env: '—', elev: '', bars: COURSES[0].bars, why: '', mine: true, mapSrc: '' }; rc.meta = rc.km.toFixed(2) + 'km · ' + rc.min + '분'; Object.defineProperty(rc, 'map', { get: () => COURSES[0].map }); S.recC.push(rc); r.cid = rc.id; return rc.id; };
  const openAt = (mr) => { const d = new Date((mr.dt || 0) - 30 * 60000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const planOf = (key, rid) => { const mr = key === 'mine' ? S.myRuns.find(x => x.id === rid) : null, df = GDEF[key] || GDEF.d4; const cid = mr ? (mr.mode === 'free' ? null : mr.cid) : df.cid; const c = cid ? ALLC().find(x => x.id === cid) : null; const pace = 360 + (S.g.paceChg ? 10 : 0), km = c ? c.km : null; return { key, rid, title: mr ? mr.title : df.title, mode: c ? 'course' : 'free', cid: c ? c.id : null, km, pace, sec: km ? Math.round(km * pace) : null }; };
  const paint51 = () => { const s = scr('s5-1'); if (!s) return; s.querySelectorAll('[data-rwi="recs"]').forEach(e => e.remove()); const first = [...s.querySelectorAll('a[href="#s5-2"]')].find(x => !x.closest('[data-rwi]')); if (!first) return; const card = first.parentElement, head = card.previousElementSibling; const L = S.recs.filter(r => r.local === 'ok'); if (!L.length || !head) return;
    const h2 = head.cloneNode(true); h2.textContent = '오늘'; h2.setAttribute('data-rwi', 'recs'); const c2 = card.cloneNode(false); c2.setAttribute('data-rwi', 'recs');
    L.forEach((r, i) => { const a = first.cloneNode(true); a.setAttribute('data-rwrec', r.id); if (i) a.style.borderTop = '1px solid rgba(255,255,255,.08)'; const rp = (x, y) => tnodes(a, x).forEach(n => { n.nodeValue = n.nodeValue.replace(x, y); });
      rp('민락수변공원 출발', r.name); rp('10.15 수 · 29:41', '오늘 · ' + fmtT(r.time)); rp('5.02', dK(r.dist)); rp('5′55″', pcOf(r));
      if (r.sync === 'pending' || r.sync === 'sending') { const b = el("<button data-act=\"retryRec\" style=\"flex:none;height:30px;padding:0 10px;border:0;border-radius:99px;background:#FF9E8A;color:#191C27;font:700 11px 'Noto Sans KR',sans-serif;cursor:pointer\"></button>"); b.dataset.rid = r.id; b.textContent = r.sync === 'sending' ? '보내는 중…' : '전송 대기 · 다시 보내기'; a.insertBefore(b, a.lastElementChild); }
      c2.appendChild(a); });
    head.before(h2); head.before(c2); };
  const paint52 = () => { const id = 's5-2', r = S.recSel, b = !r || r.base, s = scr(id);
    T(id, '5.02', b ? null : dK(r.dist)); T(id, '29:41', b ? null : fmtT(r.time)); T(id, '5′55″/km', b ? null : pcOf(r) + '/km');
    T(id, '목표 30:00 달성 · 19초 단축', b ? null : recGoal(r) + (r.today ? ' · 개인 종료' : '')); T(id, '10.19 일 러닝', b ? null : r.today ? '오늘 러닝' : r.date + ' ' + r.day + ' 러닝');
    const hr = b || r.hr; T(id, '3km에서 빨라져 심박이 올랐어요. 다음엔 3km를 5초만 늦춰 보세요.', hr ? null : '3km에서 페이스가 빨라졌어요. 다음엔 3km를 5초만 늦춰 보세요.');
    if (s) [...s.querySelectorAll('span')].filter(e => !e.children.length && /심박|케이던스/.test(e.textContent) && e.parentElement && e.parentElement.style.gridTemplateColumns).forEach(e => show(e, hr, ''));
    const rs = routeSvg(s); if (rs) rs.style.visibility = !b && r.noGps ? 'hidden' : ''; paintBookRun(id); };
  const paintGrun = (id) => { const r = S.run; if (r.mode !== 'group' || !r.id) return; const s = scr(id), goal = r.goalPace, gd = r.guidePace || goal, chg = gd !== goal, runners = S.g.mem.filter(m => m.st === 'run'); const c = r.cid ? ALLC().find(x => x.id === r.cid) : null;
    T(id, '민락수변공원 출발 5.0km · 그룹런 4명', (c ? CN(c) : '자유 러닝 · 코스 없음') + ' · ' + runners.length + '명 달리는 중');
    T(id, '공동 목표 6′00″', chg ? '지금 안내 ' + fmtP(gd) + ' · 출발 목표 ' + fmtP(goal) : '공동 목표 ' + fmtP(goal)); T(id, '느림 6′20″', '느림 ' + fmtP(gd + 20)); T(id, '빠름 5′40″', '빠름 ' + fmtP(gd - 20));
    if (id === 's6-5b') T(id, '6′15″', fmtP(goal + 15));
    T(id, '그룹 범위 안이에요 · 선두–후미', runners.length < 2 ? '함께 달리는 멤버가 없어요' : null); T(id, '180m', runners.length < 2 ? '' : null);
    const img = Q(id, 'img[data-pan]'); if (img) { if (img.__o == null) img.__o = img.getAttribute('src'); const fi = Q('s2-0f', 'img[data-pan]') || Q('s2-0f', 'img'); img.src = !c ? (fi ? fi.src : img.__o) : c.id === 'c0' ? img.__o : c.map; }
    if (id === 's6-6r') { const vis = []; ['성윤', '민준', '서연', '은서'].forEach(n => { const row = rowOf(s, n, '11px'); const m = S.g.mem.find(x => x.n === n); const on = !!(m && m.st === 'run'); show(row, on, 'flex'); if (row && on) vis.push(row); }); vis.forEach((row, i) => { const lb = row.firstElementChild; if (lb) lb.textContent = vis.length < 2 ? '' : i === 0 ? '선두' : i === vis.length - 1 ? '후미' : ''; }); } };
  const paintWatch = (id) => { const r = S.run; if (!r.id) return; const grp = r.mode === 'group', c = r.cid ? ALLC().find(x => x.id === r.cid) : null, gd = r.guidePace || r.goalPace, base = c ? c.name.replace(/ [\d.]+km$/, '') : '자유 러닝';
    if (id === 's9-1') { T(id, '민락수변공원 출발', grp ? '그룹런 · ' + base : base); T(id, '5.0km', r.goalKm ? r.goalKm.toFixed(1) + 'km' : '거리 목표 없음'); T(id, '목표 30:00 · 5′59″ · ♪172', (r.goalSec ? '목표 ' + fmtT(r.goalSec) + ' · ' : '') + (r.goalPace ? (grp ? '공동 ' : '') + fmtP(r.goalPace) : '목표 페이스 없음') + ' · ♪172'); }
    if (id === 's9-2' && gd) T(id, '안내 5′58″', '안내 ' + fmtP(gd));
    if (grp && id === 's9-7') { T(id, '5′40″', fmtP(gd)); T(id, '내 5′42″ · +2″', '내 ' + fmtP(gd + 2) + ' · +2″'); T(id, '공동 목표 30:00 · 예상 29:50', r.goalSec ? '출발 목표 ' + fmtT(r.goalSec) + ' · ' + fmtP(r.goalPace) : '출발 공동 페이스 ' + fmtP(r.goalPace) + ' · 코스 없음'); }
    if (grp && id === 's9-2c') { T(id, '5′40″', fmtP(r.goalPace)); T(id, '5′55″', fmtP(r.goalPace + 15)); }
    if (grp && id === 's9-8') { const run = S.g.mem.filter(m => m.st === 'run'), i = Math.max(0, run.findIndex(m => m.me)); T(id, '앞 2명', '앞 ' + i + '명'); T(id, '뒤 4명', '뒤 ' + Math.max(0, run.length - i - 1) + '명'); } };
  const paintCoach = (id) => { const s = scr(id); if (!s) return; s.querySelectorAll('[data-act="coachVoice"]').forEach(t => { const on = !S.coachOff; t.setAttribute('aria-checked', String(on)); t.style.background = on ? '#A7F6EC' : 'rgba(255,255,255,.18)'; const k = t.firstElementChild; if (k) { k.style.right = on ? '3px' : ''; k.style.left = on ? '' : '3px'; k.style.background = on ? '#191C27' : '#fff'; } }); };
  const route13 = (href, a, id, txt, to) => {
    if (id === 's3-1' && to === 's3-1b') { const w = Q(id, '[data-tmode]'), rg = Q(id, '[data-distrange]'); const km = rg ? parseFloat(rg.value) || 5 : 5; if (w) S.cgoal = { pace: w.dataset.tmode === 'time' ? (+w.dataset.tsec) / km : +w.dataset.psec, mode: w.dataset.tmode, km }; }
    if (id === 's3-1c' && a.hasAttribute('data-rwcid')) { S.course = Math.max(0, ALLC().findIndex(x => x.id === a.getAttribute('data-rwcid'))); chooseCourse(); return true; }
    if (to === 's6-crm' && a.hasAttribute('data-rwnewcrew')) S.crewSel = a.getAttribute('data-rwnewcrew');
    if (to === 's6-2' && a.hasAttribute('data-rwmine')) { S.gd.key = 'mine'; S.gd.rid = a.getAttribute('data-rwmine'); api.nav('s6-2'); return true; }
    if (id === 's6-2' && to === 's6-4c') S.cx = S.gd.key === 'mine' ? S.gd.rid : null;
    return undefined;
  };

  window.RWFlow = {
    COURSES,
    bind: (a) => { api = a; window.__rwApi = a; },
    reset: () => { reset(); closeSheet(); },
    chooseCourse: () => api && chooseCourse(),
    pickCourse: (i) => { S.course = Math.max(0, Math.min(COURSES.length - 1, i)); },
    enter: (...x) => api ? enter(...x) : undefined,
    route: (...x) => api ? route(...x) : undefined,
    click: (...x) => api ? click(...x) : false,
    input, branches: (id) => api ? branches(id) : [],
    onSaveEnter: () => { if (S.run.rec && S.run.rec.local === 'new') doSave(S.run.rec); },
    state: () => S
  };
  document.addEventListener('input', input, true);
})();
