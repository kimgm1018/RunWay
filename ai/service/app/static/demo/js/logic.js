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

  // 738: '이전 기록' 목록 한 줄. 시각(브라우저 현지), 개인/그룹, 길이, 판단 수, 진행 중 여부.
  function historyRowText(row) {
    if (!row) return '';
    var date = new Date(row.startedAt || '');
    var time = Number.isNaN(date.getTime()) ? '—' :
      String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    var minutes = Math.max(0, Math.round(Number(row.durationSec) / 60) || 0);
    var kind = row.kind === 'GROUP' ? '그룹' : '개인';
    return time + ' · ' + kind + ' · ' + (minutes < 1 ? '1분 미만' : minutes + '분') + ' · 판단 ' + (Number(row.traceCount) || 0) + '건' +
      (row.live ? ' · 진행 중' : '');
  }

  var GROUP_STALE_MS = 50000;

  // 736: 판단 기록 머리의 '마지막 판단 N초 전'. 라이브에서만, 서버 시각 보정 후 판단 시각(없으면 입력 시각) 기준.
  function lastDecisionText(trace, nowMs, serverOffsetMs) {
    if (!trace) return '';
    var at = Date.parse(trace.decidedAt || trace.inputAsOf || '');
    if (!Number.isFinite(at)) return '';
    var sec = Math.max(0, Math.round((nowMs + (serverOffsetMs || 0) - at) / 1000));
    if (sec < 60) return '마지막 판단 ' + sec + '초 전';
    return '마지막 판단 ' + Math.floor(sec / 60) + '분 ' + (sec % 60) + '초 전';
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
    if (trace.status === 'INPUT_INSUFFICIENT') return {kind: 'insufficient', text: '입력 부족·20초 이상'};
    // 736: 그룹(AI10)은 30초마다 판단하므로 20초 기준이면 정상 운행 중에도 매 주기 배너가 켜졌다 꺼진다.
    // 그룹은 GROUP_STALE_MS(판단 간격 30초 + 여유) 넘게 새 판단이 없을 때만 '판단 지연'으로 알린다.
    if (stage !== 'L3' && Number.isFinite(asOf)) {
      var age = adjustedNow - asOf;
      if (trace.kind === 'GROUP' && age >= GROUP_STALE_MS) {
        return {kind: 'stale', text: '판단 지연 ' + Math.round(age / 1000) + '초 · 새 기록 없음'};
      }
      if (trace.kind !== 'GROUP' && age >= 20000) return {kind: 'insufficient', text: '입력 부족·20초 이상'};
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

  // 724: 실제(측정) 페이스 표시. 바탕은 AI가 보낸 최근 속도 12칸(5초 간격, 약 60초) 평균.
  // 속도가 없으면 '—', 0.83 m/s(20'00"/km)보다 느리면 '정지'로 보여 큰 숫자가 나오지 않게 한다. 판단에는 쓰지 않는다.
  var ACTUAL_WINDOW_TEXT = '최근 60초 평균';
  var STOP_SPEED_MPS = 1000 / 1200;
  function actualPace(speedMps, paceSec) {
    var speed = speedMps == null ? NaN : Number(speedMps);
    if (!Number.isFinite(speed)) {
      var pace = paceSec == null ? NaN : Number(paceSec);     // 옛 기록: 속도 칸이 없으면 페이스로 판단
      if (!Number.isFinite(pace) || pace <= 0) return {kind: 'none', text: '—', sec: null};
      speed = 1000 / pace;
    }
    if (speed < STOP_SPEED_MPS) return {kind: 'stopped', text: '정지', sec: null};
    var sec = 1000 / speed;
    if (sec < 120) return {kind: 'none', text: '—', sec: null};  // 2'00"/km보다 빠르면 측정 오류로 본다
    return {kind: 'pace', text: formatPace(sec), sec: sec};
  }

  // 747: 안내 카드의 '지금(실제)' 한 값. 개인은 그대로, 그룹은 달리는 러너의 평균
  function actualSummary(actuals) {
    var paces = (actuals || []).filter(function (a) { return a && a.kind === 'pace' && Number.isFinite(a.sec); });
    if (paces.length) {
      var mean = paces.reduce(function (sum, a) { return sum + a.sec; }, 0) / paces.length;
      return formatPace(mean);
    }
    return (actuals || []).some(function (a) { return a && a.kind === 'stopped'; }) ? '정지' : '—';
  }

  function guideCard(trace) {
    trace = trace || {};
    var decision = trace.decision || {};
    var action = decision.action;
    var candidate = (trace.candidates || [])[decision.chosenIndex];
    var delta = candidate && candidate.deltaSecPerKm;
    var actionText = action === 'EASE_OFF' ? '속도 낮추기' : delta === 0 ? '유지' : delta < 0 ? '가속' : delta > 0 ? '감속' : '—';
    if (decision.reasonLabel) actionText = decision.reasonLabel;   // 그룹 AI10: 가속·감속·정상 · 유지·쿨다운·워밍업
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
  // 747: 청중용 안내 한 줄. 처음 보는 사람이 5초 안에 '지금 무슨 판단을 했는지' 알 수 있게 숫자 대신 말로.
  // tone: up(빠르게) / down(늦춤) / hold(유지) / wait(대기) / danger(위험)
  function josa(word, withFinal, withoutFinal) {
    var text = String(word || '');
    var last = text.charAt(text.length - 1);
    var hasFinal;
    if (/[0-9]/.test(last)) hasFinal = '013678'.indexOf(last) >= 0;          // 영·일·삼·육·칠·팔은 받침이 있다
    else {
      var code = last.charCodeAt(0) - 0xAC00;
      hasFinal = code >= 0 && code <= 11171 ? code % 28 !== 0 : false;
    }
    return text + (hasFinal ? withFinal : withoutFinal);
  }

  function headline(trace) {
    trace = trace || {};
    var decision = trace.decision || {};
    var status = trace.status;
    if (!trace.decision || status === 'INPUT_INSUFFICIENT' || decision.recommendedPaceSecPerKm == null) {
      return {tone: 'wait', text: '심박 대기'};
    }
    if (status === 'SAFETY') return {tone: 'danger', text: '위험 → 늦춤'};
    if (trace.group) {
      var group = trace.group;
      var worst = Number.isInteger(group.worstIndex) && group.members ? group.members[group.worstIndex] : null;
      var who = String(worst && worst.label ? worst.label : '한 명').replace(/\s+/g, '');
      var code = decision.reasonCode;
      if (code === 'SPEED_UP' || code === 'AHEAD') return {tone: 'up', text: '모두 여유 → 올림'};
      if (code === 'SLOW_DOWN') return {tone: 'down', text: who + ' 심박 높음 → 늦춤'};
      if (code === 'WARMUP') return {tone: 'down', text: '워밍업 → 늦춤'};
      if (code === 'COOLDOWN') return {tone: 'hold', text: '방금 바꿈 → 유지'};
      return {tone: 'hold', text: '알맞음 → 유지'};
    }
    var kind = actionKind(trace);
    if (kind === 'up') return {tone: 'up', text: '여유 → 올림'};
    if (kind === 'ease') return {tone: 'danger', text: '심박 높음 → 크게 늦춤'};
    if (kind === 'down') return {tone: 'down', text: '심박 오름 → 늦춤'};
    if (String(decision.reason || decision.reasonCode || '').indexOf('COOLDOWN') >= 0) return {tone: 'hold', text: '방금 바꿈 → 유지'};
    return {tone: 'hold', text: '알맞음 → 유지'};
  }

  // 판단 흐름 카드의 이유 한 단어(색과 함께)
  var TONE_WORD = {up: '여유', down: '힘듦', danger: '위험', hold: '유지', wait: '대기'};
  function toneWord(tone) { return TONE_WORD[tone] || ''; }

  function actionKind(trace) {
    var decision = trace && trace.decision || {};
    if (decision.action === 'EASE_OFF') return 'ease';
    if (decision.direction) return {FAST: 'up', SLOW: 'down', HOLD: 'hold'}[decision.direction] || 'idle';
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
    if (trace && (trace.group || trace.kind === 'GROUP')) {
      return {kind: 'group', label: trace.group && trace.group.label || '그룹 공동 페이스 · AI10'};
    }
    return {kind: 'personal', label: '개인 페이스 · AI04'};
  }

  // 그룹 판단(app/demo/group_trace.py build_group_trace):
  // trace.group = {candidates:[{deltaSecPerKm, paceSecPerKm, passed}], chosenIndex, worstIndex,
  //                members:[{label, hrNowBpm, allowBpm, predHr120Bpm[], upperHrBpm[], passed[]}]}
  // 행 = 멤버, 열 = 후보. 칸 = 120초 예측 심박과 허용선까지 남은 bpm(상한 기준, 음수면 초과).
  function groupMatrix(group) {
    if (!group || !Array.isArray(group.members) || !Array.isArray(group.candidates)) return null;
    var chosen = Number.isInteger(group.chosenIndex) ? group.chosenIndex : null;
    var worst = null, worstHeadroom = Infinity;
    var rows = group.members.map(function (member, index) {
      var allow = Number(member && member.allowBpm);
      var uppers = member && Array.isArray(member.upperHrBpm) ? member.upperHrBpm : [];
      var preds = member && Array.isArray(member.predHr120Bpm) ? member.predHr120Bpm : [];
      var passes = member && Array.isArray(member.passed) ? member.passed : [];
      var cells = group.candidates.map(function (_, j) {
        var upper = uppers[j] == null ? NaN : Number(uppers[j]);
        var pred = preds[j] == null ? NaN : Number(preds[j]);
        var headroom = Number.isFinite(upper) && Number.isFinite(allow) ? allow - upper : null;
        var passed = typeof passes[j] === 'boolean' ? passes[j] : headroom == null ? null : headroom > 0;
        return {upper: Number.isFinite(upper) ? upper : null, pred: Number.isFinite(pred) ? pred : null,
          headroom: headroom, passed: passed};
      });
      var atChosen = chosen != null && cells[chosen] ? cells[chosen].headroom : null;
      if (atChosen != null && atChosen < worstHeadroom) { worstHeadroom = atChosen; worst = index; }
      var hr = Number(member && member.hrNowBpm);
      return {label: member && member.label || '멤버 ' + (index + 1), allow: Number.isFinite(allow) ? allow : null,
        hrNow: member && member.hrNowBpm != null && Number.isFinite(hr) ? hr : null, cells: cells,
        actual: actualPace(member && member.speedNowMps, member && member.paceNowSecPerKm)};
    });
    if (Number.isInteger(group.worstIndex) && rows[group.worstIndex]) worst = group.worstIndex;
    var columns = group.candidates.map(function (c, j) {
      if (typeof c.passed === 'boolean') return c.passed;
      return rows.length ? rows.every(function (r) { return r.cells[j].passed !== false; }) : null;
    });
    return {rows: rows, chosenIndex: chosen, worstIndex: worst, columnsPassed: columns};
  }

  // 그룹 러닝 스트림 키(app/demo/buffer.py GROUP_KEY_OFFSET과 같은 값, 테스트로 확인). Nginx 숫자 경로를 그대로 쓴다
  var GROUP_KEY_OFFSET = 9000000000000;

  // ?session=<id>가 있으면 그 세션, ?group=<groupRunId>면 그룹 스트림, 둘 다 없으면 가장 최근 세션
  function streamRef(params) {
    var session = params.get('session');
    if (session) return session;
    var group = params.get('group');
    if (group && /^[0-9]+$/.test(group)) return String(GROUP_KEY_OFFSET + Number(group));
    return 'latest';
  }

  var RunwayDemoLogic = {
    lastDecisionText: lastDecisionText, GROUP_STALE_MS: GROUP_STALE_MS,
    actualPace: actualPace, ACTUAL_WINDOW_TEXT: ACTUAL_WINDOW_TEXT,
    GROUP_KEY_OFFSET: GROUP_KEY_OFFSET,
    streamRef: streamRef,
    candidateSummary: candidateSummary,
    modeOf: modeOf,
    groupMatrix: groupMatrix,
    recordingOptionTexts: recordingOptionTexts,
    parseSseChunk: parseSseChunk,
    headline: headline, josa: josa, toneWord: toneWord, actualSummary: actualSummary,
    historyRowText: historyRowText,
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
