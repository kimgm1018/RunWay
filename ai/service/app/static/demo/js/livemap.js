(function (root) {
  'use strict';

  // 722: 실시간 러닝 경로 지도. OpenStreetMap 타일 + Leaflet(cdnjs 1.9.4, index.html에서 버전·SRI 고정).
  // SSE의 routes([{label, points:[[lat, lon], ...]}])를 받아 선과 현재 위치 점을 그린다.
  // Leaflet을 못 읽으면(오프라인·한 파일 콘솔) 아무것도 하지 않고 기존 SVG 코스 그림이 그대로 보인다.
  // 색: 앱 지도와 같은 민트 리본(mapRoute.ts mintMapLook), 그룹은 앱 멤버 색(stand.tsx memberColors) 순서.
  var MINT = '#4DFFD2';
  var MEMBER_COLORS = [MINT, '#FFD84D', '#4D9BFF', '#FF7EB6', '#B58CFF', '#FF9F1C'];
  var FOLLOW_ZOOM = 16;
  // 727: 위치가 이 시간 넘게 늘지 않으면 흐리게(서버 조회는 3초 간격, W07 batch는 보통 수 초~수십 초)
  var STALE_MS = 30000;
  var lastCourse = null;
  var staleTimer = null;

  var map = null;
  var layers = {};          // label -> {ribbon, core, dot}
  var courseLayer = null;
  var follow = true;
  var fitted = false;
  var active = false;

  function L() { return root.L; }
  function byId(id) { return root.document ? root.document.getElementById(id) : null; }

  function colorFor(label, index, count) {
    if (count <= 1 && label === '러너') return MINT;
    var n = /(\d+)$/.exec(label || '');
    var i = n ? Number(n[1]) - 1 : index;
    return MEMBER_COLORS[((i % MEMBER_COLORS.length) + MEMBER_COLORS.length) % MEMBER_COLORS.length];
  }

  function ensureMap() {
    if (map || !L()) return map;
    var host = byId('live-map');
    if (!host) return null;
    map = L().map(host, {zoomControl: true, attributionControl: true, preferCanvas: false})
      .setView([37.5665, 126.978], 13);
    L().tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.on('dragstart', function () { setFollow(false); });
    return map;
  }

  function setActive(on) {
    active = on;
    var body = root.document && root.document.body;
    if (body) body.classList.toggle('has-live-map', on);
    var host = byId('live-map');
    if (host) host.classList.toggle('hidden', !on);
    var button = byId('map-follow');
    if (button) button.classList.toggle('hidden', !on);
    if (on && map) setTimeout(function () { map.invalidateSize(); }, 0);
  }

  function setFollow(on) {
    follow = on;
    var button = byId('map-follow');
    if (button) {
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.textContent = on ? '따라가기 켬' : '따라가기 끔';
    }
    if (on) recenter();
  }

  function lastPoints() {
    return Object.keys(layers).map(function (label) {
      var pts = layers[label].points;
      return pts.length ? pts[pts.length - 1] : null;
    }).filter(Boolean);
  }

  function recenter() {
    if (!map) return;
    var ends = lastPoints();
    if (!ends.length) return;
    if (ends.length === 1) map.setView(ends[0], Math.max(map.getZoom(), FOLLOW_ZOOM), {animate: fitted});
    else map.fitBounds(L().latLngBounds(ends).pad(0.6), {maxZoom: FOLLOW_ZOOM, animate: fitted});
  }

  function setRoutes(routes) {
    var list = (Array.isArray(routes) ? routes : []).filter(function (r) {
      return r && Array.isArray(r.points) && r.points.length;
    });
    if (!list.length) {
      Object.keys(layers).forEach(function (label) { removeLayer(label); });
      setActive(false);
      return;
    }
    if (!ensureMap()) return;
    setActive(true);
    var seen = {};
    list.forEach(function (route, index) {
      var label = String(route.label || '러너');
      seen[label] = true;
      var pts = route.points.filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); });
      var color = colorFor(label, index, list.length);
      var layer = layers[label];
      if (!layer) {
        layer = layers[label] = {
          ribbon: L().polyline([], {color: color, weight: 9, opacity: 0.35, lineCap: 'round', lineJoin: 'round', className: 'route-ribbon'}).addTo(map),
          core: L().polyline([], {color: '#B8FFEC', weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round', className: 'route-core'}).addTo(map),
          dot: L().circleMarker([0, 0], {radius: 7, color: '#02050E', weight: 3, fillColor: color, fillOpacity: 1, className: 'route-dot'}),
          points: [], grewAt: Date.now(), lastKey: ''
        };
        if (color !== MINT) layer.core.setStyle({color: color});
        // 727: 가까이 붙어 뛰면 이름표가 겹치지 않게 홀수 번째 러너는 위, 짝수 번째는 아래에 단다
        var below = /(\d+)$/.test(label) && Number(/(\d+)$/.exec(label)[1]) % 2 === 0;
        layer.dot.bindTooltip(label, {permanent: list.length > 1, direction: below ? 'bottom' : 'top',
          offset: [0, below ? 8 : -8], className: 'route-tip'});
      }
      var end = pts[pts.length - 1];
      var key = pts.length + ':' + end[0] + ',' + end[1];
      if (key !== layer.lastKey) { layer.lastKey = key; layer.grewAt = Date.now(); }
      layer.points = pts;
      layer.ribbon.setLatLngs(pts);
      layer.core.setLatLngs(pts);
      layer.dot.setLatLng(pts[pts.length - 1]);
      if (!map.hasLayer(layer.dot)) layer.dot.addTo(map);
    });
    Object.keys(layers).forEach(function (label) { if (!seen[label]) removeLayer(label); });
    if (!fitted) { recenter(); fitted = true; }
    else if (follow) recenter();
    var meta = byId('course-meta');
    if (meta) meta.textContent = list.length > 1 ? '실시간 경로 · ' + list.length + '명' : '실시간 경로';
    computeStandings();
  }

  // 727: 선두·후미 배지와 간격(standings.js). 판정은 새 좌표가 왔을 때만(computeStandings) 하고,
  // 흐림 타이머·코스 변경은 마지막 판정으로 다시 그리기만 한다(깜빡임 방지 '2번 연속'이 타이머로 채워지지 않게).
  var tracker = null;
  var lastStanding = null;

  function computeStandings() {
    var S = root.RunwayDemoStandings;
    var labels = Object.keys(layers);
    if (S && !tracker) tracker = S.createTracker();
    lastStanding = tracker && labels.length >= 2
      ? tracker.update(labels.map(function (label) { return {label: label, points: layers[label].points}; }), lastCourse)
      : null;
    drawStandings();
  }

  function drawStandings() {
    var S = root.RunwayDemoStandings;
    var box = byId('map-standings');
    var st = lastStanding;
    Object.keys(layers).forEach(function (label) {
      var layer = layers[label];
      var badge = !st || !st.basis ? '' :
        st.sideBySide ? '<i class="tip-badge side">나란히</i>' :
        label === st.leader ? '<i class="tip-badge lead">선두</i>' :
        label === st.trailer ? '<i class="tip-badge tail">후미</i>' : '';
      var ageSec = Math.round((Date.now() - layer.grewAt) / 1000);
      var stale = ageSec * 1000 > STALE_MS;
      var html = '<b>' + escapeHtml(label) + '</b>' + badge + (stale ? '<i class="tip-stale">' + ageSec + '초 전</i>' : '');
      if (layer.tipHtml !== html) { layer.dot.setTooltipContent(html); layer.tipHtml = html; }
      layer.dot.setStyle({fillOpacity: stale ? 0.35 : 1, opacity: stale ? 0.45 : 1});
      var tip = layer.dot.getTooltip && layer.dot.getTooltip();
      var el = tip && tip.getElement && tip.getElement();
      if (el) el.classList.toggle('is-stale', stale);
    });
    if (box) {
      var text = S && st ? S.standingsText(st) : '';
      box.textContent = text;
      box.classList.toggle('hidden', !text);
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }

  function startStaleTimer() {
    if (staleTimer || typeof setInterval !== 'function') return;
    staleTimer = setInterval(function () { if (active) drawStandings(); }, 5000);
  }

  function removeLayer(label) {
    var layer = layers[label];
    if (!layer || !map) return;
    map.removeLayer(layer.ribbon); map.removeLayer(layer.core);
    if (map.hasLayer(layer.dot)) map.removeLayer(layer.dot);
    delete layers[label];
  }

  // 계획 코스(있으면)를 흐린 선으로 깐다. course.points = [[lon, lat, alt, distM], ...]
  function setCourse(course) {
    lastCourse = course || null;
    if (!map) return;
    if (courseLayer) { map.removeLayer(courseLayer); courseLayer = null; }
    var pts = course && Array.isArray(course.points) ? course.points : [];
    var latlngs = pts.filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); })
      .map(function (p) { return [Number(p[1]), Number(p[0])]; });
    if (latlngs.length < 2 || !active) return;
    courseLayer = L().polyline(latlngs, {color: '#8C95A6', weight: 3, opacity: 0.7, dashArray: '6 8', className: 'route-plan'}).addTo(map);
    courseLayer.bringToBack();
    drawStandings();
  }

  function reset() {
    Object.keys(layers).forEach(function (label) { removeLayer(label); });
    if (courseLayer && map) { map.removeLayer(courseLayer); courseLayer = null; }
    fitted = false;
    if (tracker) tracker.reset();
    lastStanding = null;
    setActive(false);
  }

  function init() {
    var button = byId('map-follow');
    if (button) button.addEventListener('click', function () { setFollow(!follow); });
    setFollow(true);
    startStaleTimer();
  }

  root.RunwayDemoLiveMap = {init: init, setRoutes: setRoutes, setCourse: setCourse, reset: reset,
    available: function () { return !!L(); }, _colorFor: colorFor};
}(typeof window !== 'undefined' ? window : globalThis));
