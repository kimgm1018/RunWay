const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../../app/static/demo/js/trackfilter.js');

// 부산 광안리 근처에서 동쪽으로 매 1초 3 m씩 달리는 열
const M_LON = 111195 * Math.cos(35.15 * Math.PI / 180);
const run = (n, x0 = 0, lat = 35.15, lon0 = 129.12) => Array.from({length: n}, (_, i) => [lat, lon0 + (x0 + i * 3) / M_LON]);
const US = [37.4220, -122.0841];     // 에뮬레이터 기본 위치(Mountain View)
const count = (r) => r.segments.reduce((n, s) => n + s.length, 0);

test('정상 경로는 점 하나도 버리지 않고 선 하나로 그린다', () => {
  const r = f.filterTrack(run(60));
  assert.equal(r.segments.length, 1);
  assert.equal(count(r), 60);
  assert.equal(r.rejected, 0);
});

test('9,000 km 튀는 점은 그리지 않고 선도 잇지 않는다', () => {
  const pts = run(20).concat([US], run(20, 60));
  const r = f.filterTrack(pts);
  assert.equal(r.segments.length, 1);
  assert.equal(count(r), 40);
  assert.equal(r.rejected, 1);
  r.segments[0].forEach(p => assert.ok(p[0] < 36));
});

test('튀는 점이 번갈아 섞여도 정상 점만 남는다', () => {
  const base = run(30);
  const pts = base.flatMap((p, i) => (i % 5 === 2 ? [p, US] : [p]));
  const r = f.filterTrack(pts);
  assert.equal(count(r), 30);
  assert.equal(r.segments.length, 1);
});

test('200 m 안이어도 12 m/s 넘는 순간이동은 거른다', () => {
  const a = run(5), jump = [a[4][0], a[4][1] + 100 / M_LON];  // 1초에 100 m
  const r = f.filterTrack(a.concat([jump]));
  assert.equal(count(r), 5);
});

test('새 위치에 3점 이상 머물면 새 기준으로 받아들이고 새 선으로 시작한다', () => {
  const stay = [US, [US[0] + 0.0001, US[1]], [US[0], US[1] + 0.0001], [US[0] + 0.0001, US[1] + 0.0001]];
  const r = f.filterTrack(run(10).concat(stay));
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].length, 10);
  assert.equal(r.segments[1].length, 4);
  assert.equal(r.rejected, 0);
  assert.deepEqual(r.last, stay[3]);
});

test('새 위치 점들이 서로 30 m 넘게 흩어지면 기준을 바꾸지 않는다', () => {
  const scattered = [[37.4, -122.0], [38.4, -121.0], [39.4, -120.0], [40.4, -119.0]];
  const r = f.filterTrack(run(10).concat(scattered));
  assert.equal(r.segments.length, 1);
  assert.equal(count(r), 10);
});

test('3점 뒤 이어지는 이동은 새 선에 계속 붙는다', () => {
  const moved = Array.from({length: 8}, (_, i) => [US[0], US[1] + i * 3 / M_LON]);
  const r = f.filterTrack(run(5).concat(moved));
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[1].length, 8);
});

test('빈 열·잘못된 점은 안전하게 넘긴다', () => {
  assert.deepEqual(f.filterTrack([]).segments, []);
  assert.equal(f.filterTrack(null).last, null);
  assert.equal(count(f.filterTrack([[NaN, 1], ...run(3)])), 3);
});
