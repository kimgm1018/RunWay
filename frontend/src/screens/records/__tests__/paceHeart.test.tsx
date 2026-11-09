import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { RunRecordDetail, RunSplit } from '../../../data';
import { compareWithGoal, kmBands, measured } from '../paceHeart';
import { RecordView } from '../RecordView';

// S15P31E105-615: 2.1 홈 러닝 분석 — a card that turns: 앞면 러닝 결과 (both lines by km, the figures), 뒷면 목표와 비교
// (the API's splits against the run's own target pace, ±10초/km). Values are synthetic.

const split = (
  km: number,
  pace: number | null,
  heart: number | null,
): RunSplit => ({
  startDistanceM: km * 1000,
  endDistanceM: (km + 1) * 1000,
  paceSecPerKm: pace,
  averageHeartRate: heart,
  averageCadence: null,
});

// The table the 담당자 was shown: target 6′00″, ±10초 keeps 1, 2 and 4 km.
const five = [
  split(0, 365, 142),
  split(1, 355, 151),
  split(2, 380, 156),
  split(3, 368, 160),
  split(4, 340, 168),
];

test('the run is cut into equal 1km bands by distance; a short last stretch joins the km before it', () => {
  // 5.02km in 1km splits: five bands, the 20m tail in the fifth.
  const bands = kmBands([
    ...five.slice(0, 4),
    { ...five[4], endDistanceM: 5020 },
  ]);
  expect(bands.map(band => band.km)).toEqual([1, 2, 3, 4, 5]);
  expect(bands[1]).toEqual({ km: 2, startM: 1000, endM: 2000 });
  expect(bands[4]).toEqual({ km: 5, startM: 4000, endM: 5020 });
  // The mock's 500m splits still read as 1km bands.
  const halves = [0, 1, 2, 3].map(index => ({
    ...split(0, 300, 150),
    startDistanceM: index * 500,
    endDistanceM: (index + 1) * 500,
  }));
  expect(kmBands(halves)).toEqual([
    { km: 1, startM: 0, endM: 1000 },
    { km: 2, startM: 1000, endM: 2000 },
  ]);
  // A run under the sliver is still one band.
  expect(kmBands([{ ...split(0, 360, null), endDistanceM: 150 }])).toHaveLength(
    1,
  );
});

test('the average against the target: 비슷 within ±10초/km, else how far faster or slower', () => {
  const at = (average: number) => {
    const goal = compareWithGoal(five, average, 360);
    return goal.kind === 'target' ? [goal.summary, goal.gap] : null;
  };
  expect(at(355)).toEqual([
    '평균 페이스는 목표와 비슷했어요.',
    '목표보다 5초 빠름',
  ]);
  expect(at(370)).toEqual([
    '평균 페이스는 목표와 비슷했어요.',
    '목표보다 10초 느림',
  ]);
  expect(at(360)).toEqual([
    '평균 페이스는 목표와 비슷했어요.',
    '목표와 같은 페이스',
  ]);
  expect(at(340)?.[0]).toBe('평균 페이스가 목표보다 20초 빨랐어요.');
  expect(at(440)?.[0]).toBe('평균 페이스가 목표보다 1분 20초 느렸어요.');
});

test('each API split with a pace is counted against the target; faster and slower ones are named', () => {
  const goal = compareWithGoal(five, 362, 360);
  expect(goal.kind).toBe('target');
  if (goal.kind !== 'target') {
    return;
  }
  // 365 · 355 · 368 within, 380 slower, 340 faster.
  expect(goal.splits).toEqual({
    analyzed: 5,
    within: 3,
    missing: 0,
    faster: '4~5km 구간은 목표보다 빠르게 달렸어요.',
    slower: '2~3km 구간은 목표보다 느리게 달렸어요.',
  });
});

test('a split without a pace is left out and counted; a short last split is named by its distance', () => {
  const goal = compareWithGoal(
    [
      split(0, 345, null),
      split(1, null, null),
      split(2, 360, null),
      { ...split(3, 400, null), endDistanceM: 3020 },
    ],
    360,
    360,
  );
  if (goal.kind !== 'target') {
    throw new Error('expected a target');
  }
  expect(goal.splits).toEqual({
    analyzed: 3,
    within: 1,
    missing: 1,
    faster: '0~1km 구간은 목표보다 빠르게 달렸어요.',
    slower: '마지막 0.02km 구간은 목표보다 느리게 달렸어요.',
  });
});

