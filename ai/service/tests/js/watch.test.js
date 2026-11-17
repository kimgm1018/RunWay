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

// ── 912: 5초 값(LIVE_METRICS)으로 판단 사이에도 갱신 ────────────────
const AS_OF = Date.parse('2026-11-05T05:00:00Z');
function liveRow(label, sec, extra) {
  return Object.assign({label: label, hrBpm: 161, speedMps: 1000 / 300, paceSecPerKm: 300, distanceM: 2500, elapsedSec: 300 + sec,
    measuredAt: new Date(AS_OF + sec * 1000).toISOString()}, extra || {});
}

test('912 개인: 판단 뒤 5초 값으로 심박·페이스·거리·경과 시간을 바꾸고 안내 페이스는 그대로 둔다', () => {
  const trace = {inputAsOf: '2026-11-05T05:00:00Z', elapsedSec: 300, status: 'OK',
    decision: {recommendedPaceSecPerKm: 330, cueBpm: 170},
    input: {hrNowBpm: 150, speedNowMps: 1000 / 340, distanceM: 2000, remainingM: 3000}};
  const base = w.view(trace, {});
  const live = w.view(trace, {live: [liveRow('러너', 10)]});
  assert.equal(base.heart.value, '150');
  assert.equal(live.heart.value, '161');
  assert.equal(live.statusPace.value, '5’00”');
  assert.equal(live.distance.value, '2.50');
  assert.equal(live.elapsed.value, '5:10');
  assert.equal(live.guide.value, base.guide.value);          // 안내 페이스·리듬은 판단 값 그대로
  assert.equal(live.rhythm, base.rhythm);
  assert.equal(live.goalProgress, 0.5);                       // 총 5000 m 중 2500 m(남은 거리도 같이 줄어 총 거리는 그대로)
  assert.equal(w.paceChanged(base, live), false);            // 5초 값만으로는 진동·쪽 이동이 없다
});

test('912 판단보다 오래된 5초 값과 값이 없는 경우는 지금과 같다', () => {
  const trace = {inputAsOf: '2026-11-05T05:00:00Z', elapsedSec: 300, status: 'OK',
    decision: {recommendedPaceSecPerKm: 330}, input: {hrNowBpm: 150, speedNowMps: 1000 / 340, distanceM: 2000, remainingM: 3000}};
  const base = JSON.stringify(w.view(trace, {}));
  assert.equal(JSON.stringify(w.view(trace, {live: [liveRow('러너', -5)]})), base);
  assert.equal(JSON.stringify(w.view(trace, {live: []})), base);
  assert.equal(JSON.stringify(w.view(trace, {live: undefined})), base);
});

test('912 그룹: 고른 러너의 5초 값만 쓰고 그룹 거리도 처음으로 보인다', () => {
  const trace = {inputAsOf: '2026-11-05T05:00:00Z', elapsedSec: 300, status: 'OK',
    decision: {recommendedPaceSecPerKm: 330, changed: false},
    group: {members: [{label: '러너 1', hrNowBpm: 150, speedNowMps: 1000 / 340},
                      {label: '러너 2', hrNowBpm: 158, speedNowMps: 1000 / 320}]}};
  const rows = [liveRow('러너 1', 10, {hrBpm: 141, distanceM: 1900}), liveRow('러너 2', 10, {hrBpm: 171, distanceM: 2100, paceSecPerKm: 310, speedMps: 1000 / 310})];
  const v1 = w.view(trace, {runner: 0, live: rows});
  const v2 = w.view(trace, {runner: 1, live: rows});
  assert.equal(v1.heart.value, '141');
  assert.equal(v2.heart.value, '171');
  assert.equal(v1.distance.value, '1.90');
  assert.equal(v2.distance.value, '2.10');
  assert.equal(v2.mine, '내 5’10” · −20”');                  // 공동 페이스 5’30” 대비
  assert.equal(v2.shared.value, '5’30”');
  assert.equal(v2.elapsed.value, '5:10');
  const without = w.view(trace, {runner: 1, live: [rows[0]]});   // 이 러너의 5초 값이 없으면 판단 값
  assert.equal(without.heart.value, '158');
  assert.equal(without.distance, null);
});

test('912 심박이 비어 오면 숨기고(– –) 판단의 옛 심박을 되살리지 않는다', () => {
  const trace = {inputAsOf: '2026-11-05T05:00:00Z', elapsedSec: 300, status: 'OK',
    decision: {recommendedPaceSecPerKm: 330}, input: {hrNowBpm: 150, speedNowMps: 3, distanceM: 2000, remainingM: 3000}};
  assert.equal(w.view(trace, {live: [liveRow('러너', 10, {hrBpm: null})]}).heart.missing, true);
});
