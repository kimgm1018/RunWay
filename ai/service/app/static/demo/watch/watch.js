/* 767 시연용 워치 화면: 콘솔과 같은 토큰·SSE로 실제 워치 앱 화면(9.2·9.5·9.7·9.8·9.2-4)을 그린다.
 * 그림 규칙은 wear/app/.../ui(component/Face.kt, Parts.kt, Controls.kt)를 그대로 옮겼다. 누르는 동작은 없다. */
(function (root) {
  'use strict';
  var W = root.RunwayWatchLogic;
  var NS = 'http://www.w3.org/2000/svg';
  var DESIGN = 454, C = DESIGN / 2, RIM_R = 208, SPAN = 56;
  var QUADRANT_START = [-78, 22, 102, 202];       // tl, tr, br, bl (Face.kt)
  var CHANGE_HOLD_MS = 10000;
  var PAGE_PARAM = {status: 'status', pace: 'pace', coaching: 'pace', heart: 'heart', position: 'position'};

  var state = {view: null, traces: 0, routes: [], course: null, standing: null, tracker: null, page: 'status',
    pinned: null, rotateAt: 0, noticeUntil: 0, lastNotice: null, mode: null, runner: 0, stream: null};

  function byId(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function svg(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function pt(r, deg) { var a = deg * Math.PI / 180; return [C + r * Math.sin(a), C - r * Math.cos(a)]; }
  function u(n) { return 'calc(' + n + ' * var(--u))'; }

  // ── 원 그림(Face.kt drawFace) ─────────────────────
  function drawArt(ticks, beatMs, pages, rimTl) {
    var art = byId('face-art');
    while (art.firstChild) art.removeChild(art.firstChild);
    // Line.copy(alpha = .10): copy는 알파를 곱하지 않고 바꾼다 → 흰색 10%
    svg('circle', {cx: C, cy: C, r: 190, fill: 'none', stroke: 'rgba(255,255,255,0.10)', 'stroke-width': 2}, art);
    if (ticks != null) {
      var g = svg('g', {class: 'ticks' + (beatMs ? ' beat' : '')}, art);
      if (beatMs) g.style.setProperty('--beat', beatMs + 'ms');
      for (var i = 0; i < 41; i++) {
        var p = pt(172, -130 + 260 * i / 40), on = i / 40 <= ticks;
        svg('circle', {cx: p[0], cy: p[1], r: on ? 2.5 : 2, fill: on ? 'rgba(77,196,255,0.8)' : 'rgba(255,255,255,0.14)', class: on ? 'on' : ''}, g);
      }
    }
    var values = [rimTl, null, null, null];        // tl = 목표 거리 진행만(나머지는 계약 없음 → 빈 트랙)
    for (var q = 0; q < 4; q++) {
      var s = QUADRANT_START[q];
      arc(art, s, SPAN, 'rgba(77,196,255,0.2)');
      var f = values[q];
      if (f != null && f > 0.001) {
        f = Math.min(1, f);
        arc(art, s, SPAN * f, 'rgba(77,196,255,0.85)');
        var k = pt(RIM_R, s + SPAN * f);
        svg('circle', {cx: k[0], cy: k[1], r: 8.5, fill: 'rgba(5,13,20,0.85)'}, art);
        svg('circle', {cx: k[0], cy: k[1], r: 7, fill: 'rgba(77,196,255,0.85)'}, art);
      }
    }
    sideIcons(art);
    if (pages && pages.count > 1) {
      for (var d = 0; d < pages.count; d++) {
        var dp = pt(RIM_R, (d - (pages.count - 1) / 2) * 7), cur = d === pages.current;
        svg('circle', {cx: dp[0], cy: dp[1], r: cur ? 6 : 4, fill: cur ? '#FFFFFF' : 'rgba(255,255,255,0.4)'}, art);
      }
    }
  }

  function arc(parent, startDeg, span, color) {
    var a = pt(RIM_R, startDeg), b = pt(RIM_R, startDeg + span);
    svg('path', {d: 'M' + a[0] + ' ' + a[1] + ' A' + RIM_R + ' ' + RIM_R + ' 0 0 1 ' + b[0] + ' ' + b[1],
      fill: 'none', stroke: color, 'stroke-width': 8, 'stroke-linecap': 'round'}, parent);
  }

  // 왼쪽 깃발·하트(오른쪽은 손잡이가 덮어 그리지 않는다)
  function sideIcons(art) {
    var k = 18 / 24;
    var flag = svg('g', {transform: 'translate(15 196) scale(' + k + ')'}, art);
    svg('path', {d: 'M6 21 L6 4 L17 4 L15 8 L17 12 L6 12', fill: 'none', stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'}, flag);
    var heart = svg('g', {transform: 'translate(15 240) scale(' + k + ')'}, art);
    svg('path', {d: 'M12 20 C12 20 4.5 15.5 4.5 9.8 C4.5 6.2 9.5 4.6 12 7.6 C14.5 4.6 19.5 6.2 19.5 9.8 C19.5 15.5 12 20 12 20 Z',
      fill: 'none', stroke: 'rgba(255,92,122,0.6)', 'stroke-width': 2, 'stroke-linejoin': 'round'}, heart);
  }

  // ── 글자 조각(Parts.kt) ──────────────────────────
  function hero(text, size, unit, dim) {
    var row = el('div', 'hero' + (dim || text.missing ? ' dim' : ''));
    var n = el('span', 'num', text.value); n.style.fontSize = u(size); row.appendChild(n);
    if (unit) { var t = el('span', 'unit', unit); t.style.paddingBottom = u(Math.floor(size / 10)); row.appendChild(t); }
    return row;
  }
  function inline(value, size, opts) {
    opts = opts || {};
    var row = el('div', 'inline');
    if (opts.symbol) { var s = el('span', 'sym' + (opts.symbol === '♥' ? ' heart' : ''), opts.symbol + '︎'); s.style.fontSize = u(Math.floor(size * 3 / 4)); row.appendChild(s); }
    var n = el('span', 'num' + (opts.missing ? ' dim' : ''), value); n.style.fontSize = u(size);
    if (opts.color) n.style.color = opts.color;
    row.appendChild(n);
    if (opts.unit) { var t = el('span', 'unit', opts.unit); t.style.fontSize = u(Math.floor(size * 2 / 3)); row.appendChild(t); }
    return row;
  }
  function labeled(label, value, size) {
    var row = el('div', 'labeled');
    row.appendChild(el('span', 'cap', label));
    row.appendChild(inline(value.value, size, {missing: value.missing}));
    return row;
  }
  function cell(value, label, dim) {
    var c = el('div', 'cell');
    var n = el('span', 'num' + (dim ? ' dim' : ''), value); c.appendChild(n);
    c.appendChild(el('span', 'label', label));
    return c;
  }
  function message(box, caption, title, body) {
    if (caption) box.appendChild(el('div', 'cap', caption));
    box.appendChild(el('div', 'title', title));
    var b = el('div', 'body'); b.innerHTML = body.split('\n').map(escapeHtml).join('<br>'); box.appendChild(b);
  }
  function escapeHtml(t) { return String(t).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }

  // ── 페이지(RunStatusPage, PaceCoachingPage, GroupPacePage, GroupPositionPage, RunDetail BODY) ──
  function renderPage() {
    var v = state.view, box = byId('content'), face = byId('face');
    while (box.firstChild) box.removeChild(box.firstChild);
    face.classList.remove('has-button');
    byId('bottom-button').classList.add('hidden');
    if (!v) {
      drawArt(null, null, null, null);
      message(box, null, '데이터를 기다려요', '러너가 달리기를 시작하면\n바로 보여 드려요');
      return;
    }
    var list = W.pages(v.mode), page = state.page;
    var index = list.indexOf(page);
    var dots = page === 'heart' ? null : {count: list.length - 1, current: index};   // 심박은 자세히 화면(쪽 점 없음)
    face.setAttribute('data-page', page);
    if (page === 'status') {
      drawArt(v.paceTicks, null, dots, v.goalProgress);
      box.appendChild(hero(v.statusPace, 104, null, false));
      if (v.paceOutOfRange) box.appendChild(el('div', 'cap', '페이스 눈금 범위 밖'));
      box.appendChild(el('div', 'divider'));
      var cells = el('div', 'cells');
      if (v.distance) cells.appendChild(inline(v.distance.value, 52, {unit: 'km', missing: v.distance.missing}));
      cells.appendChild(inline(v.elapsed.value, 52, {missing: v.elapsed.missing}));
      box.appendChild(cells);
    } else if (page === 'coaching') {
      drawArt(v.rhythmTicks, v.beatMs, dots, v.goalProgress);
      box.appendChild(el('div', 'cap', '페이스 코칭'));
      if (!v.guide) {
        box.appendChild(el('div', 'title', '코칭 안내를 기다려요'));
      } else {
        box.appendChild(labeled('안내', v.guide, 48));
        if (v.rhythm) box.appendChild(labeled('리듬 BPM', {value: v.rhythm, missing: false}, 48));
      }
      face.classList.add('has-button');
      byId('bottom-button').classList.remove('hidden');
    } else if (page === 'groupPace') {
      drawArt(null, null, dots, null);
      if (v.shared.missing) { message(box, '공동 페이스', '공동 페이스를 기다려요', '받는 대로\n바로 보여 드려요'); return; }
      box.appendChild(el('div', 'cap', '공동 페이스'));
      box.appendChild(hero(v.shared, 104, null, false));
      var notice = Date.now() < state.noticeUntil ? state.lastNotice : null;
      // GroupPacePage: 변경 안내(있으면)와 내 페이스 줄을 함께. 뒤처짐 알림(그룹장 전용 서버 알림)은 SSE에 없어 그리지 않는다
      if (notice) box.appendChild(el('div', 'line strong', notice));
      if (v.mine) box.appendChild(el('div', 'line soft', v.mine));
    } else if (page === 'position') {
      drawArt(null, null, dots, null);
      var p = v.position;
      if (!p) { message(box, '진행 순서', '순위를 기다려요', '받는 대로\n바로 보여 드려요'); return; }
      var rank = el('div', 'rank');
      var size = p.tie ? 104 : (p.rank.length <= 1 ? 132 : 132);
      rank.appendChild(hero({value: p.rank, missing: false}, size, null, false));
      rank.appendChild(el('span', 'rest', '위 ' + p.total));
      box.appendChild(rank);
      if (p.tie) box.appendChild(el('div', 'chip', '공동 순위 · ' + p.tie + '명'));
      else {
        var side = el('div', 'cells');
        side.appendChild(cell(p.ahead.none ? '없음' : (p.ahead.value || W.MISSING), '바로 앞'));
        side.appendChild(cell(p.behind.none ? '없음' : (p.behind.value || W.MISSING), '바로 뒤'));
        box.appendChild(side);
      }
      if (p.spread) box.appendChild(el('div', 'line soft', p.spread));
    } else if (page === 'heart') {
      drawArt(null, null, null, v.goalProgress);
      box.appendChild(inline(v.heart.value, 88, {symbol: '♥', unit: 'bpm', missing: v.heart.missing,
        color: v.heart.missing ? null : 'var(--primary)'}));
    }
  }

  // ── 페이지 돌리기·변경 안내 ─────────────────────
  function pacePage(mode) { return mode === 'group' ? 'groupPace' : 'coaching'; }
  // 처음 보여 줄 쪽: ?page=가 있으면 그 쪽, 없으면 실제 앱처럼 운동 현황(쪽 0)
  function startPage(mode) {
    var want = state.pinned;
    if (want === 'pace') return pacePage(mode);
    if (want === 'position' && mode !== 'group') return 'status';
    return want || 'status';
  }

  // 실제 앱 흐름: 쪽은 사람이 넘긴다(좌우 밀기 = 화면 왼쪽·오른쪽 누르기, ←/→ 키). 심박은 왼쪽 하트를 눌러 열고,
  // 자세히 화면은 아무 곳이나 누르면 돌아간다(S15P31E105-658). 자동 넘기기는 ?auto=초 로만 켠다(시연 선택).
  function go(page) {
    if (!state.view || page === state.page) return;
    if (page === 'heart') state.backPage = state.page;
    state.page = page;
    state.rotateAt = Date.now() + (state.auto || 0);
    renderPage();
  }
  function onFaceClick(event) {
    if (!state.view) return;
    if (state.page === 'heart') return go(state.backPage || 'status');
    var face = byId('face').getBoundingClientRect();
    var x = (event.clientX - face.left) / face.width, y = (event.clientY - face.top) / face.height;
    if (x < 0.14 && y > 0.47 && y < 0.62) return go('heart');          // 왼쪽 하트(9.2-4 심박 자세히)
    go(W.stepPage(state.view.mode, state.page, x >= 0.5 ? 1 : -1));
  }
  function onKey(event) {
    if (!state.view || event.target && event.target.tagName === 'INPUT') return;
    if (event.key === 'ArrowRight') go(state.page === 'heart' ? (state.backPage || 'status') : W.stepPage(state.view.mode, state.page, 1));
    else if (event.key === 'ArrowLeft') go(state.page === 'heart' ? (state.backPage || 'status') : W.stepPage(state.view.mode, state.page, -1));
  }

  function tick() {
    var v = state.view;
    if (!v || !state.auto) return;
    var now = Date.now();
    if (now < state.rotateAt) return;
    var list = W.pages(v.mode);
    // 시연에서는 페이스 쪽을 가장 자주: 페이스 → 다른 쪽 → 페이스 → …
    var order = v.mode === 'group' ? ['groupPace', 'position', 'groupPace', 'heart', 'groupPace', 'status'] : ['coaching', 'heart', 'coaching', 'status'];
    state.cycle = ((state.cycle || 0) + 1) % order.length;
    state.page = list.indexOf(order[state.cycle]) >= 0 ? order[state.cycle] : list[0];
    state.rotateAt = now + state.auto;
    renderPage();
  }

  function buzz() {
    var face = byId('face');
    face.classList.remove('buzz');
    void face.offsetWidth;          // 같은 애니메이션을 다시 시작
    face.classList.add('buzz');
  }

  function onTrace(trace) {
    var prev = state.view;
    var next = W.view(trace, {runner: state.runner, standing: state.standing});
    if (!next) return;
    state.mode = next.mode;
    state.view = next;
    if (next.mode === 'group' && next.change) { state.lastNotice = next.change; }
    if (!prev) { state.page = startPage(next.mode); state.rotateAt = Date.now() + (state.auto || 0); }
    if (W.paceChanged(prev, next)) {
      if (next.mode === 'group') state.noticeUntil = Date.now() + W.NOTICE_HOLD_MS;
      // 실제 앱은 진동만 하고 쪽은 그대로 둔다. 자동 넘기기를 켠 시연에서만 페이스 쪽으로 옮겨 잠시 머문다
      if (state.auto) { state.page = pacePage(next.mode); state.rotateAt = Date.now() + CHANGE_HOLD_MS; }
      renderPage();
      buzz();
      return;
    }
    renderPage();
  }

  function onRoutes(routes, course) {
    if (Array.isArray(routes)) state.routes = routes;
    if (course !== undefined) state.course = course;
    if (!state.tracker && root.RunwayDemoStandings) state.tracker = root.RunwayDemoStandings.createTracker();
    if (state.tracker) state.standing = state.tracker.update(state.routes, state.course);
    if (state.view && state.view.mode === 'group' && state.lastTrace) {
      state.view = W.view(state.lastTrace, {runner: state.runner, standing: state.standing});
      if (state.page === 'position') renderPage();
    }
  }

  function onEvent(name, data) {
    if (name === 'SNAPSHOT') {
      onRoutes(data && data.routes, data ? data.course : undefined);
      var traces = data && Array.isArray(data.traces) ? data.traces : [];
      state.view = null;
      if (traces.length) { state.lastTrace = traces[traces.length - 1]; onTrace(state.lastTrace); }
      else renderPage();
    } else if (name === 'MPC_TRACE') {
      state.lastTrace = data; onTrace(data);
    } else if (name === 'COURSE_UPDATE') {
      onRoutes(data && data.routes, data && data.course ? data.course : undefined);
    }
  }

  // ── 연결(콘솔과 같은 토큰·SSE, 화면 연결 상한도 함께 쓴다) ─────
  var STATUS_TEXT = {connected: '연결됨', waiting: '러너 대기', disconnected: '연결 끊김 · 자동 재연결',
    full: '연결 가득 · 다른 탭 닫기', unavailable: 'AI 준비 중 · 자동 재연결', unauthorized: '토큰 확인 필요'};
  function setConn(status) {
    var c = byId('conn');
    c.textContent = (state.runnerLabel ? state.runnerLabel + ' · ' : '') + (STATUS_TEXT[status] || status);
    c.classList.toggle('bad', status === 'full' || status === 'unauthorized' || status === 'disconnected');
    if (status === 'unauthorized') { try { sessionStorage.removeItem('runwayDemoToken'); } catch (e) { /* 저장소 없음 */ } byId('auth').classList.remove('hidden'); }
  }

  function connect(token, params) {
    var session = root.RunwayDemoLogic.streamRef(params);
    if (state.stream) state.stream.close();
    state.stream = root.RunwayDemoStream.connect({token: token, session: session, onStatus: setConn, onEvent: onEvent});
  }

  async function playHistory(token, id) {
    setConn('connected');
    try {
      var data = await root.RunwayDemoStream.fetchSnapshot({token: token, session: 'h' + id});
      var traces = data && Array.isArray(data.traces) ? data.traces : [];
      onRoutes(data && data.routes, data ? data.course : undefined);
      var i = 0;
      (function step() {
        if (!traces.length) return renderPage();
        var t = traces[i];
        state.lastTrace = t; onTrace(t);
        var a = Number(t.elapsedSec), b = Number(traces[(i + 1) % traces.length].elapsedSec);
        var wait = Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.min(5000, Math.max(800, (b - a) * 1000)) : 2000;
        i = (i + 1) % traces.length;
        setTimeout(step, wait);
      }());
    } catch (e) {
      setConn('이전 기록 실패');
    }
  }

  function start() {
    var params = new URLSearchParams(root.location.search);
    state.runner = W.runnerIndex(params, 99);
    state.pinned = PAGE_PARAM[params.get('page')] || null;
    state.auto = W.autoMs(params);
    byId('face').addEventListener('click', onFaceClick);
    document.addEventListener('keydown', onKey);
    if (params.get('group')) state.runnerLabel = '러너 ' + (state.runner + 1);
    renderPage();
    setInterval(tick, 500);
    var token = '';
    try { token = sessionStorage.getItem('runwayDemoToken') || ''; } catch (e) { token = ''; }
    var history = params.get('history');
    function go(t) {
      if (history && /^[0-9]+$/.test(history)) playHistory(t, history);
      else connect(t, params);
    }
    byId('auth').addEventListener('submit', function (event) {
      event.preventDefault();
      var value = byId('token').value.trim();
      if (!value) return;
      try { sessionStorage.setItem('runwayDemoToken', value); } catch (e) { /* 이 탭에서만 */ }
      byId('auth').classList.add('hidden');
      go(value);
    });
    if (token) go(token); else { byId('auth').classList.remove('hidden'); setConn('토큰 입력 대기'); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}(window));
