const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../app/static/demo/js/logic.js');

const T = Date.parse('2026-11-05T05:00:00Z');
function tr(id, sec) { return {traceId: id, inputAsOf: new Date(T + sec * 1000).toISOString()}; }
function ids(list) { return list.map(t => t.traceId); }

test('판단 기록 보관 창은 서버와 같은 10분', () => {
  assert.equal(m.TRACE_WINDOW_SEC, 600);
});

test('가장 늦은 inputAsOf에서 10분보다 오래된 기록은 버린다', () => {
  const merged = m.mergeTraces([tr('a', 0), tr('b', 300)], tr('c', 601));
  assert.deepEqual(ids(merged), ['b', 'c']);
});

test('정확히 10분 전 기록은 남긴다', () => {
  assert.deepEqual(ids(m.mergeTraces([tr('a', 0)], tr('b', 600))), ['a', 'b']);
});

test('늦게 도착한 오래된 기록도 창 밖이면 남기지 않는다', () => {
  assert.deepEqual(ids(m.mergeTraces([tr('b', 700)], tr('a', 0))), ['b']);
});

test('긴 러닝에서도 목록이 창 크기를 넘지 않는다', () => {
  let list = [];
  for (let s = 0; s <= 3600; s += 5) list = m.mergeTraces(list, tr('t' + s, s));
  assert.equal(list.length, 600 / 5 + 1);
  assert.equal(list[0].traceId, 't3000');
  assert.equal(list[list.length - 1].traceId, 't3600');
});

test('같은 traceId는 갱신하고 시간순으로 정렬한다', () => {
  const merged = m.mergeTraces([tr('b', 10), tr('a', 5)], [{...tr('b', 10), status: 'OK'}]);
  assert.deepEqual(ids(merged), ['a', 'b']);
  assert.equal(merged[1].status, 'OK');
});

test('정책 표기는 판단 기록의 policyVersion을 먼저 쓰고, 없으면 현재 정책 mpc-v0.4.3', () => {
  assert.equal(m.DEFAULT_POLICY_VERSION, 'mpc-v0.4.3');
  assert.equal(m.policyVersionOf({policyVersion: 'mpc-v0.5.0'}, {policyVersion: 'mpc-v0.4.1'}), 'mpc-v0.5.0');
  assert.equal(m.policyVersionOf({}, {policyVersion: 'mpc-v0.4.2'}), 'mpc-v0.4.2');
  assert.equal(m.policyVersionOf(null, null), 'mpc-v0.4.3');
  assert.equal(m.policyVersionOf({policyVersion: 'mpc-v0.5.0'}, null), 'mpc-v0.5.0');   // 정책이 바뀌어도 데이터 값을 그대로 쓴다
});

test('탈락 이유는 화면 문구로, 모르는 값은 그대로', () => {
  assert.equal(m.rejectReasonText('UPPER_OVER_ALLOW'), '허용선 초과');
  assert.equal(m.rejectReasonText('GATE_SLOW_ONLY'), '감속만 허용');
  assert.equal(m.rejectReasonText('NEW_REASON'), 'NEW_REASON');
  assert.equal(m.rejectReasonText(null), '안전 기준 미통과');
});

test('안내 방향은 고른 후보의 delta와 EASE_OFF로 정한다', () => {
  const c = [-10, -5, 0, 5, 10].map(d => ({deltaSecPerKm: d}));
  assert.equal(m.actionKind({candidates: c, decision: {chosenIndex: 1}}), 'up');
  assert.equal(m.actionKind({candidates: c, decision: {chosenIndex: 2}}), 'hold');
  assert.equal(m.actionKind({candidates: c, decision: {chosenIndex: 4}}), 'down');
  assert.equal(m.actionKind({candidates: c, decision: {action: 'EASE_OFF', chosenIndex: null}}), 'ease');
  assert.equal(m.actionKind({}), 'idle');
  assert.equal(m.guideCard({candidates: c, decision: {chosenIndex: 0, recommendedPaceSecPerKm: 320}}).actionKind, 'up');
});

test('경과 시간 표기', () => {
  assert.equal(m.formatElapsed(1050), '17:30');
  assert.equal(m.formatElapsed(3725), '1:02:05');
  assert.equal(m.formatElapsed(null), '—');
});

test('후보 막대 범위는 허용선과 모든 예측·상한을 담는다', () => {
  const cands = [{predHrBpm: [150, 155, 160], peakUpperBpm: 166}, {predHrBpm: [150, 156, 164], peakUpperBpm: 171}];
  const r = m.gaugeRange(cands, 172);
  assert.ok(r.lo < 160 && r.hi > 172);
  assert.equal(m.gaugeRange([], null), null);
});

test('후보 요약은 데이터의 개수와 범위를 쓴다(개인 5개·그룹 9개)', () => {
  const personal = [-10, -5, 0, 5, 10].map(d => ({deltaSecPerKm: d}));
  const group = [-30, -20, -10, 0, 10, 20, 30, 45, 60].map(d => ({deltaSecPerKm: d}));
  assert.equal(m.candidateSummary(personal).text, '후보 5개 · −10 ~ +10초/km');
  assert.equal(m.candidateSummary(group).text, '후보 9개 · −30 ~ +60초/km');
  assert.equal(m.candidateSummary([]).text, '');
});

test('판단 모드: group이 있으면 그룹 AI10, 없으면 개인 AI04', () => {
  assert.equal(m.modeOf({}).kind, 'personal');
  assert.equal(m.modeOf({group: {members: []}}).kind, 'group');
});

