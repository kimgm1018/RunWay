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

// A swipe across the newest week strip (5.1) or chart (5.3): dx > 0 goes back.
async function swipe(screen: Screen, dx: number) {
  const areas = screen.root.findAll(
    node => typeof node.props.onTouchEnd === 'function',
  );
  const area = areas[areas.length - 1];
  await act(async () => {
    area.props.onTouchStart({ nativeEvent: { pageX: 200 } });
    area.props.onTouchEnd({ nativeEvent: { pageX: 200 + dx } });
  });
  await settle();
  await settle();
}

async function render(repositories = createMockRepositories({ latencyMs: 0 })) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  await settle();
  return screen!;
}

test('5.1 opens on the newest run in its week and moves by day, week and month', async () => {
  const screen = await render();
  await press(screen, '과거 러닝 기록');
  let page = texts(screen);
  for (const text of [
    '내 기록',
    '페이스',
    '평균 페이스',
    '5′55″',
    '5.02',
    '29:41',
    '목표 30:00 달성 · 19초 단축',
  ]) {
    expect(page).toContain(text);
  }
  expect(stateOf(screen, '10월 15일')?.selected).toBe(true);
  expect(hasLabel(screen, '5′41″ 최고')).toBe(true);

  await press(screen, '10월 14일');
  expect(texts(screen)).toContain('이 날은 러닝 기록이 없어요');
  await press(screen, '10월 13일');
  expect(texts(screen)).toContain('29:48');

  // A swipe goes back a week: 10.05 – 10.11 with the group run on Sunday.
  await swipe(screen, 120);
  expect(hasLabel(screen, '10월 5일')).toBe(true);
  await press(screen, '10월 8일');
  expect(texts(screen)).toContain('목표 31:12 미달성 · 1분 50초 늦음');
  // The run did not measure cadence, so its tab is not there.
  expect(hasLabel(screen, '케이던스')).toBe(false);

  // The calendar opens the month picker; a month opens its newest run.
  await press(screen, '월 선택');
  expect(texts(screen)).toContain('기록이 있는 달');
  expect(stateOf(screen, '2026년 11월')?.disabled).toBe(true);
  await press(screen, '2026년 9월');
  expect(hasLabel(screen, '10월 15일')).toBe(false);
  await act(async () => screen.unmount());
});

test('5.2 opens from 5.1 with the figures, split graphs and the two buttons', async () => {
  const screen = await render();
  await press(screen, '과거 러닝 기록');
  await press(screen, '민락수변공원 출발, 10.15 목 · 29:41, 5.02km');
  const page = texts(screen);
  for (const text of [
    '기록 상세',
    '5′55″',
    '5.02',
    '29:41',
    '목표 30:00 달성 · 19초 단축',
    '페이스',
    '심박',
    '케이던스',
    '내 코스에 저장',
    '기록 공유',
  ]) {
    expect(page).toContain(text);
  }
  // The handoff drops the map, AI advice and 닫기 (담당자 결정).
  expect(page).not.toContain('AI 조언');
  expect(hasLabel(screen, '닫기')).toBe(false);
  expect(hasLabel(screen, '5′41″ 최고')).toBe(true);
  await press(screen, '심박');
  expect(hasLabel(screen, '171 최고')).toBe(true);
  await press(screen, '케이던스');
  expect(hasLabel(screen, '178 최고')).toBe(true);
  await act(async () => screen.unmount());
});

test('5.2 saves a run as my course, and a run without location cannot', async () => {
  const screen = await render();
  await press(screen, '과거 러닝 기록');
  await swipe(screen, 120);
  await press(screen, '10월 8일');
  await press(screen, '남천 해변 언덕길, 10.08 목 · 33:02, 5.20km');
  await press(screen, '내 코스에 저장');
  const page = texts(screen);
  expect(page).toContain('내 코스에 저장했어요');
  expect(page).toContain('내 코스에 저장됨');
  await act(async () => screen.unmount());

  const other = await render();
  await press(other, '과거 러닝 기록');
  await swipe(other, 120);
  await swipe(other, 120);
  await press(other, '10월 1일');
  await press(other, '이기대 갈맷길, 10.01 목 · 25:05, 4.66km');
  expect(stateOf(other, '내 코스에 저장')?.disabled).toBe(true);
  await act(async () => other.unmount());
});

test('5.2 deletes my run after the S09 notice, with the post that shares it', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const screen = await render(repositories);
  await press(screen, '과거 러닝 기록');
  const row = '민락수변공원 출발, 10.15 목 · 29:41, 5.02km';
  await press(screen, row);
  await press(screen, '기록 메뉴');
  await press(screen, '기록 삭제');
  let page = texts(screen);
  expect(page).toContain('이 운동 기록을 삭제할까요?');
  expect(page).toContain('이 기록을 공유한 게시물도 함께 삭제됩니다.');

  await press(screen, '삭제');
  page = texts(screen);
  expect(page).toContain('기록을 삭제했어요');
  // Back on 5.1, which read the week again without the run.
  expect(hasLabel(screen, row)).toBe(false);
  expect(page).toContain('이 날은 러닝 기록이 없어요');
  await expect(
    repositories.records.getDetail('run-1015'),
  ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  // The mock throws right away for a post that is gone.
  await expect(
    Promise.resolve().then(() =>
      repositories.community.get('post-minjun-1015'),
    ),
  ).rejects.toThrow('게시물 없음');
  await act(async () => screen.unmount());
});

