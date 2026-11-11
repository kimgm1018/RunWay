import { createMockRepositories, type MockScenario } from '../src/data';
import { DataError } from '../src/data/errors';
import type { SessionGoalDraft, WatchSessionEvent } from '../src/data/types';
import { createRunControl } from '../src/screens/run/runControl';

// S15P31E105-533: 시작 화면의 미리 준비, 같은 목표의 준비 재사용, 오래된·바뀐 준비 정리, S01 재시도, 확정 후 화면 먼저 반영.

const free: SessionGoalDraft = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};
const fiveK: SessionGoalDraft = { ...free, targetDistanceM: 5000 };

const wait = (ms = 20) => new Promise<void>(resolve => setTimeout(resolve, ms));

function setup(
  options: {
    scenario?: MockScenario;
    watchLatencyMs?: number;
    now?: () => number;
    connected?: () => boolean;
  } = {},
) {
  const repositories = createMockRepositories({
    latencyMs: 0,
    watchLatencyMs: options.watchLatencyMs ?? 0,
    scenario: options.scenario ?? 'default',
  });
  const calls = {
    create: 0,
    cancel: 0,
    prepare: 0,
    reportPrepared: 0,
    request: [] as string[],
    serverState: 0,
  };
  const session = {
    ...repositories.session,
    create: (request: Parameters<typeof repositories.session.create>[0]) => {
      calls.create += 1;
      return repositories.session.create(request);
    },
    cancel: (sessionId: string) => {
      calls.cancel += 1;
      return repositories.session.cancel(sessionId);
    },
    reportPrepared: (...args: Parameters<typeof repositories.session.reportPrepared>) => {
      calls.reportPrepared += 1;
      return repositories.session.reportPrepared(...args);
    },
    requestControl: (...args: Parameters<typeof repositories.session.requestControl>) => {
      calls.request.push(args[1]);
      return repositories.session.requestControl(...args);
    },
  };
  let receivedHold: Promise<void> | null = null;
  const watch = {
    ...repositories.watchSession,
    prepare: (...args: Parameters<typeof repositories.watchSession.prepare>) => {
      calls.prepare += 1;
      return repositories.watchSession.prepare(...args);
    },
    sendCommand: (...args: Parameters<typeof repositories.watchSession.sendCommand>) =>
      repositories.watchSession.sendCommand(...args),
    sendServerState: (...args: Parameters<typeof repositories.watchSession.sendServerState>) => {
      calls.serverState += 1;
      return repositories.watchSession.sendServerState(...args);
    },
    sendReceived: async (...args: Parameters<typeof repositories.watchSession.sendReceived>) => {
      if (receivedHold) {
        await receivedHold;
      }
      return repositories.watchSession.sendReceived(...args);
    },
    ...(options.connected
      ? { isWatchConnected: async () => (options.connected as () => boolean)() }
      : {}),
  };
  const control = createRunControl({
    session,
    watch,
    now: options.now,
    timers: {
      resultWaitMs: 200,
      endResultWaitMs: 300,
      retryDelaysMs: [0, 5, 5],
      createRetryDelaysMs: [0, 5],
    },
  });
  return {
    control,
    calls,
    repositories,
    session,
    holdReceived: (hold: Promise<void> | null) => {
      receivedHold = hold;
    },
  };
}

test('prepare then start reuses the session and the watch preparation', async () => {
  const { control, calls } = setup();
  await control.prepare(fiveK);
  expect(control.getState()).toMatchObject({ status: 'READY', problem: null });
  expect(calls).toMatchObject({ create: 1, prepare: 1, reportPrepared: 1 });

  await control.start(fiveK);

  expect(control.getState()).toMatchObject({ status: 'RUNNING', problem: null });
  // 시작에서 S01·워치 준비·S08을 다시 하지 않고 START만 요청한다.
  expect(calls).toMatchObject({ create: 1, prepare: 1, reportPrepared: 1, cancel: 0 });
  expect(calls.request).toEqual(['START']);
  control.dispose();
});

