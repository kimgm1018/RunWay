import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';

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

function stateOf(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      node.props.accessibilityState !== undefined,
  );
  return matches[matches.length - 1]?.props.accessibilityState;
}

function hasLabel(screen: Screen, label: string) {
  return (
    screen.root.findAll(node => node.props.accessibilityLabel === label)
      .length > 0
  );
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
}

async function render() {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createMockRepositories({ latencyMs: 0 })}
        initialSignedIn
      />,
    );
  });
  await settle();
  await settle();
  return screen!;
}

test('5.1 shows the month by week, filters group runs and steps back a month', async () => {
  const screen = await render();
  await press(screen, '전체 기록 보기');
  let page = texts(screen);
  for (const text of [
    '내 기록',
    '2026년 10월',
    '7회 러닝',
    '34.2',
    '3:21',
    '5′52″',
    '지난주',
    '10.15 목 · 29:41',
    '10.11 일 · 광안리 새벽 크루 · 8명 완주',
    '그룹런',
    '10.05 – 10.11',
  ]) {
    expect(page).toContain(text);
  }
  // This month is the newest one.
  expect(stateOf(screen, '다음 기간')?.disabled).toBe(true);

  await press(screen, '그룹런');
  page = texts(screen);
  expect(page).toContain('광안대교 루프 함께 달리기');
  // 2.1 underneath also lists 남천 해변 언덕길, so look for the 5.1 row itself.
  expect(hasLabel(screen, '남천 해변 언덕길, 10.08 목 · 33:02, 5.20km')).toBe(
    false,
  );
  // The month summary still counts every run.
  expect(page).toContain('7회 러닝');

  await press(screen, '개인');
  expect(texts(screen)).not.toContain('광안대교 루프 함께 달리기');

  await press(screen, '이전 기간');
  page = texts(screen);
  expect(page).toContain('2026년 9월');
  expect(page).toContain('5회 러닝');
  expect(page).toContain('26.8');
  expect(page).toContain('6′00″');
  await act(async () => screen.unmount());
});

test('5.2 opens from 5.1 with the goal result, AI advice and split graphs', async () => {
  const screen = await render();
  await press(screen, '전체 기록 보기');
  await press(screen, '민락수변공원 출발, 10.15 목 · 29:41, 5.02km');
  const page = texts(screen);
  for (const text of [
    '10.15 목 러닝',
    '5.02',
    '29:41',
    '5′55″/km',
    '목표 30:00 달성 · 19초 단축',
    'AI 조언',
    '3km에서 빨라져 심박이 올랐어요. 다음엔 3km를 5초만 늦춰 보세요.',
    '페이스',
    '심박',
    '케이던스',
    '내 코스에 저장',
    '기록 공유',
    '닫기',
  ]) {
    expect(page).toContain(text);
  }
  expect(hasLabel(screen, '5′41″ 최고')).toBe(true);
  await press(screen, '심박');
  expect(hasLabel(screen, '171 최고')).toBe(true);
  await press(screen, '케이던스');
  expect(hasLabel(screen, '178 최고')).toBe(true);

  await press(screen, '닫기');
  expect(texts(screen)).toContain('7회 러닝');
  await act(async () => screen.unmount());
});

test('5.2 hides graphs a run did not measure and saves a free run as my course', async () => {
  const screen = await render();
  await press(screen, '전체 기록 보기');
  await press(screen, '남천 해변 언덕길, 10.08 목 · 33:02, 5.20km');
  let page = texts(screen);
  expect(page).toContain('목표 31:12 미달성 · 1분 50초 늦음');
  expect(page).not.toContain('케이던스');
  await press(screen, '내 코스에 저장');
  page = texts(screen);
  expect(page).toContain('내 코스에 저장했어요');
  expect(page).toContain('내 코스에 저장됨');
  await press(screen, '닫기');

  // Recorded without location: no route to save.
  await press(screen, '이기대 갈맷길, 10.01 목 · 25:05, 4.66km');
  expect(texts(screen)).toContain('위치 없이 기록한 러닝이라 경로가 없어요');
  expect(stateOf(screen, '내 코스에 저장')?.disabled).toBe(true);
  await act(async () => screen.unmount());
});

test('5.3 shows the month, switches to week and year, and links to 5.1', async () => {
  const screen = await render();
  await press(screen, '분석 자세히 보기');
  let page = texts(screen);
  for (const text of [
    '러닝 분석',
    '2026년 10월',
    '34.2',
    '5′52″',
    '3:21',
    '주별 거리',
    '6.2',
    '10.4',
    '12.6',
    '평균 페이스 추이',
    '최근 6개월',
    '6′31″에서 5′52″까지',
    '39초 빨라졌어요',
    '심박 구간',
    '2 유산소',
    '46%',
    '지난달과 비교',
    '9월',
    '5회',
    '7회',
    '+2회',
    '26.8km',
    '+7.4km',
    '6′00″',
    '8초 단축',
  ]) {
    expect(page).toContain(text);
  }

  await press(screen, '주');
  page = texts(screen);
  expect(page).toContain('10.19 – 10.25');
  expect(page).toContain('이 기간에는 기록이 없어요');
  await press(screen, '이전 기간');
  page = texts(screen);
  expect(page).toContain('10.12 – 10.18');
  expect(page).toContain('요일별 거리');
  expect(page).toContain('지난주와 비교');

  await press(screen, '년');
  page = texts(screen);
  expect(page).toContain('2026년');
  expect(page).toContain('월별 거리');
  expect(page).toContain('지난해와 비교');

  await press(screen, '월');
  await press(screen, '이번 달 기록 보기');
  expect(texts(screen)).toContain('7회 러닝');
  await act(async () => screen.unmount());
});