test('5.2 stays with a toast when S09 fails', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.records.remove = jest.fn().mockRejectedValue(
    Object.assign(new Error('분석 중'), {
      code: 'INVALID_STATE',
      status: 409,
    }),
  );
  const screen = await render(repositories);
  await press(screen, '과거 러닝 기록');
  await press(screen, '민락수변공원 출발, 10.15 목 · 29:41, 5.02km');
  await press(screen, '기록 메뉴');
  await press(screen, '기록 삭제');
  await press(screen, '삭제');
  const page = texts(screen);
  expect(page).toContain(
    '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  expect(page).toContain('기록 상세');
  await act(async () => screen.unmount());
});

test('5.3 shows the month chart and summary, picks a day, and switches periods', async () => {
  const screen = await render();
  await press(screen, '러닝 분석');
  let page = texts(screen);
  for (const text of [
    '러닝 분석',
    '10월 ▾',
    '누적 거리',
    '일별 거리',
    '10.15 · 34.2km',
    '9월 26.8km',
    '4.9',
    '요약',
    '10.1 – 10.15',
    '5′52″',
    '8초 빠름',
    '34.2',
    '+7.4km',
    '+2회',
    '10월 누적',
  ]) {
    expect(page).toContain(text);
  }

  // 총 시간 reads 3h 21m.
  expect(hasLabel(screen, '총 시간 3h 21m, 10월 누적')).toBe(true);

  // A bar picks its day; the summary counts up to it.
  await press(screen, '10.8 5.2km');
  page = texts(screen);
  expect(page).toContain('10.1 – 10.8');
  expect(page).toContain('10.8 · 18.8km');
  await press(screen, '선택 해제');
  expect(texts(screen)).not.toContain('10.1 – 10.8');

  await press(screen, '목록으로 보기');
  expect(texts(screen)).toContain('광안대교 루프 함께 달리기');
  await press(screen, '요약으로 보기');

  await press(screen, '주');
  page = texts(screen);
  expect(page).toContain('이 기간에는 기록이 없어요');
  expect(page).toContain('이번 주 누적');
  // Today (10.19) is in October's 4th week.
  expect(page).toContain('4주차 ▾');
  await swipe(screen, 120);
  page = texts(screen);
  expect(page).toContain('10.12 – 10.15');
  expect(page).toContain('3주차 ▾');
  // The week tab again opens the week picker.
  await press(screen, '주');
  expect(texts(screen)).toContain('기록이 있는 주');
  expect(stateOf(screen, '10월 5주차')?.disabled).toBe(true);
  await press(screen, '10월 2주차');
  page = texts(screen);
  expect(page).toContain('2주차 ▾');
  expect(page).toContain('10.05 – 10.11');
  // Weeks are calendar rows of 7 days: 9.28–10.4 is both October's 1주차 and September's 5주차.
  await press(screen, '주');
  expect(texts(screen)).toContain('9.28–10.4');
  await press(screen, '10월 1주차');
  expect(texts(screen)).toContain('1주차 ▾');
  await swipe(screen, 120);
  expect(texts(screen)).toContain('4주차 ▾');
  await press(screen, '주');
  expect(stateOf(screen, '9월 4주차')?.selected).toBe(true);
  expect(texts(screen)).toContain('8.31–9.6');
  await press(screen, '9월 5주차');
  expect(texts(screen)).toContain('5주차 ▾');

  await press(screen, '년');
  page = texts(screen);
  expect(page).toContain('월별 거리');
  expect(page).toContain('2026년 ▾');
  expect(page).toContain('2026년 누적');
  // The year tab again opens the year picker.
  await press(screen, '년');
  expect(texts(screen)).toContain('기록이 있는 해');
  await press(screen, '2025년');
  page = texts(screen);
  expect(page).toContain('2025년 ▾');
  expect(page).toContain('2025년 누적');

  await press(screen, '전체');
  page = texts(screen);
  expect(page).toContain('연도별 거리');
  expect(page).toContain('전체 누적');

  // The month tab again opens the month picker.
  await press(screen, '월');
  await press(screen, '월');
  expect(texts(screen)).toContain('기록이 있는 달');
  await press(screen, '2026년 9월');
  page = texts(screen);
  expect(page).toContain('9월 ▾');
  expect(page).toContain('9월 누적');
  await act(async () => screen.unmount());
});

test('5.1, 5.2 and 5.3 go back with the 뒤로 at their top left', async () => {
  const screen = await render();
  await press(screen, '과거 러닝 기록');
  await press(screen, '민락수변공원 출발, 10.15 목 · 29:41, 5.02km');
  expect(texts(screen)).toContain('기록 상세');
  await press(screen, '뒤로');
  expect(stateOf(screen, '10월 15일')?.selected).toBe(true);
  await press(screen, '뒤로');
  expect(texts(screen)).toContain('오늘 준비도');

  await press(screen, '러닝 분석');
  expect(texts(screen)).toContain('누적 거리');
  await press(screen, '뒤로');
  expect(hasLabel(screen, '월')).toBe(false);
  await act(async () => screen.unmount());
});
