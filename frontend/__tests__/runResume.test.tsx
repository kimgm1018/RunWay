import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  createMockRepositories,
  DataError,
  DataProvider,
  type Repositories,
} from '../src/data';
import {
  RunSessionProvider,
  useRunControlState,
  useRunResume,
  useRunSession,
} from '../src/screens/run/RunSession';
import { SessionProvider, useSession } from '../src/session/SessionProvider';

// S15P31E105-444: 앱 재실행·재로그인 뒤 서버에 남은 본인의 진행 중 세션(S02)을 이어받는다.
// 다른 계정·삭제·종료된 세션은 복원하지 않고, 로그아웃하면 이전 계정의 러닝 화면 상태를 남기지 않는다.

jest.mock('../src/health/watchHealth', () => ({
  setWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
  refreshWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
}));
jest.setTimeout(30000);

type Mock = ReturnType<typeof createMockRepositories>;
type Seen = {
  session: ReturnType<typeof useSession>;
  run: ReturnType<typeof useRunSession>;
  control: ReturnType<typeof useRunControlState>;
  target: ReturnType<typeof useRunResume>['target'];
};

const noGoal = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};

let seen: Seen;
let mounted: TestRenderer.ReactTestRenderer | null = null;

// 복원 화면 이동(MainTabs의 useResumeRun)은 대상만 확인하고 소비하지 않는다.
function Probe() {
  seen = {
    session: useSession(),
    run: useRunSession(),
    control: useRunControlState(),
    target: useRunResume().target,
  };
  return null;
}

async function settle(ms = 50) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function waitUntil(check: () => boolean, label: string) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await settle();
  }
}

async function mount(repositories: Repositories, signedIn: boolean) {
  await act(async () => {
    mounted = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <SessionProvider initialSignedIn={signedIn}>
          <RunSessionProvider>
            <Probe />
          </RunSessionProvider>
        </SessionProvider>
      </DataProvider>,
    );
  });
  await settle();
}

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  if (screen) {
    await act(async () => screen.unmount());
  }
});

const repositoriesFor = () =>
  createMockRepositories({ latencyMs: 0, tickMs: 50, watchLatencyMs: 0 });

// 지난 실행(또는 로그아웃 전)에 시작이 확정된 세션. remember=false면 러닝 서비스가 세션을 기억하지 못한다.
async function startedSession(repositories: Mock, { paused = false, remember = true } = {}) {
  const { session } = repositories;
  const created = await session.create({ controlDeviceId: '101', relayDeviceId: '102', goal: noGoal });
  const id = created.sessionId;
  const start = await session.requestControl(id, 'START', { deviceId: '101', expectedVersion: 1 });
  await session.reportResult(id, 'START', {
    commandId: start.commandId,
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: new Date().toISOString(),
    reasonCode: null,
  });
  if (paused) {
    const pause = await session.requestControl(id, 'PAUSE', { deviceId: '101', expectedVersion: 2 });
    await session.reportResult(id, 'PAUSE', {
      commandId: pause.commandId,
      deviceId: '101',
      result: 'APPLIED',
      appliedAt: new Date().toISOString(),
      reasonCode: null,
    });
  }
  await repositories.watchSession.setRunActive(remember, remember ? id : undefined);
  return id;
}

test('after signing in again the running session is restored to the progress screen', async () => {
  const repositories = repositoriesFor();
  const sessionId = await startedSession(repositories);
  await mount(repositories, false);
  expect(seen.control).toBeNull();
  expect(seen.target).toBeNull();

  await act(async () => seen.session.signIn());
  await waitUntil(() => seen.target !== null, 'resume target');

  expect(seen.target).toBe('RunProgress');
  expect(seen.control).toMatchObject({ sessionId, status: 'RUNNING', joined: true });
  expect(seen.run.run).toMatchObject({ status: 'running', config: { mode: 'FREE', plan: null } });
});

test('signing out leaves no run behind and signing in again restores it', async () => {
  const repositories = repositoriesFor();
  const sessionId = await startedSession(repositories);
  await mount(repositories, true);
  await waitUntil(() => seen.control?.status === 'RUNNING', 'restored run');

  await act(async () => seen.session.signOut());
  await settle();
  expect(seen.control).toBeNull();
  expect(seen.run.run).toBeNull();
  expect(seen.target).toBeNull();
  // 워치의 운동은 그대로 두어 같은 계정으로 다시 로그인하면 이어받는다.
  expect(await repositories.watchSession.getActiveSessionId()).toBe(sessionId);

  await act(async () => seen.session.signIn());
  await waitUntil(() => seen.control?.status === 'RUNNING', 'restored run after sign-in');
  expect(seen.target).toBe('RunProgress');
});

test('a restored session keeps control: pause goes to the server and the watch', async () => {
  const repositories = repositoriesFor();
  const sessionId = await startedSession(repositories);
  await mount(repositories, false);
  await act(async () => seen.session.signIn());
  await waitUntil(() => seen.control?.status === 'RUNNING', 'restored run');

  await act(async () => seen.run.pause());
  await waitUntil(() => seen.control?.status === 'PAUSED', 'paused');

  expect((await repositories.session.get(sessionId)).state).toBe('PAUSED');
  expect(seen.run.run?.status).toBe('paused');
});

