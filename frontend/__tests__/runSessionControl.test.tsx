import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories, type MockOptions } from '../src/data';

// 개인 러닝 화면이 워치의 실제 실행·서버 확정을 기다리는지 확인한다 (작업 계획 AC-B1~B4).

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(60000);

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
  return matches[matches.length - 1];
}

let controlledTime = false;
let mounted: Screen | null = null;

// Pending watch states must remain observable until the test advances app time.
function controlTime() {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'],
  });
  controlledTime = true;
}

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  try {
    if (screen) {
      await act(async () => screen.unmount());
    }
  } finally {
    if (controlledTime) {
      jest.clearAllTimers();
      jest.useRealTimers();
      controlledTime = false;
    }
  }
});

async function settle(ms = 20) {
  if (controlledTime) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  } else {
    await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
  }
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

async function hold(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label, 'onLongPress').props.onLongPress();
  });
  await settle();
}

// Wait for the state each test observes; pending-start tests must stop before confirmation.
async function countDown(
  options: MockOptions,
  expectedText = '경과 시간',
  repositories = createMockRepositories({ latencyMs: 0, tickMs: 50, ...options }),
) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={repositories}
        initialSignedIn
      />,
    );
  });
  mounted = screen!;
  await settle();
  await settle();
  await press(screen!, '러닝');
  await press(screen!, '자유 러닝');
  await press(screen!, '러닝 시작');
  await waitForText(screen!, expectedText);
  return screen!;
}

test('러닝 시작 waits for the watch: 시작 확인 중 then the progress screen', async () => {
  controlTime();
  const screen = await countDown({ watchLatencyMs: 1500 }, '시작 확인 중');
  expect(texts(screen)).toContain('시작 확인 중');
  expect(texts(screen)).not.toContain('경과 시간');

  await waitForText(screen, '경과 시간');
  expect(texts(screen)).toContain('경과 시간');
  expect(texts(screen)).not.toContain('시작 확인 중');
});

test('a rejected start stays on the start screen with 다시 시작', async () => {
  const screen = await countDown({ scenario: 'watchRejectsStart' }, '워치가 시작하지 못했어요');
  expect(texts(screen)).toContain('워치가 시작하지 못했어요');
  expect(texts(screen)).toContain('다시 시작');
  expect(texts(screen)).not.toContain('경과 시간');
});

test('a silent watch shows 시작 여부를 확인할 수 없습니다 with 다시 확인 and 이번 운동 중단', async () => {
  const screen = await countDown(
    { scenario: 'watchNoResult', resultWaitMs: 500 },
    '시작 여부를 확인할 수 없습니다',
  );
  const shown = texts(screen);
  expect(shown).toContain('시작 여부를 확인할 수 없습니다');
  expect(shown).toContain('다시 확인');
  expect(shown).toContain('이번 운동 중단');
  expect(shown).not.toContain('경과 시간');

  await press(screen, '이번 운동 중단');
  await settle(100);
  expect(texts(screen)).not.toContain('시작 여부를 확인할 수 없습니다');
});

test('no watch shows 워치를 연결해 주세요', async () => {
  const screen = await countDown({ scenario: 'watchDisconnected' }, '워치를 연결해 주세요');
  expect(texts(screen)).toContain('워치를 연결해 주세요');
  expect(texts(screen)).not.toContain('경과 시간');
});

test('pause shows 일시정지 확인 중 until the watch confirms', async () => {
  controlTime();
  const screen = await countDown({ watchLatencyMs: 300 });
  expect(texts(screen)).toContain('경과 시간');

  await press(screen, '일시정지');
  expect(texts(screen)).toContain('일시정지 확인 중');
  expect(texts(screen)).not.toContain('종료는 1초 길게 눌러야 동작해요');

  await waitForText(screen, '종료는 1초 길게 눌러야 동작해요');
  expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');
});

test('종료 shows 종료 처리 중 then the result', async () => {
  controlTime();
  const screen = await countDown({ watchLatencyMs: 300 });
  await press(screen, '일시정지');
  await waitForText(screen, '종료는 1초 길게 눌러야 동작해요');

  await hold(screen, '종료');
  expect(texts(screen)).toContain('종료 처리 중');
  expect(texts(screen)).not.toContain('평균 페이스 /km');

  await waitForText(screen, '평균 페이스 /km');
  expect(texts(screen)).toContain('평균 페이스 /km');
});

// --- 최종 리뷰 수정(F-5·F-6) ---