test('start pressed while preparing waits for it instead of being dropped; double start sends one START', async () => {
  const { control, calls } = setup({ watchLatencyMs: 40 });
  const preparing = control.prepare(fiveK);
  const first = control.start(fiveK);
  const second = control.start(fiveK);
  await Promise.all([preparing, first, second]);

  expect(control.getState().status).toBe('RUNNING');
  expect(calls.create).toBe(1);
  expect(calls.request.filter(action => action === 'START')).toHaveLength(1);
  control.dispose();
});

test('a changed goal cancels the prepared READY session and prepares a new one', async () => {
  const { control, calls } = setup();
  await control.prepare(free);
  const firstId = control.getState().sessionId;
  await control.prepare(fiveK);

  expect(calls).toMatchObject({ create: 2, cancel: 1, prepare: 2 });
  expect(control.getState()).toMatchObject({ status: 'READY' });
  expect(control.getState().sessionId).not.toBe(firstId);

  await control.start(fiveK);
  expect(calls).toMatchObject({ create: 2, cancel: 1, prepare: 2 });
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('the same goal prepared twice keeps one session', async () => {
  const { control, calls } = setup();
  await control.prepare(fiveK);
  await control.prepare({ ...fiveK });
  expect(calls).toMatchObject({ create: 1, cancel: 0, prepare: 1 });
  control.dispose();
});

test('a preparation older than the limit is replaced at start', async () => {
  let clock = 1_000_000;
  const { control, calls } = setup({ now: () => clock });
  await control.prepare(fiveK);
  clock += 600_001;

  await control.start(fiveK);

  expect(calls).toMatchObject({ create: 2, cancel: 1, prepare: 2 });
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('a watch that lost its connection is prepared again before START', async () => {
  let connected = true;
  const { control, calls } = setup({ connected: () => connected });
  await control.prepare(fiveK);
  connected = false;

  await control.start(fiveK);

  expect(calls.prepare).toBe(2);
  expect(calls.request).toEqual(['START']);
  control.dispose();
});

test('a reused preparation rejected as NOT_PREPARED is prepared once more and started', async () => {
  const { control, calls, repositories } = setup();
  await control.prepare(fiveK);
  const original = repositories.watchSession.sendCommand;
  const watch = repositories.watchSession as unknown as { emit: (event: WatchSessionEvent) => void };
  let rejected = false;
  repositories.watchSession.sendCommand = async (sessionId, approval) => {
    if (approval.action !== 'START' || rejected) {
      return original(sessionId, approval);
    }
    // 워치가 준비를 잃었다(예: 다른 세션 준비로 덮임).
    rejected = true;
    setTimeout(
      () =>
        watch.emit({
          type: 'COMMAND_RESULT',
          sessionId,
          commandId: approval.commandId,
          result: 'REJECTED',
          appliedAt: null,
          reasonCode: 'NOT_PREPARED',
          uploadComplete: null,
          pendingBatchCount: null,
        }),
      5,
    );
  };

  await control.start(fiveK);

  expect(calls.request).toEqual(['START', 'START']);
  expect(calls.prepare).toBe(2);
  expect(control.getState()).toMatchObject({ status: 'RUNNING', problem: null });
  control.dispose();
});

test('prepare failures stay off the screen; start reports them', async () => {
  const { control, calls } = setup({ scenario: 'watchDisconnected' });
  await control.prepare(fiveK);
  expect(control.getState()).toMatchObject({ sessionId: null, problem: null });

  await control.start(fiveK);
  expect(control.getState().problem).toEqual({ kind: 'watchRequired' });
  expect(calls.create).toBe(0);
  control.dispose();
});

test('releasePrepared cancels an unstarted READY session and tells the watch; it leaves a running one alone', async () => {
  const { control, calls } = setup();
  await control.prepare(fiveK);
  await control.releasePrepared();
  expect(control.getState().status).toBe('CANCELLED');
  expect(calls.cancel).toBe(1);
  expect(calls.serverState).toBe(1);
  control.dispose();

  const running = setup();
  await running.control.prepare(fiveK);
  await running.control.start(fiveK);
  await running.control.releasePrepared();
  expect(running.control.getState().status).toBe('RUNNING');
  expect(running.calls.cancel).toBe(0);
  running.control.dispose();
});

test('a timed-out S01 is sent once more only (server plan deadline), not three times', async () => {
  const { control, calls, session } = setup();
  session.create = async () => {
    calls.create += 1;
    throw new DataError('NETWORK_ERROR', 'timeout');
  };
  await control.start(fiveK);
  expect(calls.create).toBe(2);
  expect(control.getState().problem).toEqual({ kind: 'error', code: 'NETWORK_ERROR' });
  control.dispose();
});

test('the screen turns RUNNING as soon as the server saves START, before the watch receipt is delivered', async () => {
  const { control, holdReceived } = setup();
  let release: () => void = () => undefined;
  holdReceived(new Promise<void>(resolve => (release = resolve)));
  await control.prepare(fiveK);

  const starting = control.start(fiveK);
  for (let i = 0; i < 50 && control.getState().status !== 'RUNNING'; i += 1) {
    await wait(5);
  }
  expect(control.getState()).toMatchObject({ status: 'RUNNING', pending: null });

  release();
  await starting;
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('start timing lines carry only stages and elapsed ms', async () => {
  const lines: string[] = [];
  const spy = jest.spyOn(console, 'info').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const { control } = setup();
  await control.prepare(fiveK);
  await control.start(fiveK);
  spy.mockRestore();

  const timing = lines.filter(line => line.includes(' timing '));
  expect(timing.some(line => /timing START approved \+\d+ms$/.test(line))).toBe(true);
  expect(timing.some(line => /timing START screen RUNNING \+\d+ms$/.test(line))).toBe(true);
  expect(timing.some(line => /timing prepare reused \+\d+ms$/.test(line))).toBe(true);
  for (const line of timing) {
    expect(line).toMatch(/^\[RunWay\] timing [A-Za-z_ ]+ \+\d+ms$/);
  }
  control.dispose();
});

// ── 리뷰 지적(A-2/B-3, B-4, B-6, B-7, A-6) 회귀 테스트.

const slowCreate = (session: { create: (...args: never[]) => Promise<unknown> }, ms: number) => {
  const original = session.create;
  session.create = (async (...args: never[]) => {
    await wait(ms);
    return original(...args);
  }) as typeof session.create;
};

test('leaving before S01 answers still cancels the session once it exists', async () => {
  const { control, calls, session } = setup();
  slowCreate(session as never, 60);
  const preparing = control.prepare(fiveK);
  await wait(10);
  expect(control.getState().sessionId).toBeNull();

  await Promise.all([preparing, control.releasePrepared()]);

  expect(calls.create).toBe(1);
  expect(calls.cancel).toBe(1);
  expect(control.getState().status).toBe('CANCELLED');
  control.dispose();
});

test('start pressed while a release is running is not dropped', async () => {
  const { control, calls, session } = setup();
  await control.prepare(fiveK);
  const cancel = session.cancel;
  session.cancel = async (sessionId: string) => {
    await wait(40);
    return cancel(sessionId);
  };
  const releasing = control.releasePrepared();
  await wait(5);
  await Promise.all([releasing, control.start(fiveK)]);

  expect(calls.cancel).toBe(1);
  expect(calls.create).toBe(2);
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('a READY session restored after relaunch (goal unknown) is left alone on screen entry and replaced on start', async () => {
  const first = setup();
  await first.control.prepare(free);
  const restoredId = first.control.getState().sessionId as string;
  // 실제 재실행은 앱이 종료되므로 dispose가 불리지 않는다. 앞 제어기는 테스트 끝에서 정리한다.

  // 같은 저장소(서버)에 새 제어기가 다시 붙는다(앱 재실행 복원).
  const control = createRunControl({
    session: first.session,
    watch: first.repositories.watchSession,
    timers: { resultWaitMs: 200, retryDelaysMs: [0, 5, 5], createRetryDelaysMs: [0, 5] },
  });
  await control.attach(restoredId);
  expect(control.getState()).toMatchObject({ sessionId: restoredId, status: 'READY' });

  // 화면 진입(미리 준비)·화면 이탈만으로는 취소하지 않는다(그룹 세션일 수 있다, 재검토 R-5).
  await control.prepare(fiveK);
  await control.releasePrepared();
  expect(control.getState()).toMatchObject({ sessionId: restoredId, status: 'READY' });
  expect(first.calls.cancel).toBe(0);

  await control.start(fiveK);

  expect(control.getState().sessionId).not.toBe(restoredId);
  expect(control.getState().status).toBe('RUNNING');
  expect(first.calls.cancel).toBe(1);
  expect(first.calls.create).toBe(2);
  control.dispose();
  first.control.dispose();
});

test('dropping an outdated preparation tells the watch the session was cancelled', async () => {
  const { control, calls } = setup();
  await control.prepare(free);
  await control.prepare(fiveK);
  expect(calls.cancel).toBe(1);
  expect(calls.serverState).toBe(1);
  control.dispose();
});

test('by default a failed S01 is sent twice, about a second apart', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, scenario: 'default' });
  const times: number[] = [];
  const session = {
    ...repositories.session,
    create: async () => {
      times.push(Date.now());
      throw new DataError('NETWORK_ERROR', 'timeout');
    },
  };
  const control = createRunControl({ session, watch: repositories.watchSession });
  await control.start(fiveK);
  expect(times).toHaveLength(2);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(950);
  control.dispose();
});

// ── 재검토 지적(R-1, R-2, R-4, R-6) 회귀 테스트.

test('the latest goal wins when start is pressed again before the first start runs', async () => {
  const { control, session } = setup();
  const goals: (number | null)[] = [];
  const create = session.create;
  session.create = async request => {
    goals.push(request.goal.targetDistanceM);
    return create(request);
  };
  slowCreate(session as never, 40);
  const preparing = control.prepare(fiveK);
  await wait(5);
  const first = control.start(fiveK);
  const second = control.start({ ...free, targetDistanceM: 3000 });
  await Promise.all([preparing, first, second]);

  expect(goals).toEqual([5000, 3000]);
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('disposing while the ahead-of-time S01 is pending cancels that session once it exists', async () => {
  const { control, calls, session } = setup();
  slowCreate(session as never, 40);
  control.prepare(fiveK);
  await wait(5);
  control.dispose();
  for (let i = 0; i < 40 && calls.cancel === 0; i += 1) {
    await wait(10);
  }
  expect(calls.create).toBe(1);
  expect(calls.cancel).toBe(1);
});

test('a prepare queued behind a release prepares a new session after the release', async () => {
  const { control, calls } = setup();
  await control.prepare(fiveK);
  await Promise.all([control.releasePrepared(), control.prepare(fiveK)]);
  expect(calls.cancel).toBe(1);
  expect(calls.create).toBe(2);
  expect(control.getState().status).toBe('READY');
  control.dispose();
});

test('a failed clean-up cancel does not send the watch an error for a request it never made', async () => {
  const { control, session, repositories } = setup();
  await control.prepare(fiveK);
  session.cancel = async () => {
    throw new DataError('SERVER_ERROR', 'down');
  };
  const sendError = jest.spyOn(repositories.watchSession, 'sendError');
  await control.releasePrepared();
  expect(sendError).not.toHaveBeenCalled();
  control.dispose();
});
