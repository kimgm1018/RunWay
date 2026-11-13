const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('../../app/static/demo/watch/watch-logic.js');

test('767 워치 숫자 표기는 워치 앱 MetricFormat과 같다', () => {
  assert.deepEqual(w.pace(354.4), {value: '5’54”', missing: false, sec: 354});
  assert.equal(w.pace(null).value, '– –');
  assert.equal(w.pace(0).missing, true);
  assert.equal(w.distance(3428).value, '3.42');            // 버림(3.428 → 3.42)
  assert.equal(w.duration(1214).value, '20:14');
  assert.equal(w.duration(3725).value, '1:02:05');
  assert.equal(w.heart(151.6).value, '152');
  assert.equal(w.heart(0).missing, true);
});

test('767 페이스 점(8’00”–4’00”)·리듬 점(150–190) 범위 밖은 숨긴다', () => {
  assert.equal(w.paceTicks(480), 0);
  assert.equal(w.paceTicks(240), 1);
  assert.equal(w.paceTicks(500), null);
  assert.equal(w.paceOutOfRange(500), true);
  assert.equal(w.bpmTicks(170), 0.5);
  assert.equal(w.bpmTicks(140), null);
});

test('767 박자 깜빡임은 초당 3번을 넘지 않는다', () => {
  assert.equal(w.beatIntervalMs(172), Math.ceil(60000 / 172));      // 2.87회/초
  assert.equal(w.beatIntervalMs(190), Math.ceil(60000 / 190 * 2));  // 3.17회/초 → 두 박에 한 번
  for (const bpm of [60, 150, 172, 180, 181, 220]) assert.ok(1000 / w.beatIntervalMs(bpm) <= 3.0001, String(bpm));
  assert.equal(w.beatIntervalMs(null), null);
});

test('767 그룹: 고른 러너의 값, 공동 페이스 변경 안내, 내 페이스 비교', () => {
  const trace = {elapsedSec: 300, status: 'OK',
    decision: {recommendedPaceSecPerKm: 330, changed: true, fromPaceSecPerKm: 360},
    group: {members: [{label: '러너 1', hrNowBpm: 150, speedNowMps: 1000 / 340},
                      {label: '러너 2', hrNowBpm: 158, speedNowMps: 1000 / 320}]}};
  const v1 = w.view(trace, {runner: 0});
  assert.equal(v1.mode, 'group');
  assert.equal(v1.shared.value, '5’30”');
  assert.equal(v1.change, '이전 6’00” → 새 5’30”');
  assert.equal(v1.mine, '내 5’40” · +10”');
  assert.equal(v1.heart.value, '150');
  assert.equal(v1.rhythm, null);              // 그룹에는 리듬 BPM이 없어 숨긴다
  assert.equal(v1.distance, null);            // 멤버별 거리도 없다
  const v2 = w.view(trace, {runner: 1});
  assert.equal(v2.runner, '러너 2');
  assert.equal(v2.mine, '내 5’20” · −10”');
  assert.equal(w.paceChanged(null, v1), true);
  assert.equal(w.paceChanged(v1, w.view({...trace, decision: {...trace.decision, changed: false}}, {runner: 0})), false);
});

test('767 개인: 안내 페이스·리듬 BPM·목표 진행, 바뀐 순간만 진동 안내', () => {
  const t = (pace, cue) => ({elapsedSec: 600, status: 'OK', decision: {recommendedPaceSecPerKm: pace, cueBpm: cue},
    input: {hrNowBpm: 149.5, speedNowMps: 1000 / 355, distanceM: 1500, remainingM: 3500}});
  const a = w.view(t(360, 172));
  assert.equal(a.guide.value, '6’00”');
  assert.equal(a.rhythm, '172');
  assert.equal(a.statusPace.value, '5’55”');
  assert.equal(a.goalProgress, 0.3);
  assert.equal(a.heart.value, '150');
  assert.equal(w.paceChanged(a, w.view(t(360, 172))), false);
  assert.equal(w.paceChanged(a, w.view(t(350, 172))), true);
  assert.equal(w.paceChanged(a, w.view(t(360, 176))), true);
  const waiting = w.view({status: 'INPUT_INSUFFICIENT', decision: {recommendedPaceSecPerKm: 360}, input: {}});
  assert.equal(waiting.guide, null);
  assert.equal(waiting.rhythm, null);
});

test('767 진행 순서: 콘솔 순서 계산 결과로 순위·바로 앞뒤·선두–후미', () => {
  const st = {basis: 'path', order: ['러너 2', '러너 1', '러너 3'], gapM: 75, sideBySide: false,
    along: {'러너 2': 300, '러너 1': 255, '러너 3': 225}};
  const p = w.position(st, '러너 1');
  assert.equal(p.rank, '2');
  assert.equal(p.total, '/ 3명');
  assert.equal(p.ahead.value, '45m');
  assert.equal(p.behind.value, '30m');
  assert.equal(p.spread, '선두–후미 75m');
  assert.equal(w.position(st, '러너 2').ahead.none, true);
  const tie = w.position({...st, sideBySide: true, gapM: 4}, '러너 1');
  assert.equal(tie.tie, 3);
  assert.equal(w.position({basis: null, order: []}, '러너 1'), null);
});

test('767 러너 고르기: 기본 1번, 범위를 넘으면 마지막 러너', () => {
  const p = q => new URLSearchParams(q);
  assert.equal(w.runnerIndex(p(''), 3), 0);
  assert.equal(w.runnerIndex(p('runner=2'), 3), 1);
  assert.equal(w.runnerIndex(p('runner=9'), 3), 2);
  assert.equal(w.runnerIndex(p('runner=x'), 3), 0);
});

test('767 쪽 넘기기는 실제 워치처럼 끝에서 멈추고, 자동 넘기기는 ?auto=초(3초 이상)로만 켠다', () => {
  assert.equal(w.stepPage('group', 'status', 1), 'groupPace');
  assert.equal(w.stepPage('group', 'position', 1), 'position');
  assert.equal(w.stepPage('personal', 'status', -1), 'status');
  assert.equal(w.stepPage('personal', 'heart', 1), 'status');       // 자세히 화면은 넘기기 목록에 없다
  const p = q => new URLSearchParams(q);
  assert.equal(w.autoMs(p('')), 0);
  assert.equal(w.autoMs(p('auto=2')), 0);
  assert.equal(w.autoMs(p('auto=6')), 6000);
});
