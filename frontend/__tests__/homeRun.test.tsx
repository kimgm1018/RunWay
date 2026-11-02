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

// The pressable record tiles on 홈, labelled "title, date · distance · time, pace".
function recordTiles(screen: Screen): string[] {
  return screen.root
    .findAll(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        /, [\d.]+ · .*km · /.test(node.props.accessibilityLabel) &&
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    )
    .map(node => node.props.accessibilityLabel)
    .filter((label, index, all) => all.indexOf(label) === index);
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

test('home shows the prototype values and re-sorts past runs', async () => {
  const screen = await render();
  const home = texts(screen);
  for (const text of [
    '오늘 달리기 좋은 날이에요',
    // 컨디션 and 준비도 each under their own name.
    '컨디션 보통',
    '준비도 양호',
    '82',
    '7h 12m',
    '58',
    '적정',
    '과부하 없음',
    '오늘은 5km를 6′00″ 페이스로 시작해도 좋아요.',
    '34.2',
    '5′52″',
    '8초 단축',
    '8초 빨라졌어요',
    '총 5개 · 3개 미리보기',
    '눌러서 러닝 방식 선택',
  ]) {
    expect(home).toContain(text);
  }
  // Newest four of my own runs as tiles; group runs (10.11) and older ones are left for 전체 기록 보기.
  const tiles = recordTiles(screen);
  expect(tiles).toHaveLength(4);
  expect(tiles[0]).toBe('민락수변공원 출발, 10.15 · 5.02km · 29:41, 5′55″');
  expect(tiles[3]).toContain('10.05 · 4.10km · 24:30');
  expect(tiles.join(' ')).not.toContain('10.11 ·');
  expect(tiles.join(' ')).not.toContain('10.03 ·');
  await press(screen, '거리순');
  expect(recordTiles(screen)[0]).toContain('광안리 해변 롱런');
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
  // Only the avatar shows a photo; the background is the default backdrop.
  expect(images.map(node => node.props.source.uri)).toEqual([
    'file:///profile.jpg',
  ]);
  await act(async () => screen!.unmount());
});

test.each([
  ['newUser', ['준비도 수집 중', '점수 산출 전'], null],
  [
    'staleHealth',
    ['마지막 평가 10월 15일', '오늘 점수로 쓰지 않아요'],
    ['워치 동기화', '심박수'],
  ],
  [
    'healthDenied',
    ['권한 없음', 'Health Connect'],
    ['설정 열기', '계정 공개 범위'],
  ],
  ['watchDisconnected', ['미연결', '워치를 연결하면'], ['워치 연결', '심박수']],
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
    if (action) {
      const [button, destination] = action;
      expect(home).not.toContain(destination);
      await press(screen, button);
      expect(texts(screen)).toContain(destination);
    }
    await act(async () => screen.unmount());
  },
);

test('notifications group by day, mark all read and open the related screen', async () => {
  const screen = await render();
  await press(screen, '알림');
  const list = texts(screen);
  for (const text of [
    '오늘',
    '이번 주',
    '3분 전',
    '12분 전',
    '1시간 전',
    '2일 전',
    '3일 전',
  ]) {
    expect(list).toContain(text);
  }
  expect(() =>
    labelled(screen, '읽지 않음, ‘민락 야경 러너스’ 가입이 승인됐어요'),
  ).not.toThrow();
  await press(screen, '모두 읽음');
  expect(() =>
    labelled(screen, '읽지 않음, ‘민락 야경 러너스’ 가입이 승인됐어요'),
  ).toThrow();
  expect(labelled(screen, '모두 읽음').props.accessibilityState).toEqual({
    disabled: true,
  });
  await press(screen, '‘토요일 아침, 함께 5km’ 그룹런이 곧 시작해요');
  await settle();
  expect(texts(screen)).toContain('예상 공동 페이스');
  await act(async () => screen.unmount());
});

test('an empty inbox shows the 2.9b empty state', async () => {
  const screen = await render('noNotifications');
  await press(screen, '알림');
  expect(texts(screen)).toContain('아직 받은 알림이 없어요');
  expect(labelled(screen, '모두 읽음').props.accessibilityState).toEqual({
    disabled: true,
  });
  await act(async () => screen.unmount());
});

test('run mode leads to course recommendations and a free run with a countdown', async () => {
  const screen = await render();
  await press(screen, '러닝 시작');
  expect(texts(screen)).toContain('달릴까요?');
  await press(screen, '코스 러닝');
  expect(texts(screen)).toContain('어디서, 얼마나 달릴까요?');
  await act(async () => screen.unmount());

  const free = await render();
  await press(free, '러닝');
  await press(free, '자유 러닝');
  expect(texts(free)).toContain('민락수변공원 입구');
  expect(texts(free)).toContain('GPS 양호');
  expect(texts(free)).not.toContain('예상 완주 시간');
  await type(free, '거리 목표', '5');
  expect(texts(free)).not.toContain('예상 완주 시간');
  await type(free, '페이스 목표', '6:00');
  expect(texts(free)).toContain('예상 완주 시간 30:00');
  await press(free, '러닝 시작');
  expect(texts(free)).toContain('3');
  // Each count renders before the next second starts, so wait a second at a time.
  for (let second = 0; second < 3; second += 1) {
    await settle(1050);
  }
  // 워치가 실제로 시작하고 서버가 확정한 뒤에 진행 화면으로 넘어간다(S15P31E105-256).
  await settle(200);
  expect(texts(free)).toContain('내 페이스');
  await act(async () => free.unmount());
});

test('course run shows the pace plan by day and the night layout after sunset', async () => {
  const day = await render();
  await press(day, '광안대교 루프, 5.0km · 30분');
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
  await press(night, '광안대교 루프, 5.0km · 30분');
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

test('the music card lists Melon and switching to Spotify changes the list', async () => {
  const screen = await openMusic('default');
  const card = texts(screen);
  for (const text of [
    '바다 쪽으로 달리기',
    '1:24',
    '3:41',
    '좋아요한 곡',
    '128곡',
    '최근 들은 곡',
    'TOP100',
    '오늘 12:00 기준',
    '멜론 열기',
  ]) {
    expect(card).toContain(text);
  }
  await press(screen, '일시정지');
  expect(() => labelled(screen, '재생')).not.toThrow();
  await press(screen, '음원 선택');
  expect(texts(screen)).toContain('로그인 필요');
  expect(labelled(screen, 'Spotify').props.accessibilityState).toMatchObject({
    disabled: true,
  });
  await press(screen, 'Spotify 로그인');
  await press(screen, 'Spotify');
  expect(labelled(screen, 'Spotify').props.accessibilityState).toMatchObject({
    selected: true,
  });
  await press(screen, '뒤로');
  const spotify = texts(screen);
  expect(spotify).toContain('Spotify Premium');
  expect(spotify).toContain('6개');
  expect(spotify).toContain('Spotify 열기');
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
  expect(texts(dropped)).toContain('좋아요한 곡');
  await press(dropped, '다시 연결');
  expect(texts(dropped)).not.toContain('연결이 끊겼어요');
  expect(texts(dropped)).toContain('바다 쪽으로 달리기');
  await act(async () => dropped.unmount());

  const setup = await openMusic('musicNeedsSetup');
  await press(setup, '음원 선택');
  const sources = texts(setup);
  for (const text of ['권한 필요', '앱 설치 필요', '허용', '설치']) {
    expect(sources).toContain(text);
  }
  await act(async () => setup.unmount());
});