test('without a target there is nothing to compare; without splits only the average is', () => {
  expect(compareWithGoal(five, 360, null)).toEqual({ kind: 'noTarget' });
  const goal = compareWithGoal([], 360, 360);
  expect(goal.kind === 'target' && goal.splits).toBeNull();
});

test('what the run measured, and whether a split lacks it', () => {
  expect(measured(five)).toEqual({ pace: true, heart: true, gap: false });
  expect(measured([split(0, 360, null)])).toEqual({
    pace: true,
    heart: false,
    gap: false,
  });
  expect(measured([split(0, 360, 150), split(1, 360, null)])).toEqual({
    pace: true,
    heart: true,
    gap: true,
  });
});

const record = (change: Partial<RunRecordDetail> = {}): RunRecordDetail => ({
  id: 'run-1',
  title: '아침 러닝',
  startedAt: '2026-11-08T22:10:00Z',
  distanceM: 5000,
  durationSec: 1808,
  averagePaceSecPerKm: 362,
  shape: [],
  runType: 'SOLO',
  group: null,
  goalAchieved: null,
  route: null,
  targetDurationSec: null,
  targetPaceSecPerKm: 360,
  averageHeartRate: 155,
  aiAdvice: null,
  splits: five,
  courseId: null,
  myCourseId: null,
  ...change,
});

async function card(change: Partial<RunRecordDetail> = {}) {
  const onOpen = jest.fn();
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <RecordView
        layout="home"
        record={record(change)}
        chartHeight={0}
        onOpen={onOpen}
        openLabel="아침 러닝 열기"
      />,
    );
  });
  const faceOf = (testID: string) =>
    screen.root.findAll(
      node => typeof node.type !== 'string' && node.props.testID === testID,
    )[0];
  // Plain texts, and the lines WordWrap sets word by word read whole from their label, in screen order.
  const wordsIn = (node: TestRenderer.ReactTestInstance) =>
    node
      .findAll(
        child =>
          typeof child.props.children === 'string' ||
          (child.props.accessible === true &&
            typeof child.props.accessibilityLabel === 'string'),
      )
      .map(child =>
        typeof child.props.children === 'string'
          ? (child.props.children as string)
          : (child.props.accessibilityLabel as string),
      );
  const press = (label: string) =>
    act(async () => {
      screen.root
        .findAll(node => node.props.accessibilityLabel === label)[0]
        .props.onPress();
    });
  return {
    screen,
    onOpen,
    press,
    front: () => faceOf('flip-front'),
    back: () => faceOf('flip-back'),
    wordsIn,
    // The figures set their unit beside the value, so a value is one child among several.
    tree: () => JSON.stringify(screen.toJSON()),
  };
}