test('a paused session is restored to 4.2 with the run paused (4.3 is part of 4.2, S15P31E105-517)', async () => {
  const repositories = repositoriesFor();
  await startedSession(repositories, { paused: true });
  await mount(repositories, true);
  await waitUntil(() => seen.target !== null, 'resume target');

  expect(seen.target).toBe('RunProgress');
  expect(seen.run.run?.status).toBe('paused');
});

test('a session that was never started is restored to the start screen', async () => {
  const repositories = repositoriesFor();
  const created = await repositories.session.create({ controlDeviceId: '101', relayDeviceId: '102', goal: noGoal });
  await repositories.watchSession.setRunActive(true, created.sessionId);
  await mount(repositories, true);
  await waitUntil(() => seen.target !== null, 'resume target');

  expect(seen.target).toBe('FreeRun');
  expect(seen.control).toMatchObject({ sessionId: created.sessionId, status: 'READY' });
  expect(seen.run.run).toBeNull();
});

test('another account’s session is not restored and the run service forgets it (S15P31E105-814)', async () => {
  const repositories = repositoriesFor();
  await startedSession(repositories);
  const other: Repositories = {
    ...repositories,
    session: {
      ...repositories.session,
      get: () =>
        Promise.reject(new DataError('SESSION_FORBIDDEN', '본인 세션이 아닙니다.', null, 403)),
    },
  };
  await mount(other, true);
  await settle(300);

  expect(seen.control).toBeNull();
  expect(seen.target).toBeNull();
  expect(seen.run.run).toBeNull();
  expect(await repositories.watchSession.getActiveSessionId()).toBeNull();
});

test('a deleted session is not restored and the run service forgets it', async () => {
  const repositories = repositoriesFor();
  await repositories.watchSession.setRunActive(true, '999');
  await mount(repositories, true);
  await settle(300);

  expect(seen.control).toBeNull();
  expect(seen.target).toBeNull();
  expect(await repositories.watchSession.getActiveSessionId()).toBeNull();
});

// S15P31E105-814: 기억한 진행 세션이 없으면 앱을 다시 열 때 남아 있던 '러닝 중' 알림(러닝 서비스)을 정리한다.
test('with no remembered session, opening the app stops a leftover run service', async () => {
  const repositories = repositoriesFor();
  const setRunActive = jest.spyOn(repositories.watchSession, 'setRunActive');
  await mount(repositories, true);
  await settle(300);

  expect(seen.control).toBeNull();
  expect(setRunActive).toHaveBeenCalledWith(false);
  expect(setRunActive).not.toHaveBeenCalledWith(true, expect.anything());
});

test('a restored running session keeps the run service on', async () => {
  const repositories = repositoriesFor();
  await startedSession(repositories);
  const setRunActive = jest.spyOn(repositories.watchSession, 'setRunActive');
  await mount(repositories, true);
  await waitUntil(() => seen.target !== null, 'resume target');

  expect(setRunActive.mock.calls.map(call => call[0])).toEqual([true]);
});

test('a finished session is not restored', async () => {
  const repositories = repositoriesFor();
  const sessionId = await startedSession(repositories);
  const end = await repositories.session.requestControl(sessionId, 'END', { deviceId: '101', expectedVersion: 2 });
  await repositories.session.reportResult(sessionId, 'END', {
    commandId: end.commandId,
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: new Date().toISOString(),
    reasonCode: null,
    uploadComplete: true,
  });
  await mount(repositories, true);
  await settle(300);

  expect(seen.control).toBeNull();
  expect(seen.target).toBeNull();
  expect(seen.run.run).toBeNull();
});

test('starting a new run while a paused session exists opens that session instead (S01 409)', async () => {
  const repositories = repositoriesFor();
  // 러닝 서비스가 세션을 기억하지 못해(앱 데이터 정리 등) 시작 시에야 서버의 활성 세션을 알게 된다.
  const sessionId = await startedSession(repositories, { paused: true, remember: false });
  await mount(repositories, true);
  expect(seen.control).toBeNull();

  await act(async () =>
    seen.run.start({ mode: 'COURSE', plan: null, goalDistanceM: 5000, goalPaceSecPerKm: 360 }),
  );
  await waitUntil(() => seen.target !== null, 'resume target');

  expect(seen.target).toBe('RunProgress');
  expect(seen.control).toMatchObject({ sessionId, status: 'PAUSED', joined: true });
  // 이 앱이 만든 운동이 아니므로 고른 목표 대신 자유 러닝으로 이어간다.
  expect(seen.run.run).toMatchObject({ status: 'paused', config: { mode: 'FREE', goalDistanceM: null } });
  expect((await repositories.session.get(sessionId)).state).toBe('PAUSED');

  // 이어받은 세션에서 재개하면 서버·워치로 간다.
  await act(async () => seen.run.resume());
  await waitUntil(() => seen.control?.status === 'RUNNING', 'resumed');
  expect(seen.run.run?.status).toBe('running');
});
