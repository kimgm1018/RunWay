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

test('736 그룹은 30초 판단 간격 안에서 입력 부족 배너가 뜨지 않고 50초 넘으면 판단 지연', () => {
  const now = Date.parse('2026-11-12T09:00:00Z');
  const at = sec => new Date(now - sec * 1000).toISOString();
  const group = sec => m.bannerFor({trace: {kind: 'GROUP', status: 'OK', inputAsOf: at(sec)}, nowMs: now, serverOffsetMs: 0,
                                    lastMessageAtMs: now, stage: 'L1A'});
  assert.equal(group(25), null);                              // 예전에는 20초부터 '입력 부족'이 켜졌다
  assert.equal(group(49), null);
  assert.deepEqual(group(65), {kind: 'stale', text: '판단 지연 65초 · 새 기록 없음'});
  const personal = m.bannerFor({trace: {status: 'OK', inputAsOf: at(25)}, nowMs: now, lastMessageAtMs: now, stage: 'L1A'});
  assert.equal(personal.kind, 'insufficient');               // 개인(AI04)은 그대로 20초
  const insufficient = m.bannerFor({trace: {kind: 'GROUP', status: 'INPUT_INSUFFICIENT', inputAsOf: at(1)}, nowMs: now,
                                    lastMessageAtMs: now, stage: 'L1A'});
  assert.equal(insufficient.kind, 'insufficient');
  assert.equal(m.bannerFor({trace: {kind: 'GROUP', status: 'OK', inputAsOf: at(300)}, nowMs: now, lastMessageAtMs: now, stage: 'L3'}), null);
});

test('736 마지막 판단 N초 전', () => {
  const now = Date.parse('2026-11-12T09:00:00Z');
  assert.equal(m.lastDecisionText({decidedAt: new Date(now - 12000).toISOString()}, now, 0), '마지막 판단 12초 전');
  assert.equal(m.lastDecisionText({inputAsOf: new Date(now - 125000).toISOString()}, now, 0), '마지막 판단 2분 5초 전');
  assert.equal(m.lastDecisionText({decidedAt: new Date(now + 3000).toISOString()}, now, 0), '마지막 판단 0초 전');
  assert.equal(m.lastDecisionText(null, now, 0), '');
  assert.equal(m.lastDecisionText({}, now, 0), '');
});

test('747 청중용 안내 한 줄(10자 안팎, 페이스 숫자 없음)', () => {
  const group = code => ({decision: {recommendedPaceSecPerKm: 354, reasonCode: code},
    group: {worstIndex: 1, members: [{label: '러너 1'}, {label: '러너 2'}]}, status: 'OK'});
  assert.deepEqual(m.headline(group('SPEED_UP')), {tone: 'up', text: '모두 여유 → 올림'});
  assert.deepEqual(m.headline(group('SLOW_DOWN')), {tone: 'down', text: '러너2 심박 높음 → 늦춤'});
  assert.equal(m.headline(group('WARMUP')).text, '워밍업 → 늦춤');
  assert.equal(m.headline(group('COOLDOWN')).text, '방금 바꿈 → 유지');
  assert.equal(m.headline(group('HOLD')).text, '알맞음 → 유지');
  assert.equal(m.headline({status: 'INPUT_INSUFFICIENT', decision: {recommendedPaceSecPerKm: 375}}).text, '심박 대기');
  assert.equal(m.headline({status: 'SAFETY', decision: {recommendedPaceSecPerKm: 400}}).tone, 'danger');
  const personal = delta => ({status: 'OK', decision: {recommendedPaceSecPerKm: 360, chosenIndex: 0},
    candidates: [{deltaSecPerKm: delta}]});
  assert.equal(m.headline(personal(-10)).text, '여유 → 올림');
  assert.equal(m.headline(personal(10)).text, '심박 오름 → 늦춤');
  assert.equal(m.headline(personal(0)).text, '알맞음 → 유지');
  for (const code of ['SPEED_UP', 'SLOW_DOWN', 'COOLDOWN', 'HOLD']) assert.ok(m.headline(group(code)).text.length <= 14);
  assert.equal(m.toneWord('up'), '여유');
  assert.equal(m.toneWord('down'), '힘듦');
  assert.equal(m.toneWord('x'), '');
});

test('747 안내 카드 지금(실제) 한 값: 개인 그대로, 그룹 평균, 정지·없음', () => {
  const pace = sec => ({kind: 'pace', text: m.formatPace(sec), sec});
  assert.equal(m.actualSummary([pace(360)]), m.formatPace(360));
  assert.equal(m.actualSummary([pace(340), pace(350)]), m.formatPace(345));
  assert.equal(m.actualSummary([{kind: 'stopped', text: '정지', sec: null}, pace(330)]), m.formatPace(330));
  assert.equal(m.actualSummary([{kind: 'stopped', text: '정지', sec: null}]), '정지');
  assert.equal(m.actualSummary([]), '—');
});

