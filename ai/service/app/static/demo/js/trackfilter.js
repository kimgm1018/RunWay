(function (root) {
  'use strict';

  // 890: 콘솔 지도 GPS 튐 필터. 에뮬레이터·도심 반사로 위치가 갑자기 멀리 뛰면 그 점은 그리지 않고 선도 잇지 않는다.
  // 점에는 시각이 없고 서버가 약 1초 간격 GPS를 그대로 쌓으므로, 점 한 칸 = STEP_SEC 초로 보고 속도를 계산한다.
  var MAX_SPEED_MPS = 12;    // 783 폰 브리지 필터와 같은 기준
  var MAX_JUMP_M = 200;      // 한 번에 이만큼 넘게 뛰면 튐
  var STEP_SEC = 1;
  var SETTLE_RADIUS_M = 30;  // 튄 점들이 서로 이 안에 모여 있으면 새 위치 후보
  var SETTLE_COUNT = 3;      // 연속 이 개수 이상 머물면 새 기준으로 받아들임

  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // points: [[lat, lon], ...] 시간순. 반환 {segments: [[[lat, lon], ...], ...], last: 마지막으로 받아들인 점|null, rejected: 버린 점 수}
  // 받아들인 점이 끊기면(새 위치로 옮겨 감) 새 선(segment)으로 시작해 이전 선과 잇지 않는다.
  function filterTrack(points) {
    var segments = [], seg = null, ref = null, refIdx = 0, cand = [], rejected = 0;
    var stepSec = STEP_SEC;
    (points || []).forEach(function (p, i) {
      if (!Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1])) return;
      if (!ref) { seg = [p]; segments.push(seg); ref = p; refIdx = i; return; }
      var d = haversine(ref, p);
      var elapsed = Math.max(1, i - refIdx) * stepSec;
      if (d <= MAX_JUMP_M && d <= MAX_SPEED_MPS * elapsed) {
        seg.push(p); ref = p; refIdx = i; cand = [];
        return;
      }
      if (cand.length && haversine(cand[0], p) > SETTLE_RADIUS_M) cand = [];
      cand.push(p);
      if (cand.length >= SETTLE_COUNT) {
        rejected -= cand.length - 1; seg = cand.slice(); segments.push(seg); ref = p; refIdx = i; cand = [];
      } else {
        rejected += 1;
      }
    });
    return {segments: segments, last: ref, rejected: rejected};
  }

  var RunwayDemoTrackFilter = {filterTrack: filterTrack, haversine: haversine, MAX_SPEED_MPS: MAX_SPEED_MPS,
    MAX_JUMP_M: MAX_JUMP_M, SETTLE_COUNT: SETTLE_COUNT, SETTLE_RADIUS_M: SETTLE_RADIUS_M};
  root.RunwayDemoTrackFilter = RunwayDemoTrackFilter;
  if (typeof module !== 'undefined' && module.exports) module.exports = RunwayDemoTrackFilter;
}(typeof window !== 'undefined' ? window : globalThis));
