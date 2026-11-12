(function (root) {
  'use strict';

  // 727: 그룹런 선두·후미 판정(표시용). routes = [{label, points:[[lat, lon], ...]}], course.points = [[lon, lat, alt, distM], ...]
  //
  // 기준선
  //  - 계획 코스가 있으면 코스 선.
  //  - 없으면(자유 러닝) '가장 앞선 러너가 지나온 경로'. 처음엔 지나온 길이가 가장 긴 러너로 잡고,
  //    다른 러너의 현재 위치를 그 선에 투영했을 때 선 끝보다 PASS_END_M 넘게 앞서 있으면 그 러너의 경로로 바꾼다.
  //  - 각 러너는 현재 위치를 기준선에 투영한 '선을 따라 온 거리'로 비교한다. 옆길로 샌 거리는 투영되면 사라진다.
  // 투영 창
  //  - 직전 위치(선을 따라 온 거리) 근처 [-BACK_M, +AHEAD_M]의 선분만 보고, 직전 위치에서 멀리 건너뛰는 후보에
  //    벌점을 준다. U턴 왕복 구간에서 반대 방향 길로 잘못 붙지 않게 한다. 처음 한 번만 선 전체에서 찾는다.
  // 깜빡임 방지
  //  - 표시 순서는 새 순서가 SIDE_BY_SIDE_M 넘게 벌어진 상태로 CONFIRM_UPDATES번 연속(갱신 3초 → 약 6초)일 때만 바꾼다.
  //  - 선두와 후미 간격이 SIDE_BY_SIDE_M 안이면 '나란히'로 보인다.
  var EARTH_M = 6371008.8;
  var SIDE_BY_SIDE_M = 15;
  var CONFIRM_UPDATES = 2;
  var BACK_M = 150;            // 투영 창: 직전 위치 뒤로
  var AHEAD_M = 800;           // 앞으로(W07 batch가 늦게 와 한 번에 많이 움직여도 놓치지 않게)
  var STEP_FREE_M = 30;        // 직전 위치에서 이 거리까지는 벌점 없음
  var JUMP_PENALTY = 0.1;      // 그 이상 1 m 떨어질 때마다 0.1 m 벌점(U턴 반대편 길로 건너뛰지 않게)
  var PASS_END_M = 15;

  function rad(d) { return d * Math.PI / 180; }

  function haversine(a, b) {
    var dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function validPoint(p) {
    return Array.isArray(p) && p[0] != null && p[1] != null && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));
  }

  // 위·경도 점 목록 → [{lat, lon, dist}] (dist = 선을 따라 온 거리)
  function buildLine(latlngs) {
    var line = [];
    latlngs.forEach(function (p) {
      var q = {lat: p[0], lon: p[1], dist: 0};
      if (line.length) {
        var prev = line[line.length - 1];
        var step = haversine([prev.lat, prev.lon], p);
        if (step < 0.01) return;               // 같은 자리 반복 점은 건너뛴다
        q.dist = prev.dist + step;
      }
      line.push(q);
    });
    return line.length >= 2 ? line : null;
  }

  function courseLine(course) {
    var raw = course && Array.isArray(course.points) ? course.points : [];
    var latlngs = raw.filter(function (p) { return validPoint(p); }).map(function (p) { return [Number(p[1]), Number(p[0])]; });
    return buildLine(latlngs);
  }

  // 점을 선에 투영. prev(직전 '선을 따라 온 거리')가 있으면 그 근처 선분만 보고, 직전 위치에서 STEP_FREE_M보다
  // 멀리 떨어진 후보에는 거리 비례 벌점을 줘서 U턴 왕복처럼 가는 길·오는 길이 붙어 있어도 이어지는 쪽을 고른다.
  // beyond = 마지막 선분 끝을 넘어선 거리(m).
  function project(line, point, prev) {
    var kx = EARTH_M * Math.cos(rad(point[0])) * Math.PI / 180, ky = EARTH_M * Math.PI / 180;
    var best = null;
    for (var i = 1; i < line.length; i++) {
      var a = line[i - 1], b = line[i];
      if (prev != null && (b.dist < prev - BACK_M || a.dist > prev + AHEAD_M)) continue;
      var ax = (a.lon - point[1]) * kx, ay = (a.lat - point[0]) * ky;
      var bx = (b.lon - point[1]) * kx, by = (b.lat - point[0]) * ky;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var raw = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
      var t = Math.max(0, Math.min(1, raw));
      var px = ax + t * dx, py = ay + t * dy, off = Math.sqrt(px * px + py * py);
      var along = a.dist + t * (b.dist - a.dist);
      var cost = off + (prev == null ? 0 : JUMP_PENALTY * Math.max(0, Math.abs(along - prev) - STEP_FREE_M));
      if (!best || cost < best.cost) {
        var beyond = i === line.length - 1 && raw > 1 ? (raw - 1) * Math.sqrt(len2) : 0;
        best = {cost: cost, off: off, along: along, beyond: beyond};
      }
    }
    if (!best && prev != null) return project(line, point, null);
    return best;
  }

  function normalize(routes) {
    return (Array.isArray(routes) ? routes : []).map(function (r) {
      var pts = (r && Array.isArray(r.points) ? r.points : []).filter(validPoint).map(function (p) { return [Number(p[0]), Number(p[1])]; });
      return {label: String(r && r.label || '러너'), points: pts};
    }).filter(function (r) { return r.points.length > 0; });
  }

  function sameOrder(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }

  function createTracker() {
    var state = {ref: null, along: {}, order: [], pendingKey: null, pendingCount: 0};

    function alongFor(line, runner, center) {
      var last = runner.points[runner.points.length - 1];
      return project(line, last, center == null ? null : center);
    }

    function update(routes, course) {
      var runners = normalize(routes);
      var empty = {basis: null, order: [], leader: null, trailer: null, gapM: null, sideBySide: false, refLabel: null, along: {}};
      if (runners.length < 2) {
        state.order = runners.map(function (r) { return r.label; });
        return empty;
      }
      var byLabel = {};
      runners.forEach(function (r) { byLabel[r.label] = r; });
      var line = courseLine(course);
      var basis = line ? 'course' : 'path';
      var along = {};
      if (basis === 'course') {
        state.ref = null;
        runners.forEach(function (r) {
          var p = alongFor(line, r, state.along[r.label]);
          along[r.label] = p ? p.along : 0;
        });
      } else {
        if (!state.ref || !byLabel[state.ref]) {
          state.ref = runners.reduce(function (best, r) {
            var len = (buildLine(r.points) || [{dist: 0}]).slice(-1)[0].dist;
            return !best || len > best.len ? {label: r.label, len: len} : best;
          }, null).label;
        }
        for (var guard = 0; guard < runners.length; guard++) {
          line = buildLine(byLabel[state.ref].points);
          var refLen = line ? line[line.length - 1].dist : 0;
          var switchTo = null;
          along = {};
          along[state.ref] = refLen;
          runners.forEach(function (r) {
            if (r.label === state.ref) return;
            if (!line) { along[r.label] = 0; return; }
            var p = alongFor(line, r, state.along[r.label]);
            along[r.label] = p ? p.along : 0;
            if (p && p.beyond > PASS_END_M && (!switchTo || p.beyond > switchTo.beyond)) switchTo = {label: r.label, beyond: p.beyond};
          });
          if (!switchTo) break;
          // 기준선 교체: 앞선 러너 경로로 바꾸고, 이전 간격을 유지한 위치를 투영 창 중심으로 옮긴다
          var oldRefAlong = refLen + 0;
          var newLine = buildLine(byLabel[switchTo.label].points);
          var newLen = newLine ? newLine[newLine.length - 1].dist : 0;
          var shifted = {};
          Object.keys(along).forEach(function (label) {
            var behindNewLeader = (along[switchTo.label] + switchTo.beyond) - along[label];
            shifted[label] = newLen - behindNewLeader;
          });
          shifted[state.ref] = newLen - ((along[switchTo.label] + switchTo.beyond) - oldRefAlong);
          state.along = shifted;
          state.ref = switchTo.label;
        }
      }
      state.along = along;

      var proposed = runners.map(function (r) { return r.label; })
        .sort(function (a, b) { return along[b] - along[a] || (a < b ? -1 : 1); });
      var current = state.order.filter(function (label) { return byLabel[label]; });
      proposed.forEach(function (label) { if (current.indexOf(label) < 0) current.push(label); });
      if (current.length !== proposed.length || !sameOrder(current, proposed)) {
        // 새 순서에서 앞뒤가 바뀐 짝이 모두 SIDE_BY_SIDE_M 넘게 벌어져야 후보로 센다
        var clear = proposed.every(function (label, i) {
          return proposed.slice(i + 1).every(function (other) {
            var wasAhead = current.indexOf(other) < current.indexOf(label);
            return !wasAhead || along[label] - along[other] > SIDE_BY_SIDE_M;
          });
        });
        var key = proposed.join('|');
        if (clear) {
          state.pendingCount = state.pendingKey === key ? state.pendingCount + 1 : 1;
          state.pendingKey = key;
          if (state.pendingCount >= CONFIRM_UPDATES || !state.order.length) {
            current = proposed;
            state.pendingKey = null; state.pendingCount = 0;
          }
        } else {
          state.pendingKey = null; state.pendingCount = 0;
        }
      } else {
        state.pendingKey = null; state.pendingCount = 0;
      }
      state.order = current;
      var lead = current[0], tail = current[current.length - 1];
      // 표시 순서 기준 간격. 새 순서를 아직 확정하지 않은 동안(앞뒤가 뒤집혀 음수)이나 15 m 안이면 '나란히'
      var signed = along[lead] - along[tail];
      var gap = Math.round(Math.abs(signed));
      var side = signed <= SIDE_BY_SIDE_M;
      return {basis: basis, order: current.slice(), leader: side ? null : lead, trailer: side ? null : tail, gapM: gap,
              sideBySide: side, refLabel: basis === 'path' ? state.ref : null,
              along: Object.keys(along).reduce(function (o, k) { o[k] = Math.round(along[k]); return o; }, {})};
    }

    function reset() { state = {ref: null, along: {}, order: [], pendingKey: null, pendingCount: 0}; }
    return {update: update, reset: reset};
  }

  function standingsText(s) {
    if (!s || !s.basis) return '';
    var how = s.basis === 'course' ? '코스 진행 거리' : '앞선 러너 경로 기준';
    if (s.sideBySide) return '나란히 달리는 중 · 간격 ' + s.gapM + ' m (' + how + ')';
    return '선두 ' + s.leader + ' · 후미 ' + s.trailer + ' · 간격 ' + s.gapM + ' m (' + how + ')';
  }

  var RunwayDemoStandings = {createTracker: createTracker, standingsText: standingsText, _haversine: haversine,
    SIDE_BY_SIDE_M: SIDE_BY_SIDE_M, CONFIRM_UPDATES: CONFIRM_UPDATES};
  root.RunwayDemoStandings = RunwayDemoStandings;
  if (typeof module !== 'undefined' && module.exports) module.exports = RunwayDemoStandings;
}(typeof window !== 'undefined' ? window : globalThis));
