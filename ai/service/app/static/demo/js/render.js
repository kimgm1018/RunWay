(function (root) {
  'use strict';

  var ns = 'http://www.w3.org/2000/svg';
  var latestSnapshot = null;
  var timerIds = [];
  var animationRunning = false;
  var queuedUpdate = null;
  var zoomEnabled = false;
  var lastRendered = null;
  var lastTopTraceId = null;
  var ANIMATION_MS = 1900;      // 후보 등장 → 판정 → 선택 강조까지. 라이브 판단 간격(15초 이상)보다 훨씬 짧다
  var VERDICT_MS = 1150;

  function L() { return root.RunwayDemoLogic; }
  function byId(id) { return document.getElementById(id); }
  function put(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '—' : String(value); return el; }
  function putBump(id, value) {
    var el = byId(id);
    if (!el) return;
    var text = value == null ? '—' : String(value);
    if (el.textContent !== text) {
      el.textContent = text;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function svg(name, attrs, parent) {
    var node = document.createElementNS(ns, name);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, String(attrs[key])); });
    if (parent) parent.appendChild(node);
    return node;
  }
  function svgText(parent, attrs, text) { var t = svg('text', attrs, parent); t.textContent = text; return t; }
  function pathOf(points) {
    return points.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  }
  function num(value) { var n = Number(value); return value != null && Number.isFinite(n) ? n : null; }
  function formatNumber(value, digits) { var n = num(value); return n == null ? '—' : n.toFixed(digits == null ? 0 : digits); }
  function deltaText(value) {
    var n = num(value);
    if (n == null) return '—';
    return n > 0 ? '+' + Math.round(n) : n < 0 ? '−' + Math.abs(Math.round(n)) : '±0';
  }
  function sizeSvg(node) {
    var box = node.getBoundingClientRect();
    var w = Math.max(80, Math.round(box.width)), h = Math.max(40, Math.round(box.height));
    node.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    return {w: w, h: h};
  }
  function gradient(defs, id, stops, vertical) {
    var g = svg('linearGradient', {id: id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0}, defs);
    stops.forEach(function (s) { svg('stop', {offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2]}, g); });
  }

  // ── 머리글·상태 ─────────────────────────
  function setHeader(modelLabel, policyVersion) {
    put('model-label', modelLabel || '예측기 대기');
    put('policy-label', '정책 ' + (policyVersion || L().DEFAULT_POLICY_VERSION));
  }

  function setStage(stage, speed) {
    var badge = byId('stage-badge');
    var kind = !stage ? 'idle' : stage === 'L3' ? 'replay' : 'live';
    if (badge) badge.setAttribute('data-kind', kind);
    put('stage-text', kind === 'replay' ? '재생 ' + (speed || 1) + '×' : kind === 'live' ? 'LIVE' : '대기');
  }

  function setBanner(banner) {
    var node = byId('banner');
    if (!node) return;
    if (!banner) { node.textContent = ''; node.className = 'banner hidden'; return; }
    if (node.textContent === (banner.text || '') && node.classList.contains(banner.kind || '_')) return;
    node.textContent = banner.text || '';
    node.className = 'banner ' + (banner.kind || '');
  }

  function setConnection(text) {
    put('connection-state', text);
    var dot = byId('conn-dot');
    if (dot) {
      var value = String(text || '');
      dot.className = 'conn-dot' + (/끊김|거부|못했/.test(value) ? ' off' : /연결됨|정적 재생/.test(value) ? ' on' : '');
    }
    var sub = byId('waiting-sub');
    if (sub) sub.textContent = /정적 재생/.test(String(text)) ? '재생을 누르면 판단 기록이 흐르기 시작합니다' : String(text || '');
  }

  function setWaiting(waiting) { document.body.classList.toggle('is-waiting', !!waiting); }

  // ── 코스 지도·고도 ───────────────────────
  function progressOf(course, trace) {
    if (!trace || !trace.input) return null;
    var d = num(trace.input.routeProgressM);
    if (d == null) d = num(trace.input.distanceM);
    if (d == null) return null;
    var length = num(course.lengthM);
    var pts = course.points;
    if (length == null) length = num(pts[pts.length - 1][3]) || 0;
    return length > 0 ? Math.max(0, Math.min(length, d)) : null;
  }

  function splitAt(points, dists, d) {
    // d까지 지난 점들과 그 위치(보간)를 돌려준다
    if (d == null) return {done: [], at: null};
    var done = [points[0]];
    for (var i = 1; i < points.length; i += 1) {
      if (dists[i] >= d) {
        var span = dists[i] - dists[i - 1];
        var f = span > 0 ? (d - dists[i - 1]) / span : 0;
        var at = [points[i - 1][0] + f * (points[i][0] - points[i - 1][0]), points[i - 1][1] + f * (points[i][1] - points[i - 1][1])];
        done.push(at);
        return {done: done, at: at};
      }
      done.push(points[i]);
    }
    return {done: done, at: points[points.length - 1]};
  }

  function drawCourse(course, trace) {
    var map = byId('course-map');
    var elevation = byId('elevation'); // 프로토타입: 고도 패널을 뺐다. 있으면 그리고, 없으면 지도만 그린다
    if (!map) return;
    clear(map); if (elevation) clear(elevation);
    var ms = sizeSvg(map), es = elevation ? sizeSvg(elevation) : null;
    var raw = course && Array.isArray(course.points) ? course.points : [];
    var points = raw.filter(function (p) { return Array.isArray(p) && num(p[0]) != null && num(p[1]) != null; });
    var context = document.querySelector('.context');
    if (context) context.classList.toggle('no-course', points.length < 2);
    if (points.length < 2) {
      svgText(map, {x: ms.w / 2, y: ms.h / 2 - 6, 'text-anchor': 'middle', class: 'svg-empty'}, '코스 데이터 없음');
      svgText(map, {x: ms.w / 2, y: ms.h / 2 + 16, 'text-anchor': 'middle', class: 'svg-legend'}, '후보·예측·안내는 그대로 동작합니다');
      put('course-meta', '—');
      return;
    }
    var hasDist = points.every(function (p) { return num(p[3]) != null; });
    var dists = hasDist ? points.map(function (p) { return Number(p[3]); }) : points.map(function (_, i) { return i; });
    if (!hasDist) course = Object.assign({}, course, {lengthM: course.lengthM || null});
    var meanLat = points.reduce(function (s, p) { return s + Number(p[1]); }, 0) / points.length;
    var kx = Math.cos(meanLat * Math.PI / 180);
    var xs = points.map(function (p) { return Number(p[0]) * kx; }), ys = points.map(function (p) { return Number(p[1]); });
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs), yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
    var pad = 22;
    var scale = Math.min((ms.w - 2 * pad) / ((xMax - xMin) || 1e-9), (ms.h - 2 * pad) / ((yMax - yMin) || 1e-9));
    var ox = (ms.w - (xMax - xMin) * scale) / 2, oy = (ms.h - (yMax - yMin) * scale) / 2;
    var mapPts = points.map(function (_, i) { return [ox + (xs[i] - xMin) * scale, oy + (yMax - ys[i]) * scale]; });
    var routePath = pathOf(mapPts);
    svg('path', {d: routePath, class: 'svg-course-shadow'}, map);
    svg('path', {d: routePath, class: 'svg-course'}, map);
    var progress = hasDist ? progressOf(course, trace) : null;
    var split = splitAt(mapPts, dists, progress);
    if (split.done.length > 1) svg('path', {d: pathOf(split.done), class: 'svg-course-done'}, map);
    svg('circle', {cx: mapPts[0][0], cy: mapPts[0][1], r: 6, class: 'svg-start'}, map);
    if (split.at) {
      svg('circle', {cx: split.at[0], cy: split.at[1], r: 9, class: 'svg-runner-ring'}, map);
      svg('circle', {cx: split.at[0], cy: split.at[1], r: 8, class: 'svg-runner'}, map);
    }
    var length = hasDist ? dists[dists.length - 1] : null;
    var meta = length ? (length / 1000).toFixed(2) + ' km 코스' : '코스';
    if (progress != null && length) meta += ' · ' + Math.round(progress / length * 100) + '% 지점';
    put('course-meta', meta);

    if (!elevation) return; // 프로토타입: 고도 패널 없음
    var elevIdx = [];
    points.forEach(function (p, i) { if (num(p[2]) != null) elevIdx.push(i); });
    if (elevIdx.length < 2 || !hasDist) {
      svgText(elevation, {x: es.w / 2, y: es.h / 2 + 5, 'text-anchor': 'middle', class: 'svg-legend'}, '고도 데이터 없음');
      return;
    }
    var defs = svg('defs', {}, elevation);
    gradient(defs, 'elev-fill', [[0, '#7DA0B2', 0.32], [1, '#7DA0B2', 0.02]], true);
    var elevs = elevIdx.map(function (i) { return Number(points[i][2]); });
    var eMin = Math.min.apply(null, elevs), eMax = Math.max.apply(null, elevs), eSpan = (eMax - eMin) || 1;
    var ex = function (d) { return 4 + d / (length || 1) * (es.w - 8); };
    var ey = function (v) { return es.h - 4 - (v - eMin) / eSpan * (es.h - 14); };
    var ePts = elevIdx.map(function (i) { return [ex(dists[i]), ey(Number(points[i][2]))]; });
    svg('path', {d: pathOf(ePts) + ' L' + ePts[ePts.length - 1][0].toFixed(1) + ' ' + es.h + ' L' + ePts[0][0].toFixed(1) + ' ' + es.h + ' Z', class: 'svg-elev'}, elevation);
    if (progress != null) {
      var doneE = ePts.filter(function (p) { return p[0] <= ex(progress); });
      if (doneE.length > 1) svg('path', {d: pathOf(doneE), class: 'svg-elev-done'}, elevation);
      svg('line', {x1: ex(progress), x2: ex(progress), y1: 0, y2: es.h, class: 'svg-elev-now'}, elevation);
    }
    svgText(elevation, {x: es.w - 6, y: 12, 'text-anchor': 'end', class: 'svg-legend'}, '고도 ' + Math.round(eMin) + '–' + Math.round(eMax) + ' m');
  }

  // ── 심박 그래프 ─────────────────────────
  var PAST_SEC = 180, FUTURE_SEC = 140, HORIZONS = [30, 60, 120];   // 747: −3분 ~ +2분으로 확대
  var AXIS_TICKS = [-180, -120, -60, 0, 60, 120];
  // 747: 러너별 색(빨강은 탈락·위험에만 쓴다)
  var MINT = '#4DFFD2', MINT_SOFT = '#A9F5E1';   // 747-7: 앱 민트(지도 코스 선과 같은 색)
  var ALLOW_RED = '#FF6B6B', ALLOW_RED_SOFT = '#F2A3A3';

  function actualSeries(trace, traces) {
    var now = num(trace.elapsedSec);
    var tail = trace.input && trace.input.tail && Array.isArray(trace.input.tail.hrBpm) ? trace.input.tail.hrBpm : [];
    var series = [];
    if (now != null) {
      var tailStart = now - (tail.length - 1) * 5;
      (traces || []).forEach(function (t) {
        var at = num(t.elapsedSec), hr = num(t.input && t.input.hrNowBpm);
        if (at != null && hr != null && at < tailStart && at >= now - PAST_SEC) series.push([at, hr]);
      });
      series.sort(function (a, b) { return a[0] - b[0]; });
      tail.forEach(function (v, i) { if (num(v) != null) series.push([tailStart + i * 5, Number(v)]); });
    } else {
      tail.forEach(function (v, i) { if (num(v) != null) series.push([-(tail.length - 1 - i) * 5, Number(v)]); });
    }
    return series;
  }

  function drawChart(trace, traces) {
    var chart = byId('hr-chart');
    if (!chart) return;
    clear(chart);
    var size = sizeSvg(chart);
    var W = size.w, H = size.h;
    if (!trace) return;
    if (trace.group) { drawGroupChart(chart, W, H, trace, traces); return; }
    var now = num(trace.elapsedSec) == null ? 0 : Number(trace.elapsedSec);
    var actual = actualSeries(trace, traces);
    var candidates = Array.isArray(trace.candidates) ? trace.candidates : [];
    var chosenIndex = trace.decision && trace.decision.chosenIndex;
    var chosen = Number.isInteger(chosenIndex) ? candidates[chosenIndex] : null;
    var allow = num(trace.reference && trace.reference.allowBpm);
    var hrNow = num(trace.input && trace.input.hrNowBpm);
    if (hrNow == null && actual.length) hrNow = actual[actual.length - 1][1];
    var values = actual.map(function (p) { return p[1]; });
    if (hrNow != null) values.push(hrNow);
    candidates.forEach(function (c) { (c.predHrBpm || []).forEach(function (v) { if (num(v) != null) values.push(Number(v)); }); });
    if (chosen) (chosen.upperHrBpm || []).forEach(function (v) { if (num(v) != null) values.push(Number(v)); });
    if (!values.length) {
      svgText(chart, {x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'svg-empty'}, '심박 입력을 기다리고 있습니다');
      return;
    }
    if (allow != null) values.push(allow);
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (zoomEnabled) { lo -= 3; hi += 3; } else { lo -= 8; hi += 5; }
    if (hi - lo < 16) { var mid = (hi + lo) / 2; lo = mid - 8; hi = mid + 8; }
    var padL = 46, padR = 86, padT = 14, padB = 26;
    var t0 = now - PAST_SEC, t1 = now + FUTURE_SEC;
    var x = function (t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
    var y = function (v) { return padT + (hi - v) / (hi - lo) * (H - padT - padB); };

    var defs = svg('defs', {}, chart);
    gradient(defs, 'actual-fill', [[0, '#7DA0B2', 0.22], [1, '#7DA0B2', 0]], true);
    gradient(defs, 'danger-fill', [[0, '#D44A4A', 0.26], [1, '#D44A4A', 0.04]], true);

    var step = (hi - lo) > 60 ? 20 : 10;
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      svg('line', {x1: padL, x2: W - padR, y1: y(g), y2: y(g), class: 'svg-grid'}, chart);
      svgText(chart, {x: padL - 8, y: y(g) + 4, 'text-anchor': 'end', class: 'svg-axis'}, String(g));
    }
    AXIS_TICKS.forEach(function (s) {
      svgText(chart, {x: x(now + s), y: H - 6, 'text-anchor': 'middle', class: 'svg-axis'}, s === 0 ? '지금' : (s > 0 ? '+' : '−') + Math.abs(s / 60) + '분');
    });
    if (allow != null && y(allow) > padT) {
      svg('rect', {x: padL, y: padT, width: W - padL - padR, height: Math.max(0, y(allow) - padT), class: 'svg-danger-zone'}, chart);
    }
    svg('line', {x1: x(now), x2: x(now), y1: padT, y2: H - padB, class: 'svg-now'}, chart);

    // 지난 판단들의 2분 뒤 예측: 실측선 위에 남겨 예측이 맞았는지 보이게 한다
    (traces || []).forEach(function (t) {
      var at = num(t.elapsedSec);
      var idx = t.decision && t.decision.chosenIndex;
      var c = Number.isInteger(idx) && t.candidates ? t.candidates[idx] : null;
      if (at == null || !c || !c.predHrBpm || num(c.predHrBpm[2]) == null || t === trace) return;
      var target = at + 120;
      if (target < t0 || target > now) return;
      svg('circle', {cx: x(target), cy: y(Number(c.predHrBpm[2])), r: 4, class: 'svg-past-pred'}, chart);
    });

    if (actual.length > 1) {
      var aPts = actual.map(function (p) { return [x(p[0]), y(p[1])]; });
      svg('path', {d: pathOf(aPts) + ' L' + aPts[aPts.length - 1][0].toFixed(1) + ' ' + (H - padB) + ' L' + aPts[0][0].toFixed(1) + ' ' + (H - padB) + ' Z', class: 'svg-actual-area'}, chart);
      svg('path', {d: pathOf(aPts), class: 'svg-actual'}, chart);
    }
    var start = hrNow != null ? [x(now), y(hrNow)] : null;
    function predPoints(c) {
      var pts = start ? [start] : [];
      (c.predHrBpm || []).forEach(function (v, i) { if (num(v) != null && HORIZONS[i] != null) pts.push([x(now + HORIZONS[i]), y(Number(v))]); });
      return pts;
    }
    candidates.forEach(function (c, i) {
      if (i === chosenIndex) return;
      var pts = predPoints(c);
      if (pts.length > 1) svg('path', {d: pathOf(pts), class: 'svg-alt' + (c.passed === false ? ' rejected' : '')}, chart);
    });
    if (chosen) {
      var pPts = predPoints(chosen);
      var uPts = start ? [start] : [];
      (chosen.upperHrBpm || []).forEach(function (v, i) { if (num(v) != null && HORIZONS[i] != null) uPts.push([x(now + HORIZONS[i]), y(Number(v))]); });
      if (uPts.length > 1 && pPts.length === uPts.length) {
        svg('path', {d: pathOf(uPts.concat(pPts.slice().reverse())) + ' Z', class: 'svg-band'}, chart);
      }
      if (pPts.length > 1) svg('path', {d: pathOf(pPts), class: 'svg-pred'}, chart);
      var end = pPts[pPts.length - 1];
      if (end && pPts.length > 1) {
        svg('circle', {cx: end[0], cy: end[1], r: 6, class: 'svg-pred-dot'}, chart);
        svgText(chart, {x: end[0] + 10, y: end[1] + 7, class: 'svg-pred-label'}, Math.round(Number(chosen.predHrBpm[2])) + '');
      }
    }
    if (allow != null) {
      svg('line', {x1: padL, x2: W - padR + 4, y1: y(allow), y2: y(allow), class: 'svg-allow'}, chart);
      svgText(chart, {x: W - padR + 10, y: y(allow) + 5, class: 'svg-allow-label'}, '허용 ' + Math.round(allow));
    }
    if (start) svg('circle', {cx: start[0], cy: start[1], r: 6, class: 'svg-dot'}, chart);
  }

  // 그룹: 러너마다 심박 선, 가장 빠듯한 러너 강조, 고른 공동 페이스의 2분 뒤 예측, 그 러너의 허용선
  function drawGroupChart(chart, W, H, trace, traces) {
    var g = trace.group, now = num(trace.elapsedSec) || 0;
    var members = g.members || [];
    var series = members.map(function (m) {
      var pts = [];
      (traces || []).forEach(function (t) {
        var at = num(t.elapsedSec);
        if (!t.group || at == null || at < now - PAST_SEC || at > now) return;
        var mm = (t.group.members || []).filter(function (x) { return x.label === m.label; })[0];
        if (mm && num(mm.hrNowBpm) != null && at < now - 115) pts.push([at, Number(mm.hrNowBpm)]);
      });
      (m.hrTail || []).forEach(function (v, i, arr) { if (num(v) != null) pts.push([now - (arr.length - 1 - i) * 5, Number(v)]); });
      pts.sort(function (a, b) { return a[0] - b[0]; });
      return pts;
    });
    var chosen = g.chosenIndex;
    var worst = g.worstIndex;
    var values = [];
    series.forEach(function (pts) { pts.forEach(function (p) { values.push(p[1]); }); });
    members.forEach(function (m, i) {
      var row = m.predHrBpm && m.predHrBpm[chosen];
      (row || []).forEach(function (v) { if (num(v) != null) values.push(Number(v)); });
      if (i === worst && Array.isArray(m.predHrBpm)) {           // 747: 부채꼴도 보이게 범위에 넣는다
        m.predHrBpm.forEach(function (r) { (r || []).forEach(function (v) { if (num(v) != null) values.push(Number(v)); }); });
      }
      if (num(m.allowBpm) != null) values.push(Number(m.allowBpm));
    });
    if (!values.length) {
      svgText(chart, {x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'svg-empty'}, '심박 입력을 기다리고 있습니다');
      return;
    }
    var lo = Math.min.apply(null, values) - 8, hi = Math.max.apply(null, values) + 5;
    if (hi - lo < 16) { var mid = (hi + lo) / 2; lo = mid - 8; hi = mid + 8; }
    var padL = 46, padR = 96, padT = 14, padB = 26;
    var t0 = now - PAST_SEC, t1 = now + FUTURE_SEC;
    var x = function (t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
    var y = function (v) { return padT + (hi - v) / (hi - lo) * (H - padT - padB); };
    var defs = svg('defs', {}, chart);
    gradient(defs, 'danger-fill', [[0, '#D44A4A', 0.26], [1, '#D44A4A', 0.04]], true);
    var step = (hi - lo) > 60 ? 20 : 10;
    for (var gv = Math.ceil(lo / step) * step; gv <= hi; gv += step) {
      svg('line', {x1: padL, x2: W - padR, y1: y(gv), y2: y(gv), class: 'svg-grid'}, chart);
      svgText(chart, {x: padL - 8, y: y(gv) + 4, 'text-anchor': 'end', class: 'svg-axis'}, String(gv));
    }
    AXIS_TICKS.forEach(function (sec) {
      svgText(chart, {x: x(now + sec), y: H - 6, 'text-anchor': 'middle', class: 'svg-axis'},
        sec === 0 ? '지금' : (sec > 0 ? '+' : '−') + Math.abs(sec / 60) + '분');
    });
    var wm = Number.isInteger(worst) ? members[worst] : null;
    var allow = wm ? num(wm.allowBpm) : null;
    if (allow != null && y(allow) > padT) {
      svg('rect', {x: padL, y: padT, width: W - padL - padR, height: Math.max(0, y(allow) - padT), class: 'svg-danger-zone'}, chart);
    }
    svg('line', {x1: x(now), x2: x(now), y1: padT, y2: H - padB, class: 'svg-now'}, chart);
    // 747: 가장 빠듯한 러너의 후보 9개 2분 뒤 예측을 부채꼴로(고른 후보는 아래에서 굵게, 허용 초과는 빨간 점선)
    var worstPts = Number.isInteger(worst) ? series[worst] : null;
    var worstLast = worstPts && worstPts.length ? worstPts[worstPts.length - 1] : null;
    if (wm && worstLast && Array.isArray(wm.predHrBpm)) {
      wm.predHrBpm.forEach(function (row, j) {
        if (j === chosen || !Array.isArray(row)) return;
        var fan = [[x(now), y(worstLast[1])]];
        row.forEach(function (v, k) { if (num(v) != null && HORIZONS[k] != null) fan.push([x(now + HORIZONS[k]), y(Number(v))]); });
        if (fan.length < 2) return;
        var failed = Array.isArray(wm.passed) && wm.passed[j] === false;
        svg('path', {d: pathOf(fan), class: 'svg-alt' + (failed ? ' rejected' : '')}, chart);
      });
    }
    var order = members.map(function (_, i) { return i; }).sort(function (a, b) { return (a === worst) - (b === worst); });
    var endLabels = [];                                           // 747: 끝 라벨은 마지막에 겹치지 않게 그린다
    order.forEach(function (i) {
      var m = members[i], pts = series[i], isWorst = i === worst;
      if (pts.length > 1) {
        svg('path', {d: pathOf(pts.map(function (p) { return [x(p[0]), y(p[1])]; })), class: isWorst ? 'svg-member worst' : 'svg-member other',
          style: 'stroke:' + (isWorst ? MINT : MINT_SOFT)}, chart);
      }
      var row = m.predHrBpm && m.predHrBpm[chosen];
      var last = pts.length ? pts[pts.length - 1] : null;
      if (row && last) {
        var pp = [[x(now), y(last[1])]];
        row.forEach(function (v, k) { if (num(v) != null && HORIZONS[k] != null) pp.push([x(now + HORIZONS[k]), y(Number(v))]); });
        svg('path', {d: pathOf(pp), class: isWorst ? 'svg-pred member' : 'svg-member-pred', style: 'stroke:' + (isWorst ? MINT : MINT_SOFT)}, chart);
        var end = pp[pp.length - 1];
        svg('circle', {cx: end[0], cy: end[1], r: isWorst ? 6 : 4, class: isWorst ? 'svg-pred-dot' : 'svg-member-dot', style: 'stroke:' + (isWorst ? MINT : MINT_SOFT)}, chart);
        endLabels.push({x: end[0] + 10, y: end[1] + 5, cls: isWorst ? 'svg-pred-label' : 'svg-member-label', color: isWorst ? MINT : MINT_SOFT,
          text: m.label.replace('러너 ', 'R') + ' ' + Math.round(Number(row[2]))});
      }
      if (last) svg('circle', {cx: x(now), cy: y(last[1]), r: isWorst ? 6 : 4, class: isWorst ? 'svg-dot' : 'svg-member-dot', style: 'stroke:' + (isWorst ? MINT : MINT_SOFT)}, chart);
    });
    members.forEach(function (m, i) {                            // 747: 러너마다 허용선(같은 색 점선)
      var a = num(m.allowBpm);
      if (a == null) return;
      var red = i === worst ? ALLOW_RED : ALLOW_RED_SOFT;
      svg('line', {x1: padL, x2: W - padR + 4, y1: y(a), y2: y(a), class: 'svg-allow member', style: 'stroke:' + red}, chart);
      endLabels.push({x: W - padR + 10, y: y(a) - 6, cls: 'svg-allow-label member', color: red,
        text: m.label.replace('러너 ', 'R') + ' 허용 ' + Math.round(a)});
    });
    spreadLabels(endLabels, 20, padT + 10, H - padB);
    endLabels.forEach(function (lb) {
      var attrs = {x: lb.x, y: lb.y, class: lb.cls};
      if (lb.color) attrs.style = 'fill:' + lb.color;
      svgText(chart, attrs, lb.text);
    });
  }

  // 747: 세로 위치가 gap보다 가까운 라벨을 위아래로 벌린다(순서는 유지)
  function spreadLabels(labels, gap, top, bottom) {
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < gap) labels[i].y = labels[i - 1].y + gap;
    }
    var over = labels.length ? labels[labels.length - 1].y - bottom : 0;
    if (over > 0) labels.forEach(function (lb) { lb.y -= over; });
    labels.forEach(function (lb) { lb.y = Math.max(top, lb.y); });
  }

  // ── 후보 카드 ───────────────────────────
  function pct(value, range) {
    return Math.max(0, Math.min(100, (value - range.lo) / (range.hi - range.lo) * 100));
  }

  function candidateCards(trace, animate) {
    var host = byId('candidate-list');
    if (!host) return [];
    clear(host);
    host.classList.remove('animating', 'pending');
    var candidates = Array.isArray(trace && trace.candidates) ? trace.candidates : [];
    var chosen = trace && trace.decision && trace.decision.chosenIndex;
    var allow = num(trace && trace.reference && trace.reference.allowBpm);
    var range = L().gaugeRange(candidates, allow);
    var many = candidates.length > 6;
    host.style.gridTemplateColumns = 'repeat(' + Math.max(1, candidates.length) + ', minmax(0, 1fr))';
    host.setAttribute('data-density', many ? 'many' : 'few');
    var summary = L().candidateSummary(candidates);
    put('candidate-meta', (summary.text ? summary.text + ' · ' : '') + 'GRU 2분 뒤 예측 심박');
    var cards = candidates.map(function (candidate, index) {
      var isChosen = index === chosen;
      var rejected = candidate.passed === false;
      var card = el('article', 'cand' + (isChosen ? ' chosen' : '') + (rejected && !isChosen ? ' rejected' : ''));
      card.style.setProperty('--i', String(index));
      var top = el('div', 'cand-top');
      top.appendChild(el('span', 'cand-delta', deltaText(candidate.deltaSecPerKm)));
      top.appendChild(el('span', 'cand-tag', isChosen ? '선택' : rejected ? (many ? '탈락' : L().rejectReasonText(candidate.rejectReason)) : '통과'));
      card.appendChild(top);
      var pace = el('div', 'cand-pace', L().formatPace(candidate.paceSecPerKm));
      pace.appendChild(el('small', null, '/km'));
      card.appendChild(pace);
      var gauge = el('div', 'gauge');
      var pred = candidate.predHrBpm && num(candidate.predHrBpm[2]);
      var peak = num(candidate.peakUpperBpm);
      if (range && pred != null) {
        var p = pct(pred, range);
        if (peak != null && peak > pred) {
          var band = el('div', 'bar-band');
          band.style.bottom = p + '%';
          band.style.height = (pct(peak, range) - p) + '%';
          gauge.appendChild(band);
        }
        var bar = el('div', 'bar-pred');
        bar.style.height = p + '%';
        gauge.appendChild(bar);
        var label = el('div', 'gauge-hr', String(Math.round(pred)));
        label.appendChild(el('small', null, 'bpm'));
        label.style.bottom = Math.min(Math.max(p, 6), 92) + '%';
        gauge.appendChild(label);
        if (allow != null && pred >= allow) card.classList.add('over');
      } else {
        gauge.appendChild(el('div', 'gauge-hr', '—')).style.bottom = '40%';
      }
      if (range && allow != null) {
        var line = el('div', 'allow-line');
        line.style.bottom = pct(allow, range) + '%';
        gauge.appendChild(line);
      }
      card.appendChild(gauge);
      var foot = el('div', 'cand-foot');
      if (many && rejected && !isChosen) {
        foot.textContent = L().rejectReasonText(candidate.rejectReason) + (peak != null ? ' · 상한 ' + Math.round(peak) : '');
      } else if (peak != null) {
        foot.appendChild(document.createTextNode('상한 '));
        foot.appendChild(el('b', null, String(Math.round(peak))));
        foot.appendChild(document.createTextNode(allow != null ? (peak >= allow ? ' ≥ ' : ' < ') + '허용 ' + Math.round(allow) : ''));
      } else {
        foot.textContent = rejected ? L().rejectReasonText(candidate.rejectReason) : '';
      }
      card.appendChild(foot);
      host.appendChild(card);
      return card;
    });
    if (animate && cards.length) host.classList.add('animating', 'pending');
    return cards;
  }

  // 844: 좁은 화면에서 후보 칸·판정판이 패널 안에서 가로로 넘치면 고른 후보가 가운데 오게 민다.
  // scrollIntoView는 페이지까지 움직이므로 쓰지 않고, 넘치지 않는 넓은 화면에서는 아무것도 하지 않는다
  function centerChosen() {
    [['candidate-list', '.cand.chosen'], ['group-board', '.gb-head.chosen']].forEach(function (pair) {
      var box = byId(pair[0]);
      if (!box || box.scrollWidth <= box.clientWidth + 1) return;
      var target = box.querySelector(pair[1]);
      if (!target) return;
      box.scrollLeft = Math.max(0, target.offsetLeft - (box.clientWidth - target.offsetWidth) / 2);
    });
  }

  // 900: 고른 후보가 탈락일 때 이유 칩(후보 패널 제목 옆, 평소 화면에서도 보임)
  function chosenWhy(trace) {
    var chip = byId('chosen-why');
    if (!chip) return;
    var text = trace ? L().chosenRejectChip(trace) : null;
    chip.textContent = text ? '탈락 후보 선택 · ' + text : '';
    chip.classList.toggle('hidden', !text);
  }

  // ── 그룹 판정판(AI10) ───────────────────
  function groupBoard(trace) {
    var board = byId('group-board');
    var list = byId('candidate-list');
    var matrix = L().groupMatrix(trace && trace.group);
    if (!board) return;
    if (!matrix) { board.classList.add('hidden'); if (list) list.classList.remove('hidden'); return; }
    if (list) list.classList.add('hidden');
    board.classList.remove('hidden');
    clear(board);
    var candidates = trace.group.candidates;
    var baseline = trace.group.baselineIndex;
    board.style.setProperty('--cols', String(candidates.length));
    board.style.setProperty('--rows', String(matrix.rows.length));
    board.appendChild(el('div', 'gb-head gb-corner', '러너 · 지금 심박'));
    candidates.forEach(function (c, j) {
      var ok = matrix.columnsPassed[j];
      var head = el('div', 'gb-head' + (j === matrix.chosenIndex ? ' chosen' : '') + (j === baseline ? ' current' : '') +
        (ok === false ? ' col-fail' : ''), deltaText(c.deltaSecPerKm));
      head.appendChild(el('small', null, L().formatPace(c.paceSecPerKm)));
      head.appendChild(el('i', 'gb-mark', j === matrix.chosenIndex ? '선택' : ok === false ? '✕' : ok ? '✓' : ''));
      board.appendChild(head);
    });
    var cellIndex = 0;
    matrix.rows.forEach(function (row, i) {
      var worst = i === matrix.worstIndex;
      var name = el('div', 'gb-name');
      name.appendChild(el('span', 'gb-who', row.label));
      name.appendChild(el('b', 'gb-hr', row.hrNow != null ? String(Math.round(row.hrNow)) : '—'));
      name.appendChild(el('small', null, row.allow != null ? '허용 ' + Math.round(row.allow) : ''));
      name.appendChild(el('small', 'gb-actual actual-' + row.actual.kind, '실제 ' + row.actual.text));
      if (worst) {                                                // 747: 줄 전체 색 대신 이름 옆 '기준' 꼬리표
        name.classList.add('gb-row-worst'); name.setAttribute('title', '가장 빠듯한 러너(공동 페이스의 기준)');
        name.insertBefore(el('i', 'gb-ref', '기준'), name.children[1] || null);
      }
      board.appendChild(name);
      row.cells.forEach(function (cell, j) {
        var cls = 'gb-cell' + (cell.passed === false ? ' fail' : cell.headroom != null && cell.headroom < 3 ? ' tight' : '') +
          (j === matrix.chosenIndex ? ' col-chosen' : '') + (worst ? ' gb-row-worst' : '');
        var node = el('div', cls);
        node.style.setProperty('--i', String(cellIndex++));
        // 747: 평소 화면은 ✓/✕와 색만, 숫자(예측 심박·여유)는 확대 모달에서
        node.appendChild(el('i', 'gb-ok', cell.passed === false ? '✕' : cell.passed ? '✓' : '·'));
        node.appendChild(el('span', 'gb-pace', L().formatPace(candidates[j] && candidates[j].paceSecPerKm)));   // 747-7: 칸 = 그 후보 페이스
        node.appendChild(el('b', null, cell.pred != null ? String(Math.round(cell.pred)) : '—'));
        node.appendChild(el('small', null, cell.headroom == null ? '' : (cell.headroom > 0 ? '여유 ' : '초과 ') + Math.abs(Math.round(cell.headroom))));
        board.appendChild(node);
      });
    });
    put('candidate-meta', '러너 ' + matrix.rows.length + '명 × ' + L().candidateSummary(candidates).text +
      ' · 칸 = 2분 뒤 예측 심박 / 허용선까지 여유(상한 기준)');
  }

  // ── 판단 기록 ───────────────────────────
  var STATUS_TEXT = {HR_STALE: '입력 지연', SAFETY: '위험 심박', INPUT_INSUFFICIENT: '입력 부족', PAUSED: '일시정지', NOT_RUNNING: '정지'};

  function addRecords(traces, animate) {
    var list = byId('record-list');
    if (!list) return;
    clear(list);
    var rows = (traces || []).slice(-40).reverse();
    rows.forEach(function (trace, index) {
      var item = el('li', 'record-item' + (index === 0 ? ' latest' : ''));
      if (index === 0 && animate && trace.traceId !== lastTopTraceId) item.classList.add('enter');
      item.setAttribute('data-trace-id', trace.traceId || '');
      var at = num(trace.elapsedSec);
      var time = el('time', null, at != null ? L().formatElapsed(at) : '—');
      if (at == null) {
        var date = new Date(trace.inputAsOf || '');
        if (!Number.isNaN(date.getTime())) time.textContent = date.toLocaleTimeString('ko-KR', {hour12: false});
      }
      item.appendChild(time);
      var kind = L().actionKind(trace);
      var act = el('span', 'rec-act', {up: '▲', down: '▼', hold: '■', ease: '▼▼'}[kind] || '·');
      act.setAttribute('data-action', kind);
      item.appendChild(act);
      var decision = trace.decision || {};
      item.appendChild(el('strong', null, decision.recommendedPaceSecPerKm != null ? L().formatPace(decision.recommendedPaceSecPerKm) : '—'));
      var hr = el('span', 'rec-hr');
      var c = Number.isInteger(decision.chosenIndex) && trace.candidates ? trace.candidates[decision.chosenIndex] : null;
      var pred = c && c.predHrBpm && num(c.predHrBpm[2]);
      if (trace.group) {
        if (decision.changed) hr.appendChild(document.createTextNode(L().formatPace(decision.fromPaceSecPerKm) + ' → '));
        hr.appendChild(el('b', null, decision.reasonLabel || ''));
        var g = trace.group, w = Number.isInteger(g.worstIndex) && g.members ? g.members[g.worstIndex] : null;
        if (w && w.hrNowBpm != null) hr.appendChild(document.createTextNode(' · ' + w.label + ' ' + Math.round(w.hrNowBpm)));
      } else if (pred != null) {
        hr.appendChild(document.createTextNode('예측 '));
        hr.appendChild(el('b', null, String(Math.round(pred))));
        var allow = num(trace.reference && trace.reference.allowBpm);
        if (allow != null) hr.appendChild(document.createTextNode(' / 허용 ' + Math.round(allow)));
      } else {
        hr.textContent = decision.reasonText || '';
      }
      item.appendChild(hr);
      var line = L().headline(trace);                       // 747: 판단 흐름 카드의 이유 한 단어(색)
      var tag = el('span', 'rec-tag', L().toneWord(line.tone));
      tag.setAttribute('data-tone', line.tone);
      item.appendChild(tag);
      item.appendChild(el('span', 'rec-status', trace.status && trace.status !== 'OK' ? (STATUS_TEXT[trace.status] || trace.status) : ''));
      list.appendChild(item);
    });
    lastTopTraceId = rows.length ? rows[0].traceId : null;
    put('record-count', (traces || []).length);
    var recordsPanel = list.closest('.records-panel');
    if (recordsPanel) recordsPanel.classList.toggle('is-empty', !rows.length);
  }

  function addRestartMarker() {
    var list = byId('record-list');
    if (!list || list.querySelector('.restart-marker')) return;
    var marker = el('li', 'restart-marker', 'AI 재시작');
    list.insertBefore(marker, list.firstChild);
  }

  // ── 상단 숫자 ───────────────────────────
  var PERSONAL_LABELS = {'label-hr': '현재 심박', 'label-pace': '실측 페이스', 'label-distance': '거리', 'unit-distance': 'km',
    'kicker-text': '목표 페이스', 'guide-side-label': '이 페이스의 2분 뒤 예측'};
  var GROUP_LABELS = {'label-hr': '가장 빠듯한 러너 심박', 'label-pace': '이전 공동 페이스', 'label-distance': '그룹 인원', 'unit-distance': '명',
    'kicker-text': '공동 목표 페이스', 'guide-side-label': '가장 빠듯한 러너 2분 뒤 예측'};
  function setLabels(group) {
    var labels = group ? GROUP_LABELS : PERSONAL_LABELS;
    Object.keys(labels).forEach(function (id) { put(id, labels[id]); });
  }

  // 641: GRU 개인 보정 표시. 기능이 꺼져 있으면 gruGb가 없어 숨긴다.
  function gruLine(gb) {
    var node = byId('metric-gru');
    if (!node) return;
    var on = !!(gb && gb.applied);
    node.textContent = on ? '개인 보정 적용 중 (러닝 ' + gb.supportN + '회, 비중 ' + Math.round(Number(gb.weight) * 100) + '%)' : '';
    node.classList.toggle('hidden', !on);
  }

  function heroNumbers(trace, stage) {
    setLabels(!!trace.group);
    if (trace.group) {
      var gw = Number.isInteger(trace.group.worstIndex) && trace.group.members ? trace.group.members[trace.group.worstIndex] : null;
      gruLine(gw && gw.gruGb);
      groupHero(trace);
      return;
    }
    gruLine(trace.gruGb);
    var input = trace.input || {};
    var allow = num(trace.reference && trace.reference.allowBpm);
    var hr = num(input.hrNowBpm);
    putBump('metric-hr', hr != null ? Math.round(hr) : '—');
    put('metric-allow', allow != null ? '허용선 ' + Math.round(allow) + ' bpm' : '허용선 —');
    var hrCard = document.querySelector('.stat-hr');
    if (hrCard) {
      hrCard.classList.toggle('over', hr != null && allow != null && hr >= allow);
      var heart = hrCard.querySelector('.heart');
      if (heart) heart.style.setProperty('--beat', hr ? (60 / hr).toFixed(3) + 's' : '0s');
    }
    var actual = L().actualPace(input.speedNowMps, input.paceNowSecPerKm);   // 724: 정지·없음은 큰 숫자 대신 글자로
    putBump('metric-pace', actual.text);
    actualLine([{label: null, actual: actual}]);
    var grade = num(input.gradeNext120sPct);
    put('metric-grade', '다음 2분 경사 ' + (grade != null ? (grade > 0 ? '+' : '') + grade.toFixed(1) + '%' : '—'));
    var distance = num(input.distanceM);
    putBump('metric-distance', distance != null ? (distance / 1000).toFixed(2) : '—');
    var remaining = num(input.remainingM);
    put('metric-remaining', remaining != null ? '남은 거리 ' + (remaining / 1000).toFixed(2) + ' km' : '남은 거리 —');
    putBump('metric-elapsed', L().formatElapsed(trace.elapsedSec));
    var latency = trace.latency || {};
    var text = '판단 ' + (latency.decideMs != null ? formatNumber(latency.decideMs, 0) + ' ms' : '—');
    if (stage !== 'L3' && latency.inputLagMs != null) text += ' · 입력 지연 ' + (Number(latency.inputLagMs) / 1000).toFixed(1) + ' s';
    put('metric-latency', text);
  }

  function groupHero(trace) {
    var g = trace.group, d = trace.decision || {};
    var w = Number.isInteger(g.worstIndex) && g.members ? g.members[g.worstIndex] : null;
    var hr = w ? num(w.hrNowBpm) : null, allow = w ? num(w.allowBpm) : null;
    putBump('metric-hr', hr != null ? Math.round(hr) : '—');
    put('metric-allow', w ? w.label + ' · 허용선 ' + (allow != null ? Math.round(allow) : '—') + ' bpm' : '허용선 —');
    var hrCard = document.querySelector('.stat-hr');
    if (hrCard) {
      hrCard.classList.toggle('over', hr != null && allow != null && hr >= allow);
      var heart = hrCard.querySelector('.heart');
      if (heart) heart.style.setProperty('--beat', hr ? (60 / hr).toFixed(3) + 's' : '0s');
    }
    putBump('metric-pace', d.fromPaceSecPerKm != null ? L().formatPace(d.fromPaceSecPerKm) : '—');
    actualLine((g.members || []).map(function (m, i) {
      return {label: m.label || '러너 ' + (i + 1), actual: L().actualPace(m.speedNowMps, m.paceNowSecPerKm)};
    }));
    put('metric-grade', g.goalPaceSecPerKm != null ? '목표 ' + L().formatPace(g.goalPaceSecPerKm) + '/km' : '목표 —');
    var hrCount = (g.members || []).length;
    putBump('metric-distance', hrCount + (g.paceOnlyCount || 0));
    put('metric-remaining', '심박 판단 ' + hrCount + '명' + (g.paceOnlyCount ? ' · 페이스만 ' + g.paceOnlyCount : '') +
      (g.excludedCount ? ' · 제외 ' + g.excludedCount : ''));
    putBump('metric-elapsed', L().formatElapsed(trace.elapsedSec));
    var latency = trace.latency || {};
    put('metric-latency', latency.decideMs != null ? '판단 ' + formatNumber(latency.decideMs, 0) + ' ms · 30초마다' : '30초마다 판단');
  }

  function guideBlock(trace, options) {
    var guide = L().guideCard(trace);
    var guideCardEl = document.querySelector('.guide-card');
    if (guideCardEl) guideCardEl.classList.toggle('is-empty', !trace || !trace.decision);
    var decision = trace.decision || {};
    var from = byId('guide-from');
    if (from) {
      var showFrom = !!trace.group && decision.changed && decision.fromPaceSecPerKm != null;
      from.textContent = showFrom ? L().formatPace(decision.fromPaceSecPerKm) + ' →' : '';
      from.classList.toggle('hidden', !showFrom);
      var card = document.querySelector('.guide-card');
      if (card) card.classList.toggle('has-from', showFrom);
    }
    if (trace.group) {
      var g = trace.group, w = Number.isInteger(g.worstIndex) && g.members ? g.members[g.worstIndex] : null;
      var gp = w && Number.isInteger(g.chosenIndex) && w.predHr120Bpm ? num(w.predHr120Bpm[g.chosenIndex]) : null;
      put('guide-pace', decision.recommendedPaceSecPerKm != null ? L().formatPace(decision.recommendedPaceSecPerKm) : '—');
      var act = put('guide-action', guide.actionText);
      if (act) act.setAttribute('data-action', guide.actionKind || 'idle');
      put('guide-delivery', options.replay ? '재생' : guide.deliveryText);
      put('guide-pred', gp != null ? Math.round(gp) : '—');
      put('guide-allow', w && w.allowBpm != null ? Math.round(w.allowBpm) : '—');
      var gs = byId('guide-side');
      if (gs) gs.classList.toggle('over', gp != null && w && gp >= w.allowBpm);
      return;
    }
    put('guide-pace', decision.recommendedPaceSecPerKm != null ? L().formatPace(decision.recommendedPaceSecPerKm) : '—');
    var action = put('guide-action', guide.actionText === '—' ? '대기' : guide.actionText);
    if (action) action.setAttribute('data-action', guide.actionKind || 'idle');
    put('guide-delivery', options.replay ? '재생' : guide.deliveryText);
    var chosen = Number.isInteger(decision.chosenIndex) && trace.candidates ? trace.candidates[decision.chosenIndex] : null;
    var pred = chosen && chosen.predHrBpm ? num(chosen.predHrBpm[2]) : num(decision.predictedHr120Bpm);
    var allow = num(trace.reference && trace.reference.allowBpm);
    put('guide-pred', pred != null ? Math.round(pred) : '—');
    put('guide-allow', allow != null ? Math.round(allow) : '—');
    var side = byId('guide-side');
    if (side) side.classList.toggle('over', pred != null && allow != null && pred >= allow);
  }

  // 909: 페이스 변경 카드. 바꾼 판단 뒤 CARD_SEC(재생은 배속 반영) 동안 보이고 흐려지며 사라진다.
  var paceChangeTimer = null, paceChangeShownId = null;
  function hidePaceChange(immediate) {
    if (paceChangeTimer) { clearTimeout(paceChangeTimer); paceChangeTimer = null; }
    var box = byId('pace-change');
    if (!box) return;
    paceChangeShownId = null;
    if (immediate) { box.classList.add('hidden'); box.classList.remove('is-out'); return; }
    box.classList.add('is-out');
    paceChangeTimer = setTimeout(function () { box.classList.add('hidden'); box.classList.remove('is-out'); paceChangeTimer = null; }, 600);
  }
  function paceChange(trace, traces, options) {
    var A = root.RunwayDemoAlerts;
    var box = byId('pace-change');
    if (!A || !box) return;
    var card = A.paceChangeCard(trace, traces);
    if (!card) { if (!box.classList.contains('hidden')) hidePaceChange(false); return; }
    if (paceChangeTimer) clearTimeout(paceChangeTimer);
    box.setAttribute('data-action', card.kind);
    box.querySelector('.pc-title').textContent = card.title;
    box.querySelector('.pc-pace').textContent = card.pace;
    box.querySelector('.pc-reason').textContent = card.reason;
    box.classList.remove('hidden', 'is-out');
    if (paceChangeShownId !== card.id) {
      paceChangeShownId = card.id;
      if (options.animate) { box.classList.remove('enter'); void box.offsetWidth; box.classList.add('enter'); }
    }
    var speed = options.replay ? Math.max(1, Number(options.replaySpeed) || 1) : 1;
    var leftMs = Math.max(0, (A.CARD_SEC - card.ageSec) * 1000 / speed);
    paceChangeTimer = setTimeout(function () { paceChangeTimer = null; hidePaceChange(false); }, leftMs);
  }

  // 724: 안내 페이스 옆 '실제' 줄. 개인은 한 값, 그룹은 러너마다(라벨 · 값).
  function actualLine(items) {
    var host = byId('actual-text');
    if (!host) return;
    clear(host);
    (items || []).forEach(function (item, index) {
      if (index) host.appendChild(document.createTextNode(' · '));
      var span = el('span', 'actual-' + item.actual.kind, (item.label ? item.label + ' ' : '') + item.actual.text);
      host.appendChild(span);
    });
    if (!(items || []).length) host.textContent = '—';
    put('actual-note', L().ACTUAL_WINDOW_TEXT);
    put('actual-sum-value', L().actualSummary((items || []).map(function (item) { return item.actual; })));
  }

  function reasonLine(trace) {
    var decision = trace && trace.decision || {};
    var reason = decision.reasonText || decision.reason || trace && trace.status || '판단 기록을 기다리고 있습니다.';
    // 747: 큰 안내는 말로 된 한 줄, 자세한 이유(숫자)는 확대 모달에서
    var line = L().headline(trace);
    var node = put('reason-line', line.text);
    if (node) node.setAttribute('data-tone', line.tone);
    put('reason-detail', reason);
  }

  function applyTrace(trace, traces, options) {
    var started = performance.now();
    var stage = options.stage || trace.stage || (latestSnapshot && latestSnapshot.stage);
    setWaiting(false);
    setStage(stage, options.replaySpeed || trace.replaySpeed || 1);
    heroNumbers(trace, stage);
    var modelLabel = options.modelLabel || trace.modelVersion || '대기';
    if (String(modelLabel).indexOf('예측기') !== 0) modelLabel = '예측기: ' + modelLabel;
    setHeader(modelLabel, L().policyVersionOf(trace, {policyVersion: options.policyVersion}));
    put('runner-label', latestSnapshot && latestSnapshot.label || '러너');
    var animate = options.animate === true;
    var mode = L().modeOf(trace);
    var chip = put('mode-chip', mode.label);
    if (chip) chip.setAttribute('data-kind', mode.kind);
    var cards = candidateCards(trace, animate && !trace.group);
    groupBoard(trace);
    chosenWhy(trace);
    centerChosen();
    var board = byId('group-board');
    if (board) {
      board.classList.remove('animating');
      if (animate && trace.group) { void board.offsetWidth; board.classList.add('animating'); }
    }
    lastRendered = {trace: trace, traces: traces};
    drawChart(trace, traces);
    drawCourse(latestSnapshot && latestSnapshot.course, trace);
    if (!animate) { addRecords(traces, false); if (options.restartMarker) addRestartMarker(); }
    var check = L().checkText(trace.check120);
    var checkLine = document.querySelector('.check-line');
    if (checkLine) checkLine.textContent = check || '2분 전 예측 비교 대기';
    put('mae-line', trace.mae10MinBpm == null ? '10분 평균 오차 —' : '10분 평균 오차 ' + formatNumber(trace.mae10MinBpm, 1) + ' bpm');
    var banner = L().bannerFor({trace: trace, nowMs: Date.now(), serverOffsetMs: options.serverOffsetMs || 0,
      lastMessageAtMs: options.lastMessageAtMs, stage: stage});
    setBanner(banner);
    root.__demoMetrics = root.__demoMetrics || {};
    root.__demoMetrics.renderLagMs = Math.max(0, performance.now() - started);
    if (!animate) { guideBlock(trace, options); reasonLine(trace); paceChange(trace, traces, options); return; }
    animationRunning = true;
    var host = byId('candidate-list');
    timerIds.push(setTimeout(function () {
      if (host) host.classList.remove('pending');
      var chosenIndex = trace.decision && trace.decision.chosenIndex;
      if (Number.isInteger(chosenIndex) && cards[chosenIndex]) cards[chosenIndex].classList.add('pulse');
      // 후보 판정이 끝난 뒤에 안내를 바꾼다: 예측 → 판정 → 안내 순서가 화면에서 보이게
      guideBlock(trace, options);
      reasonLine(trace);
      paceChange(trace, traces, options);
      addRecords(traces, true);
      if (options.restartMarker) addRestartMarker();
      var guideCardEl = document.querySelector('.guide-card');
      if (guideCardEl) { guideCardEl.classList.remove('flash'); void guideCardEl.offsetWidth; guideCardEl.classList.add('flash'); }
    }, VERDICT_MS));
    timerIds.push(setTimeout(function () {
      if (host) host.classList.remove('animating');
      animationRunning = false;
      timerIds = [];
      if (queuedUpdate) {
        var queued = queuedUpdate;
        queuedUpdate = null;
        renderTrace(queued.trace, queued.traces, queued.options);
      }
    }, ANIMATION_MS));
  }

  function renderTrace(trace, traces, options) {
    options = options || {};
    if (!trace) return;
    if (options.animate && animationRunning) {
      queuedUpdate = {trace: trace, traces: traces, options: options};
      return;
    }
    applyTrace(trace, traces || [trace], options);
  }

  function renderSnapshot(snapshot) {
    latestSnapshot = snapshot || {};
    setStage(latestSnapshot.stage, 1);
    put('runner-label', latestSnapshot.label || '러너 대기');
    drawCourse(latestSnapshot.course, null);
  }

  function updateCourse(course, trace) {
    latestSnapshot = Object.assign({}, latestSnapshot || {}, {course: course || null});
    drawCourse(latestSnapshot.course, trace || null);
  }

  function reset(snapshot) {
    latestSnapshot = snapshot || null;
    timerIds.forEach(clearTimeout);
    timerIds = [];
    queuedUpdate = null;
    animationRunning = false;
    lastRendered = null;
    lastTopTraceId = null;
    ['metric-hr', 'metric-pace', 'metric-distance', 'metric-elapsed'].forEach(function (id) { put(id, '—'); });
    put('metric-allow', '허용선 —'); put('metric-grade', '다음 2분 경사 —'); gruLine(null);
    put('metric-remaining', '남은 거리 —'); put('metric-latency', '판단 —');
    var hrCard = document.querySelector('.stat-hr');
    if (hrCard) hrCard.classList.remove('over');
    put('guide-pace', '—');
    var action = put('guide-action', '대기');
    if (action) action.setAttribute('data-action', 'idle');
    put('guide-delivery', '대기');
    put('guide-pred', '—'); put('guide-allow', '—');
    var emptyCard = document.querySelector('.guide-card');
    if (emptyCard) emptyCard.classList.add('is-empty');
    var waitLine = put('reason-line', '심박 대기');             // 747: 빈 상태도 짧은 안내
    if (waitLine) waitLine.setAttribute('data-tone', 'wait');
    put('reason-detail', '판단 기록을 기다리고 있습니다.');
    actualLine([]);
    put('record-count', '0'); put('mae-line', '10분 평균 오차 —');
    var checkLine = document.querySelector('.check-line');
    if (checkLine) checkLine.textContent = '2분 전 예측 비교 대기';
    clear(byId('record-list')); clear(byId('candidate-list')); clear(byId('hr-chart'));
    put('candidate-meta', 'GRU가 예측한 2분 뒤 심박');
    groupBoard(null);
    chosenWhy(null);
    setLabels(false);
    var fromEl = byId('guide-from');
    if (fromEl) fromEl.classList.add('hidden');
    var guideEl = document.querySelector('.guide-card');
    if (guideEl) guideEl.classList.remove('has-from');
    setBanner(null);
    hidePaceChange(true);
    setWaiting(true);
    renderSnapshot(snapshot || {});
  }

  function setZoom(value) {
    zoomEnabled = !!value;
    if (lastRendered) drawChart(lastRendered.trace, lastRendered.traces);
  }

  // 그래프·지도는 그릴 때의 픽셀 크기로 좌표를 잡는다. 칸 크기가 바뀌면(프로젝터 전환·전체 화면·창 크기)
  // 다음 판단을 기다리지 않고 한 프레임 안에 다시 그린다.
  var redrawFrame = null;
  function redrawSized() {
    if (redrawFrame) return;
    redrawFrame = (root.requestAnimationFrame || setTimeout)(function () {
      redrawFrame = null;
      drawChart(lastRendered && lastRendered.trace, lastRendered && lastRendered.traces);
      drawCourse(latestSnapshot && latestSnapshot.course, lastRendered && lastRendered.trace);
    });
  }
  root.addEventListener('resize', redrawSized);
  if (typeof root.ResizeObserver === 'function') {
    var sizes = new WeakMap();
    var observer = new root.ResizeObserver(function (entries) {
      var changed = entries.some(function (entry) {
        var box = entry.contentRect;
        var key = Math.round(box.width) + 'x' + Math.round(box.height);
        if (sizes.get(entry.target) === key) return false;
        sizes.set(entry.target, key);
        return true;
      });
      if (changed) redrawSized();
    });
    ['.chart-wrap', '.map-wrap', '.elev-wrap'].forEach(function (selector) {
      var node = document.querySelector(selector);
      if (node) observer.observe(node);
    });
  }

  root.RunwayDemoRender = {setHeader: setHeader, setStage: setStage, setBanner: setBanner,
    setConnection: setConnection, renderSnapshot: renderSnapshot, renderTrace: renderTrace,
    updateCourse: updateCourse, reset: reset, setZoom: setZoom, setWaiting: setWaiting};
}(window));
