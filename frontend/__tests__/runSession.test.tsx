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

function textOf(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node => node.type === Text && node.props.accessibilityLabel === label,
  );
  return String(matches[matches.length - 1].props.children);
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
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

// 홈 위젯에도 '러닝 시작'(러닝 방식 선택으로 이동)이 있으므로, 맨 위 화면의 시작 버튼이
// 설정을 받아 활성화된 뒤에 누른다. 코스 화면은 코스 계획을 불러온 뒤에 시작 버튼을 그린다.
function startReady(screen: Screen) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === '러닝 시작' &&
      typeof node.props.onPress === 'function',
  );
  return (
    matches.length > 0 &&
    matches[matches.length - 1].props.accessibilityState?.disabled === false
  );
}

// 앱 타이머가 낸 갱신은 act가 끝날 때 반영되므로 짧게 나눠 기다리며 조건을 확인한다.
async function settleUntil(
  screen: Screen,
  ready: () => boolean,
  what: string,
  timeoutMs = 15000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(
        `${what} 화면이 ${timeoutMs}ms 안에 열리지 않음: ${texts(screen)}`,
      );
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

async function hold(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label, 'onLongPress').props.onLongPress();
  });
  await settle();
}

// Starts a run and waits out the 3·2·1 countdown. Each mock sample is one second of running,
// sent every 50ms here, so the run covers about 55m per real second.
async function startRun(
  kind: 'course' | 'free',
  scenario: MockScenario = 'default',
) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createMockRepositories({
          latencyMs: 0,
          tickMs: 50,
          scenario,
        })}
        initialSignedIn
      />,
    );
  });
  // 화면 이동과 mock 응답은 settle의 act가 끝날 때 반영되므로, 고정 시간 대신 누를 대상이 열릴 때까지
  // 기다린다. 부하가 큰 전체 jest 실행에서는 짧은 고정 대기 안에 다음 화면이 준비되지 않는다(S15P31E105-323).
  const open = async (label: string, what: string) => {
    await settleUntil(screen!, () => shows(screen!, label), what);
    await press(screen!, label);
  };
  if (kind === 'course') {
    // 2.1 저장한 코스 → 3.1c, where a course sets up the run.
    await open('저장한 코스', '홈');
    await open('광안대교 루프, 5.0km 30분', '저장한 코스 목록');
  } else {
    await open('러닝', '홈 탭');
    await open('자유 러닝', '러닝 방식 선택');
  }
  await settleUntil(screen!, () => startReady(screen!), '러닝 시작 버튼');
  await press(screen!, '러닝 시작');
  // 워치가 실제로 시작하고 서버가 확정한 뒤에 진행 화면으로 넘어간다(S15P31E105-256).
  // 카운트다운 뒤 확정까지는 mock 응답 타이머가 이어지는 비동기 흐름이고, 화면은 settle의 act가 끝날 때만
  // 갱신된다. 고정 시간 대기는 전체 jest 부하에서 확정이 늦으면 진행 화면 전이나 첫 샘플 전에 끝나므로
  // 진행 화면이 열릴 때까지 기다린다(S15P31E105-323).
  await settleUntil(
    screen!,
    () => shows(screen!, '일시정지'),
    '4.2 러닝 진행',
  );
  // 진행 화면이 열릴 때 추적이 시작된다. 50ms 간격 샘플은 이 200ms 대기보다 먼저 도착한다.
  await settle(200);
  return screen!;
}

test('a course run shows live numbers, the rival gap and turn guidance', async () => {
  const screen = await startRun('course');
  const shown = texts(screen);
  for (const text of [
    '광안대교 루프 5.0km · 경쟁 모드',
    '10.13 기록보다',
    '거리',
    '경과 시간',
    '남은 거리',
    '내 페이스',
    // The pace card names the goal and how the pace stands against it.
    '목표 6′00″',
  ]) {
    expect(shown).toContain(text);
  }
  expect(shown).toMatch(/\d+초 (앞서는|뒤처지는) 중/);
  expect(shown).toMatch(/목표보다 \d+초 (빠름|느림)|목표 페이스/);
  expect(shown).toMatch(/앞 .+(직진|왼쪽|오른쪽)/);
  expect(textOf(screen, '내 페이스')).toMatch(/^\d′\d\d″$/);
  await act(async () => screen.unmount());
});

test('pause stops the clock, 재개 carries on and a long press on 종료 shows the result', async () => {
  const screen = await startRun('course');
  await press(screen, '일시정지');
  expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');
  const paused = textOf(screen, '경과 시간');
  await settle(300);
  expect(textOf(screen, '경과 시간')).toBe(paused);

  // Letting go early does nothing; finishing needs the hold.
  await act(async () => {
    labelled(screen, '종료', 'onPressIn').props.onPressIn();
    labelled(screen, '종료', 'onPressOut').props.onPressOut();
  });
  await settle();
  expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');

  await press(screen, '재개');
  await settle(300);
  expect(texts(screen)).toContain('내 페이스');
  await press(screen, '일시정지');
  const toSeconds = (value: string) =>
    value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  expect(toSeconds(textOf(screen, '경과 시간'))).toBeGreaterThan(
    toSeconds(paused),
  );

  await hold(screen, '종료');
  await settle();
  const result = texts(screen);
  for (const text of [
    // Stopped well before 5km, so the course is not 완주 and no goal line shows.
    '평균 페이스 /km · 목표 6′00″',
    '시간',
    '거리',
    '평균 심박',
    '평균 케이던스',
  ]) {
    expect(result).toContain(text);
  }
  // A good save stays quiet; only a failed one is shown.
  expect(result).not.toContain('기록을 저장하지 못했어요');
  expect(result).not.toContain('달성');
  expect(textOf(screen, '평균 페이스')).toMatch(/^\d′\d\d″$/);

  // The course is already one of mine, so the button starts saved and toggles off and on.
  await press(screen, '내 코스에 저장됨');
  expect(texts(screen)).toContain('내 코스에서 뺐어요');
  await press(screen, '내 코스에 저장');
  expect(texts(screen)).toContain('내 코스에 저장했어요');

  await press(screen, '완료');
  expect(texts(screen)).toContain('오늘 준비도');
  await act(async () => screen.unmount());
});

test('a free run result can be saved as my course, and a failed save offers 다시 저장', async () => {
  const free = await startRun('free');
  expect(texts(free)).toContain('자유 러닝');
  expect(texts(free)).not.toContain('경쟁 모드');
  await press(free, '일시정지');
  await hold(free, '종료');
  await settle();
  expect(texts(free)).toContain('평균 페이스 /km');
  await press(free, '내 코스에 저장');
  expect(texts(free)).toContain('내 코스에 저장했어요');
  expect(texts(free)).toContain('내 코스에 저장됨');
  // 기록 보기 opens the run just saved in 5.2.
  await press(free, '기록 보기');
  await settle();
  expect(texts(free)).toContain('기록 상세');
  await act(async () => free.unmount());

  const failed = await startRun('free', 'recordSaveFailed');
  await press(failed, '일시정지');
  await hold(failed, '종료');
  await settle();
  expect(texts(failed)).toContain('기록을 저장하지 못했어요');
  expect(labelled(failed, '기록 공유').props.disabled).toBe(true);
  await press(failed, '다시 저장');
  expect(texts(failed)).toContain('기록을 저장하지 못했어요');
  await act(async () => failed.unmount());
});
