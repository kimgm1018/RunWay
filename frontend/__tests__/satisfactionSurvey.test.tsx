import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  type MockScenario,
  type Repositories,
} from '../src/data';
import { DataError } from '../src/data/errors';
import { surveyPrompt } from '../src/data/survey/surveyPrompt';
import type { SatisfactionSurveyAnswer } from '../src/data/types';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function labelled(screen: Screen, label: string, prop = 'onPress') {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

function shows(screen: Screen, label: string) {
  return (
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === 'function',
    ).length > 0
  );
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function settleUntil(
  screen: Screen,
  ready: () => boolean,
  what: string,
  maxPolls = 300,
) {
  for (let i = 0; i < maxPolls; i++) {
    if (ready()) return;
    await settle(50);
  }
  throw new Error(`${what} 화면이 열리지 않음: ${texts(screen)}`);
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
}

async function hold(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label, 'onLongPress').props.onLongPress();
  });
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    labelled(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

function recordSubmits(repositories: Repositories) {
  const sent: SatisfactionSurveyAnswer[] = [];
  repositories.surveys.submit = async answer => {
    sent.push(answer);
  };
  return sent;
}

const promptTitle = 'RunWay는 어떠셨나요?';
const promptOpen = (screen: Screen) => shows(screen, '만족도 조사 나중에 하기');

async function mount(repositories: Repositories) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  return screen!;
}

// A free run to its end (4.5): like runSession.test's startRun, then 일시정지 and a held 종료.
async function finishFreeRun(repositories: Repositories) {
  const screen = await mount(repositories);
  await settleUntil(screen, () => shows(screen, '러닝'), '홈 탭');
  await press(screen, '러닝');
  await settleUntil(
    screen,
    () =>
      screen.root
        .findAll(
          node =>
            node.props.accessibilityLabel === '러닝 시작' &&
            typeof node.props.onPress === 'function',
        )
        .some(node => node.props.accessibilityState?.disabled === false),
    '러닝 시작 버튼',
  );
  await press(screen, '러닝 시작');
  await settleUntil(screen, () => shows(screen, '일시정지'), '4.2 러닝 진행');
  await settle(200);
  await press(screen, '일시정지');
  await hold(screen, '종료');
  await settle();
  return screen;
}

const runRepositories = (scenario: MockScenario = 'default') =>
  createMockRepositories({ latencyMs: 0, tickMs: 50, scenario });

describe('4.5 만족도 조사 prompt (S15P31E105-813 AC-6)', () => {
  test('a saved run shows it; 나중에 하기 closes it and rests it for 3 days', async () => {
    const screen = await finishFreeRun(runRepositories());
    await settleUntil(screen, () => promptOpen(screen), '만족도 안내');
    expect(texts(screen)).toContain(promptTitle);

    const before = Date.now();
    await press(screen, '만족도 조사 나중에 하기');
    expect(promptOpen(screen)).toBe(false);
    await expect(surveyPrompt.isDue(new Date(before))).resolves.toBe(false);
    await expect(
      surveyPrompt.isDue(new Date(before + 3 * 24 * 60 * 60 * 1000 + 1000)),
    ).resolves.toBe(true);
    await act(async () => screen.unmount());
  });

  test('closing it rests it for 30 days', async () => {
    const screen = await finishFreeRun(runRepositories());
    await settleUntil(screen, () => promptOpen(screen), '만족도 안내');

    const before = Date.now();
    await press(screen, '닫기');
    expect(promptOpen(screen)).toBe(false);
    const day = 24 * 60 * 60 * 1000;
    await expect(
      surveyPrompt.isDue(new Date(before + 29 * day)),
    ).resolves.toBe(false);
    await expect(
      surveyPrompt.isDue(new Date(before + 30 * day + 1000)),
    ).resolves.toBe(true);
    await act(async () => screen.unmount());
  });

  test('it stays away while resting', async () => {
    await surveyPrompt.rest('done');
    const screen = await finishFreeRun(runRepositories());
    await settleUntil(screen, () => shows(screen, '기록 공유'), '4.5 결과');
    await settle(200);
    expect(promptOpen(screen)).toBe(false);
    expect(texts(screen)).not.toContain(promptTitle);
    await act(async () => screen.unmount());
  });

  test('a run whose record was not saved does not show it', async () => {
    const screen = await finishFreeRun(runRepositories('recordSaveFailed'));
    await settleUntil(
      screen,
      () => texts(screen).includes('기록을 저장하지 못했어요'),
      '저장 실패',
    );
    await settle(200);
    expect(promptOpen(screen)).toBe(false);
    await act(async () => screen.unmount());
  });

  test('참여하기 opens 8.1d and sends the answer as RUN_RESULT', async () => {
    const repositories = runRepositories();
    const sent = recordSubmits(repositories);
    const screen = await finishFreeRun(repositories);
    await settleUntil(screen, () => promptOpen(screen), '만족도 안내');

    await press(screen, '만족도 조사 참여하기');
    await settleUntil(screen, () => shows(screen, '5점 매우 만족'), '8.1d');
    await press(screen, '5점 매우 만족');
    await press(screen, '만족도 보내기');

    expect(sent).toEqual([{ score: 5, comment: '', source: 'RUN_RESULT' }]);
    // A sent answer rests the prompt for 30 days (리뷰 A-4).
    const day = 24 * 60 * 60 * 1000;
    await expect(
      surveyPrompt.isDue(new Date(Date.now() + 29 * day)),
    ).resolves.toBe(false);
    await act(async () => screen.unmount());
  });

  test('참여하기 then leaving 8.1d without sending rests it for 3 days only', async () => {
    const repositories = runRepositories();
    const sent = recordSubmits(repositories);
    const screen = await finishFreeRun(repositories);
    await settleUntil(screen, () => promptOpen(screen), '만족도 안내');

    const before = Date.now();
    await press(screen, '만족도 조사 참여하기');
    await settleUntil(screen, () => shows(screen, '5점 매우 만족'), '8.1d');
    await press(screen, '뒤로');

    expect(sent).toEqual([]);
    const day = 24 * 60 * 60 * 1000;
    await expect(surveyPrompt.isDue(new Date(before + 2 * day))).resolves.toBe(
      false,
    );
    await expect(
      surveyPrompt.isDue(new Date(before + 3 * day + 60 * 1000)),
    ).resolves.toBe(true);
    await act(async () => screen.unmount());
  });
});

