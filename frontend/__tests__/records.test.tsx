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

// A swipe of the week strip back by one week: the pager stops on its first page, the week before (S15P31E105-564).
async function swipeWeek(screen: Screen) {
  const strip = screen.root.findAll(
    node =>
      node.props.pagingEnabled === true &&
      typeof node.props.onMomentumScrollEnd === 'function',
  )[0];
  await act(async () => {
    strip.props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
  });
  await settle();
  await settle();
}

async function waitForText(screen: Screen, text: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!texts(screen).includes(text)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${text}: ${texts(screen)}`);
    }
    await settle(30);
  }
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

// The date line's calendar picks a day (S15P31E105-564) on 러닝 분석, where the day's run card is (S15P31E105-615).
async function pickDay(screen: Screen, month: number, day: number) {
  if (stateOf(screen, '러닝 분석')?.selected !== true) {
    await press(screen, '러닝 분석');
  }
  await press(screen, '달력 열기');
  if (month !== 10) {
    await press(screen, `2026년 ${month}월`);
  }
  await press(screen, `${month}월 ${day}일 선택`);
  await settle();
}

// The day's run card opens its detail (S15P31E105-574): its label is the run's name, date, time and distance.
async function openCard(screen: Screen) {
  const cards = screen.root.findAll(
    node =>
      typeof node.props.accessibilityLabel === 'string' &&
      / · \d+:\d{2}, [\d.]+km$/.test(node.props.accessibilityLabel) &&
      typeof node.props.onPress === 'function',
  );
  await act(async () => {
    cards[cards.length - 1].props.onPress();
  });
  await settle();
  await settle();
}

// 2.1's 기록 상세 for a day, with the run's buttons under it (S15P31E105-564: 5.2 is part of 2.1).
async function openRecordDetail(screen: Screen, month: number, day: number) {
  await pickDay(screen, month, day);
  await waitForText(screen, '평균 페이스');
  await openCard(screen);
  await waitForText(screen, '기록 공유');
}

test('2.1 러닝 분석 shows the day on the date line, a week back by swipe and any day by the calendar', async () => {
  const screen = await render();
  // The day's run card moved to 러닝 분석 (S15P31E105-615, 담당자 요청).
  await press(screen, '러닝 분석');
  // Today (10.19) has no run.
  await waitForText(screen, '아직 이 날의 러닝 기록이 없어요');
  expect(stateOf(screen, '10월 19일')?.selected).toBe(true);
  expect(stateOf(screen, '10월 20일')?.disabled).toBe(true);

  // A swipe goes back a week and keeps the weekday: 월 19일 → 월 12일.
  await swipeWeek(screen);
  expect(texts(screen)).toContain('10월 12일 월요일');
  await press(screen, '10월 15일');
  // The time goal is on the card's back, said without 달성 · 미달성 (S15P31E105-615).
  await waitForText(screen, '목표 시간 30:00보다 19초 빨리 마쳤어요.');
  let page = texts(screen);
  for (const text of ['평균 페이스', '5′55″', '5.02', '29:41']) {
    expect(page).toContain(text);
  }
  // 러닝 분석 (S15P31E105-615): 평균 심박 with 평균 페이스, the two lines by km, and the turn to 목표와 비교.
  for (const text of ['평균 심박', '페이스와 심박 변화', '목표와 비교하기']) {
    expect(page).toContain(text);
  }
  expect(
    screen.root.findAll(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('페이스 ') &&
        node.props.accessibilityLabel.includes('심박'),
    ).length,
  ).toBeGreaterThan(0);
  await press(screen, '10월 14일');
  await waitForText(screen, '아직 이 날의 러닝 기록이 없어요');
  await press(screen, '10월 13일');
  await waitForText(screen, '29:48');

  // Another week back: 10.05 – 10.11.
  await swipeWeek(screen);
  await press(screen, '10월 8일');
  await waitForText(screen, '목표 시간 31:12보다 1분 50초 늦게 마쳤어요.');

  // The calendar: this month's chips, later days and months dimmed; another month and a day in it.
  await press(screen, '달력 열기');
  page = texts(screen);
  expect(page).toContain('2026년 10월');
  expect(stateOf(screen, '2026년 11월')?.disabled).toBe(true);
  expect(stateOf(screen, '10월 25일 선택')?.disabled).toBe(true);
  expect(stateOf(screen, '10월 8일 선택')?.selected).toBe(true);
  await press(screen, '2026년 9월');
  expect(texts(screen)).toContain('2026년 9월');
  await press(screen, '9월 24일 선택');
  expect(texts(screen)).toContain('9월 24일 목요일');
  expect(hasLabel(screen, '9월 24일 선택')).toBe(false);
  await act(async () => screen.unmount());
});

test('2.1 기록 상세 shows the run with its 페이스 · 심박 · 케이던스 tabs and its buttons', async () => {
  const screen = await render();
  await pickDay(screen, 10, 15);
  await waitForText(screen, '평균 페이스');
  await openCard(screen);
  await waitForText(screen, '구간 페이스');
  let page = texts(screen);
  for (const text of [
    '5′55″',
    '5.02',
    '29:41',
    '목표 30:00 달성 · 19초 단축',
    '페이스',
    '심박',
    '케이던스',
  ]) {
    expect(page).toContain(text);
  }
  expect(hasLabel(screen, '최고 5′41″')).toBe(true);
  // The split graph's title follows the tab (담당자 요청).
  await press(screen, '심박');
  expect(hasLabel(screen, '최고 171')).toBe(true);
  expect(texts(screen)).toContain('구간 심박');
  await press(screen, '케이던스');
  expect(hasLabel(screen, '최고 178')).toBe(true);
  expect(texts(screen)).toContain('구간 케이던스');

  // A day whose run did not measure cadence has no 케이던스 tab: back to 러닝 기록, another day, its run.
  await press(screen, '기록으로 돌아가기');
  await pickDay(screen, 10, 8);
  await waitForText(screen, '남천 해변 언덕길');
  await openCard(screen);
  await waitForText(screen, '기록 공유');
  expect(hasLabel(screen, '케이던스')).toBe(false);

  // The run's buttons sit under it; the handoff drops the map, AI advice and 닫기 (담당자 결정), and the ↗ to 5.2
  // is gone with 5.2 (S15P31E105-564).
  page = texts(screen);
  for (const text of ['내 코스에 저장', '기록 공유', '기록 삭제']) {
    expect(page).toContain(text);
  }
  expect(page).not.toContain('AI 조언');
  expect(hasLabel(screen, '닫기')).toBe(false);
  expect(hasLabel(screen, '기록 상세 화면 열기')).toBe(false);
  await act(async () => screen.unmount());
});

test('기록 상세 saves a run as my course, and a run without location cannot', async () => {
  const screen = await render();
  await openRecordDetail(screen, 10, 8);
  await press(screen, '내 코스에 저장');
  const page = texts(screen);
  expect(page).toContain('내 코스에 저장했어요');
  expect(page).toContain('내 코스에 저장됨');
  await act(async () => screen.unmount());

  const other = await render();
  await openRecordDetail(other, 10, 1);
  expect(stateOf(other, '내 코스에 저장')?.disabled).toBe(true);
  await act(async () => other.unmount());
});

test('기록 상세 deletes my run after the S09 notice, with the post that shares it', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const screen = await render(repositories);
  await openRecordDetail(screen, 10, 15);
  await press(screen, '기록 삭제');
  let page = texts(screen);
  expect(page).toContain('이 운동 기록을 삭제할까요?');
  expect(page).toContain('이 기록을 공유한 게시물도 함께 삭제됩니다.');

  await press(screen, '삭제');
  page = texts(screen);
  expect(page).toContain('기록을 삭제했어요');
  // 2.1 reads the day again without the run.
  await waitForText(screen, '아직 이 날의 러닝 기록이 없어요');
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

test('기록 상세 keeps the run with a toast when S09 fails', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.records.remove = jest.fn().mockRejectedValue(
    Object.assign(new Error('분석 중'), {
      code: 'INVALID_STATE',
      status: 409,
    }),
  );
  const screen = await render(repositories);
  await openRecordDetail(screen, 10, 15);
  await press(screen, '기록 삭제');
  await press(screen, '삭제');
  const page = texts(screen);
  expect(page).toContain(
    '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  expect(page).toContain('민락수변공원 출발');
  await act(async () => screen.unmount());
});

test('2.1 러닝 분석 is the day’s pace · heart rate card; the old day summary is gone (S15P31E105-615)', async () => {
  const screen = await render();
  await pickDay(screen, 10, 15);
  await waitForText(screen, '페이스와 심박 변화');
  const page = texts(screen);
  for (const text of ['민락수변공원 출발', '평균 심박', '목표와 비교하기']) {
    expect(page).toContain(text);
  }
  // 담당자 요청: 지금 러닝 분석 화면은 없앰 — no day summary tiles.
  for (const text of ['누적 거리', '총 시간', '러닝 1회']) {
    expect(page).not.toContain(text);
  }
  // A day without a run offers the month, which is 러닝 기록.
  await press(screen, '10월 14일');
  await waitForText(screen, '아직 이 날의 러닝 기록이 없어요');
  await press(screen, '이 달 기록 보기');
  await waitForText(screen, '10월 기록');
  expect(stateOf(screen, '러닝 기록')?.selected).toBe(true);
  await act(async () => screen.unmount());
});

test('2.1 러닝 기록 is the month’s runs, and a run there opens its detail and comes back', async () => {
  const screen = await render();
  await press(screen, '러닝 기록');
  // The month list at once (S15P31E105-615, 담당자 요청): no day card to turn over to.
  await waitForText(screen, '10월 기록');
  let page = texts(screen);
  for (const text of [
    '러닝 기록 | 10월',
    '10월 기록',
    '7번 · 34.2km',
    '10.15',
    '목요일',
    '5′55″',
  ]) {
    expect(page).toContain(text);
  }
  expect(hasLabel(screen, '하루 기록으로 보기')).toBe(false);
  expect(hasLabel(screen, '이 달 기록 전체 보기')).toBe(false);

  await press(screen, '남천 해변 언덕길, 10.08 목');
  await waitForText(screen, '10월 8일 목요일');
  await waitForText(screen, '내 코스에 저장');
  // The detail is a step of 러닝 기록, which stays chosen.
  expect(stateOf(screen, '러닝 기록')?.selected).toBe(true);
  page = texts(screen);
  expect(page).toContain('남천 해변 언덕길');
  // Back comes to the month list.
  await press(screen, '기록으로 돌아가기');
  page = texts(screen);
  expect(page).toContain('10월 기록');
  expect(page).toContain('7번 · 34.2km');
  expect(page).not.toContain('내 코스에 저장');
  await act(async () => screen.unmount());
});
