import React from 'react';
import { AppState, Platform, StyleSheet, Text, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  type AppNotification,
  type MockScenario,
} from '../src/data';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

// A Text's whole line, nested Texts included (NumText draws the digits in their own Text, S15P31E105-594).
function lineOf(children: unknown): string {
  return [children]
    .flat(Infinity as 1)
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : child && typeof child === 'object' && 'props' in child
        ? lineOf((child as { props: { children?: unknown } }).props.children)
        : '',
    )
    .join('');
}

function texts(screen: Screen) {
  const nodes = screen.root.findAllByType(Text);
  return [
    ...nodes
      .flatMap(node => [node.props.children].flat())
      .filter(child => typeof child === 'string' || typeof child === 'number'),
    // Lines split into nested Texts, read whole too.
    ...nodes
      .filter(node =>
        [node.props.children]
          .flat()
          .some(child => child && typeof child === 'object'),
      )
      .map(node => lineOf(node.props.children)),
  ].join(' ');
}

function labelled(screen: Screen, label: string, prop = 'onPress') {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  // Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

// Flush each timer-driven render before checking the next screen (S15P31E105-372).
async function waitForText(screen: Screen, text: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (!texts(screen).includes(text)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${text}: ${texts(screen)}`);
    }
    await settle(50);
  }
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
}

async function render(scenario: MockScenario = 'default') {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createMockRepositories({ latencyMs: 0, scenario })}
        initialSignedIn
      />,
    );
  });
  // Home loads, then its records card loads.
  await settle();
  await settle();
  return screen!;
}

test('home greets me, shows today’s readiness and swaps the card from the menu (S15P31E105-564 · 574)', async () => {
  const screen = await render();
  const home = texts(screen);
  // 인사말 in one line; the old logo row, its avatar button and 러닝 시작 are gone.
  expect(home).toContain('반가워요 민준님 👋');
  expect(() => labelled(screen, '내 프로필')).toThrow();
  // 준비도 first, on today; like every menu it has the date line and its calendar (S15P31E105-594 담당자 요청: 과거
  // 날짜를 고르면 그날의 준비도), and the card names today as 오늘의 준비도 with the day.
  expect(home).toContain('10월 19일 월요일');
  expect(home).toContain('오늘의 준비도');
  // Today's score: its band and the band's one line, one sentence per line (S15P31E105-657).
  expect(home).toContain('준비도 최상');
  expect(home).toContain('몸 상태가 좋아요.');
  expect(home).toContain('계획한 강도로 달려도 좋아요.');
  expect(labelled(screen, '달력 열기')).toBeTruthy();
  expect(stateOf(screen, '10월 19일')?.selected).toBe(true);
  // The menu: three pills, each its name with an icon; 기록 상세 is no longer one of them.
  for (const menu of ['준비도', '월별 기록', '러닝 분석']) {
    expect(labelled(screen, menu).props.accessibilityRole).toBe('button');
  }
  // 준비도 · 러닝 분석 · 러닝 기록, left to right (S15P31E105-615, 담당자 요청).
  const order = screen.root
    .findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        ['준비도', '러닝 분석', '월별 기록'].includes(
          node.props.accessibilityLabel,
        ),
    )
    .map(node => node.props.accessibilityLabel)
    .filter((label, index, all) => all.indexOf(label) === index);
  expect(order).toEqual(['준비도', '러닝 분석', '월별 기록']);
  expect(stateOf(screen, '준비도')?.selected).toBe(true);
  expect(() => labelled(screen, '기록 상세')).toThrow();
  expect(() => labelled(screen, '과거 러닝 기록')).toThrow();
  // 준비도 (S15P31E105-594 담당자 시안): the load sentence and the score on its ring, the notice, 최근 러닝 with the
  // week's load by day against the usual week, 왜 82점인가요? with the item scores, and 러닝 시작하기 at the foot.
  for (const text of [
    // The score's grade on top, the load against the usual week under it (S15P31E105-594 담당자 요청).
    '준비도 최상',
    '최근 운동량이 평소보다 많아요.',
    '82',
    '100점 기준',
    '운동량 항목에 반영됐어요.',
    '최근 러닝',
    '50% 증가',
    '10.13 – 10.19 · 날짜별 운동 부하',
    '휴식',
    '180',
    '오늘',
    '최근 7일',
    '600',
    '평소',
    '400',
    '평소 = 최근 28일의 주간 평균',
    '왜 82점인가요?',
    '수면 · 최근 3일 반영',
    '93점',
    '안정 심박 · 평소 대비 +6.7%',
    '최근 운동량 · 평소의 1.5배',
    '72.5점',
    '세 항목의 평균',
    '평균 81.83점을 반올림했어요.',
    '러닝 시작하기',
  ]) {
    expect(home).toContain(text);
  }
  // The newest day is picked: its line says what the bar is; another bar picks its own day. 10/14 has no run and
  // no load, so it is a rest day; 10/15's run is in the records.
  expect(home).toContain('10월 19일 · 운동 기록 · 운동 부하 180');
  await press(screen, '15일 운동 부하');
  expect(texts(screen)).toContain('10월 15일 · 러닝 1회 · 운동 부하 160');
  await press(screen, '14일 운동 부하');
  expect(texts(screen)).toContain('10월 14일 · 휴식 기록 · 운동 부하 0');
  // 부하란? opens and closes what the word means.
  await press(screen, '부하란?');
  expect(texts(screen)).toContain('심박 구간');
  await press(screen, '부하란?');
  expect(texts(screen)).not.toContain('심박 구간');
  // 왜 82점인가요? folds away.
  await press(screen, '왜 82점인가요?');
  expect(texts(screen)).not.toContain('세 항목의 평균');
  await press(screen, '왜 82점인가요?');
  // 러닝 시작하기 is the card's last part and opens the run tab's map, 2.0F (S15P31E105-683).
  const card = texts(screen);
  expect(card.lastIndexOf('러닝 시작하기')).toBeGreaterThan(
    card.lastIndexOf('세 항목의 평균'),
  );
  await press(screen, '러닝 시작하기');
  expect(texts(screen)).toContain('목표 설정');
  expect(texts(screen)).not.toContain('오늘은 어떻게 달릴까요?');
  await press(screen, '뒤로');
  await press(screen, '홈');
  for (const gone of ['저장한 코스', '지난 러닝']) {
    expect(home).not.toContain(gone);
  }
  // 러닝 분석 shows the day's run card (S15P31E105-615): no run on 10.19, then 10.15's run.
  await press(screen, '러닝 분석');
  await waitForText(screen, '아직 이 날의 러닝 기록이 없어요');
  // No 오늘 button any more (S15P31E105-690 담당자 피드백): ‹ › step a day, and nothing lies after today.
  expect(() => labelled(screen, '오늘로 이동')).toThrow();
  expect(labelled(screen, '다음 날').props.accessibilityState).toEqual({
    disabled: true,
  });
  // The date line opens the calendar (2026년 10월), where a day picks it and closes it.
  await press(screen, '달력 열기');
  expect(texts(screen)).toContain('2026년 10월');
  await press(screen, '10월 15일 선택');
  expect(texts(screen)).toContain('10월 15일 목요일');
  await waitForText(screen, '민락수변공원 출발');
  // A past day can step forward again, one day at a time.
  expect(labelled(screen, '다음 날').props.accessibilityState).toEqual({
    disabled: false,
  });
  // The card is the run itself: no 기록 상세 to open, no 페이스 · 심박 · 케이던스 tabs (S15P31E105-594 담당자 결정).
  // S15P31E105-772 restores 기록 삭제 on this card.
  for (const text of ['평균 페이스', '29:41', '목표와 비교하기', '기록 삭제']) {
    expect(texts(screen)).toContain(text);
  }
  for (const gone of ['기록 상세 보기', '케이던스', '기록으로 돌아가기']) {
    expect(texts(screen)).not.toContain(gone);
  }
  // 월별 기록 shows that day's month.
  await press(screen, '월별 기록');
  expect(texts(screen)).toContain('10월 15일 목요일');
  await waitForText(screen, '10월 기록');
  // 러닝 분석 keeps the day, and 준비도 shows that day's score (S15P31E105-594 담당자 요청: 과거 날짜를 고르면 그날의
  // 준비도) without resetting it.
  await press(screen, '러닝 분석');
  await waitForText(screen, '민락수변공원 출발');
  await press(screen, '준비도');
  expect(texts(screen)).toContain('10월 15일 목요일 기준');
  expect(texts(screen)).not.toContain('오늘의 준비도');
  expect(texts(screen)).toContain('왜 76점인가요?');
  // A day without a score says so.
  await press(screen, '10월 14일');
  expect(texts(screen)).toContain('이 날의 준비도 기록이 없어요');
  // On the navy card in the card's white text, not the light screens' dark text that vanished on it (S15P31E105-660
  // 실기기 확인).
  const none = screen.root
    .findAllByType(Text)
    .find(node => node.props.children === '이 날의 준비도 기록이 없어요');
  expect(StyleSheet.flatten(none?.props.style)?.color).toBe('#FFFFFF');
  await press(screen, '10월 15일');
  await press(screen, '월별 기록');
  expect(texts(screen)).toContain('10월 15일 목요일');
  // › steps a day forward; the week strip brings today back, where › stops.
  await press(screen, '다음 날');
  expect(texts(screen)).toContain('10월 16일 금요일');
  await press(screen, '10월 19일');
  expect(texts(screen)).toContain('10월 19일 월요일');
  expect(labelled(screen, '다음 날').props.accessibilityState).toEqual({
    disabled: true,
  });
  await act(async () => screen.unmount());
});

function stateOf(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      node.props.accessibilityState !== undefined,
  );
  return matches[matches.length - 1]?.props.accessibilityState;
}

// 저장한 코스 is the second tab of 코스 설정, which sits beside the goal on the run map (S15P31E105-683).
async function openSaved(screen: Screen) {
  await press(screen, '러닝');
  await press(screen, '코스 설정');
  await press(screen, '저장한 코스');
}

test('the tab bar shows 홈·커뮤니티·러닝·그룹·프로필 in order with their names, and 프로필 without a photo is a line icon', async () => {
  const screen = await render();
  const tabs = screen.root.findAll(
    node =>
      node.props.accessibilityRole === 'tab' && typeof node.type !== 'string',
  );
  const names = [...new Set(tabs.map(node => node.props.accessibilityLabel))];
  expect(names).toEqual(['홈', '커뮤니티', '러닝', '그룹', '프로필']);
  // Each tab shows its name under its icon.
  const bar = screen.root.find(
    node =>
      node.props.accessibilityRole === 'tablist' &&
      typeof node.type === 'string',
  );
  expect(bar.findAllByType(Text).map(node => node.props.children)).toEqual([
    '홈',
    '커뮤니티',
    '러닝',
    '그룹',
    '프로필',
  ]);
  // The mock profile has no photo, so 프로필 draws its icon instead of an image.
  expect(
    bar.findAll(
      node =>
        node.props.source?.uri !== undefined && typeof node.type === 'string',
    ),
  ).toHaveLength(0);
  await press(screen, '커뮤니티');
  await press(screen, '프로필');
  await act(async () => screen.unmount());
});

test('the home has no background photo and keeps the profile photo as the avatar', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const getMe = repositories.profile.getMe;
  repositories.profile.getMe = async () => ({
    ...(await getMe()),
    profileImageUrl: 'file:///profile.jpg',
  });
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  const images = screen!.root.findAll(
    node =>
      node.props.source?.uri !== undefined && typeof node.type === 'string',
  );
  // Only the greeting and the 프로필 tab show the photo (S15P31E105-522·-564); the tab draws it twice, pale and
  // chosen, for the fade between them (S15P31E105-657).
  expect(images.map(node => node.props.source.uri)).toEqual([
    'file:///profile.jpg',
    'file:///profile.jpg',
    'file:///profile.jpg',
  ]);
  await act(async () => screen!.unmount());
});

// Each state without a usable score says why and turns 러닝 시작 into what fixes it (2.1 핸드오프 ConditionCard).
// Without a usable score the card has no sentence (S15P31E105-615): why in the report, the details with
// their dashes, the button that fixes it and 러닝 시작하기.
test.each([
  ['newUser', ['데이터를 모으는 중이에요'], null],
  ['staleHealth', ['마지막 평가 10월 15일'], null],
  [
    'healthDenied',
    ['건강 데이터 권한이 없어요'],
    ['설정 열기', '위치 기록'],
  ],
  ['watchDisconnected', ['연결된 워치가 없어요'], ['워치 연결', '활동량']],
] as const)(
  'home readiness shows the %s state without a score',
  async (scenario, lines, action) => {
    const screen = await render(scenario);
    let home = texts(screen);
    expect(home).toContain('러닝 시작하기');
    expect(home).not.toContain('계획한 강도로 달려도 좋아요');
    for (const line of lines) {
      expect(home).toContain(line);
    }
    home = texts(screen);
    expect(home).toContain('오늘의 준비도');
    // No score: dashes, never 0, and no breakdown of a score that is not there.
    expect(home).toContain('--');
    expect(home).not.toContain('7h 12m');
    expect(home).not.toContain('항목의 평균');
    expect(home).not.toContain('운동량 항목에 반영됐어요.');
    if (action) {
      const [button, destination] = action;
      expect(home).not.toContain(destination);
      await press(screen, button);
      expect(texts(screen)).toContain(destination);
    } else {
      // Data collection/age cannot ask an already-ready watch to synchronize again.
      expect(home).not.toContain('워치 동기화');
    }
    await act(async () => screen.unmount());
  },
);

test('notifications come in one list, count as read once left, and open the related screen', async () => {
  const screen = await render();
  await press(screen, '알림');
  const list = texts(screen);
  // One list, newest first, with no 오늘 · 이번 주 tabs and no 지우기 (담당자 레퍼런스: 알림 페이지 영상).
  for (const text of [
    '그룹런 곧 시작',
    '3분 전',
    '12분 전',
    '1시간 전',
    '2일 전',
    '3일 전',
  ]) {
    expect(list).toContain(text);
  }
  expect(() => labelled(screen, '이번 주')).toThrow();
  expect(() => labelled(screen, '지우기')).toThrow();
  // The 2.9 핸드오프 has no 모두 읽음; the unread dots stay while the list is open.
  expect(() => labelled(screen, '모두 읽음')).toThrow();
  expect(() =>
    labelled(
      screen,
      '읽지 않음, 크루 가입 승인, ‘민락 야경 러너스’ 가입이 승인됐어요',
    ),
  ).not.toThrow();

  // Leaving marks everything read.
  await press(screen, '뒤로');
  await press(screen, '알림');
  expect(() =>
    labelled(
      screen,
      '읽지 않음, 크루 가입 승인, ‘민락 야경 러너스’ 가입이 승인됐어요',
    ),
  ).toThrow();
  await press(
    screen,
    '그룹런 곧 시작, ‘토요일 아침, 함께 5km’ 그룹런이 곧 시작해요',
  );
  await settle();
  // 6.4 opens on the notification's run (its pace shows as a pill there), not the next one.
  expect(texts(screen)).toContain('페이스 6′00″');
  expect(
    screen.root
      .findAllByType(Text)
      .some(node => node.props.children === '토요일 아침, 함께 5km'),
  ).toBe(true);
  await act(async () => screen.unmount());
});

test('an empty inbox shows the 2.9b empty state', async () => {
  const screen = await render('noNotifications');
  await press(screen, '알림');
  expect(texts(screen)).toContain('아직 받은 알림이 없어요');
  expect(() => labelled(screen, '모두 읽음')).toThrow();
  await act(async () => screen.unmount());
});

test('FOLLOW_REQUEST opens the approve/reject sheet, not only the runner profile', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const request: AppNotification = {
    id: 'noti-follow-request',
    kind: 'FOLLOW_REQUEST',
    message: 'dohyun_r님의 팔로우 요청이 도착했습니다.',
    createdAt: '2026-10-19T12:40:00+09:00',
    read: false,
    // N01 targetId is the requester users.id (notifications.md), not the request id.
    targetId: 'user-dohyun',
  };
  repositories.notifications.list = async () => ({
    items: [request],
    unreadCount: 1,
    nextCursor: null,
  });
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  await settle();
  await press(screen!, '알림');
  await press(
    screen!,
    '읽지 않음, 팔로우 요청, dohyun_r님의 팔로우 요청이 도착했습니다.',
  );
  await settle(50);
  expect(texts(screen!)).toContain(
    '승인하면 맞팔로우 없이도 내 게시물을 볼 수 있어요.',
  );
  expect(texts(screen!)).toContain('dohyun_r');
  expect(() => labelled(screen!, 'dohyun_r 승인')).not.toThrow();
  await act(async () => screen!.unmount());
});

test('알림 더 보기 loads the next N01 page', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const first: AppNotification = {
    id: 'noti-page-1',
    kind: 'POST_COMMENT',
    message: '서연님이 내 게시물에 댓글을 남겼어요: 첫 페이지',
    createdAt: '2026-10-19T12:40:00+09:00',
    read: false,
    targetId: 'post-minjun-1015',
  };
  const second: AppNotification = {
    id: 'noti-page-2',
    kind: 'NEW_FOLLOWER',
    message: '지우님이 나를 팔로우했어요',
    createdAt: '2026-10-19T11:40:00+09:00',
    read: true,
    targetId: 'user-jiwoo',
  };
  repositories.notifications.list = async cursor =>
    cursor
      ? { items: [second], unreadCount: 1, nextCursor: null }
      : { items: [first], unreadCount: 1, nextCursor: 'page-2' };
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  await settle();
  await press(screen!, '알림');
  expect(texts(screen!)).toContain('첫 페이지');
  // Emphasis splits "지우님" into its own Text node, so assert the non-bold rest.
  expect(texts(screen!)).not.toContain('나를 팔로우했어요');
  // loadMore is async; await the button handler so the next page is merged before assert.
  await act(async () => {
    await labelled(screen!, '더 보기').props.onPress();
  });
  await settle();
  expect(texts(screen!)).toContain('나를 팔로우했어요');
  expect(texts(screen!)).toContain('지우님');
  expect(() => labelled(screen!, '더 보기')).toThrow();
  await act(async () => screen!.unmount());
});

test('the run map leads to course recommendations and saved courses, and starts a free run with a countdown', async () => {
  const screen = await render();
  await press(screen, '러닝');
  // One map (S15P31E105-683): 목표 설정 and 코스 설정 side by side. No course is a free run, so 러닝 시작 is ready.
  expect(texts(screen)).toContain('목표 설정');
  expect(texts(screen)).toContain('코스 설정');
  expect(labelled(screen, '러닝 시작').props.disabled).toBe(false);
  // 설정 sits left of 러닝 시작 where the 자유 ↔ 코스 switch was.
  expect(() => labelled(screen, '코스 러닝으로 바꾸기')).toThrow();
  expect(() => labelled(screen, '설정')).not.toThrow();
  await press(screen, '코스 설정');
  expect(texts(screen)).toContain('환경 · 여러 개 선택');
  // 저장한 코스 is 코스 설정's second tab.
  await press(screen, '저장한 코스');
  expect(texts(screen)).toContain('광안대교 루프');
  await act(async () => screen.unmount());

  const free = await render();
  await press(free, '러닝');
  expect(texts(free)).toContain('민락수변공원 입구');
  expect(texts(free)).toContain('GPS 양호');
  // 자유 러닝 목표는 한 화면에서 거리·시간을 체크해 조합한다.
  expect(texts(free)).toContain('목표 설정');
  await press(free, '목표 설정');
  for (const text of [
    '운동 목표',
    '선택하지 않으면 목표 없이 달려요',
    '거리',
    '시간',
  ]) {
    expect(texts(free)).toContain(text);
  }
  expect(texts(free)).not.toContain('칼로리');
  await press(free, '거리 목표 선택');
  await press(free, '시간 목표 선택');
  expect(texts(free)).toContain('페이스 · 계산');
  expect(texts(free)).toContain('6′00″/km');
  // A screen reader steps the distance ruler: 5km → 5.5km makes the pace faster.
  await act(async () => {
    labelled(
      free,
      '목표 거리',
      'onAccessibilityAction',
    ).props.onAccessibilityAction({
      nativeEvent: { actionName: 'increment' },
    });
  });
  expect(texts(free)).toContain('5.5km');
  expect(texts(free)).toContain('5′27″/km');
  // The sheet only sets the goal; 러닝 시작 stays on the map (S15P31E105-683).
  await press(free, '목표 설정 완료');
  expect(texts(free)).toContain('5.5km · 30분 · 5′27″/km');
  await press(free, '러닝 시작');
  expect(texts(free)).toContain('3');
  // Countdown, watch execution and server confirmation must all finish.
  await waitForText(free, '현재 페이스');
  expect(texts(free)).toContain('현재 페이스');
  await act(async () => free.unmount());
});

test.each([false, true])('a start confirmed while the phone is locked opens the latest run state only after foregrounding (paused=%s)', async paused => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  let state: AppStateStatus = 'active';
  const descriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => state });
  const listeners = new Set<(next: AppStateStatus) => void>();
  const focusListeners = new Set<(next: AppStateStatus) => void>();
  const blurListeners = new Set<(next: AppStateStatus) => void>();
  const original = AppState.addEventListener;
  AppState.addEventListener = (type, listener) => {
    if (type === 'focus' || type === 'blur') {
      const list = type === 'focus' ? focusListeners : blurListeners;
      list.add(listener);
      return { remove: () => { list.delete(listener); } };
    }
    if (type !== 'change') {
      return original.call(AppState, type, listener);
    }
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  };
  const repositories = createMockRepositories({ latencyMs: 0 });
  let screen!: Screen;
  const create = repositories.session.create;
  let createdId: string | null = null;
  repositories.session.create = async request => {
    const session = await create(request);
    createdId = session.sessionId;
    return session;
  };
  try {
    await act(async () => {
      screen = TestRenderer.create(<App repositories={repositories} initialSignedIn />);
    });
    await settle();
    await press(screen, '러닝');
    await press(screen, '러닝 시작');
    await act(async () => {
      state = 'background';
      blurListeners.forEach(listener => listener(state));
      listeners.forEach(listener => listener(state));
    });
    const deadline = Date.now() + 12_000;
    let running = false;
    while (!running && Date.now() < deadline) {
      await settle(50);
      running = !!createdId && (await repositories.session.get(createdId)).state === 'RUNNING';
    }
    expect(running).toBe(true);
    if (paused) {
      const view = await repositories.session.get(createdId!);
      (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
        type: 'COMMAND_REQUEST', sessionId: createdId, action: 'PAUSE', expectedVersion: view.stateVersion,
      });
      const pauseDeadline = Date.now() + 3000;
      while ((await repositories.session.get(createdId!)).state !== 'PAUSED' && Date.now() < pauseDeadline) {
        await settle(50);
      }
      expect((await repositories.session.get(createdId!)).state).toBe('PAUSED');
    }
    await settle();
    expect(texts(screen)).not.toContain('현재 페이스');
    await act(async () => {
      state = 'active';
      listeners.forEach(listener => listener(state));
    });
    await settle();
    expect(texts(screen)).not.toContain('현재 페이스');
    await act(async () => {
      focusListeners.forEach(listener => listener(state));
    });
    await waitForText(screen, '현재 페이스');
  } finally {
    if (screen) {
      await act(async () => screen.unmount());
    }
    AppState.addEventListener = original;
    Object.defineProperty(AppState, 'currentState', descriptor);
    os.restore();
  }
});

test('a picked course shows on the same map: its chip beside the goal and today’s strategy, by day and after sunset', async () => {
  for (const scenario of [undefined, 'night'] as const) {
    const screen = await render(scenario);
    await openSaved(screen);
    await press(screen, '광안대교 루프, 5.0km 30분');
    await waitForText(screen, '오늘의 전략');
    const plan = texts(screen);
    // The course chip on the right of the goal (S15P31E105-683); the plan's pace is the goal.
    for (const text of [
      '광안대교 루프 · 5.0km',
      '오늘의 전략',
      '초반 안정 → 오르막 절제 → 후반 가속',
      '2km 오르막 주의',
    ]) {
      expect(plan).toContain(text);
    }
    expect(plan).toContain('6′00″');
    // No pace colours on the one mint line.
    expect(plan).not.toContain('빠름');
    // ✕ drops the course: the same map, a free run again.
    await press(screen, '코스 해제');
    expect(texts(screen)).toContain('코스 설정');
    await act(async () => screen.unmount());
  }
});

async function openMusic(scenario: MockScenario) {
  const screen = await render(scenario);
  await press(screen, '러닝');
  await press(screen, '음악');
  return screen;
}

test('the music card plays Melon, and 2.8 switches to Spotify or clears the pick', async () => {
  const screen = await openMusic('default');
  const card = texts(screen);
  for (const text of ['바다 쪽으로 달리기', '1:24', '3:41', '멜론 열기']) {
    expect(card).toContain(text);
  }
  // The handoff's ⚙ took the place of the 재생 중 badge.
  expect(card).not.toContain('재생 중');
  // The 2.7 핸드오프 card has no lists and no shuffle or repeat.
  expect(card).not.toContain('좋아요한 곡');
  expect(() => labelled(screen, '셔플')).toThrow();
  // 멜론 cannot start a chosen playlist, so 내 재생 목록 stays out.
  expect(card).not.toContain('내 재생 목록');
  await press(screen, '일시정지');
  expect(() => labelled(screen, '재생')).not.toThrow();
  // 다음 곡 goes through the music repository and shows the song it reports.
  await press(screen, '다음 곡');
  expect(texts(screen)).not.toContain('바다 쪽으로 달리기');
  await press(screen, '이전 곡');
  expect(texts(screen)).toContain('바다 쪽으로 달리기');

  await press(screen, '음악 연결 설정');
  expect(labelled(screen, 'Spotify').props.accessibilityState).toMatchObject({
    disabled: true,
  });
  await press(screen, 'Spotify 로그인');
  await press(screen, 'Spotify');
  expect(labelled(screen, 'Spotify').props.accessibilityState).toMatchObject({
    checked: true,
  });
  expect(labelled(screen, '멜론').props.accessibilityState).toMatchObject({
    checked: false,
  });
  // Closing without ✓ keeps 멜론.
  await press(screen, '닫기');
  expect(texts(screen)).toContain('멜론 열기');

  await press(screen, '음악 연결 설정');
  await press(screen, 'Spotify');
  await press(screen, '설정 완료');
  const spotify = texts(screen);
  expect(spotify).toContain('Spotify Premium');
  expect(spotify).toContain('Spotify 열기');

  // The picked row pressed again clears the pick, back to 2.7a.
  await press(screen, '음악 연결 설정');
  await press(screen, 'Spotify');
  expect(labelled(screen, 'Spotify').props.accessibilityState).toMatchObject({
    checked: false,
  });
  await press(screen, '설정 완료');
  expect(texts(screen)).toContain('음악 서비스를 연결해 주세요');
  await act(async () => screen.unmount());
});

test('the Spotify card lists my playlists and songs heard lately, and a tap plays one', async () => {
  const screen = await openMusic('musicSpotify');
  // The lists come in after the card.
  await waitForText(screen, '내 재생 목록');
  const card = texts(screen);
  for (const text of [
    '내 재생 목록',
    '광안리 새벽',
    '인터벌 데이',
    'Spotify 열기',
  ]) {
    expect(card).toContain(text);
  }
  await press(screen, '인터벌 데이 재생 목록 재생');
  expect(texts(screen)).toContain('재생 목록');
  expect(() => labelled(screen, '일시정지')).not.toThrow();
  // 최근 들은 곡 is the other tab over the same row, and a song plays on its own.
  expect(texts(screen)).not.toContain('새벽 해변');
  await press(screen, '최근 들은 곡');
  expect(texts(screen)).not.toContain('광안리 새벽');
  await press(screen, '케이던스 180 재생');
  expect(texts(screen)).toContain('Run Crew');
  await act(async () => screen.unmount());
});

test('the music card shows the not-connected and disconnected states', async () => {
  const empty = await openMusic('musicNotConnected');
  expect(texts(empty)).toContain('음악 서비스를 연결해 주세요');
  await press(empty, '음원 선택');
  expect(texts(empty)).toContain('음악 없음');
  await act(async () => empty.unmount());

  const dropped = await openMusic('musicDisconnected');
  expect(texts(dropped)).toContain('연결이 끊겼어요');
  await press(dropped, '다시 연결');
  expect(texts(dropped)).not.toContain('연결이 끊겼어요');
  expect(texts(dropped)).toContain('바다 쪽으로 달리기');
  await act(async () => dropped.unmount());

  const setup = await openMusic('musicNeedsSetup');
  await press(setup, '음악 연결 설정');
  const sources = texts(setup);
  for (const text of ['허용', '설치']) {
    expect(sources).toContain(text);
  }
  await act(async () => setup.unmount());
});

test('2.1 준비도 does not call an older score today’s and shows a value not collected as a dash (S15P31E105-574)', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const getToday = repositories.home.getTodayCondition.bind(repositories.home);
  jest
    .spyOn(repositories.home, 'getTodayCondition')
    .mockImplementation(async () => ({
      ...(await getToday()),
      // Made the day before, without a sleep value but with a real 0 elsewhere untouched.
      date: '2026-10-18',
      sleepMinutes: null,
      // No item scores: the records themselves show, a missing one as a dash.
      scoreFactors: null,
    }));
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  await settle();
  let page = texts(screen!);
  // Today stays on the date line; the card names the score's own day.
  expect(page).toContain('10월 19일 월요일');
  expect(page).toContain('10월 18일 일요일 기준');
  // No sentence about today comes of another day's score; its values keep that day's date (S15P31E105-615).
  // No sentence of its own: the neutral line is gone (담당자 요청).
  expect(page).not.toContain('오늘의 달리기를 준비해 보세요');
  expect(page).not.toContain('계획한 강도로 달려도 좋아요');
  // The card names that day, not today (S15P31E105-594).
  expect(page).not.toContain('오늘의 준비도');
  expect(page).toContain('준비도');
  // Days that do not end on the score's day are not drawn under it.
  expect(page).not.toContain('날짜별 운동 부하');
  expect(page).toContain('10.12 – 10.18 · 최근 7일 운동 부하');
  page = texts(screen!);
  // The missing value is a dash; why it is missing is each metric's own line (S15P31E105-572).
  expect(page).toContain('– –');
  // No label under a value that is not there.
  expect(page).not.toContain('충분');
  expect(page).toContain('58회/분');
  await act(async () => screen!.unmount());
});
