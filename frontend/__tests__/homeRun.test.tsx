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

test('home greets me, shows today’s readiness and swaps the card from the menu (S15P31E105-564)', async () => {
  const screen = await render();
  const home = texts(screen);
  // 인사말 in one line; the old logo row, its avatar button and 러닝 시작 are gone.
  expect(home).toContain('반가워요 민준님 👋');
  expect(() => labelled(screen, '내 프로필')).toThrow();
  // The date line, then 준비도 first: the score, its grade, sleep, resting heart rate and the weekly load.
  expect(home).toContain('10월 19일 월요일');
  for (const text of [
    '82',
    '오늘 준비도 양호',
    '계획한 강도로 달려도 좋아요',
    '7h 12m',
    '58 bpm',
    '적정',
    '오늘은 5km를 6′00″ 페이스로 시작해도 좋아요.',
  ]) {
    expect(home).toContain(text);
  }
  for (const gone of ['러닝 시작', '저장한 코스', '지난 러닝']) {
    expect(home).not.toContain(gone);
  }
  // 과거 러닝 기록 shows the day on the date line: no run on 10.19, then 10.15's run.
  await press(screen, '과거 러닝 기록');
  await waitForText(screen, '이 날은 러닝 기록이 없어요');
  // The date line opens the calendar (2026년 10월), where a day picks it and closes it.
  await press(screen, '달력 열기');
  expect(texts(screen)).toContain('2026년 10월');
  await press(screen, '10월 15일 선택');
  expect(texts(screen)).toContain('10월 15일 목요일');
  await waitForText(screen, '민락수변공원 출발');
  // Its card turns over to the month's runs (담당자 결정), and a run there opens 기록 상세 on the same screen,
  // with the 페이스 · 심박 · 케이던스 tabs and the run's buttons.
  await press(screen, labelOf(screen, '민락수변공원 출발'));
  await settle(600);
  expect(texts(screen)).toContain('10월 기록');
  expect(texts(screen)).toContain('7번 · 34.2km');
  await press(screen, '민락수변공원 출발, 10.15 목');
  await waitForText(screen, '내 코스에 저장');
  for (const text of [
    '페이스',
    '심박',
    '케이던스',
    '평균 페이스',
    '29:41',
    '내 코스에 저장',
    '기록 공유',
    '기록 삭제',
  ]) {
    expect(texts(screen)).toContain(text);
  }
  expect(texts(screen)).not.toContain('내 기록');
  // 러닝 분석 keeps the day.
  await press(screen, '러닝 분석');
  await waitForText(screen, '러닝 분석 | 10월 15일');
  await press(screen, '준비도');
  expect(texts(screen)).toContain('오늘 준비도 양호');
  await act(async () => screen.unmount());
});

// The run card's label starts with the run's name.
function labelOf(screen: Screen, name: string) {
  return screen.root.find(
    node =>
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith(`${name}, `) &&
      typeof node.props.onPress === 'function',
  ).props.accessibilityLabel as string;
}

// 저장한 코스 left 2.1 for 2.0C, beside 코스 설정 (S15P31E105-564).
async function openSaved(screen: Screen) {
  await press(screen, '러닝');
  await press(screen, '코스 러닝');
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
  // Only the greeting and the 프로필 tab show the photo (S15P31E105-522·-564).
  expect(images.map(node => node.props.source.uri)).toEqual([
    'file:///profile.jpg',
    'file:///profile.jpg',
  ]);
  await act(async () => screen!.unmount());
});

// Each state without a usable score says why and turns 러닝 시작 into what fixes it (2.1 핸드오프 ConditionCard).
test.each([
  [
    'newUser',
    ['오늘 준비도', '데이터를 모으는 중이에요'],
    ['워치 동기화', '심박수'],
  ],
  [
    'staleHealth',
    ['오늘 준비도', '마지막 평가 10월 15일'],
    ['워치 동기화', '심박수'],
  ],
  [
    'healthDenied',
    ['오늘 준비도', '건강 데이터 권한이 없어요'],
    ['설정 열기', '계정 공개 범위'],
  ],
  [
    'watchDisconnected',
    ['오늘 준비도', '연결된 워치가 없어요'],
    ['워치 연결', '심박수'],
  ],
] as const)(
  'home readiness shows the %s state without a score',
  async (scenario, lines, action) => {
    const screen = await render(scenario);
    const home = texts(screen);
    for (const line of lines) {
      expect(home).toContain(line);
    }
    expect(home).toContain('– –');
    expect(home).not.toContain('7h 12m');
    expect(home).not.toContain('오늘 준비도 양호');
    const [button, destination] = action;
    expect(home).not.toContain(destination);
    await press(screen, button);
    expect(texts(screen)).toContain(destination);
    await act(async () => screen.unmount());
  },
);

