const test = require('node:test');
const assert = require('node:assert/strict');
require('../../app/static/demo/js/logic.js');
const m = globalThis.RunwayDemoLogic;

test('SSE 조각과 재접속 대기', () => {
  const r = m.parseSseChunk('event: A\ndata: {"x":1}\n\nevent: B\nda');
  assert.deepEqual(r.events, [{event: 'A', data: {x: 1}}]);
  assert.equal(r.rest, 'event: B\nda');
  assert.deepEqual([0, 1, 2, 3].map(m.backoffMs), [1000, 2000, 5000, 5000]);
});

test('배너 우선순위와 입력 상태 문구', () => {
  const now = Date.now();
  const trace = {status: 'SAFETY', inputAsOf: new Date().toISOString(), latency: {inputLagMs: 0}};
  assert.equal(m.bannerFor({trace, nowMs: now, serverOffsetMs: 0, lastMessageAtMs: now - 46000, stage: 'L2'}).text, '연결 끊김');
  assert.equal(m.bannerFor({trace, nowMs: now, serverOffsetMs: 0, lastMessageAtMs: now, stage: 'L2'}).text, '속도 낮추기');
  assert.equal(m.bannerFor({trace: {...trace, status: 'OK', inputAsOf: new Date(now - 21000).toISOString()}, nowMs: now,
    serverOffsetMs: 0, lastMessageAtMs: now, stage: 'L2'}).text, '입력 부족·20초 이상');
  assert.equal(m.bannerFor({trace: {...trace, status: 'OK', inputAsOf: new Date(now - 21000).toISOString(), latency: {inputLagMs: null}},
    nowMs: now, serverOffsetMs: 0, lastMessageAtMs: now, stage: 'L3'}), null);
  assert.equal(m.bannerFor({trace: {...trace, status: 'OK', latency: {inputLagMs: -2500}}, nowMs: now,
    serverOffsetMs: 0, lastMessageAtMs: now, stage: 'L2'}).text, '기기 시계 확인');
  assert.equal(m.bannerFor({trace: {...trace, status: 'PAUSED'}, nowMs: now, serverOffsetMs: 0,
    lastMessageAtMs: now, stage: 'L2'}).text, '일시정지');
  assert.equal(m.bannerFor({trace: {...trace, status: 'HR_STALE'}, nowMs: now, serverOffsetMs: 0,
    lastMessageAtMs: now, stage: 'L2'}).text, '입력 지연 15초+: 가속 안 함');
});

test('비교 문자열·pace·확대 보기', () => {
  assert.equal(m.checkText({shown: 'RECOMMENDED', comparable: true, actualHrBpm: 160.1,
    recommended: {predHr120Bpm: 158, errorBpm: 2.1}}), '추천대로 뜀 · 예측 158 → 실측 160 (+2)');
  assert.equal(m.checkText({shown: 'NEAREST', comparable: true, actualHrBpm: 160,
    nearest: {deltaSecPerKm: -10, predHr120Bpm: 161, errorBpm: -1}}), '추천과 다르게 뜀 · 실제 속도 후보(−10) 예측 161 → 실측 160 (−1)');
  assert.equal(m.checkText({shown: null, comparable: false, notComparableReason: 'OUT_OF_CANDIDATE_RANGE'}), '비교 불가(후보 범위 밖)');
  assert.deepEqual([m.formatPace(335), m.formatPace(300)], ["5'35\"", "5'00\""]);
  assert.deepEqual(m.zoomDeltas([155,156,157,159,160].map(v => ({predHrBpm: [0,0,v]}))), [-2, -1, 0, 2, 3]);
  assert.equal(m.checkText({shown: null, comparable: false, notComparableReason: 'NO_SOURCE_TRACE'}), null);
});

test('안내 카드와 trace 병합', () => {
  const trace = {decision: {action: 'GUIDE_PACE', chosenIndex: 3, recommendedPaceSecPerKm: 345},
    candidates: [{deltaSecPerKm: -10}, {deltaSecPerKm: -5}, {deltaSecPerKm: 0}, {deltaSecPerKm: 5}, {deltaSecPerKm: 10}],
    coaching: {delivery: 'WATCH'}};
  assert.deepEqual(m.guideCard(trace), {paceText: "5'45\"/km", actionText: '감속', deliveryText: '워치 적용'});
  const first = {traceId: 'a', inputAsOf: '2026-11-05T05:00:05Z'};
  const second = {traceId: 'b', inputAsOf: '2026-11-05T05:00:00Z'};
  assert.deepEqual(m.mergeTraces([first], {...first}), [first]);
  assert.deepEqual(m.mergeTraces([first], second), [second, first]);
});

test('기록 선택지: 러닝이 둘 이상이면 러닝 이름을 붙인다', () => {
  const a = {modelLabel: 'GRU M3-005', label: '러닝 A'}, b = {modelLabel: 'TF-D H420', label: '러닝 A'};
  const c = {modelLabel: 'GRU M3-005', label: '러닝 B'}, d = {modelVersion: 'x-1', label: '러닝 B'};
  assert.deepEqual(m.recordingOptionTexts([a, b]), ['예측기: GRU M3-005', '예측기: TF-D H420']);
  assert.deepEqual(m.recordingOptionTexts([a, c, d]), ['예측기: GRU M3-005 · 러닝 A', '예측기: GRU M3-005 · 러닝 B', '예측기: x-1 · 러닝 B']);
});
