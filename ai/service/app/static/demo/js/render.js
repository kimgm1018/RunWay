(function (root) {
  'use strict';

  var ns = 'http://www.w3.org/2000/svg';
  var latestSnapshot = null;
  var timerIds = [];
  var animationRunning = false;
  var queuedUpdate = null;
  var zoomEnabled = false;

  function byId(id) { return document.getElementById(id); }
  function put(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '—' : String(value); }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function svg(name, attrs) {
    var el = document.createElementNS(ns, name);
    Object.keys(attrs || {}).forEach(function (key) { el.setAttribute(key, String(attrs[key])); });
    return el;
  }
  function line(parent, points, color, width, dash) {
    if (!points.length) return;
    parent.appendChild(svg('polyline', {points: points.map(function (p) { return p[0] + ',' + p[1]; }).join(' '),
      fill: 'none', stroke: color, 'stroke-width': width || 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-dasharray': dash || ''}));
  }
  function formatNumber(value, digits) {
    var number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits == null ? 0 : digits) : '—';
  }
  function deltaText(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number > 0 ? '+' + Math.round(number) : number < 0 ? '−' + Math.abs(Math.round(number)) : '0';
  }
  function stageText(stage, speed) {
    if (stage === 'L3') return '재생 ' + (speed || 1) + '×';
    return stage || '대기';
  }

  function setHeader(modelLabel, policyVersion) {
    put('model-label', modelLabel || '예측기 대기');
    put('policy-label', '정책 ' + (policyVersion || 'mpc-v0.4.1') + ' · 같은 정책, 예측기만 다름');
  }

  function setStage(stage, speed) { put('stage-badge', stageText(stage, speed)); }

  function setBanner(banner) {
    var el = byId('banner');
    if (!el) return;
    if (!banner) {
      el.textContent = '';
      el.className = 'banner hidden';
      return;
    }
    el.textContent = banner.text || '';
    el.className = 'banner ' + (banner.kind || '');
  }

  function setConnection(text) { put('connection-state', text); }

  function drawCourse(course, trace) {
    var map = byId('course-map');
    var elevation = byId('elevation');
    clear(map); clear(elevation);
    var points = course && Array.isArray(course.points) ? course.points : [];
    if (points.length < 2) {
      map.appendChild(svg('text', {x: 240, y: 140, 'text-anchor': 'middle', fill: '#8ba1b5'})).textContent = '코스 데이터 없음';
      elevation.appendChild(svg('text', {x: 240, y: 65, 'text-anchor': 'middle', fill: '#8ba1b5'})).textContent = '고도 데이터 없음';
      return;
    }
    var lonMin = Math.min.apply(null, points.map(function (p) { return p[0]; }));
    var lonMax = Math.max.apply(null, points.map(function (p) { return p[0]; }));
    var latMin = Math.min.apply(null, points.map(function (p) { return p[1]; }));
    var latMax = Math.max.apply(null, points.map(function (p) { return p[1]; }));
    var lonSpan = lonMax - lonMin || 1;
    var latSpan = latMax - latMin || 1;
    var mapPoints = points.map(function (p) {
      return [24 + (p[0] - lonMin) / lonSpan * 432, 20 + (latMax - p[1]) / latSpan * 240];
    });
    line(map, mapPoints, '#56d2eb', 4);
    map.appendChild(svg('circle', {cx: mapPoints[0][0], cy: mapPoints[0][1], r: 6, fill: '#66dda5'}));
    map.appendChild(svg('circle', {cx: mapPoints[mapPoints.length - 1][0], cy: mapPoints[mapPoints.length - 1][1], r: 6, fill: '#ff777e'}));
    var distance = trace && trace.input ? Number(trace.input.routeProgressM == null ? trace.input.distanceM : trace.input.routeProgressM) : 0;
    var routeLength = Number(course.lengthM) || Number(points[points.length - 1][3]) || 0;
    var target = routeLength > 0 ? Math.max(0, Math.min(1, distance / routeLength)) : 0;
    var current = mapPoints[Math.min(mapPoints.length - 1, Math.round(target * (mapPoints.length - 1)))];
    map.appendChild(svg('circle', {cx: current[0], cy: current[1], r: 9, fill: '#f2f5f8', stroke: '#172b3b', 'stroke-width': 4}));

    var elevatedPoints = points.filter(function (p) { return p[2] != null && Number.isFinite(Number(p[2])); });
    if (elevatedPoints.length < 2) {
      elevation.appendChild(svg('text', {x: 240, y: 65, 'text-anchor': 'middle', fill: '#8ba1b5'})).textContent = '고도 데이터 없음';
      return;
    }
    var elevations = elevatedPoints.map(function (p) { return Number(p[2]); });
    var eMin = Math.min.apply(null, elevations);
    var eMax = Math.max.apply(null, elevations);
    var eSpan = eMax - eMin || 1;
    var elevPoints = elevatedPoints.map(function (p) {
      var d = Number(p[3]) || 0;
      var x = routeLength > 0 ? 18 + Math.max(0, Math.min(1, d / routeLength)) * 444 : 18;
      return [x, 106 - (Number(p[2]) - eMin) / eSpan * 88];
    });
    line(elevation, elevPoints, '#f2ba64', 3);
  }

  function drawChart(trace) {
    var chart = byId('hr-chart');
    if (!chart) return;
    clear(chart);
    var input = trace && trace.input || {};
    var actual = input.tail && Array.isArray(input.tail.hrBpm) ? input.tail.hrBpm.filter(function (v) { return v != null; }).map(Number) : [];
    var candidates = Array.isArray(trace && trace.candidates) ? trace.candidates : [];
    var chosenIndex = trace && trace.decision && trace.decision.chosenIndex;
    var chosen = Number.isInteger(chosenIndex) ? candidates[chosenIndex] : null;
    var predictions = chosen && Array.isArray(chosen.predHrBpm) ? chosen.predHrBpm.map(Number) : [];
    var allowBpm = trace && trace.reference && Number(trace.reference.allowBpm);
    var values = actual.concat(predictions).filter(Number.isFinite);
    if (!values.length) {
      chart.appendChild(svg('text', {x: 450, y: 125, 'text-anchor': 'middle', fill: '#8ba1b5'})).textContent = '심박 입력을 기다리고 있습니다';
      return;
    }
    if (Number.isFinite(allowBpm)) values.push(allowBpm);   // 확대 보기에서도 허용선이 화면 안에 있게 한다
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (zoomEnabled) { lo -= 4; hi += 4; } else { lo = Math.min(100, lo - 5); hi = Math.max(210, hi + 5); }
    if (hi - lo < 1) hi = lo + 1;
    var y = function (v) { return 220 - (v - lo) / (hi - lo) * 190; };
    [0, 1, 2, 3].forEach(function (i) {
      var yy = 28 + i * 58;
      chart.appendChild(svg('line', {x1: 46, y1: yy, x2: 890, y2: yy, stroke: '#21374b', 'stroke-width': 1}));
      chart.appendChild(svg('text', {x: 40, y: yy + 4, 'text-anchor': 'end', fill: '#8ba1b5', 'font-size': 12}))
        .textContent = String(Math.round(lo + (220 - yy) / 190 * (hi - lo)));
    });
    if (Number.isFinite(allowBpm)) {
      line(chart, [[46, y(allowBpm)], [890, y(allowBpm)]], '#ffd166', 2, '7 6');
      chart.appendChild(svg('text', {x: 886, y: y(allowBpm) - 6, 'text-anchor': 'end', fill: '#ffd166', 'font-size': 12}))
        .textContent = '허용 ' + Math.round(allowBpm);
    }
    var actualPts = actual.map(function (v, i) { return [50 + (actual.length <= 1 ? 0 : i / (actual.length - 1)) * 520, y(v)]; });
    line(chart, actualPts, '#54d7e8', 3);
    if (actualPts.length) chart.appendChild(svg('circle', {cx: actualPts[actualPts.length - 1][0], cy: actualPts[actualPts.length - 1][1], r: 5, fill: '#54d7e8'}));
    var startX = actualPts.length ? actualPts[actualPts.length - 1][0] : 570;
    var predPts = predictions.map(function (v, i) { return [startX + (i + 1) * 105, y(v)]; });
    if (predPts.length && actualPts.length) predPts.unshift(actualPts[actualPts.length - 1]);
    line(chart, predPts, '#6eabff', 4);
    predPts.slice(actualPts.length ? 1 : 0).forEach(function (p) { chart.appendChild(svg('circle', {cx: p[0], cy: p[1], r: 4, fill: '#6eabff'})); });
    if (chosen && Array.isArray(chosen.upperHrBpm)) {
      chosen.upperHrBpm.slice(0, 3).forEach(function (v, i) {
        if (v != null && predPts[i + (actualPts.length ? 1 : 0)]) {
          var pt = predPts[i + (actualPts.length ? 1 : 0)];
          chart.appendChild(svg('circle', {cx: pt[0], cy: y(Number(v)), r: 3, fill: 'none', stroke: '#ff777e', 'stroke-width': 2}));
        }
      });
    }
  }

  function candidateCards(trace, animate) {
    var host = byId('candidate-list');
    if (!host) return [];
    clear(host);
    var candidates = Array.isArray(trace && trace.candidates) ? trace.candidates : [];
    var chosen = trace && trace.decision && trace.decision.chosenIndex;
    return candidates.map(function (candidate, index) {
      var card = document.createElement('article');
      card.className = 'candidate-card' + (animate ? '' : ' revealed');
      var delta = document.createElement('span');
      delta.textContent = deltaText(candidate.deltaSecPerKm);
      var pace = document.createElement('strong');
      pace.textContent = root.RunwayDemoLogic.formatPace(candidate.paceSecPerKm) + '/km';
      var detail = document.createElement('small');
      var hr = candidate.predHrBpm && candidate.predHrBpm.length > 2 ? Math.round(candidate.predHrBpm[2]) + ' bpm' : '예측 대기';
      detail.textContent = hr + (candidate.passed === false ? ' · ' + (candidate.rejectReason || '안전 기준 미통과') : ' · 안전 기준 통과');
      card.appendChild(delta); card.appendChild(pace); card.appendChild(detail);
      if (index === chosen) card.classList.add('recommended');
      if (candidate.passed === false && !animate) card.classList.add('rejected');
      host.appendChild(card);
      return card;
    });
  }

  function reasonLine(trace) {
    var decision = trace && trace.decision || {};
    var reason = decision.reasonText || decision.reason || trace && trace.status || '판단 기록을 기다리고 있습니다.';
    put('reason-line', reason);
  }

  function addRecords(traces) {
    var list = byId('record-list');
    if (!list) return;
    clear(list);
    var rows = (traces || []).slice(-60).reverse();
    rows.forEach(function (trace) {
      var item = document.createElement('li');
      item.className = 'record-item';
      item.setAttribute('data-trace-id', trace.traceId || '');
      var time = document.createElement('time');
      var date = new Date(trace.inputAsOf || '');
      time.textContent = Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('ko-KR', {hour12: false});
      var title = document.createElement('strong');
      var decision = trace.decision || {};
      title.textContent = decision.action === 'EASE_OFF' ? '속도 낮추기' : decision.recommendedPaceSecPerKm != null
        ? root.RunwayDemoLogic.formatPace(decision.recommendedPaceSecPerKm) + '/km' : trace.status || '판단 대기';
      var status = document.createElement('span');
      status.textContent = trace.status || '';
      item.appendChild(time); item.appendChild(title); item.appendChild(status);
      list.appendChild(item);
    });
    put('record-count', rows.length);
  }

  function addRestartMarker() {
    var list = byId('record-list');
    if (!list || list.querySelector('.restart-marker')) return;
    var marker = document.createElement('li');
    marker.className = 'restart-marker';
    marker.textContent = 'AI 재시작';
    list.insertBefore(marker, list.firstChild);
  }

  function applyTrace(trace, traces, options) {
    var started = performance.now();
    var stage = options.stage || trace.stage || (latestSnapshot && latestSnapshot.stage);
    setStage(stage, options.replaySpeed || trace.replaySpeed || 1);
    var guide = root.RunwayDemoLogic.guideCard(trace);
    put('guide-pace', guide.paceText);
    put('guide-action', guide.actionText);
    put('guide-delivery', options.replay ? '재생' : guide.deliveryText);
    put('metric-hr', trace.input && trace.input.hrNowBpm != null ? Math.round(trace.input.hrNowBpm) + ' bpm' : '—');
    put('metric-pace', trace.input && trace.input.paceNowSecPerKm != null ? root.RunwayDemoLogic.formatPace(trace.input.paceNowSecPerKm) + '/km' : '—');
    put('metric-grade', trace.input && trace.input.gradeNext120sPct != null ? formatNumber(trace.input.gradeNext120sPct, 1) + '%' : '—');
    var elapsed = Number(trace.elapsedSec);
    var minutes = Number.isFinite(elapsed) ? Math.floor(elapsed / 60) + ':' + String(Math.floor(elapsed % 60)).padStart(2, '0') : '—';
    put('metric-distance', formatNumber(trace.input && trace.input.distanceM, 0) + ' m · ' + minutes);
    var lag = stage === 'L3' || !trace.latency || trace.latency.inputLagMs == null ? '—' : formatNumber(trace.latency.inputLagMs, 0) + ' ms';
    var decide = trace.latency && trace.latency.decideMs != null ? formatNumber(trace.latency.decideMs, 1) + ' ms' : '—';
    put('metric-latency', lag + ' · ' + decide);
    var modelLabel = options.modelLabel || trace.modelVersion || '대기';
    if (String(modelLabel).indexOf('예측기') !== 0) modelLabel = '예측기: ' + modelLabel;
    setHeader(modelLabel, options.policyVersion || trace.policyVersion || 'mpc-v0.4.1');
    put('runner-label', latestSnapshot && latestSnapshot.label || '러너');
    var cards = candidateCards(trace, options.animate === true);
    drawChart(trace);
    drawCourse(latestSnapshot && latestSnapshot.course, trace);
    addRecords(traces);
    if (options.restartMarker) addRestartMarker();
    var check = root.RunwayDemoLogic.checkText(trace.check120);
    var checkLine = document.querySelector('.check-line');
    if (checkLine) checkLine.textContent = check || '비교 대기';
    put('mae-line', trace.mae10MinBpm == null ? '10분 평균 실차 —' : '10분 평균 실차 ' + formatNumber(trace.mae10MinBpm, 1) + ' bpm');
    var banner = root.RunwayDemoLogic.bannerFor({trace: trace, nowMs: Date.now(), serverOffsetMs: options.serverOffsetMs || 0,
      lastMessageAtMs: options.lastMessageAtMs, stage: stage});
    setBanner(banner);
    root.__demoMetrics = root.__demoMetrics || {};
    root.__demoMetrics.renderLagMs = Math.max(0, performance.now() - started);
    if (options.animate) {
      animationRunning = true;
      cards.forEach(function (card, index) {
        timerIds.push(setTimeout(function () { card.classList.add('revealed'); }, 300 * (index + 1)));
      });
      timerIds.push(setTimeout(function () {
        cards.forEach(function (card, index) {
          var candidate = (trace.candidates || [])[index];
          if (candidate && candidate.passed === false) card.classList.add('rejected');
        });
      }, 2100));
      timerIds.push(setTimeout(function () {
        if (Number.isInteger(trace.decision && trace.decision.chosenIndex) && cards[trace.decision.chosenIndex]) {
          cards[trace.decision.chosenIndex].classList.add('recommended');
        }
      }, 2500));
      timerIds.push(setTimeout(function () {
        reasonLine(trace);
      }, 2800));
      timerIds.push(setTimeout(function () {
        animationRunning = false;
        timerIds = [];
        if (queuedUpdate) {
          var queued = queuedUpdate;
          queuedUpdate = null;
          renderTrace(queued.trace, queued.traces, queued.options);
        }
      }, 3000));
    } else {
      reasonLine(trace);
    }
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
    ['metric-hr', 'metric-pace', 'metric-grade', 'metric-distance', 'metric-latency'].forEach(function (id) { put(id, '—'); });
    put('guide-pace', '—/km'); put('guide-action', '대기'); put('guide-delivery', '대기');
    put('reason-line', '판단 기록을 기다리고 있습니다.');
    put('record-count', '0'); put('mae-line', '10분 평균 실차 —');
    clear(byId('record-list')); clear(byId('candidate-list')); clear(byId('hr-chart'));
    setBanner(null);
    renderSnapshot(snapshot || {});
  }

  function setZoom(value) {
    zoomEnabled = !!value;
    var traces = root.__demoState && root.__demoState.traces || [];
    if (traces.length) drawChart(traces[traces.length - 1]);
  }

  root.RunwayDemoRender = {setHeader: setHeader, setStage: setStage, setBanner: setBanner,
    setConnection: setConnection, renderSnapshot: renderSnapshot, renderTrace: renderTrace,
    updateCourse: updateCourse, reset: reset, setZoom: setZoom};
}(window));