test('notifications split into 오늘 and 이번 주, count as read once left, and open the related screen', async () => {
  const screen = await render();
  await press(screen, '알림');
  let list = texts(screen);
  for (const text of [
    '오늘',
    '이번 주',
    '그룹런 곧 시작',
    '3분 전',
    '12분 전',
    '1시간 전',
  ]) {
    expect(list).toContain(text);
  }
  // The 2.9 핸드오프 has no 모두 읽음; the unread dots stay while the list is open.
  expect(() => labelled(screen, '모두 읽음')).toThrow();
  expect(() =>
    labelled(
      screen,
      '읽지 않음, 크루 가입 승인, ‘민락 야경 러너스’ 가입이 승인됐어요',
    ),
  ).not.toThrow();
  await press(screen, '이번 주');
  list = texts(screen);
  expect(list).toContain('2일 전');
  expect(list).toContain('3일 전');
  expect(list).not.toContain('3분 전');

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

test('run mode leads to course recommendations and a free run with a countdown', async () => {
  const screen = await render();
  await press(screen, '러닝');
  expect(texts(screen)).toContain('달릴까요?');
  await press(screen, '코스 러닝');
  // 2.0C first: the map with 코스 설정 in place of 목표 설정, and 러닝 시작 waits for a course (담당자 요청).
  expect(texts(screen)).toContain('코스 설정');
  expect(texts(screen)).not.toContain('목표 설정');
  expect(labelled(screen, '러닝 시작').props.disabled).toBe(true);
  // 저장한 코스 sits beside 코스 설정 and opens the saved list.
  await press(screen, '저장한 코스');
  expect(texts(screen)).toContain('광안대교 루프');
  await press(screen, '뒤로');
  // The round button left of 러닝 시작 turns it into a free run, and back again.
  await press(screen, '자유 러닝으로 바꾸기');
  expect(texts(screen)).toContain('목표 설정');
  await press(screen, '코스 러닝으로 바꾸기');
  expect(texts(screen)).toContain('코스 설정');
  await press(screen, '코스 설정');
  expect(texts(screen)).toContain('환경 · 여러 개 선택');
  await act(async () => screen.unmount());

  const free = await render();
  await press(free, '러닝');
  await press(free, '자유 러닝');
  expect(texts(free)).toContain('민락수변공원 입구');
  expect(texts(free)).toContain('GPS 양호');
  // 운동 목표 (S15P31E105-517): the chip opens the goal cards; 페이서 works the pace out of a distance and a time.
  expect(texts(free)).toContain('목표 설정');
  await press(free, '목표 설정');
  for (const text of ['운동 목표', '목표 없음', '거리', '시간', '페이서']) {
    expect(texts(free)).toContain(text);
  }
  expect(texts(free)).not.toContain('칼로리');
  await press(free, '페이서 목표');
  expect(texts(free)).toContain('거리와 시간으로 계산한 페이스');
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
  await press(free, '목표만 설정');
  expect(texts(free)).toContain('5.5km · 30분 · 5′27″/km');
  await press(free, '러닝 시작');
  expect(texts(free)).toContain('3');
  // Countdown, watch execution and server confirmation must all finish.
  await waitForText(free, '현재 페이스');
  expect(texts(free)).toContain('현재 페이스');
  await act(async () => free.unmount());
});

test('course run shows the pace plan by day and the night layout after sunset', async () => {
  const day = await render();
  await openSaved(day);
  await press(day, '광안대교 루프, 5.0km 30분');
  await waitForText(day, '오늘의 러닝 전략');
  const plan = texts(day);
  for (const text of [
    '오늘의 러닝 전략',
    '광안대교 루프 5.0km',
    '빠름',
    '초반 안정 → 오르막 절제 → 후반 가속',
    '2km 오르막 주의',
  ]) {
    expect(plan).toContain(text);
  }
  expect(plan).toContain('6′00″');
  await act(async () => day.unmount());

  const night = await render('night');
  await openSaved(night);
  await press(night, '광안대교 루프, 5.0km 30분');
  await waitForText(night, '광안대교 루프 · 5.0km');
  const dark = texts(night);
  expect(dark).toContain('코스 러닝');
  expect(dark).toContain('광안대교 루프 · 5.0km');
  expect(dark).toContain('GPS 양호');
  expect(dark).not.toContain('오늘의 러닝 전략');
  await act(async () => night.unmount());
});

async function openMusic(scenario: MockScenario) {
  const screen = await render(scenario);
  await press(screen, '러닝');
  await press(screen, '자유 러닝');
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
