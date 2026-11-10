import { currentPace } from '../paceRule';

// 현재 페이스 공통 규칙(S15P31E105-549 2안). 워치 PaceRuleTest와 같은 값으로 검증한다.

const at = (sec: number) => sec * 1000;

test('the pace is the time over the distance of the last 15 s', () => {
  // 3 m/s for 15 s → 1000 / 3 ≈ 333 s/km; the older sample outside the window is not used.
  const samples = [
    { at: at(0), metres: 0 },
    { at: at(10), metres: 50 },
    { at: at(15), metres: 65 },
    { at: at(25), metres: 95 },
  ];
  expect(currentPace(samples, null)).toBeCloseTo(1000 / 3, 5);
});

test('with too few samples in 15 s it uses the nearest earlier one within 60 s', () => {
  // Screen off: distance comes about once a minute. 120 m in 40 s → 3 m/s.
  const samples = [
    { at: at(0), metres: 100 },
    { at: at(40), metres: 220 },
  ];
  expect(currentPace(samples, null)).toBeCloseTo(1000 / 3, 5);
  // Older than 60 s: no pace from distance.
  expect(currentPace([{ at: at(0), metres: 0 }, { at: at(70), metres: 200 }], null)).toBeNull();
});

test('standing still shows no pace, by the latest speed or by the distance', () => {
  const moving = [
    { at: at(0), metres: 0 },
    { at: at(15), metres: 45 },
  ];
  expect(currentPace(moving, { at: at(16), mps: 0.2 })).toBeNull();
  expect(currentPace([{ at: at(0), metres: 0 }, { at: at(15), metres: 3 }], null)).toBeNull();
});

test('without enough distance it falls back to the latest speed', () => {
  expect(currentPace([{ at: at(0), metres: 0 }], { at: at(1), mps: 2.5 })).toBeCloseTo(400, 5);
  expect(currentPace([], null)).toBeNull();
});
