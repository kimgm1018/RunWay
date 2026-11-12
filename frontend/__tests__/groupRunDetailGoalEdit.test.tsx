import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components';
import {
  createMockRepositories,
  DataProvider,
  type GroupPaceInfo,
  type GroupRunDetail,
  type Repositories,
} from '../src/data';
import { goalPatchBody } from '../src/data/api/groupRuns';
import {
  derivedOf,
  goalOfDraft,
  goalProblem,
  switchDraft,
} from '../src/screens/group/GroupGoalSheet';
import { GroupRunDetailScreen } from '../src/screens/group/GroupRunDetailScreen';
import { GroupRunDraftProvider } from '../src/screens/group/parts';
import { ThemeProvider } from '../src/theme';

// S15P31E105-702: the host changes the goal from the 공동 페이스 card on 6.4.

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: { groupRunId: 'gr-wednesday' } }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => effect(), [effect]);
  },
  useIsFocused: () => true,
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

const settledPace: GroupPaceInfo = {
  mode: 'TOGETHER',
  appliedSecPerKm: 380,
  aiSecPerKm: 380,
  goalSecPerKm: 360,
  basis: 'MEMBER',
  basisNickname: '민수',
  calculating: false,
  slowerThanGoalCount: 1,
};

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

function labelled(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

// NumText draws its digits apart, so a line with numbers is read from its text prop.
function lines(screen: Screen) {
  return screen.root
    .findAll(node => typeof node.props.text === 'string')
    .map(node => node.props.text as string);
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function renderDetail(
  patch: Partial<GroupRunDetail>,
  setup?: (repositories: Repositories) => void,
) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const originalGet = repositories.groupRuns.get.bind(repositories.groupRuns);
  let saved = false;
  jest.spyOn(repositories.groupRuns, 'get').mockImplementation(async id => ({
    ...(await originalGet(id)),
    status: 'SCHEDULED',
    ...patch,
    // After a save the server recalculates, so the card reads 계산 중.
    pace: saved ? { ...settledPace, calculating: true } : patch.pace,
  }));
  const update = jest.fn(async () => {
    saved = true;
  });
  repositories.groupRuns.updateGoal = update;
  setup?.(repositories);
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <SafeAreaProvider>
        <ThemeProvider>
          <DataProvider repositories={repositories}>
            <ToastProvider>
              <GroupRunDraftProvider>
                <GroupRunDetailScreen />
              </GroupRunDraftProvider>
            </ToastProvider>
          </DataProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  for (let i = 0; i < 40 && !texts(screen!).includes('공동 페이스'); i++) {
    await settle(25);
  }
  return { screen: screen!, update };
}

test('the host saves a new goal with G04 and the card turns to 계산 중', async () => {
  const { screen, update } = await renderDetail({
    isHost: true,
    courseId: null,
    targetDistanceM: 5000,
    targetDurationSec: 1800,
    pace: settledPace,
  });
  await act(async () => {
    labelled(screen, '목표 변경').props.onPress();
  });
  expect(texts(screen)).toContain('자동 계산 · 페이스');
  // Nothing changed yet, so 저장 waits (opening and saving would only round the goal).
  expect(labelled(screen, '목표 저장').props.accessibilityState.disabled).toBe(
    true,
  );
  await act(async () => {
    labelled(screen, '페이스').props.onPress();
  });
  expect(labelled(screen, '목표 저장').props.accessibilityState.disabled).toBe(
    false,
  );
  await act(async () => {
    labelled(screen, '목표 저장').props.onPress();
  });
  await settle();
  // 5km in 30분 is 6′00″/km; only the pace goes with the distance, never both.
  expect(update).toHaveBeenCalledWith(
    'gr-wednesday',
    { distanceM: 5000, input: 'PACE', paceSecPerKm: 360 },
    expect.any(String),
    false,
  );
  expect(texts(screen)).toContain('계산 중…');
  await act(async () => screen.unmount());
});

test('a member only reads the goal', async () => {
  const { screen } = await renderDetail({ isHost: false, pace: settledPace });
  expect(texts(screen)).toContain('목표');
  expect(() => labelled(screen, '목표 변경')).toThrow();
  expect(() => labelled(screen, '목표 저장')).toThrow();
  await act(async () => screen.unmount());
});

// After the start the card (and with it the 목표 변경 row) is gone; the course row keeps the goal.
test('after the start there is no goal editing', async () => {
  const { screen } = await renderDetail({
    isHost: true,
    status: 'RUNNING',
    pace: settledPace,
  });
  expect(() => labelled(screen, '목표 변경')).toThrow();
  await act(async () => screen.unmount());
});

test('a goal is the distance with one of 완주 시간 or 페이스, never both', () => {
  const time = goalOfDraft({ distanceKm: 10, input: 'TIME', value: 55 });
  expect(time).toEqual({ distanceM: 10000, input: 'TIME', durationSec: 3300 });
  const pace = goalOfDraft({ distanceKm: 10, input: 'PACE', value: 330 });
  expect(pace).toEqual({ distanceM: 10000, input: 'PACE', paceSecPerKm: 330 });
  // The third is only shown.
  expect(derivedOf({ distanceKm: 10, input: 'TIME', value: 55 })).toBe(
    '5′30″/km',
  );
  const timeBody = goalPatchBody(time, '2026-11-14T09:00:00+09:00', false);
  expect(timeBody).toMatchObject({
    goalInputType: 'TIME',
    targetDistanceM: 10000,
    targetDurationSec: 3300,
    title: '토요일, 함께 10km',
  });
  expect(timeBody).not.toHaveProperty('targetPaceSecPerKm');
  const paceBody = goalPatchBody(pace, '2026-11-14T09:00:00+09:00', false);
  expect(paceBody).toMatchObject({
    goalInputType: 'PACE',
    targetPaceSecPerKm: 330,
  });
  expect(paceBody).not.toHaveProperty('targetDurationSec');
});

test('with the card the course row names the run only and the card holds the whole goal', async () => {
  const { screen } = await renderDetail({
    isHost: true,
    courseId: null,
    courseName: null,
    targetDistanceM: null,
    targetDurationSec: 1800,
    pace: settledPace,
  });
  const all = texts(screen);
  expect(lines(screen)).toContain('자유 러닝');
  expect(lines(screen)).not.toContain('자유 러닝 · 30분 · 페이스 6′00″');
  // Both rows lead with a pace; the time goal is the 목표 row's small line (S15P31E105-741).
  expect(lines(screen)).toContain('6′00″');
  expect(lines(screen)).toContain('30분 완주');
  // Labels follow the rows; who the AI is based on never shows.
  expect(all).toContain('AI 추천');
  expect(all).toContain('모두가 뛸 수 있는 페이스');
  expect(all).toContain('모두가 끝까지 함께 달릴 수 있는 페이스로 달려요');
  expect(all).not.toContain('민수');
  expect(all).not.toContain('함께 완주');
  expect(all).not.toContain('가장 느린');
  await act(async () => screen.unmount());
});

test('without the card the course row keeps the whole goal', async () => {
  const { screen } = await renderDetail({
    isHost: true,
    courseId: null,
    courseName: null,
    targetDurationSec: 1800,
    goalPaceSecPerKm: 360,
    pace: null,
  });
  expect(lines(screen)).toContain('자유 러닝 · 30분 · 페이스 6′00″');
  await act(async () => screen.unmount());
});

test('goal mode explains itself and a distance goal shows with its time', async () => {
  const { screen } = await renderDetail({
    isHost: true,
    courseId: null,
    courseName: null,
    targetDistanceM: 5000,
    targetDurationSec: 1800,
    pace: { ...settledPace, mode: 'GOAL', basis: 'GOAL' },
  });
  const all = texts(screen);
  expect(lines(screen)).toContain('5km · 30분 완주');
  expect(all).toContain('목표 페이스로 달리고, 심박이 위험할 때만 AI가 늦춰요');
  expect(all).toContain('참가자 1명은 목표보다 느릴 수 있어요');
  await act(async () => screen.unmount());
});

test('a course run sends no distance or title, so the server keeps the course distance', () => {
  const body = goalPatchBody(
    { distanceM: 5000, input: 'TIME', durationSec: 1800 },
    '2026-11-14T09:00:00+09:00',
    true,
  );
  expect(body).toEqual({ goalInputType: 'TIME', targetDurationSec: 1800 });
});

test('a goal whose worked-out half leaves the pickers range cannot be saved', () => {
  // 21.1km in 30분 would be 1′25″/km.
  expect(goalProblem({ distanceKm: 21.1, input: 'TIME', value: 30 })).toContain(
    '페이스',
  );
  // 21.1km at 9′00″/km is over three hours.
  expect(goalProblem({ distanceKm: 21.1, input: 'PACE', value: 540 })).toContain(
    '완주 시간',
  );
  expect(goalProblem({ distanceKm: 5, input: 'TIME', value: 30 })).toBeNull();
});

test('switching 완주 시간 and 페이스 keeps the run, rounded to the picker and kept in range', () => {
  expect(switchDraft({ distanceKm: 5, input: 'TIME', value: 28 }, 'PACE')).toEqual(
    { distanceKm: 5, input: 'PACE', value: 335 },
  );
  expect(switchDraft({ distanceKm: 10, input: 'PACE', value: 330 }, 'TIME')).toEqual(
    { distanceKm: 10, input: 'TIME', value: 55 },
  );
  expect(
    switchDraft({ distanceKm: 21, input: 'TIME', value: 20 }, 'PACE').value,
  ).toBe(180);
});