test('그룹 판정판: 칸은 허용선까지 남은 bpm, 고른 후보에서 여유가 가장 작은 멤버가 worst', () => {
  const g = {candidates: [{deltaSecPerKm: 0}, {deltaSecPerKm: 10}], chosenIndex: 1,
    members: [{label: 'A', allowBpm: 170, upperHrBpm: [172, 165]}, {label: 'B', allowBpm: 175, upperHrBpm: [170, 173]}]};
  const x = m.groupMatrix(g);
  assert.equal(x.rows[0].cells[0].passed, false);
  assert.equal(x.rows[0].cells[1].headroom, 5);
  assert.equal(x.worstIndex, 1);
  assert.equal(m.groupMatrix(null), null);
});

test('라이브 연결 대상: session 우선, group은 그룹 스트림 키, 없으면 latest', () => {
  assert.equal(m.streamRef(new URLSearchParams('mode=live&session=42')), '42');
  assert.equal(m.streamRef(new URLSearchParams('mode=live&group=3')), String(m.GROUP_KEY_OFFSET + 3));
  assert.equal(m.streamRef(new URLSearchParams('mode=live&group=abc')), 'latest');
  assert.equal(m.streamRef(new URLSearchParams('mode=live')), 'latest');
});

test('그룹 기록: 판정판은 데이터의 통과·예측·worst를 쓰고, 안내 방향은 direction', () => {
  const g = {candidates: [{deltaSecPerKm: -20, paceSecPerKm: 350, passed: true}, {deltaSecPerKm: 0, paceSecPerKm: 370, passed: true}],
    chosenIndex: 0, worstIndex: 1,
    members: [{label: '러너 1', hrNowBpm: 140, allowBpm: 163, predHr120Bpm: [146, 139], upperHrBpm: [151, 143], passed: [true, true]},
              {label: '러너 2', hrNowBpm: 145, allowBpm: 163, predHr120Bpm: [151, 144], upperHrBpm: [155, 148], passed: [true, true]}]};
  const x = m.groupMatrix(g);
  assert.equal(x.worstIndex, 1);
  assert.equal(x.rows[0].cells[0].pred, 146);
  assert.equal(x.rows[1].hrNow, 145);
  assert.deepEqual(x.columnsPassed, [true, true]);
  const trace = {kind: 'GROUP', group: g, decision: {direction: 'FAST', reasonLabel: '가속', chosenIndex: 0}};
  assert.equal(m.modeOf(trace).kind, 'group');
  assert.equal(m.actionKind(trace), 'up');
  assert.equal(m.guideCard(trace).actionText, '가속');
  assert.equal(m.actionKind({decision: {direction: 'HOLD'}}), 'hold');
});

test('724 실제 페이스: 정지·없음은 글자, 정상은 페이스', () => {
  assert.deepEqual(m.actualPace(null, null), {kind: 'none', text: '—', sec: null});
  assert.equal(m.actualPace(0, null).text, '정지');                 // 멈춤: 속도 0
  assert.equal(m.actualPace(0.05, 20000).text, '정지');             // 거의 멈춤: 큰 숫자 대신 정지
  assert.equal(m.actualPace(0.8, 1250).kind, 'stopped');            // 20'00"/km보다 느리면 정지
  assert.equal(m.actualPace(1000 / 422, 422).text, '7\'02"');
  assert.equal(m.actualPace(20, 50).text, '—');                     // 2'00"/km보다 빠르면 측정 오류
  assert.equal(m.actualPace(undefined, 375).text, '6\'15"');        // 옛 기록: 속도 칸이 없으면 페이스로
  assert.equal(m.actualPace(undefined, 99999).text, '정지');
  assert.equal(m.actualPace('abc', null).text, '—');
});

test('724 그룹 판정판 행에 러너별 실제 페이스', () => {
  const group = {candidates: [{paceSecPerKm: 375, deltaSecPerKm: 0}], chosenIndex: 0, worstIndex: 0,
    members: [{label: '러너 1', hrNowBpm: 150, allowBpm: 163, upperHrBpm: [155], predHr120Bpm: [150], passed: [true],
               speedNowMps: 0, paceNowSecPerKm: null},
              {label: '러너 2', hrNowBpm: 140, allowBpm: 163, upperHrBpm: [150], predHr120Bpm: [146], passed: [true],
               speedNowMps: 1000 / 422, paceNowSecPerKm: 422}]};
  const matrix = m.groupMatrix(group);
  assert.deepEqual(matrix.rows.map(r => r.actual.text), ['정지', '7\'02"']);
});

test('738 이전 기록 목록 한 줄', () => {
  const start = new Date(2026, 10, 12, 14, 7).toISOString();
  assert.equal(m.historyRowText({startedAt: start, kind: 'GROUP', durationSec: 725, traceCount: 24, live: false}),
    '14:07 · 그룹 · 12분 · 판단 24건');
  assert.equal(m.historyRowText({startedAt: start, kind: 'PERSONAL', durationSec: 20, traceCount: 3, live: true}),
    '14:07 · 개인 · 1분 미만 · 판단 3건 · 진행 중');
  assert.equal(m.historyRowText({startedAt: 'x', kind: 'PERSONAL', durationSec: null, traceCount: null}), '— · 개인 · 1분 미만 · 판단 0건');
  assert.equal(m.historyRowText(null), '');
});
