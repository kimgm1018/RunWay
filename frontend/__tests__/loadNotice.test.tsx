import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { LoadNotice } from '../src/screens/home/ReadinessFlow';

// 2.1 준비도 notice under the score (S15P31E105-660 사용자 결정): the same bands as the sentence above it (ratio of the
// last 7 days to the usual week, 0.8~1.2 = 평소와 비슷), the percent only outside them, and "운동량 항목에 반영됐어요"
// only when the score used the load item.

jest.setTimeout(30000);

async function notice(weekly: number, usual: number | null, loadScored = true) {
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <LoadNotice load={{ weekly, usual, days: null }} loadScored={loadScored} />,
    );
  });
  const text = screen!.root
    .findAllByType(Text)
    // Lines only: a Text nested in another Text (the strong word) is part of its line.
    .filter(node => {
      for (let up = node.parent; up; up = up.parent) {
        if (up.type === Text) {
          return false;
        }
      }
      return true;
    })
    .map(node =>
      [node.props.children]
        .flat(Infinity as 1)
        .map(child =>
          typeof child === 'string'
            ? child
            : child?.props
            ? [child.props.children].flat().join('')
            : '',
        )
        .join(''),
    );
  await act(async () => screen!.unmount());
  return text;
}

test.each([
  [94, 100, '최근 7일 운동량이 평소와 비슷해'],
  [80, 100, '최근 7일 운동량이 평소와 비슷해'],
  [120, 100, '최근 7일 운동량이 평소와 비슷해'],
  [79, 100, '최근 7일 운동량이 평소보다 21% 적어'],
  [121, 100, '최근 7일 운동량이 평소보다 21% 많아'],
  [150, 100, '최근 7일 운동량이 평소보다 50% 많아'],
  [288, 100, '최근 7일 운동량이 평소보다 188% 많아'],
])('weekly %s against usual %s reads "%s"', async (weekly, usual, line) => {
  expect(await notice(weekly, usual)).toEqual([
    line,
    '운동량 항목에 반영됐어요.',
  ]);
});

test('a small difference shows no percent at all', async () => {
  const [line] = await notice(94, 100);
  expect(line).not.toMatch(/%/);
});

test('without the load item in the score it does not say the load was counted', async () => {
  expect(await notice(94, 100, false)).toEqual([
    '최근 7일 운동량이 평소와 비슷해요.',
  ]);
  expect(await notice(150, 100, false)).toEqual([
    '최근 7일 운동량이 평소보다 50% 많아요.',
  ]);
});

test('without a usual week there is no notice', async () => {
  expect(await notice(50, null)).toEqual([]);
  expect(await notice(50, 0)).toEqual([]);
});
