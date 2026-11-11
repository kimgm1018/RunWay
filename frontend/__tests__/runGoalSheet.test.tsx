import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { RunGoalSheet } from '../src/screens/run/goal/RunGoalSheet';
import type { RunGoal } from '../src/screens/run/goal/runGoal';

// 운동 목표 시트(S15P31E105-517): cards per goal, quick start, rulers, and no goal the server would turn down.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const texts = (root: TestRenderer.ReactTestInstance) =>
  root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children as string)
    .join(' ');

const labelled = (root: TestRenderer.ReactTestInstance, label: string) =>
  root
    .findAll(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === 'function',
    )
    .pop()!;

function open(
  goal: RunGoal,
  mode: 'FREE' | 'COURSE' = 'FREE',
  plannedPace: number | null = 360,
) {
  const onSet = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <RunGoalSheet
        visible
        onClose={() => undefined}
        mode={mode}
        goal={goal}
        course={
          mode === 'COURSE' ? { distanceM: 5000, plannedPace } : undefined
        }
        onSet={onSet}
      />,
    );
  });
  return { root: renderer.root, onSet };
}

test('free goal uses one checklist and keeps the course choices', () => {
  const free = open({ kind: 'NONE' });
  expect(texts(free.root)).toContain('선택하지 않으면 목표 없이 달려요');
  // The sheet only sets the goal; 러닝 시작 stays on the map (S15P31E105-683).
  expect(labelled(free.root, '이 목표로 러닝 시작')).toBeUndefined();
  act(() => labelled(free.root, '목표 설정 완료').props.onPress());
  expect(free.onSet).toHaveBeenCalledWith({ kind: 'NONE' });
  act(() => labelled(free.root, '거리 목표 선택').props.onPress());
  expect(
    labelled(free.root, '거리 목표 선택').props.accessibilityState.checked,
  ).toBe(true);
  act(() => labelled(free.root, '목표 설정 완료').props.onPress());
  expect(free.onSet).toHaveBeenLastCalledWith({
    kind: 'DISTANCE',
    distanceM: 5000,
  });
  act(() => labelled(free.root, '시간 목표 선택').props.onPress());
  expect(texts(free.root)).toContain('페이스 · 계산');
  act(() => labelled(free.root, '목표 설정 완료').props.onPress());
  expect(free.onSet).toHaveBeenLastCalledWith({
    kind: 'PACER',
    distanceM: 5000,
    durationSec: 1800,
  });
  act(() => labelled(free.root, '거리 목표 선택').props.onPress());
  act(() => labelled(free.root, '목표 설정 완료').props.onPress());
  expect(free.onSet).toHaveBeenLastCalledWith({
    kind: 'TIME',
    durationSec: 1800,
  });

  const course = open({ kind: 'PLAN' }, 'COURSE');
  const shown = texts(course.root);
  for (const text of ['추천 전략', '시간', '페이스', '6′00″/km']) {
    expect(shown).toContain(text);
  }
  expect(shown).not.toContain('페이서');
  // 30 minutes on the 5km course works out to 6′00″/km.
  expect(shown).toContain('페이스 6′00″/km');
});

test('a pacer whose pace no runner keeps says so and cannot be set or started', () => {
  const { root, onSet } = open({
    kind: 'PACER',
    distanceM: 12000,
    durationSec: 1800,
  });
  expect(texts(root)).toContain('2′30″/km');
  expect(texts(root)).toContain(
    '페이스가 3′00″~15′00″/km 사이가 되도록 거리나 시간을 바꿔 주세요',
  );
  expect(labelled(root, '목표 설정 완료').props.disabled).toBe(true);
  expect(onSet).not.toHaveBeenCalled();
});