test('앞면 러닝 결과: the lines, the four figures and 목표와 비교하기; the lines open the same run', async () => {
  const { front, back, wordsIn, press, onOpen, tree } = await card();
  const words = wordsIn(front());
  const order = [
    '페이스와 심박 변화',
    '달린 속도와 심박수의 변화를 함께 살펴보세요.',
    '거리',
    '시간',
    '평균 페이스',
    '평균 심박',
    '목표와 비교하기',
  ].map(text => words.indexOf(text));
  expect(order.every(at => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(tree()).toContain('"155"');
  // The comparison is the back's, and the lines are not repeated there.
  expect(words).not.toContain('목표 페이스 유지율');
  expect(wordsIn(back())).not.toContain('페이스와 심박 변화');
  // The back is turned away: no touch, hidden from the screen reader.
  expect(back().props.pointerEvents).toBe('none');
  expect(back().props.accessibilityElementsHidden).toBe(true);
  expect(front().props.pointerEvents).toBe('auto');
  await press('아침 러닝 열기');
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('뒷면 목표와 비교: the line, the two paces, the splits in range and the faster and slower ones', async () => {
  const { front, back, wordsIn, press } = await card();
  await press('목표와 비교하기');
  expect(front().props.pointerEvents).toBe('none');
  expect(front().props.accessibilityElementsHidden).toBe(true);
  expect(back().props.pointerEvents).toBe('auto');
  const words = wordsIn(back());
  const order = [
    '평균 페이스는 목표와 비슷했어요.',
    '목표 페이스',
    '실제 평균 페이스',
    // The splits as a chart off the target line, counted in its legend (담당자 요청: 말 대신 시각 자료로).
    '범위 안 3',
    '빠름 1',
    '느림 1',
    '목표 ±10초/km',
    '러닝 결과 보기',
  ].map(text => words.indexOf(text));
  expect(order.every(at => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const word of ['성공', '실패', '달성', '%']) {
    expect(words.join(' ')).not.toContain(word);
  }
});

test('a second tap while the card turns is ignored, then it turns back', async () => {
  jest.useFakeTimers();
  const { front, press } = await card();
  await press('목표와 비교하기');
  await press('러닝 결과 보기');
  // Still on the back: the turn under way swallowed the second tap.
  expect(front().props.pointerEvents).toBe('none');
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  await press('러닝 결과 보기');
  expect(front().props.pointerEvents).toBe('auto');
  jest.useRealTimers();
});

test('without a target pace the back says so and shows no figures or verdicts', async () => {
  const { back, wordsIn } = await card({ targetPaceSecPerKm: null });
  const words = wordsIn(back());
  expect(words).toContain('목표 페이스 없이 기록한 러닝이에요');
  for (const text of ['목표 페이스', '실제 평균 페이스']) {
    expect(words).not.toContain(text);
  }
  expect(words.join(' ')).not.toContain('범위 안');
});

test('a run without heart rate keeps the pace comparison and says the heart rate was not measured', async () => {
  const { front, back, wordsIn } = await card({
    averageHeartRate: null,
    splits: five.map(item => ({ ...item, averageHeartRate: null })),
  });
  expect(wordsIn(front())).toContain('이번 러닝에는 심박수 기록이 없어요.');
  expect(wordsIn(front())).toContain('기록 없음');
  expect(wordsIn(back())).toContain('범위 안 3');
});

test('a missing split is noted on both faces and left out of the count', async () => {
  const { front, back, wordsIn } = await card({
    splits: [...five.slice(0, 2), split(2, null, null), ...five.slice(3)],
  });
  expect(wordsIn(front())).toContain('일부 구간의 데이터가 없어요.');
  const words = wordsIn(back());
  expect(words).toContain('범위 안 3');
  expect(words).toContain('기록 없음 1');
});

test('a run without splits gives no split comparison', async () => {
  const { back, wordsIn } = await card({ splits: [] });
  const words = wordsIn(back());
  expect(words).toContain('평균 페이스는 목표와 비슷했어요.');
  expect(words.join(' ')).not.toContain('범위 안');
});

test('a time goal is said without 달성 or 미달성', async () => {
  const { back, wordsIn } = await card({ targetDurationSec: 1827 });
  expect(wordsIn(back())).toContain('목표 시간 30:27보다 19초 빨리 마쳤어요.');
});

test('뒷면 막대: a split faster than the target rises above the target line, a slower one hangs below it', () => {
  const { TargetSplitChart } = require('../TargetSplitChart');
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <TargetSplitChart
        splits={[split(0, 330, null), split(1, 390, null)]}
        target={360}
      />,
    );
  });
  const plot = tree.root.findAll(
    node => typeof node.props.onLayout === 'function',
  )[0];
  act(() => {
    plot.props.onLayout({
      nativeEvent: { layout: { width: 200, height: 120 } },
    });
  });
  const svg = tree.root.findByProps({ testID: 'target-split-chart' });
  const middle = 60;
  const bars = svg
    .findAll(node => node.props.rx === 2 && typeof node.props.y === 'number')
    .filter((node, index, all) => all.indexOf(node) === index);
  const [faster, slower] = bars.filter(
    (node, index) =>
      bars.findIndex(other => other.props.x === node.props.x) === index,
  );
  // Faster: the bar ends at the line, its top above it.
  expect(faster.props.y + faster.props.height).toBeCloseTo(middle);
  expect(faster.props.y).toBeLessThan(middle);
  // Slower: the bar starts at the line and runs down.
  expect(slower.props.y).toBeCloseTo(middle);
});
