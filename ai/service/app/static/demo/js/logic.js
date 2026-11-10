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
    if (!Array.isArray(candidates)) return [];
    // 안내 그대로 후보(deltaSecPerKm 0). 후보가 9개(S15P31E105-624)면 3번, 옛 기록(5개)이면 2번이다.
    var zero = candidates.filter(function (c) { return c && c.deltaSecPerKm === 0; })[0] || candidates[2];
    if (!zero || !zero.predHrBpm) return [];
    var base = zero.predHrBpm[2];
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
    return {paceText: formatPace(decision.recommendedPaceSecPerKm) + '/km', actionText: actionText, deliveryText: deliveryText,
      actionKind: actionKind(trace)};
  }

  // 화면에 따로 버전이 오지 않을 때 쓰는 현재 정책 버전(app/policy/policy_v03.json policy_version)
  var DEFAULT_POLICY_VERSION = 'mpc-v0.4.3';

  function policyVersionOf(trace, recording) {
    var fromTrace = trace && trace.policyVersion;
    var fromRecording = recording && recording.policyVersion;
    return fromTrace || fromRecording || DEFAULT_POLICY_VERSION;
  }

  // 정책 탈락 이유(app/policy/mpc_policy.py reject_reason)를 화면 문구로 바꾼다
  var REJECT_TEXT = {
    UPPER_OVER_ALLOW: '허용선 초과',
    GATE_SLOW_ONLY: '감속만 허용',
    GATE_HOLD_OR_SLOW: '가속 금지',
    HR_STALE: '입력 지연',
    ACCEL_IN_HOLD: '안내 유지 중',
    SLOW_IN_HOLD: '감속 대기',
    SAFETY: '위험 심박'
  };

  function rejectReasonText(reason) {
    if (!reason) return '안전 기준 미통과';
    return REJECT_TEXT[reason] || String(reason);
  }

  // 안내 방향: up 가속 · hold 유지 · down 감속 · ease 위험 감속 · idle 판단 없음
  function actionKind(trace) {
    var decision = trace && trace.decision || {};
    if (decision.action === 'EASE_OFF') return 'ease';
    var candidate = (trace && trace.candidates || [])[decision.chosenIndex];
    var delta = candidate && Number(candidate.deltaSecPerKm);
    if (!candidate || !Number.isFinite(delta)) return 'idle';
    return delta < 0 ? 'up' : delta > 0 ? 'down' : 'hold';
  }

  function formatElapsed(sec) {
    var value = Number(sec);
    if (sec == null || !Number.isFinite(value) || value < 0) return '—';
    value = Math.floor(value);
    var h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = value % 60;
    var mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return (h > 0 ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  // 후보 막대의 공통 세로 범위. 허용선과 모든 예측·상한이 들어가고, 허용선이 위쪽 3/4 근처에 오게 한다
  function gaugeRange(candidates, allowBpm) {
    var values = [];
    (candidates || []).forEach(function (c) {
      if (c && Array.isArray(c.predHrBpm) && c.predHrBpm[2] != null) values.push(Number(c.predHrBpm[2]));
      if (c && c.peakUpperBpm != null) values.push(Number(c.peakUpperBpm));
    });
    var allow = Number(allowBpm);
    if (allowBpm != null && Number.isFinite(allow)) values.push(allow);
    values = values.filter(Number.isFinite);
    if (!values.length) return null;
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var hi = max + 18;
    var lo = Math.min(min - 12, hi - 46);
    return {lo: lo, hi: hi};
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

  function signedSec(value) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) return '—';
    return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0';
  }

  // 후보 개수·간격은 데이터에서 읽는다(개인 AI04 5개, 그룹 AI10 9개 등). 화면에 고정 문구를 두지 않는다
  function candidateSummary(candidates) {
    var deltas = (candidates || []).map(function (c) { return c && Number(c.deltaSecPerKm); }).filter(Number.isFinite);
    if (!deltas.length) return {count: (candidates || []).length, text: ''};
    var lo = Math.min.apply(null, deltas), hi = Math.max.apply(null, deltas);
    return {count: candidates.length, min: lo, max: hi,
      text: '후보 ' + candidates.length + '개 · ' + signedSec(lo) + ' ~ ' + signedSec(hi) + '초/km'};
  }

  // 어떤 판단기가 낸 기록인지: trace.group이 있으면 그룹 공동 페이스(AI10), 아니면 개인 페이스(AI04)
  function modeOf(trace) {
    if (trace && trace.group) return {kind: 'group', label: trace.group.label || '그룹 공동 페이스 · AI10'};
    return {kind: 'personal', label: '개인 페이스 · AI04'};
  }

  // 그룹 판단(제안 형식, 아직 데모 스트림에 들어오지 않음):
  // trace.group = {label?, candidates:[{deltaSecPerKm, paceSecPerKm}], chosenIndex,
  //                members:[{label, allowBpm, upperHrBpm:[후보별 120초 예측+여유]}]}
  // 행 = 멤버, 열 = 후보. 칸 값 = 허용선까지 남은 bpm(음수면 초과). 고른 후보에서 여유가 가장 작은 멤버가 worst.
  function groupMatrix(group) {
    if (!group || !Array.isArray(group.members) || !Array.isArray(group.candidates)) return null;
    var chosen = Number.isInteger(group.chosenIndex) ? group.chosenIndex : null;
    var worst = null, worstHeadroom = Infinity;
    var rows = group.members.map(function (member, index) {
      var allow = Number(member && member.allowBpm);
      var uppers = member && Array.isArray(member.upperHrBpm) ? member.upperHrBpm : [];
      var cells = group.candidates.map(function (_, j) {
        var upper = uppers[j] == null ? NaN : Number(uppers[j]);
        var headroom = Number.isFinite(upper) && Number.isFinite(allow) ? allow - upper : null;
        return {upper: Number.isFinite(upper) ? upper : null, headroom: headroom, passed: headroom == null ? null : headroom > 0};
      });
      var atChosen = chosen != null && cells[chosen] ? cells[chosen].headroom : null;
      if (atChosen != null && atChosen < worstHeadroom) { worstHeadroom = atChosen; worst = index; }
      return {label: member && member.label || '멤버 ' + (index + 1), allow: Number.isFinite(allow) ? allow : null, cells: cells};
    });
    return {rows: rows, chosenIndex: chosen, worstIndex: worst};
  }

  var RunwayDemoLogic = {
    candidateSummary: candidateSummary,
    modeOf: modeOf,
    groupMatrix: groupMatrix,
    recordingOptionTexts: recordingOptionTexts,
    parseSseChunk: parseSseChunk,
    backoffMs: backoffMs,
    bannerFor: bannerFor,
    checkText: checkText,
    zoomDeltas: zoomDeltas,
    formatPace: formatPace,
    guideCard: guideCard,
    mergeTraces: mergeTraces,
    TRACE_WINDOW_SEC: TRACE_WINDOW_SEC,
    DEFAULT_POLICY_VERSION: DEFAULT_POLICY_VERSION,
    policyVersionOf: policyVersionOf,
    rejectReasonText: rejectReasonText,
    actionKind: actionKind,
    formatElapsed: formatElapsed,
    gaugeRange: gaugeRange
  };

  root.RunwayDemoLogic = RunwayDemoLogic;
  if (typeof module !== 'undefined' && module.exports) module.exports = RunwayDemoLogic;
}(typeof window !== 'undefined' ? window : globalThis));