test('다시 확인 after an unconfirmed start moves to the progress screen', async () => {
  const screen = await countDown(
    { scenario: 'watchNoResult', resultWaitMs: 500 },
    '시작 여부를 확인할 수 없습니다',
  );
  expect(texts(screen)).toContain('시작 여부를 확인할 수 없습니다');

  await press(screen, '다시 확인');
  await waitForText(screen, '경과 시간');
  expect(texts(screen)).toContain('경과 시간');
});

test('an unconfirmed pause shows 다시 확인 and recheck opens the pause screen', async () => {
  const screen = await countDown(
    { scenario: 'watchNoResult', resultWaitMs: 500 },
    '시작 여부를 확인할 수 없습니다',
  );
  await press(screen, '다시 확인');
  await waitForText(screen, '경과 시간');

  await press(screen, '일시정지');
  await waitForText(screen, '일시정지 여부를 확인할 수 없습니다');
  expect(texts(screen)).toContain('일시정지 여부를 확인할 수 없습니다');
  expect(texts(screen)).not.toContain('종료는 1초 길게 눌러야 동작해요');

  await press(screen, '다시 확인');
  await waitForText(screen, '종료는 1초 길게 눌러야 동작해요');
  expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');
});

test('종료 pressed on the watch moves the progress screen to the result', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, tickMs: 50, watchLatencyMs: 50 });
  const screen = await countDown({}, '경과 시간', repositories);
  expect(texts(screen)).toContain('경과 시간');

  await act(async () => {
    (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
      type: 'COMMAND_REQUEST',
      sessionId: '1',
      action: 'END',
      expectedVersion: 2,
    });
  });
  await waitForText(screen, '평균 페이스 /km');
  expect(texts(screen)).toContain('평균 페이스 /km');
});

// --- 앱 재실행 복구 ---

test('on launch the app reattaches to the remembered session and reports the stored watch result', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, tickMs: 50, watchLatencyMs: 0 });
  // 지난 실행에서 시작을 승인받았고 워치가 실행했지만, 결과를 보고하기 전에 앱이 꺼졌다.
  const created = await repositories.session.create({
    controlDeviceId: '101',
    relayDeviceId: '102',
    goal: { courseId: null, comparisonSessionId: null, targetDistanceM: null, targetDurationSec: null, targetPaceSecPerKm: null },
  });
  const approval = await repositories.session.requestControl(created.sessionId, 'START', { deviceId: '101', expectedVersion: 1 });
  await repositories.watchSession.setRunActive(true, created.sessionId);
  (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
    type: 'COMMAND_RESULT',
    sessionId: created.sessionId,
    commandId: approval.commandId,
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:00:01.000Z',
    reasonCode: null,
    pendingBatchCount: null,
    uploadComplete: null,
  });

  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(<App repositories={repositories} initialSignedIn />);
  });
  await settle(500);

  expect((await repositories.session.get(created.sessionId)).state).toBe('RUNNING');
  await act(async () => screen!.unmount());
});


async function runningSession(repositories: ReturnType<typeof createMockRepositories>) {
  const created = await repositories.session.create({
    controlDeviceId: '101',
    relayDeviceId: '102',
    goal: { courseId: null, comparisonSessionId: null, targetDistanceM: null, targetDurationSec: null, targetPaceSecPerKm: null },
  });
  const approval = await repositories.session.requestControl(created.sessionId, 'START', { deviceId: '101', expectedVersion: 1 });
  await repositories.session.reportResult(created.sessionId, 'START', {
    commandId: approval.commandId,
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: new Date().toISOString(),
    reasonCode: null,
  });
  await repositories.watchSession.setRunActive(true, created.sessionId);
  return created.sessionId;
}

test('on launch during a running session the app opens the progress screen', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, tickMs: 50, watchLatencyMs: 0 });
  await runningSession(repositories);

  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(<App repositories={repositories} initialSignedIn />);
  });
  await waitForText(screen!, '경과 시간');

  expect(texts(screen!)).toContain('경과 시간');
  await act(async () => screen!.unmount());
});

test('after reattaching, pause on the progress screen goes to the server', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, tickMs: 50, watchLatencyMs: 0 });
  const sessionId = await runningSession(repositories);

  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(<App repositories={repositories} initialSignedIn />);
  });
  await waitForText(screen!, '경과 시간');
  await press(screen!, '일시정지');
  await settle(500);

  expect((await repositories.session.get(sessionId)).state).toBe('PAUSED');
  await act(async () => screen!.unmount());
});
