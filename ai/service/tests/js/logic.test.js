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
