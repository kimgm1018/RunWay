/* 767: 시연용 워치 화면의 계산(화면 없이 시험 가능). 실제 워치 앱(wear/app/.../ui)의 표시 규칙을 그대로 옮긴다.
 * SSE 값 → 워치가 받는 값으로 바꾸고, SSE에 없는 값은 만들지 않는다(null → 숨김 또는 "– –"). */
(function (root) {
  'use strict';

  var MISSING = '– –';                 // MetricFormat.MISSING
  var PACE_SLOWEST = 480, PACE_FASTEST = 240;   // RunStatusPage PaceScale(8’00” → 4’00”)
  var BPM_LOW = 150, BPM_HIGH = 190;            // PaceCoachingPage BpmScale
  var STOP_SPEED_MPS = 0.5;            // 콘솔 actualPace와 같은 정지 기준
  var MAX_FLASH_PER_SEC = 3;           // 박자 표시는 초당 3번을 넘지 않는다
  var NOTICE_HOLD_MS = 30000;          // 공동 페이스 변경 안내를 남겨 두는 시간

  function num(value) { var n = Number(value); return value != null && value !== '' && Number.isFinite(n) ? n : null; }

  // MetricFormat.pace: 정수 초, 1..3599만, %d’%02d”
  function pace(sec) {
    var s = num(sec);
    if (s == null) return {value: MISSING, missing: true};
    s = Math.round(s);
    if (s < 1 || s > 3599) return {value: MISSING, missing: true};
    return {value: Math.floor(s / 60) + '’' + String(s % 60).padStart(2, '0') + '”', missing: false, sec: s};
  }

  // MetricFormat.distance: 버림, 소수 둘째 자리, km
  function distance(meters) {
    var m = num(meters);
    if (m == null || m < 0) return {value: MISSING, unit: 'km', missing: true};
    var h = Math.floor(m / 10);
    return {value: Math.floor(h / 100) + '.' + String(h % 100).padStart(2, '0'), unit: 'km', missing: false};
  }

  // MetricFormat.duration
  function duration(sec) {
    var t = num(sec);
    if (t == null || t < 0) return {value: MISSING, missing: true};
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return {value: h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0'),
      missing: false};
  }

  function heart(bpm) {
    var b = num(bpm);
    if (b == null || Math.round(b) < 1 || Math.round(b) > 250) return {value: MISSING, missing: true};
    return {value: String(Math.round(b)), missing: false};
  }

  // 실제 페이스: 최근 속도 평균(콘솔과 같은 근거). 정지·없음은 값 없음
  function actualPaceSec(speedMps, paceSec) {
    var speed = num(speedMps);
    if (speed == null) {
      var p = num(paceSec);
      if (p == null || p <= 0) return null;
      speed = 1000 / p;
    }
    if (speed < STOP_SPEED_MPS) return null;
    var sec = 1000 / speed;
    return sec < 120 ? null : Math.round(sec);
  }

  function paceTicks(sec) {
    var s = num(sec);
    if (s == null || s < PACE_FASTEST || s > PACE_SLOWEST) return null;
    return (PACE_SLOWEST - s) / (PACE_SLOWEST - PACE_FASTEST);
  }

  function paceOutOfRange(sec) {
    var s = num(sec);
    return s != null && s > 0 && (s < PACE_FASTEST || s > PACE_SLOWEST);
  }

  function bpmTicks(bpm) {
    var b = num(bpm);
    if (b == null || b < BPM_LOW || b > BPM_HIGH) return null;
    return (b - BPM_LOW) / (BPM_HIGH - BPM_LOW);
  }

  // 박자 점: 리듬 BPM 박자마다 한 번. 초당 3번을 넘으면 두 박에 한 번(빛 깜빡임 제한)
  function beatIntervalMs(bpm) {
    var b = num(bpm);
    if (b == null || b <= 0) return null;
    var every = 1;
    while (b / every / 60 > MAX_FLASH_PER_SEC) every += 1;
    return Math.ceil(60000 / b * every);          // 올림: 반올림하면 180 BPM이 초당 3.003번이 된다
  }

  function signedGap(seconds) {
    var s = Math.abs(seconds);
    return s < 60 ? s + '”' : Math.floor(s / 60) + '’' + String(s % 60).padStart(2, '0') + '”';
  }

  // GroupRunDisplay.mine: "내 5’40” · −20”"
  function mineLine(ownSec, sharedSec) {
    if (ownSec == null || sharedSec == null) return null;
    var own = pace(ownSec), diff = own.sec - Math.round(sharedSec);
    if (own.missing) return null;
    if (diff > 0) return '내 ' + own.value + ' · +' + signedGap(diff);
    if (diff < 0) return '내 ' + own.value + ' · −' + signedGap(diff);
    return '내 ' + own.value + ' · 같음';
  }

  function meters(value) {
    var v = num(value);
    if (v == null || v < 0) return null;
    return v < 1000 ? Math.floor(v) + 'm' : distance(v).value + 'km';
  }

  function runnerIndex(params, count) {
    var n = Number(params && params.get ? params.get('runner') : null);
    if (!Number.isInteger(n) || n < 1) n = 1;
    return Math.min(n, Math.max(1, count || 1)) - 1;
  }

  // 순서 쪽: 콘솔 standings(경로 점)로 정한 순서·위치. 실제 워치는 서버 G10 순위를 받는다(MR 대응표 참고)
  function position(standing, label) {
    if (!standing || !standing.basis || !Array.isArray(standing.order) || standing.order.indexOf(label) < 0) return null;
    var order = standing.order, total = order.length, along = standing.along || {};
    if (standing.sideBySide) {
      return {rank: '1', total: '/ ' + total + '명', tie: total, ahead: null, behind: null,
        spread: standing.gapM != null ? '선두–후미 ' + meters(standing.gapM) : null};
    }
    var i = order.indexOf(label);
    function gapTo(j) {
      if (j < 0 || j >= total) return {none: true};
      var a = num(along[order[j]]), b = num(along[label]);
      return {value: a != null && b != null ? meters(Math.abs(a - b)) : null};
    }
    return {rank: String(i + 1), total: '/ ' + total + '명', tie: null, ahead: gapTo(i - 1), behind: gapTo(i + 1),
      spread: standing.gapM != null ? '선두–후미 ' + meters(standing.gapM) : null};
  }

  // SSE 한 판단 → 워치 화면 값
  function view(trace, options) {
    options = options || {};
    if (!trace) return null;
    var decision = trace.decision || {};
    var group = trace.group;
    var hasGuide = trace.decision != null && num(decision.recommendedPaceSecPerKm) != null && trace.status !== 'INPUT_INSUFFICIENT';
    if (group) {
      var members = Array.isArray(group.members) ? group.members : [];
      var index = Math.min(options.runner || 0, Math.max(0, members.length - 1));
      var me = members[index] || {};
      var own = actualPaceSec(me.speedNowMps, me.paceNowSecPerKm);
      var shared = hasGuide ? num(decision.recommendedPaceSecPerKm) : null;
      return {
        mode: 'group', runner: me.label || ('러너 ' + (index + 1)), runnerCount: members.length,
        shared: pace(shared), sharedSec: shared != null ? Math.round(shared) : null,
        changed: !!decision.changed && num(decision.fromPaceSecPerKm) != null,
        change: decision.changed && num(decision.fromPaceSecPerKm) != null && shared != null
          ? '이전 ' + pace(decision.fromPaceSecPerKm).value + ' → 새 ' + pace(shared).value : null,
        mine: mineLine(own, shared),
        statusPace: pace(own), paceTicks: paceTicks(own), paceOutOfRange: paceOutOfRange(own),
        distance: null,                                   // 멤버별 거리는 SSE에 없음 → 숨김
        elapsed: duration(trace.elapsedSec),
        heart: heart(me.hrNowBpm),
        rhythm: null,                                     // 그룹 판단에는 리듬 BPM이 없음 → 숨김
        goalProgress: null,
        position: position(options.standing, me.label),
        hasStanding: !!(options.standing && options.standing.basis)
      };
    }
    var input = trace.input || {};
    var ownSec = actualPaceSec(input.speedNowMps, input.paceNowSecPerKm);
    var dist = num(input.distanceM), remaining = num(input.remainingM);
    var cue = num(decision.cueBpm);
    return {
      mode: 'personal', runner: null, runnerCount: 1,
      guide: hasGuide ? pace(decision.recommendedPaceSecPerKm) : null,
      guideSec: hasGuide ? Math.round(num(decision.recommendedPaceSecPerKm)) : null,
      rhythm: hasGuide && cue != null ? String(Math.round(cue)) : null,
      rhythmTicks: hasGuide ? bpmTicks(cue) : null,
      beatMs: hasGuide ? beatIntervalMs(cue) : null,
      statusPace: pace(ownSec), paceTicks: paceTicks(ownSec), paceOutOfRange: paceOutOfRange(ownSec),
      distance: distance(dist), elapsed: duration(trace.elapsedSec), heart: heart(input.hrNowBpm),
      goalProgress: dist != null && remaining != null && dist + remaining > 0 ? Math.min(1, dist / (dist + remaining)) : null
    };
  }

  // 판단이 바뀐 순간: 개인은 안내 페이스나 리듬이 달라질 때, 그룹은 서버가 changed로 알릴 때
  function paceChanged(prev, next) {
    if (!next) return false;
    if (next.mode === 'group') return !!next.changed;
    if (!prev || prev.mode !== 'personal') return false;
    return (prev.guideSec != null && next.guideSec != null && prev.guideSec !== next.guideSec) ||
      (prev.rhythm != null && next.rhythm != null && prev.rhythm !== next.rhythm);
  }

  // 실제 워치 페이지 순서(WatchNavigation.pages) + 심박 자세히(9.2-4)
  function pages(mode, hasStanding) {
    if (mode === 'group') return ['status', 'groupPace', 'position', 'heart'];
    return ['status', 'coaching', 'heart'];
  }

  // 쪽 넘기기(실제 워치의 좌우 밀기). 심박 자세히는 쪽이 아니라서 넘기기 목록에 없다
  function stepPage(mode, page, dir) {
    var list = pages(mode).filter(function (p) { return p !== 'heart'; });
    var i = list.indexOf(page);
    if (i < 0) return list[0];
    return list[Math.max(0, Math.min(list.length - 1, i + dir))];
  }

  // 자동 넘기기(시연용 선택): ?auto=초. 없거나 3초 미만이면 끈다(실제 앱처럼 손으로만 넘김)
  function autoMs(params) {
    var n = Number(params && params.get ? params.get('auto') : null);
    return Number.isFinite(n) && n >= 3 ? Math.round(n * 1000) : 0;
  }

  var api = {
    stepPage: stepPage, autoMs: autoMs,
    MISSING: MISSING, NOTICE_HOLD_MS: NOTICE_HOLD_MS, pace: pace, distance: distance, duration: duration, heart: heart,
    actualPaceSec: actualPaceSec, paceTicks: paceTicks, paceOutOfRange: paceOutOfRange, bpmTicks: bpmTicks,
    beatIntervalMs: beatIntervalMs, mineLine: mineLine, meters: meters, runnerIndex: runnerIndex, position: position,
    view: view, paceChanged: paceChanged, pages: pages
  };
  root.RunwayWatchLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
