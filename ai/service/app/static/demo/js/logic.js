(function (root) {
  'use strict';

  function parseSseChunk(text) {
    var normalized = String(text || '').replace(/\r\n/g, '\n');
    var blocks = normalized.split('\n\n');
    var rest = blocks.pop();
    var events = [];
    blocks.forEach(function (block) {
      if (!block) return;
      var eventName = 'message';
      var data = [];
      block.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) eventName = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
      });
      if (!data.length) return;
      var joined = data.join('\n');
      var parsed;
      try { parsed = JSON.parse(joined); } catch (_) { parsed = joined; }
      events.push({event: eventName, data: parsed});
    });
    return {events: events, rest: rest};
  }

  function backoffMs(attempt) {
    if (attempt <= 0) return 1000;
    if (attempt === 1) return 2000;
    return 5000;
  }

  function bannerFor(options) {
    var trace = options.trace || {};
    var nowMs = options.nowMs;
    var stage = options.stage;
    var lastMessage = options.lastMessageAtMs;
    if (lastMessage != null && nowMs - lastMessage > 45000) return {kind: 'disconnected', text: '연결 끊김'};
    if (trace.status === 'PAUSED') return {kind: 'paused', text: '일시정지'};
    var asOf = Date.parse(trace.inputAsOf || '');
    var adjustedNow = nowMs + (options.serverOffsetMs || 0);
    if (trace.status === 'INPUT_INSUFFICIENT' || (stage !== 'L3' && Number.isFinite(asOf) && adjustedNow - asOf >= 20000)) {
      return {kind: 'insufficient', text: '입력 부족·20초 이상'};
    }
    if (trace.status === 'SAFETY') return {kind: 'safety', text: '속도 낮추기'};
    if (trace.status === 'HR_STALE') return {kind: 'stale', text: '입력 지연 20초+: 가속 안 함'};
    if (stage !== 'L3' && trace.latency && trace.latency.inputLagMs < -2000) {
      return {kind: 'clock', text: '기기 시계 확인'};
    }
    return null;
  }

  function signed(value) {
    var rounded = Math.round(Number(value));
    if (!Number.isFinite(rounded) || rounded === 0) return rounded === 0 ? '0' : '—';
    return rounded < 0 ? '−' + Math.abs(rounded) : '+' + rounded;
  }

  function checkText(check) {
    if (!check) return null;
    if (check.notComparableReason === 'OUT_OF_CANDIDATE_RANGE') return '비교 불가(후보 범위 밖)';
    if (check.shown === 'RECOMMENDED' && check.recommended) {
      return '추천대로 뜀 · 예측 ' + Math.round(check.recommended.predHr120Bpm) +
        ' → 실측 ' + Math.round(check.actualHrBpm) + ' (' + signed(check.recommended.errorBpm) + ')';
    }
    if (check.shown === 'NEAREST' && check.nearest) {
      return '추천과 다르게 뜀 · 실제 속도 후보(' + signed(check.nearest.deltaSecPerKm) +
        ') 예측 ' + Math.round(check.nearest.predHr120Bpm) + ' → 실측 ' + Math.round(check.actualHrBpm) +
        ' (' + signed(check.nearest.errorBpm) + ')';
    }
    return null;
  }

  function zoomDeltas(candidates) {
    if (!Array.isArray(candidates) || candidates.length < 3 || !candidates[2].predHrBpm) return [];
    var base = candidates[2].predHrBpm[2];
    return candidates.map(function (candidate) {
      return candidate.predHrBpm && candidate.predHrBpm[2] != null && base != null
        ? candidate.predHrBpm[2] - base : null;
    });
  }

  function formatPace(sec) {
    if (sec == null || !Number.isFinite(Number(sec))) return '—';
    var value = Math.max(0, Math.round(Number(sec)));
    return Math.floor(value / 60) + "'" + String(value % 60).padStart(2, '0') + '"';
  }

  function guideCard(trace) {
    trace = trace || {};
    var decision = trace.decision || {};
    var action = decision.action;
    var candidate = (trace.candidates || [])[decision.chosenIndex];
    var delta = candidate && candidate.deltaSecPerKm;
    var actionText = action === 'EASE_OFF' ? '속도 낮추기' : delta === 0 ? '유지' : delta < 0 ? '가속' : delta > 0 ? '감속' : '—';
    var delivery = trace.coaching && trace.coaching.delivery;
    var deliveryText = {WATCH: '워치 적용', NOT_DELIVERED: '워치 미전달', REPLAY: '재생'}[delivery] || '워치 미전달';
    return {paceText: formatPace(decision.recommendedPaceSecPerKm) + '/km', actionText: actionText, deliveryText: deliveryText};
  }

  // 서버 데모 버퍼(app/demo/buffer.py WINDOW_SEC)와 같은 값. 두 값이 같은지는 테스트로 확인한다
  var TRACE_WINDOW_SEC = 600;

  function mergeTraces(list, incoming) {
    var map = new Map();
    (list || []).forEach(function (trace) { if (trace && trace.traceId) map.set(trace.traceId, trace); });
    (Array.isArray(incoming) ? incoming : [incoming]).forEach(function (trace) {
      if (trace && trace.traceId) map.set(trace.traceId, trace);
    });
    var sorted = Array.from(map.values()).sort(function (a, b) {
      return Date.parse(a.inputAsOf || 0) - Date.parse(b.inputAsOf || 0);
    });
    // 서버와 같은 규칙: 가장 늦은 inputAsOf에서 10분보다 오래된 판단 기록은 버린다
    var latest = -Infinity;
    sorted.forEach(function (trace) {
      var ms = Date.parse(trace.inputAsOf || '');
      if (Number.isFinite(ms) && ms > latest) latest = ms;
    });
    if (!Number.isFinite(latest)) return sorted;
    var cutoff = latest - TRACE_WINDOW_SEC * 1000;
    return sorted.filter(function (trace) {
      var ms = Date.parse(trace.inputAsOf || '');
      return !Number.isFinite(ms) || ms >= cutoff;
    });
  }

  function recordingOptionTexts(recordings) {
    var list = recordings || [];
    // 러닝이 둘 이상이면 같은 예측기 이름이 겹치므로 러닝 이름을 붙인다
    var labels = new Set(list.map(function (r) { return r && r.label; }));
    return list.map(function (r) {
      var text = '예측기: ' + ((r && (r.modelLabel || r.modelVersion)) || '알 수 없음');
      return labels.size > 1 && r && r.label ? text + ' · ' + r.label : text;
    });
  }

  var RunwayDemoLogic = {
    recordingOptionTexts: recordingOptionTexts,
    parseSseChunk: parseSseChunk,
    backoffMs: backoffMs,
    bannerFor: bannerFor,
    checkText: checkText,
    zoomDeltas: zoomDeltas,
    formatPace: formatPace,
    guideCard: guideCard,
    mergeTraces: mergeTraces,
    TRACE_WINDOW_SEC: TRACE_WINDOW_SEC
  };

  root.RunwayDemoLogic = RunwayDemoLogic;
  if (typeof module !== 'undefined' && module.exports) module.exports = RunwayDemoLogic;
}(typeof window !== 'undefined' ? window : globalThis));
