import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories, type MockScenario } from '../src/data';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

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

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    labelled(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

async function adjust(screen: Screen, label: string, action: string) {
  await act(async () => {
    labelled(
      screen,
      label,
      'onAccessibilityAction',
    ).props.onAccessibilityAction({ nativeEvent: { actionName: action } });
  });
  await settle();
}

// Signs in and opens 3.1 오늘의 러닝 from 2.0M 코스 러닝.
async function openTodayRun(scenario: MockScenario = 'default') {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createMockRepositories({ latencyMs: 0, scenario })}
        initialSignedIn
      />,
    );
  });
  await settle();
  await press(screen!, '러닝');
  await press(screen!, '코스 러닝');
  return screen!;
}

test('today’s run works out pace and finish time from the distance', async () => {
  const screen = await openTodayRun();
  let page = texts(screen);
  for (const text of [
    '어디서, 얼마나 달릴까요?',
    '광안리해수욕장 · 현재 위치',
    '목표 완주 시간',
    '6′00″',
    '준비도 82',
  ]) {
    expect(page).toContain(text);
  }
  expect(labelled(screen, '공원').props.accessibilityState).toEqual({
    checked: true,
  });
  // 3.1p: the pace goes in, the finish time comes out.
  await press(screen, '페이스');
  page = texts(screen);
  expect(page).toContain('목표 페이스');
  expect(labelled(screen, '목표 페이스', 'onChangeText').props.value).toBe(
    '6:00',
  );
  expect(page).toContain('30:00');
  await adjust(screen, '목표 거리', 'increment');
  expect(texts(screen)).toContain('5.5');
  expect(texts(screen)).toContain('33:00');
  await type(screen, '목표 페이스', '5:30');
  expect(texts(screen)).toContain('30:15');
  await press(screen, '도심');
  expect(labelled(screen, '도심').props.accessibilityState).toEqual({
    checked: true,
  });
  await press(screen, '기준 위치 광안리해수욕장 · 현재 위치');
  await press(screen, '민락수변공원');
  expect(texts(screen)).toContain('민락수변공원');
  await act(async () => screen.unmount());
});

test('readiness is left out of the recommendation until there is a score', async () => {
  const screen = await openTodayRun('newUser');
  expect(texts(screen)).toContain('준비도 미반영');
  await act(async () => screen.unmount());
});

test('recommended courses turn over to their detail and lead to the course run', async () => {
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');
  let page = texts(screen);
  expect(page).toContain('1 / 4');
  expect(page).toContain('민락수변공원 출발 5.0km');
  expect(page).toContain('카드를 누르면 코스 정보를 볼 수 있어요');
  await press(screen, '민락수변공원 출발 5.0km, 코스 정보 보기');
  expect(() =>
    labelled(screen, '민락수변공원 출발 5.0km, 앞면 보기'),
  ).not.toThrow();
  page = texts(screen);
  for (const text of ['순환', '공원 · 하천변 · 평지', '추천 이유', '↑12']) {
    expect(page).toContain(text);
  }
  await press(screen, '내 코스에 저장');
  expect(() => labelled(screen, '저장 해제')).not.toThrow();
  // The first card (민락수변공원 출발) is the one turned over above.
  await act(async () => {
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '코스 선택' &&
          typeof node.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  await settle();
  expect(texts(screen)).toContain('민락수변공원 출발 5.0km 5.0km');
  expect(texts(screen)).toContain('오늘의 러닝 전략');
  await act(async () => screen.unmount());
});

test.each([
  ['noCourses', '조건에 맞는 코스를 찾지 못했어요.'],
  ['courseError', '코스를 추천받지 못했어요.'],
] as const)(
  'a %s answer keeps the user on 3.1 with the inputs',
  async (scenario, message) => {
    const screen = await openTodayRun(scenario);
    await press(screen, '코스 추천 받기');
    expect(texts(screen)).toContain(message);
    expect(texts(screen)).toContain('어디서, 얼마나 달릴까요?');
    expect(() => labelled(screen, '조건 변경')).toThrow();
    await act(async () => screen.unmount());
  },
);

test('saved courses show nicknames, undo an unsave and open the course run', async () => {
  const screen = await openTodayRun();
  await press(screen, '저장한 코스');
  let page = texts(screen);
  for (const text of [
    '광안대교 루프',
    '민락수변 왕복',
    '수영강 하천길',
    '이기대 갈맷길',
    'APEC 나루공원 루프',
  ]) {
    expect(page).toContain(text);
  }
  await press(screen, '이기대 갈맷길 저장 해제');
  page = texts(screen);
  expect(page).not.toContain('이기대 갈맷길');
  expect(page).toContain('저장을 해제했어요');
  await press(screen, '되돌리기');
  expect(texts(screen)).toContain('이기대 갈맷길');
  await press(screen, '민락수변 왕복, 5.4km 33분');
  expect(texts(screen)).toContain('민락수변 왕복 5.4km');
  await act(async () => screen.unmount());
});
