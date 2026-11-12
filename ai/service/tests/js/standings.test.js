const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../../app/static/demo/js/standings.js');

// 727 선두·후미 판정. 지역 평면 좌표(m) → 위·경도. 매 1초 GPS 점, 콘솔 갱신은 3초마다(서버 조회 간격).
const LAT0 = 37.5, LON0 = 127.0, M_LAT = 111195, M_LON = 111195 * Math.cos(LAT0 * Math.PI / 180);
const ll = (x, y) => [LAT0 + y / M_LAT, LON0 + x / M_LON];
// 결정적 GPS 흔들림(±amp m)
const jitter = (t, seed, amp) => amp * Math.sin(t * 1.7 + seed * 3.1) * Math.cos(t * 0.6 + seed);

function run(positions, untilSec, course = null) {
  // positions: {label: t => [x, y]} — t초까지 1초 간격 점을 쌓아 3초마다 tracker.update
  const tracker = s.createTracker();
  const history = [];
  for (let t = 3; t <= untilSec; t += 3) {
    const routes = Object.entries(positions).map(([label, fn]) => ({
      label, points: Array.from({length: t + 1}, (_, k) => ll(...fn(k))),
    }));
    history.push({t, ...tracker.update(routes, course)});
  }
  return history;
}

test('727 (a) 나란히 뛰면 GPS 흔들림이 있어도 선두·후미가 깜빡이지 않고 나란히', () => {
  const h = run({
    '러너 1': t => [5 * t + jitter(t, 1, 6), jitter(t, 2, 6)],
    '러너 2': t => [5 * t - 4 + jitter(t, 3, 6), 3 + jitter(t, 4, 6)],
  }, 120);
  const later = h.filter(x => x.t >= 9);
  assert.ok(later.every(x => x.sideBySide), JSON.stringify(later.filter(x => !x.sideBySide).map(x => [x.t, x.gapM])));
  assert.ok(later.every(x => x.leader === null && x.trailer === null));
  assert.match(s.standingsText(later.at(-1)), /^나란히 달리는 중 · 간격 \d+ m \(앞선 러너 경로 기준\)$/);
});

test('727 (b) 후미가 옆길로 30 m 샜다 돌아와도 순서가 바뀌지 않는다(누적 거리였다면 바뀜)', () => {
  // 러너 2는 40 m 뒤. 20~32초에 옆으로 30 m 나갔다 돌아온다(누적 거리는 약 +60 m)
  const side = t => (t < 20 || t > 32 ? 0 : 30 * Math.sin(Math.PI * (t - 20) / 12));
  const h = run({
    '러너 1': t => [5 * t, 0],
    '러너 2': t => [5 * t - 40, side(t)],
  }, 60);
  assert.ok(h.filter(x => x.t >= 6).every(x => x.leader === '러너 1' && x.trailer === '러너 2'),
    JSON.stringify(h.map(x => [x.t, x.leader, x.gapM])));
  const mid = h.find(x => x.t === 27);
  assert.ok(Math.abs(mid.gapM - 40) <= 6, String(mid.gapM));                 // 옆으로 샌 거리는 빠진다
});

test('727 (c) 후미가 실제로 추월하면 15 m를 넘고 두 번 연속일 때 바뀐다', () => {
  const h = run({
    '러너 1': t => [5 * t, 0],
    '러너 2': t => [5.5 * t - 40, 2],
  }, 132);
  const first = h.find(x => x.leader === '러너 2');
  assert.ok(first, '추월이 반영되지 않음');
  // 러너 2가 15 m 넘게 앞서는 첫 갱신(t=111, 15.5 m)에서는 그대로, 두 번째(t=114)에 바뀐다
  assert.equal(first.t, 114);
  assert.ok(h.filter(x => x.t < 114).every(x => x.leader !== '러너 2'));
  assert.equal(h.find(x => x.t === 111).leader, null);                       // 그 직전은 15 m 안팎이라 나란히
  assert.equal(h.at(-1).refLabel, '러너 2');                                   // 기준선도 앞선 러너 경로로 바뀜
  assert.ok(h.filter(x => x.t >= 114).every(x => x.leader === '러너 2'));
});

test('727 (d) U턴 왕복 구간에서 반대편 길에 붙지 않는다', () => {
  // 300 m 갔다가 3 m 옆 차선으로 돌아온다. 러너 2는 60 m 뒤, GPS가 돌아오는 차선 쪽으로 2.5 m 치우침
  const path = sAlong => (sAlong <= 300 ? [sAlong, 0] : [600 - sAlong, 3]);
  const h = run({
    '러너 1': t => path(5 * t),
    '러너 2': t => { const [x, y] = path(Math.max(0, 5 * t - 60)); return [x, y + (5 * t - 60 <= 300 ? 2.5 : -2.5)]; },
  }, 90);
  const cross = h.find(x => x.t === 66);                                       // 러너 1 330 m(돌아오는 길), 러너 2 270 m(가는 길): 같은 자리
  assert.equal(cross.leader, '러너 1');
  assert.ok(Math.abs(cross.gapM - 60) <= 6, String(cross.gapM));
  assert.ok(h.filter(x => x.t >= 6).every(x => x.leader === '러너 1' && !x.sideBySide),
    JSON.stringify(h.map(x => [x.t, x.leader, x.gapM])));
});

test('727 코스가 있으면 코스 선 진행 거리', () => {
  const course = {points: Array.from({length: 61}, (_, i) => [ll(i * 10, 0)[1], ll(i * 10, 0)[0], 0, null])};
  const h = run({'러너 1': t => [5 * t, 4], '러너 2': t => [5 * t - 50, -4]}, 30, course);
  const last = h.at(-1);
  assert.equal(last.basis, 'course');
  assert.equal(last.leader, '러너 1');
  assert.ok(Math.abs(last.gapM - 50) <= 2, String(last.gapM));
  assert.match(s.standingsText(last), /\(코스 진행 거리\)$/);
});

test('727 위치가 2명 미만이면 판정 없음, 잘못된 점은 건너뜀', () => {
  const tracker = s.createTracker();
  assert.equal(tracker.update([{label: '러너 1', points: [ll(0, 0)]}], null).basis, null);
  assert.equal(tracker.update([], null).leader, null);
  assert.equal(s.standingsText(tracker.update([], null)), '');
  const r = s.createTracker().update([{label: '러너 1', points: [['x', 1], ll(0, 0), ll(80, 0)]},
                                      {label: '러너 2', points: [ll(0, 0), null, ll(20, 0)]}], null);
  assert.equal(r.leader, '러너 1');
  assert.ok(Number.isFinite(r.gapM));
});
