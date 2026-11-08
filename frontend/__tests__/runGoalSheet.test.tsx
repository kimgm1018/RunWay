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

function open(goal: RunGoal, mode: 'FREE' | 'COURSE' = 'FREE') {
  const onSet = jest.fn();
  const onStart = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <RunGoalSheet
        visible
        onClose={() => undefined}
        mode={mode}
        goal={goal}
        course={mode === 'COURSE' ? { distanceM: 5000, plannedPace: 360 } : undefined}
        onSet={onSet}
        onStart={onStart}
      />,
    );
  });
  return { root: renderer.root, onSet, onStart };
}

test('a card starts right away with its goal, and a course offers 추천 전략 · 시간 · 페이스', () => {
  const free = open({ kind: 'NONE' });
  act(() => labelled(free.root, '거리 목표로 바로 시작').props.onPress());
  expect(free.onStart).toHaveBeenCalledWith({ kind: 'DISTANCE', distanceM: 5000 });

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
  const { root, onSet, onStart } = open({
    kind: 'PACER',
    distanceM: 12000,
    durationSec: 1800,
  });
  act(() => labelled(root, '페이서 목표').props.onPress());
  expect(texts(root)).toContain('2′30″/km');
  expect(texts(root)).toContain('페이스가 3′00″~15′00″/km 사이가 되도록 거리나 시간을 바꿔 주세요');
  expect(labelled(root, '이 목표로 러닝 시작').props.disabled).toBe(true);
  expect(labelled(root, '목표만 설정').props.disabled).toBe(true);
  expect(onSet).not.toHaveBeenCalled();
  expect(onStart).not.toHaveBeenCalled();
});