describe('8.1d 만족도 조사 from 8.1 (S15P31E105-813 AC-7)', () => {
  async function openSurvey(repositories: Repositories) {
    const screen = await mount(repositories);
    await press(screen, '설정');
    await settle();
    await press(screen, '만족도 조사');
    await settleUntil(screen, () => shows(screen, '1점 매우 불만'), '8.1d');
    return screen;
  }

  test('a score and a comment are sent as SETTINGS, thanked, and rest the prompt', async () => {
    const repositories = createMockRepositories({ latencyMs: 0 });
    const sent = recordSubmits(repositories);
    const screen = await openSurvey(repositories);

    expect(labelled(screen, '만족도 보내기').props.disabled).toBe(true);
    await press(screen, '4점 만족');
    expect(
      labelled(screen, '4점 만족').props.accessibilityState.selected,
    ).toBe(true);
    await type(screen, '의견', '코스 추천이 좋아요');
    expect(texts(screen)).toContain('10 / 1000');
    expect(labelled(screen, '만족도 보내기').props.disabled).toBe(false);
    await press(screen, '만족도 보내기');

    expect(sent).toEqual([
      { score: 4, comment: '코스 추천이 좋아요', source: 'SETTINGS' },
    ]);
    expect(texts(screen)).toContain('소중한 의견 고마워요');
    // The result stays on the screen, not only in a toast (실기기: the toast sat under the keyboard).
    expect(texts(screen)).toContain('제출 완료');
    await expect(surveyPrompt.isDue()).resolves.toBe(false);
    await press(screen, '만족도 조사 닫기');
    await settleUntil(screen, () => shows(screen, '만족도 조사'), '8.1');
    await act(async () => screen.unmount());
  });

  test('a failed send keeps the answer and says so', async () => {
    const repositories = createMockRepositories({ latencyMs: 0 });
    repositories.surveys.submit = async () => {
      throw new DataError('SERVER_ERROR', '일시적 오류');
    };
    const screen = await openSurvey(repositories);

    await press(screen, '2점 불만');
    await type(screen, '의견', '느려요');
    await press(screen, '만족도 보내기');

    expect(texts(screen)).toContain('보내지 못했어요');
    expect(texts(screen)).toContain('보내지 못했어요. 잠시 후 다시 시도해 주세요.');
    expect(texts(screen)).not.toContain('제출 완료');
    expect(labelled(screen, '의견', 'onChangeText').props.value).toBe('느려요');
    expect(
      labelled(screen, '2점 불만').props.accessibilityState.selected,
    ).toBe(true);
    expect(labelled(screen, '만족도 보내기').props.disabled).toBe(false);
    await expect(surveyPrompt.isDue()).resolves.toBe(true);
    await act(async () => screen.unmount());
  });
});
