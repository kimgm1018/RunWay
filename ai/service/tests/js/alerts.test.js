const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../../app/static/demo/js/alerts.js');

// 909 청중용 알림: 페이스 변경 카드 문구와 뒤처짐 표시·해제.
function trace(at, decision, worstIndex = 1) {
  return {traceId: 't' + at, elapsedSec: at, decision,
    group: {worstIndex, members: [{label: '러너 1'}, {label: '러너 2'}]}};
}
const SLOW = {changed: true, direction: 'SLOW', reason: 'HR_LIMIT', fromPaceSecPerKm: 350, recommendedPaceSecPerKm: 360,
  reasonText: '러너 2 상한 164 ≥ 허용 163 → 5\'50"에서 6\'00"로 감속'};
const HOLD = {changed: false, direction: 'HOLD', reason: 'COOLDOWN', fromPaceSecPerKm: 360, recommendedPaceSecPerKm: 360};

test('909 짧은 이유: 감속은 가장 빠듯한 러너 심박, 가속은 여유·복귀, 공식은 쓰지 않는다', () => {
  assert.equal(a.shortReason(trace(0, SLOW)), '러너 2 심박 높음');
  assert.equal(a.shortReason(trace(0, {...SLOW, reason: 'WARMUP_CAP'}, 0)), '러너 1 심박 높음');
  assert.equal(a.shortReason(trace(0, {...SLOW, reason: 'FLOOR'}, null)), '심박 높음');
  assert.equal(a.shortReason(trace(0, {changed: true, direction: 'FAST', reason: 'AHEAD'})), '모두 여유 있음');
  assert.equal(a.shortReason(trace(0, {changed: true, direction: 'FAST', reason: 'SMALL_CHANGE'})), '모두 여유 있음');
  assert.equal(a.shortReason(trace(0, {changed: true, direction: 'FAST', reason: 'RECOVERED'})), '목표 페이스로 복귀');
  assert.equal(a.shortReason(trace(0, HOLD)), '');
  for (const r of ['러너 2 심박 높음', '모두 여유 있음', '목표 페이스로 복귀']) assert.ok(r.length <= 12, r);
});

test('909 페이스 변경 카드: 바꾼 뒤 45초 동안만, 늦춤은 ▼·올림은 ▲, 두 페이스를 화살표로', () => {
  const list = [trace(360, HOLD), trace(390, SLOW), trace(420, HOLD), trace(450, HOLD)];
  assert.equal(a.paceChangeCard(list[0], list.slice(0, 1)), null);
  const card = a.paceChangeCard(list[1], list.slice(0, 2));
  assert.deepEqual({kind: card.kind, title: card.title, pace: card.pace, reason: card.reason, ageSec: card.ageSec},
    {kind: 'down', title: '▼ 페이스 늦춤', pace: '5\'50" → 6\'00"', reason: '러너 2 심박 높음', ageSec: 0});
  assert.equal(a.paceChangeCard(list[2], list.slice(0, 3)).ageSec, 30);     // 다음 판단(유지)에도 그대로
  assert.equal(a.paceChangeCard(list[3], list), null);                      // 60초 뒤엔 숨김
  const up = a.paceChangeCard(trace(60, {changed: true, direction: 'FAST', reason: 'RECOVERED',
    fromPaceSecPerKm: 370, recommendedPaceSecPerKm: 350}), null);
  assert.equal(up.kind, 'up'); assert.equal(up.title, '▲ 페이스 올림'); assert.equal(up.pace, '6\'10" → 5\'50"');
  assert.equal(a.paceChangeCard({elapsedSec: 10, decision: SLOW}, null), null);   // 개인(그룹 아님)은 없음
});

test('909 뒤처짐: 50 m 넘으면 표시, 20 m 아래로 와야 해제(앱·워치와 같은 규칙), 둘이면 둘 다', () => {
  const t = a.createLagTracker();
  const st = along => ({along});
  assert.deepEqual(t.update(st({'러너 1': 500, '러너 2': 450})), []);                  // 정확히 50 m는 아직
  assert.deepEqual(t.update(st({'러너 1': 560, '러너 2': 508})), [{label: '러너 2', gapM: 52}]);
  assert.equal(a.lagText({label: '러너 2', gapM: 52}), '⚠ 러너 2 뒤처짐 · 52 m');
  assert.deepEqual(t.update(st({'러너 1': 600, '러너 2': 570})), [{label: '러너 2', gapM: 30}]);   // 30 m: 아직 표시
  assert.deepEqual(t.update(st({'러너 1': 640, '러너 2': 621})), []);                  // 19 m: 해제
  assert.deepEqual(t.update(st({'러너 1': 680, '러너 2': 640})), []);                  // 40 m: 다시 50 m 넘어야
  const three = t.update(st({'러너 1': 900, '러너 2': 840, '러너 3': 790}));
  assert.deepEqual(three, [{label: '러너 3', gapM: 110}, {label: '러너 2', gapM: 60}]);
  assert.deepEqual(t.update(null), []);
  assert.deepEqual(t.update(st({'러너 1': 900})), []);
});
