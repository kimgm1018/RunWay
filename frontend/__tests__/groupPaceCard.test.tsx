import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { GroupPaceInfo } from '../src/data';
import {
  aiSubLine,
  cardGoal,
  goalSubLine,
  GroupPaceCard,
} from '../src/screens/group/GroupPaceCard';

// S15P31E105-741: the 공동 페이스 card leads both rows with a pace, puts the time in each row's small line, and
// says 'AI 추천' only where it is a row's label or the host's button.

const pace: GroupPaceInfo = {
  mode: 'TOGETHER',
  appliedSecPerKm: 486,
  aiSecPerKm: 486,
  goalSecPerKm: 404,
  basis: 'MEMBER',
  basisNickname: '민수',
  calculating: false,
  slowerThanGoalCount: 0,
  kmPaces: [],
  kmDistanceM: 0,
};

function card(info: GroupPaceInfo, canChangeMode = false) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <GroupPaceCard
        pace={info}
        goal={{ distanceM: 4000, durationSec: 1620, showDistance: false }}
        change={null}
        canChangeMode={canChangeMode}
        busy={false}
        onChangeMode={() => undefined}
      />,
    );
  });
  return renderer;
}

// NumText keeps a line with numbers in its text prop; plain lines are Text children.
function shown(renderer: TestRenderer.ReactTestRenderer) {
  const numbered = renderer.root
    .findAll(node => typeof node.props.text === 'string')
    .map(node => node.props.text as string);
  const plain = renderer.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string');
  return [...numbered, ...plain];
}

test('the AI line tells about how long the distance takes at its pace', () => {
  const goal = { distanceM: 4000, durationSec: 1620, showDistance: false };
  // 4km at 8′06″ is 32분 24초, about 32분.
  expect(aiSubLine(goal, 486)).toBe('모두가 뛸 수 있는 페이스 · 약 32분');
  expect(aiSubLine({ ...goal, distanceM: null }, 486)).toBe(
    '모두가 뛸 수 있는 페이스',
  );
});

test('the goal line says the time it was set by, or the time its pace makes, or nothing', () => {
  expect(
    goalSubLine({ distanceM: 4000, durationSec: 1620, showDistance: false }, 404),
  ).toBe('27분 완주');
  expect(
    goalSubLine({ distanceM: 5000, durationSec: null, showDistance: false }, 360),
  ).toBe('예상 30분');
  expect(
    goalSubLine({ distanceM: 5000, durationSec: 1800, showDistance: true }, 360),
  ).toBe('5km · 30분 완주');
  expect(
    goalSubLine({ distanceM: null, durationSec: null, showDistance: false }, 360),
  ).toBeNull();
  // A course run's distance is the course's, named above the card.
  expect(
    cardGoal({
      courseName: '다대포 코스',
      targetDistanceM: 4000,
      targetDurationSec: 1620,
    }).showDistance,
  ).toBe(false);
});

test('the applied pace is not repeated under the title, and no chip repeats the mode', () => {
  const renderer = card(pace);
  const lines = shown(renderer);
  // Each pace once, in its row: the applied AI pace shows as often as the goal's (a NumText line is found at each of
  // its levels, so the counts are compared rather than fixed).
  const count = (text: string) => lines.filter(line => line === text).length;
  expect(count('8′06″')).toBeGreaterThan(0);
  expect(count('8′06″')).toBe(count('6′44″'));
  expect(lines).toContain('모두가 뛸 수 있는 페이스 · 약 32분');
  expect(lines).toContain('27분 완주');
  // 'AI 추천' is the row's label only (no buttons for a member).
  expect(lines.filter(line => line === 'AI 추천')).toHaveLength(1);
  // The host's buttons say it once more, as the choice.
  const host = shown(card(pace, true));
  expect(host.filter(line => line === 'AI 추천')).toHaveLength(2);
});

test('the title holds the pace only when no row does: 계산 중 or the median', () => {
  expect(shown(card({ ...pace, calculating: true }))).toContain('계산 중…');
  const median = shown(
    card({ ...pace, aiSecPerKm: null, basis: 'MEDIAN', appliedSecPerKm: 400 }),
  );
  expect(median).toContain('6′40″ · 중앙값');
  expect(median).toContain('기록 부족');
});
