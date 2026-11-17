(function (root) {
  'use strict';

  // 909: 청중용 알림 두 가지(그룹 AI10). 판정은 여기 순수 함수로 두고, 화면 그리기는 render.js·livemap.js가 한다.
  //  1) 페이스 변경 카드: AI가 공동 페이스를 바꾼 직후 CARD_SEC 동안 '▼ 페이스 늦춤 / 5'50" → 6'00" / 러너 2 심박 높음'.
  //  2) 뒤처짐 알림: 지도 선두·후미 판정(standings.js)의 '선을 따라 온 거리'로 가장 앞선 러너와의 거리를 재서,
  //     LAG_ALERT_M을 넘으면 '⚠ 러너 2 뒤처짐 · 52 m', LAG_ALERT_M − LAG_REARM_MARGIN_M 아래로 오면 숨긴다.
  //     앱·워치 뒤처짐 알림(frontend groupStatus.ts GROUP_GAP_ALERT_M 50, REARM_MARGIN 30)과 같은 숫자다.
  //     이름은 판단 기록에 닉네임이 없어 화면의 러너 라벨을 쓴다.
  var CARD_SEC = 45;
  var LAG_ALERT_M = 50;
  var LAG_REARM_MARGIN_M = 30;

  function num(value) { var n = Number(value); return value != null && Number.isFinite(n) ? n : null; }

  function formatPace(sec) {
    var n = num(sec);
    if (n == null || n <= 0) return '—';
    var v = Math.round(n);
    return Math.floor(v / 60) + "'" + String(v % 60).padStart(2, '0') + '"';
  }

  function worstLabel(trace) {
    var g = trace && trace.group;
    var m = g && Number.isInteger(g.worstIndex) && Array.isArray(g.members) ? g.members[g.worstIndex] : null;
    return m && m.label ? String(m.label) : null;
  }

  // 판단 이유 → 짧은 한 줄(12자 안팎). 공식(상한 164 ≥ 허용 163)은 쓰지 않는다.
  function shortReason(trace) {
    var d = trace && trace.decision || {};
    if (d.direction === 'SLOW') {
      var who = worstLabel(trace);
      return who ? who + ' 심박 높음' : '심박 높음';
    }
    if (d.direction === 'FAST') {
      if (d.reason === 'RECOVERED') return '목표 페이스로 복귀';
      return '모두 여유 있음';
    }
    return '';
  }

  // 지금 보여 줄 페이스 변경 카드. traces는 시간순 판단 기록(마지막이 trace). 바꾼 판단이 CARD_SEC 안이면 그 판단으로.
  function paceChangeCard(trace, traces) {
    var now = num(trace && trace.elapsedSec);
    if (!trace || !trace.group || now == null) return null;
    var list = Array.isArray(traces) && traces.length ? traces : [trace];
    var change = null;
    list.forEach(function (t) {
      var at = num(t && t.elapsedSec);
      if (t && t.group && t.decision && t.decision.changed && at != null && at <= now &&
          (t.decision.direction === 'SLOW' || t.decision.direction === 'FAST')) change = t;
    });
    if (!change || now - num(change.elapsedSec) > CARD_SEC) return null;
    var d = change.decision;
    var down = d.direction === 'SLOW';
    return {id: change.traceId || String(change.elapsedSec), kind: down ? 'down' : 'up',
      title: down ? '▼ 페이스 늦춤' : '▲ 페이스 올림',
      pace: formatPace(d.fromPaceSecPerKm) + ' → ' + formatPace(d.recommendedPaceSecPerKm),
      reason: shortReason(change), ageSec: now - num(change.elapsedSec)};
  }

  // 뒤처짐 판정. update(standing)에 standings.js 결과({along: {label: m}})를 넣으면 지금 뒤처진 러너 목록을 돌려준다.
  function createLagTracker(alertM, rearmMarginM) {
    var threshold = alertM == null ? LAG_ALERT_M : alertM;
    var clearBelow = threshold - (rearmMarginM == null ? LAG_REARM_MARGIN_M : rearmMarginM);
    var lagging = {};
    function update(standing) {
      var along = standing && standing.along;
      var labels = along ? Object.keys(along).filter(function (k) { return num(along[k]) != null; }) : [];
      if (labels.length < 2) { lagging = {}; return []; }
      var lead = Math.max.apply(null, labels.map(function (k) { return Number(along[k]); }));
      var next = {};
      labels.forEach(function (label) {
        var gap = lead - Number(along[label]);
        if (gap > threshold || (lagging[label] && gap >= clearBelow)) next[label] = Math.round(gap);
      });
      lagging = next;
      return labels.filter(function (label) { return next[label] != null; })
        .sort(function (a, b) { return next[b] - next[a]; })
        .map(function (label) { return {label: label, gapM: next[label]}; });
    }
    function reset() { lagging = {}; }
    return {update: update, reset: reset};
  }

  function lagText(item) { return '⚠ ' + item.label + ' 뒤처짐 · ' + item.gapM + ' m'; }

  var RunwayDemoAlerts = {shortReason: shortReason, paceChangeCard: paceChangeCard, createLagTracker: createLagTracker,
    lagText: lagText, CARD_SEC: CARD_SEC, LAG_ALERT_M: LAG_ALERT_M, LAG_REARM_MARGIN_M: LAG_REARM_MARGIN_M};
  root.RunwayDemoAlerts = RunwayDemoAlerts;
  if (typeof module !== 'undefined' && module.exports) module.exports = RunwayDemoAlerts;
}(typeof window !== 'undefined' ? window : globalThis));