test('900 고른 후보가 탈락일 때만 이유 칩(개인 selectorReason, 그룹 decision.reason)', () => {
  const personal = (passed, reason) => ({decision: {chosenIndex: 1}, selectorReason: reason,
    candidates: [{passed: true}, {passed}]});
  assert.equal(m.chosenRejectChip(personal(false, 'FLOOR')), '통과 후보 없음 → 한 단계 늦춤');
  assert.equal(m.chosenRejectChip(personal(false, 'WARMUP_CAP')), '출발 3분 제한');
  assert.equal(m.chosenRejectChip(personal(false, 'COOLDOWN')), '바꾼 지 2분 유지');
  assert.equal(m.chosenRejectChip(personal(true, 'COOLDOWN')), null);       // 통과한 후보면 칩 없음
  assert.equal(m.chosenRejectChip(personal(false, 'HR_LIMIT')), null);      // 세 이유 밖이면 칩 없음
  assert.equal(m.chosenRejectChip(personal(false, undefined)), null);       // 옛 기록(이유 없음)
  const group = (passed, reason) => ({decision: {chosenIndex: 0, reason},
    group: {chosenIndex: 0, candidates: [{passed}]}, candidates: []});
  assert.equal(m.chosenRejectChip(group(false, 'WARMUP_CAP')), '출발 3분 제한');
  assert.equal(m.chosenRejectChip(group(true, 'WARMUP_CAP')), null);
  assert.equal(m.chosenRejectChip({decision: {chosenIndex: null}}), null);
  assert.equal(m.chosenRejectChip(null), null);
});

// ── 912: 판단 사이 5초 값(LIVE_METRICS) ─────────────────────────────
const LIVE_TRACE = {inputAsOf: '2026-11-05T05:00:00Z', elapsedSec: 600};
function liveRow(label, sec, extra) {
  return Object.assign({label: label, hrBpm: 150, speedMps: 3, paceSecPerKm: 333.3, distanceM: 1800, elapsedSec: 600 + sec,
    measuredAt: new Date(Date.parse('2026-11-05T05:00:00Z') + sec * 1000).toISOString()}, extra || {});
}

test('912 판단보다 오래된 5초 값은 쓰지 않고, 같거나 새 값만 쓴다', () => {
  assert.equal(m.liveFor(LIVE_TRACE, [liveRow('러너', -5)], null), null);
  assert.equal(m.liveFor(LIVE_TRACE, [liveRow('러너', 0)], null).hrBpm, 150);
  assert.equal(m.liveFor(LIVE_TRACE, [liveRow('러너', 5)], null).hrBpm, 150);
  assert.equal(m.liveFor(LIVE_TRACE, [], null), null);
  assert.equal(m.liveFor(LIVE_TRACE, undefined, null), null);
});

test('912 그룹은 같은 라벨의 값만 고른다', () => {
  const rows = [liveRow('러너 1', 5, {hrBpm: 140}), liveRow('러너 2', 5, {hrBpm: 170})];
  assert.equal(m.liveFor(LIVE_TRACE, rows, '러너 2').hrBpm, 170);
  assert.equal(m.liveFor(LIVE_TRACE, rows, '러너 3'), null);
});

test('912 시간 정보가 없는 값은 판단 시각과 비교하지 않고 그대로 쓴다', () => {
  assert.equal(m.liveFor({elapsedSec: 600}, [liveRow('러너', -50, {measuredAt: null})], null).hrBpm, 150);
});

test('912 판단 시간축 위치는 벽시계 차이로 맞춘다', () => {
  assert.equal(m.liveAxisSec(LIVE_TRACE, liveRow('러너', 25)), 625);
  assert.equal(m.liveAxisSec({elapsedSec: 600}, liveRow('러너', 25)), null);
});

test('912 심박 점은 라벨별로 쌓고 같은 시각·거꾸로 간 시각·심박 없음은 무시하며 상한을 넘으면 오래된 것부터 버린다', () => {
  let series = m.appendLiveSeries({}, [liveRow('러너', 5), liveRow('러너 2', 5, {hrBpm: 160})]);
  series = m.appendLiveSeries(series, [liveRow('러너', 5, {hrBpm: 199})]);      // 같은 시각
  series = m.appendLiveSeries(series, [liveRow('러너', 0, {hrBpm: 199})]);      // 거꾸로
  series = m.appendLiveSeries(series, [liveRow('러너', 10, {hrBpm: null})]);    // 심박 없음
  series = m.appendLiveSeries(series, [liveRow('러너', 10)]);
  assert.deepEqual(series['러너'].map(p => p[1]), [150, 150]);
  assert.equal(series['러너 2'].length, 1);
  let long = {};
  for (let i = 0; i < m.LIVE_SERIES_MAX + 10; i += 1) long = m.appendLiveSeries(long, [liveRow('러너', i * 5)]);
  assert.equal(long['러너'].length, m.LIVE_SERIES_MAX);
  assert.equal(long['러너'][0][0], Date.parse('2026-11-05T05:00:00Z') + 10 * 5 * 1000);
});

test('912 심박 실제선에 이을 점은 판단 시간축으로 바꿔 지난 점 뒤·최대 범위 안만 고른다', () => {
  const series = m.appendLiveSeries({}, [liveRow('러너', 5, {hrBpm: 151}), liveRow('러너', 10, {hrBpm: 152})]);
  const more = m.appendLiveSeries(series, [liveRow('러너', 200, {hrBpm: 160})]);
  assert.deepEqual(m.liveSeriesPoints(LIVE_TRACE, more['러너'], 600, 740), [[605, 151], [610, 152]]);   // 200초 값은 범위 밖
  assert.deepEqual(m.liveSeriesPoints(LIVE_TRACE, more['러너'], 605, 740), [[610, 152]]);
  assert.deepEqual(m.liveSeriesPoints({elapsedSec: 600}, more['러너'], 600, 740), []);
});

test('912 남은 거리는 판단 뒤 달린 만큼 줄이고 0 아래로 내려가지 않는다', () => {
  const trace = {input: {distanceM: 1800, remainingM: 3200}};
  assert.equal(m.liveRemaining(trace, {distanceM: 1850}), 3150);
  assert.equal(m.liveRemaining(trace, {distanceM: 9000}), 0);
  assert.equal(m.liveRemaining(trace, {distanceM: null}), null);
  assert.equal(m.liveRemaining({input: {}}, {distanceM: 1850}), null);
});
