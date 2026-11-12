(function (root) {
  'use strict';

  // 722: 실시간 러닝 경로 지도. OpenStreetMap 타일 + Leaflet(cdnjs 1.9.4, index.html에서 버전·SRI 고정).
  // SSE의 routes([{label, points:[[lat, lon], ...]}])를 받아 선과 현재 위치 점을 그린다.
  // Leaflet을 못 읽으면(오프라인·한 파일 콘솔) 아무것도 하지 않고 기존 SVG 코스 그림이 그대로 보인다.
  // 색: 앱 지도와 같은 민트 리본(mapRoute.ts mintMapLook), 그룹은 앱 멤버 색(stand.tsx memberColors) 순서.
  var MINT = '#4DFFD2';
  var MEMBER_COLORS = [MINT, '#FFD84D', '#4D9BFF', '#FF7EB6', '#B58CFF', '#FF9F1C'];
  var FOLLOW_ZOOM = 16;

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
          points: []
        };
        if (color !== MINT) layer.core.setStyle({color: color});
        layer.dot.bindTooltip(label, {permanent: list.length > 1, direction: 'top', offset: [0, -8], className: 'route-tip'});
      }
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
    if (!map) return;
    if (courseLayer) { map.removeLayer(courseLayer); courseLayer = null; }
    var pts = course && Array.isArray(course.points) ? course.points : [];
    var latlngs = pts.filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); })
      .map(function (p) { return [Number(p[1]), Number(p[0])]; });
    if (latlngs.length < 2 || !active) return;
    courseLayer = L().polyline(latlngs, {color: '#8C95A6', weight: 3, opacity: 0.7, dashArray: '6 8', className: 'route-plan'}).addTo(map);
    courseLayer.bringToBack();
  }

  function reset() {
    Object.keys(layers).forEach(function (label) { removeLayer(label); });
    if (courseLayer && map) { map.removeLayer(courseLayer); courseLayer = null; }
    fitted = false;
    setActive(false);
  }

  function init() {
    var button = byId('map-follow');
    if (button) button.addEventListener('click', function () { setFollow(!follow); });
    setFollow(true);
  }

  root.RunwayDemoLiveMap = {init: init, setRoutes: setRoutes, setCourse: setCourse, reset: reset,
    available: function () { return !!L(); }, _colorFor: colorFor};
}(typeof window !== 'undefined' ? window : globalThis));