test('the course goal sheet only sets a goal: no start buttons, 추천 전략 only with a plan, and a way back to none', () => {
  const planned = open({ kind: 'PLAN' }, 'COURSE');
  expect(labelled(planned.root, '추천 전략 목표로 바로 시작')).toBeUndefined();
  expect(texts(planned.root)).toContain('선택하지 않으면 목표 없이 달려요');
  // 추천 전략 again takes it off; 목표 없이 달리기 does the same.
  act(() => labelled(planned.root, '추천 전략 목표').props.onPress());
  expect(planned.onSet).toHaveBeenLastCalledWith({ kind: 'NONE' });
  act(() => labelled(planned.root, '목표 없이 달리기').props.onPress());
  expect(planned.onSet).toHaveBeenLastCalledWith({ kind: 'NONE' });

  // A server course without a pace plan offers only the finish time card, and nothing chosen means no goal.
  const plain = open({ kind: 'NONE' }, 'COURSE', null);
  // That one card opens at once: its rulers, with no list to go back to.
  expect(labelled(plain.root, '추천 전략 목표')).toBeUndefined();
  expect(labelled(plain.root, '목표 목록으로')).toBeUndefined();
  expect(texts(plain.root)).toContain('목표 완주 시간');
  expect(labelled(plain.root, '목표 없이 달리기')).toBeUndefined();
  // With a goal set, 목표 없이 달리기 takes it off.
  const timed = open({ kind: 'TIME', durationSec: 1800 }, 'COURSE', null);
  act(() => labelled(timed.root, '목표 없이 달리기').props.onPress());
  expect(timed.onSet).toHaveBeenLastCalledWith({ kind: 'NONE' });
});

// One goal on a course (S15P31E105-683): moving the finish time moves the pace, and the other way round.
test('the course finish time and pace move each other', () => {
  const sheet = open({ kind: 'NONE' }, 'COURSE', null);
  const step = (label: string, actionName: string) =>
    act(() =>
      sheet.root
        .findAll(
          node =>
            node.props.accessibilityLabel === label &&
            typeof node.props.onAccessibilityAction === 'function',
        )
        .pop()!
        .props.onAccessibilityAction({ nativeEvent: { actionName } }),
    );
  // 5km in 30:00 is 6′00″/km.
  expect(texts(sheet.root)).toContain('30:00');
  expect(texts(sheet.root)).toContain('6′00″/km');
  step('목표 완주 시간', 'increment');
  expect(texts(sheet.root)).toContain('31:00');
  expect(texts(sheet.root)).toContain('6′12″/km');
  step('목표 페이스', 'decrement');
  // The pace ruler steps by 5 seconds: 6′12″ sits on 6′10″, one step down is 6′05″.
  expect(texts(sheet.root)).toContain('6′05″/km');
  expect(texts(sheet.root)).toContain('30:25');
  act(() => labelled(sheet.root, '목표 설정 완료').props.onPress());
  expect(sheet.onSet).toHaveBeenLastCalledWith({
    kind: 'PACE',
    paceSecPerKm: 365,
  });
});

// 자유 러닝 목표 (S15P31E105-683): any one or two of 거리 · 시간 · 페이스; the third is worked out and closed.
test('the free goal takes a pace alone or with a distance or a time, and works out the third', () => {
  const free = open({ kind: 'NONE' });
  const box = (label: string) => labelled(free.root, label);
  act(() => box('페이스 목표 선택').props.onPress());
  act(() => labelled(free.root, '목표 설정 완료').props.onPress());
  expect(free.onSet).toHaveBeenLastCalledWith({
    kind: 'PACE',
    paceSecPerKm: 360,
  });
  // 거리 + 페이스: 5km at 6′00″/km finishes in 30:00, and 시간 cannot be picked as a third.
  act(() => box('거리 목표 선택').props.onPress());
  expect(texts(free.root)).toContain('시간 · 계산');
  expect(texts(free.root)).toContain('30:00');
  expect(box('시간 목표 선택').props.accessibilityState.disabled).toBe(true);
  act(() => labelled(free.root, '목표 설정 완료').props.onPress());
  expect(free.onSet).toHaveBeenLastCalledWith({
    kind: 'DISTANCE_PACE',
    distanceM: 5000,
    paceSecPerKm: 360,
  });
  // 시간 + 페이스: 30분 at 6′00″/km covers 5km.
  act(() => box('거리 목표 선택').props.onPress());
  act(() => box('시간 목표 선택').props.onPress());
  expect(texts(free.root)).toContain('거리 · 계산');
  expect(texts(free.root)).toContain('5km');
  act(() => labelled(free.root, '목표 설정 완료').props.onPress());
  expect(free.onSet).toHaveBeenLastCalledWith({
    kind: 'TIME_PACE',
    durationSec: 1800,
    paceSecPerKm: 360,
  });
});
