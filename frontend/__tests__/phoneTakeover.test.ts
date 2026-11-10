import { createMockRepositories, DataError, type PhoneFix, type WatchSessionEvent } from '../src/data';
import { canTakeOver, createRunControl, type RunControl } from '../src/screens/run/runControl';
import { takeoverNotice } from '../src/screens/run/controlNotice';
import { payloadHash } from '../src/watch/phoneBatch';

// 폰 인계(S08 TAKE_OVER_PHONE, S15P31E105-464): 워치 batch 수신 차단 → 받은 batch 저장 확인 → 인계 → 폰 GPS·제어.
// 합성 값만 쓴다.

const goal = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};

const wait = (ms = 30) => new Promise<void>(resolve => setTimeout(resolve, ms));

type BatchEvent = Extract<WatchSessionEvent, { type: 'BATCH_DATA' }>;

const watchBatch = (sessionId: string, n = 1): BatchEvent => {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    type: 'BATCH_DATA',
    sessionId,
    batchId: id,
    deviceId: '101',
    itemCount: 1,
    body: JSON.stringify({ id, deviceId: 101, sessionId: Number(sessionId), items: [{}] }),
  };
};

function setup(
  options: {
    upload?: (body: string) => Promise<{ status: string; batchId: string; acceptedCount: number }>;
    takeOver?: 'ok' | 'lost' | 'stale' | 'unknown';
    frozen?: (sessionId: string) => BatchEvent[];
    connected?: boolean;
    watchQuietMs?: number;
    current?: () => Promise<PhoneFix>;
  } = {},
) {
  const repositories = createMockRepositories({ latencyMs: 0, watchLatencyMs: 0 });
  const calls = {
    uploads: [] as string[],
    takeOver: [] as { deviceId: string; expectedVersion: number }[],
    blocked: [] as string[],
    unblocked: [] as string[],
    errors: [] as string[],
    active: [] as [boolean, boolean][],
    received: 0,
    request: [] as { action: string; deviceId: string }[],
    reports: [] as { action: string; deviceId: string; uploadComplete?: boolean }[],
  };
  let getDown = false;
  const session = {
    ...repositories.session,
    get: (sessionId: string) =>
      getDown
        ? Promise.reject(new DataError('NETWORK_ERROR', '응답 없음'))
        : repositories.session.get(sessionId),
    uploadBatch: (body: string) => {
      calls.uploads.push(body);
      return (options.upload ?? repositories.session.uploadBatch)(body) as ReturnType<
        typeof repositories.session.uploadBatch
      >;
    },
    requestControl: (...args: Parameters<typeof repositories.session.requestControl>) => {
      calls.request.push({ action: args[1], deviceId: args[2].deviceId });
      return repositories.session.requestControl(...args);
    },
    reportResult: (...args: Parameters<typeof repositories.session.reportResult>) => {
      calls.reports.push({
        action: args[1],
        deviceId: args[2].deviceId,
        uploadComplete: args[2].uploadComplete,
      });
      return repositories.session.reportResult(...args);
    },
    takeOverPhone: async (sessionId: string, request: { deviceId: string; expectedVersion: number }) => {
      calls.takeOver.push(request);
      const mode = options.takeOver ?? 'ok';
      if (mode === 'stale') {
        throw new DataError('STALE_STATE', '세션 상태가 변경되었습니다.');
      }
      if (mode === 'unknown') {
        getDown = true;
        throw new DataError('NETWORK_ERROR', '응답 없음');
      }
      const view = await repositories.session.takeOverPhone!(sessionId, request);
      if (mode === 'lost') {
        throw new DataError('NETWORK_ERROR', '응답 없음');
      }
      return view;
    },
  };
  const watch = {
    ...repositories.watchSession,
    // 테스트가 나중에 바꿔 끼울 수 있도록 호출 시점에 위임한다.
    sendCommand: (...args: Parameters<typeof repositories.watchSession.sendCommand>) =>
      repositories.watchSession.sendCommand(...args),
    sendReceived: () => {
      calls.received += 1;
      return Promise.resolve();
    },
    sendError: (_sessionId: string, error: { code: string }) => {
      calls.errors.push(error.code);
      return Promise.resolve();
    },
    setRunActive: (active: boolean, sessionId?: string, run?: { location: boolean }) => {
      calls.active.push([active, run?.location === true]);
      return repositories.watchSession.setRunActive(active, sessionId);
    },
    blockBatches: async (sessionId: string) => {
      calls.blocked.push(sessionId);
      return options.frozen ? options.frozen(sessionId) : [watchBatch(sessionId)];
    },
    unblockBatches: async (sessionId: string) => {
      calls.unblocked.push(sessionId);
    },
    isWatchConnected: async () => options.connected ?? true,
  };
  const gps = new Set<(fix: PhoneFix) => void>();
  const location = {
    start: async () => true,
    stop: async () => undefined,
    subscribe: (listener: (fix: PhoneFix) => void) => {
      gps.add(listener);
      return () => gps.delete(listener);
    },
    requestPermission: async () => true,
    current:
      options.current ??
      (async (): Promise<PhoneFix> => {
        throw new DataError('LOCATION_UNAVAILABLE', '현재 위치 없음');
      }),
  };
  let ids = 900;
  const control = createRunControl({
    session,
    watch,
    location,
    newId: () => `00000000-0000-4000-8000-000000000${ids++}`,
    // 목업 워치의 시작 시각보다 늦은 실제 적용 시각.
    now: () => Date.now() + 86_400_000 * 365,
    timers: {
      resultWaitMs: 100,
      endResultWaitMs: 100,
      retryDelaysMs: [0, 5, 5],
      watchCheckMs: 10,
      watchQuietMs: options.watchQuietMs ?? 60_000,
      phoneFlushMs: 10,
      phoneFinishWaitMs: 200,
      approxEveryMs: 20,
    },
  });
  const fix = (latitude: number, longitude: number) =>
    gps.forEach(listener =>
      listener({ latitude, longitude, accuracyM: 4.567, altitudeM: null, time: Date.UTC(2026, 10, 6, 1, 0, 0) }),
    );
  return { control, calls, repositories, fix };
}

async function startedWatchSilent(control: RunControl, repositories: ReturnType<typeof createMockRepositories>) {
  await control.start(goal);
  expect(control.getState()).toMatchObject({ status: 'RUNNING', recordingMode: 'WATCH' });
  // 이 시점부터 워치가 답하지 않는다(연결 끊김).
  repositories.watchSession.sendCommand = async () => undefined;
}

test('the W07 hash matches the documented synthetic example', () => {
  const items = [
    {
      type: 'METRIC_SAMPLE',
      measuredAt: '2026-10-27T01:00:01Z',
      elapsedDurationSec: 1,
      heartRateBpm: 142,
      cadenceSpm: null,
      speedMps: null,
      gradePercent: null,
      totalDistanceM: null,
      routeProgressM: null,
      isHrMeasured: true,
    },
  ];
  expect(payloadHash('00000000-0000-4000-8000-000000000101', '101', '5001', items)).toBe(
    'ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c',
  );
});

test('takeover is offered only for a started watch run that lost the watch', async () => {
  const { control, repositories } = setup();
  await startedWatchSilent(control, repositories);
  expect(canTakeOver(control.getState())).toBe(false);

  await control.finish();
  // 종료 결과를 받지 못하면(워치 단절) 폰으로 기록 계속을 고를 수 있다.
  expect(control.getState().problem).toMatchObject({ kind: 'saveUnconfirmed', reason: 'NO_RESULT' });
  expect(canTakeOver(control.getState())).toBe(true);
  expect(takeoverNotice(control.getState())).toMatchObject({ offer: true });
  control.dispose();
});

test('a disconnected watch is shown as lost while running', async () => {
  const { control } = setup({ connected: false });
  await control.start(goal);
  await wait(40);
  expect(control.getState().watchLost).toBe(true);
  expect(canTakeOver(control.getState())).toBe(true);
  control.dispose();
});

test('no watch batch for a while while running is shown as lost, and a new batch clears it', async () => {
  const { control, repositories } = setup({ watchQuietMs: 20 });
  await control.start(goal);
  await wait(60);
  expect(control.getState().watchLost).toBe(true);

  const watch = repositories.watchSession as unknown as { emit: (event: unknown) => void };
  watch.emit(watchBatch(control.getState().sessionId!, 7));
  await wait(5);
  expect(control.getState().watchLost).toBe(false);
  control.dispose();
});

test('takeover saves the received watch batches first, then hands over to the relay phone', async () => {
  const { control, calls, repositories } = setup();
  await startedWatchSilent(control, repositories);
  await control.finish();
  const sessionId = control.getState().sessionId!;
  const version = control.getState().stateVersion;

  await control.takeOver();

  expect(calls.blocked).toEqual([sessionId]);
  // 고정한 워치 batch를 인계 요청보다 먼저 올렸다.
  expect(calls.uploads[0]).toBe(watchBatch(sessionId).body);
  expect(calls.takeOver).toEqual([{ deviceId: '102', expectedVersion: version }]);
  expect(control.getState()).toMatchObject({
    recordingMode: 'PHONE_FALLBACK',
    pending: null,
    problem: null,
    stateVersion: version + 1,
    phoneGps: 'on',
  });
  // 인계가 확인됐으므로 워치 batch 수신은 계속 막아 둔다. 러닝 서비스는 위치 유형으로 다시 켠다.
  expect(calls.unblocked).toEqual([]);
  expect(calls.active).toContainEqual([true, true]);
  control.dispose();
});

test('after takeover the phone records GPS and ends with its own END and batches', async () => {
  const { control, calls, repositories, fix } = setup();
  await startedWatchSilent(control, repositories);
  await control.finish();
  await control.takeOver();
  const before = calls.uploads.length;
  const received = calls.received;

  fix(35.1532, 129.1186);
  fix(35.1533, 129.1187);
  await control.finish();

  const state = control.getState();
  expect(state.status).toBe('COMPLETED');
  expect(calls.request.filter(r => r.action === 'END').map(r => r.deviceId)).toEqual(['101', '102']);
  expect(calls.reports[calls.reports.length - 1]).toEqual({
    action: 'END',
    deviceId: '102',
    uploadComplete: true,
  });
  const phoneBodies = calls.uploads.slice(before).map(body => JSON.parse(body));
  expect(phoneBodies).toHaveLength(1);
  expect(phoneBodies[0]).toMatchObject({
    deviceId: 102,
    sessionId: Number(state.sessionId),
    schemaVersion: '1',
    items: [
      { type: 'GPS_POINT', coordinates: [129.1186, 35.1532], accuracyM: 4.57, altitudeM: null },
      { type: 'GPS_POINT', coordinates: [129.1187, 35.1533] },
    ],
  });
  // 폰이 실행한 명령은 워치에 저장 확인을 보내지 않고, 끝난 운동은 막아 둔 수신을 다시 연다.
  expect(calls.received).toBe(received);
  expect(calls.unblocked).toEqual([state.sessionId]);
  expect(calls.active[calls.active.length - 1]).toEqual([false, false]);
  control.dispose();
});

test('after takeover pause and resume run on the phone and skip GPS while paused', async () => {
  const { control, calls, repositories, fix } = setup();
  await startedWatchSilent(control, repositories);
  await control.finish();
  await control.takeOver();

  await control.pause();
  expect(control.getState()).toMatchObject({ status: 'PAUSED', problem: null });
  fix(35.1, 129.1);
  await control.resume();
  expect(control.getState()).toMatchObject({ status: 'RUNNING', problem: null });
  fix(35.2, 129.2);
  await control.finish();

  expect(calls.reports.filter(r => r.deviceId === '102').map(r => r.action)).toEqual([
    'PAUSE',
    'RESUME',
    'END',
  ]);
  const points = calls.uploads
    .map(body => JSON.parse(body))
    .filter(body => body.deviceId === 102)
    .flatMap(body => body.items);
  expect(points.map((item: { coordinates: number[] }) => item.coordinates)).toEqual([[129.2, 35.2]]);
  control.dispose();
});

test('an unsaved received watch batch holds the takeover and reopens intake', async () => {
  const { control, calls, repositories } = setup({
    upload: () => Promise.reject(new DataError('NETWORK_ERROR', '응답 없음')),
  });
  await startedWatchSilent(control, repositories);
  await control.finish();

  await control.takeOver();

  expect(calls.takeOver).toEqual([]);
  expect(control.getState()).toMatchObject({
    recordingMode: 'WATCH',
    pending: null,
    problem: { kind: 'takeoverHeld' },
  });
  expect(calls.unblocked).toEqual([control.getState().sessionId]);
  expect(canTakeOver(control.getState())).toBe(true);
  control.dispose();
});

test('a lost takeover response is settled by S02 and not assumed', async () => {
  const { control, calls, repositories } = setup({ takeOver: 'lost' });
  await startedWatchSilent(control, repositories);
  await control.finish();

  await control.takeOver();

  expect(control.getState()).toMatchObject({ recordingMode: 'PHONE_FALLBACK', problem: null });
  expect(calls.unblocked).toEqual([]);
  control.dispose();
});

test('a refused takeover (STALE_STATE) refreshes, keeps WATCH and reopens intake', async () => {
  const { control, calls, repositories } = setup({ takeOver: 'stale' });
  await startedWatchSilent(control, repositories);
  await control.finish();

  await control.takeOver();

  expect(control.getState()).toMatchObject({
    recordingMode: 'WATCH',
    problem: { kind: 'takeoverFailed', code: 'STALE_STATE' },
  });
  expect(calls.unblocked).toEqual([control.getState().sessionId]);
  control.dispose();
});

test('when neither the takeover nor S02 answers, intake stays closed and the result is unconfirmed', async () => {
  const { control, calls, repositories } = setup({ takeOver: 'unknown' });
  await startedWatchSilent(control, repositories);
  await control.finish();

  await control.takeOver();

  expect(control.getState()).toMatchObject({ problem: { kind: 'takeoverUnconfirmed' } });
  expect(calls.unblocked).toEqual([]);
  control.dispose();
});

test('after takeover the old watch cannot control the run', async () => {
  const { control, calls, repositories } = setup();
  await startedWatchSilent(control, repositories);
  await control.finish();
  await control.takeOver();
  const requests = calls.request.length;
  const watch = repositories.watchSession as unknown as { emit: (event: unknown) => void };

  watch.emit({
    type: 'COMMAND_REQUEST',
    sessionId: control.getState().sessionId,
    action: 'PAUSE',
    expectedVersion: control.getState().stateVersion,
  });
  await wait(10);

  expect(calls.errors).toEqual(['CONTROL_DEVICE_CHANGED']);
  expect(calls.request).toHaveLength(requests);
  expect(control.getState()).toMatchObject({ status: 'RUNNING', recordingMode: 'PHONE_FALLBACK' });
  control.dispose();
});

// S15P31E105-549: a WATCH run also records phone GPS with the relay phone's deviceId. The phone keeps GPS on while
// ready but records only while running, and a watch END waits for the phone batches before uploadComplete=true.
const phoneItems = (uploads: string[]) =>
  uploads
    .map(body => JSON.parse(body))
    .filter(body => body.deviceId === 102)
    .flatMap(body => body.items);

test('a watch run uploads phone GPS from the relay phone only while running', async () => {
  const { control, calls, fix } = setup();
  await control.prepare(goal);
  expect(control.getState()).toMatchObject({ status: 'READY', phoneGps: 'on' });
  fix(35.0, 129.0);
  await control.start(goal);
  expect(control.getState()).toMatchObject({ status: 'RUNNING', recordingMode: 'WATCH' });
  fix(35.1, 129.1);
  await control.pause();
  expect(control.getState().status).toBe('PAUSED');
  fix(35.2, 129.2);
  await control.resume();
  fix(35.3, 129.3);
  await control.finish();

  expect(control.getState().status).toBe('COMPLETED');
  expect(phoneItems(calls.uploads).map((item: { coordinates: number[] }) => item.coordinates)).toEqual([
    [129.1, 35.1],
    [129.3, 35.3],
  ]);
  // The watch stays the control device; the phone batches only add positions.
  expect(calls.reports.map(r => r.deviceId)).toEqual(['101', '101', '101', '101']);
  expect(calls.reports[calls.reports.length - 1]).toEqual({ action: 'END', deviceId: '101', uploadComplete: true });
  // The run service asked for the location type while preparing, so phone GPS keeps coming with the screen off.
  expect(calls.active[0]).toEqual([true, true]);
  control.dispose();
});

test('a watch END is not upload-complete while a phone GPS batch is unsaved', async () => {
  const { control, calls, fix } = setup({
    upload: async body => {
      const parsed = JSON.parse(body);
      if (parsed.deviceId === 102) {
        throw new DataError('NETWORK_ERROR', '응답 없음');
      }
      return { status: 'COMMITTED', batchId: parsed.id, acceptedCount: parsed.items.length };
    },
  });
  await control.start(goal);
  fix(35.1, 129.1);
  await control.finish();
  const end = calls.reports.filter(r => r.action === 'END');
  expect(end[end.length - 1]).toEqual({ action: 'END', deviceId: '101', uploadComplete: false });
  control.dispose();
});

test('the phone GPS of the watch part carries on with the same recorder after a takeover', async () => {
  const { control, calls, repositories, fix } = setup();
  await startedWatchSilent(control, repositories);
  fix(35.1, 129.1);
  await control.finish();
  await control.takeOver();
  fix(35.2, 129.2);
  await control.finish();
  expect(phoneItems(calls.uploads).map((item: { coordinates: number[] }) => item.coordinates)).toEqual([
    [129.1, 35.1],
    [129.2, 35.2],
  ]);
  control.dispose();
});


// S15P31E105-549 실기기 피드백: 실내처럼 GPS 위치가 하나도 없으면 대략 현재 위치(Wi-Fi·기지국 포함)로 지도 점만 찍는다.
test('without any GPS fix a running run shows an approximate position, never uploads it, and drops it once GPS comes', async () => {
  const current = jest.fn(
    async (): Promise<PhoneFix> => ({ latitude: 35.1, longitude: 129.1, accuracyM: 60, altitudeM: null, time: 0 }),
  );
  const { control, calls, fix } = setup({ current });
  await control.start(goal);
  await wait(60);
  expect(control.getState().approxPosition).toEqual([129.1, 35.1]);
  expect(current).toHaveBeenCalled();
  // The approximate position is only for the dot: no batch carries it.
  expect(phoneItems(calls.uploads)).toEqual([]);

  // A GPS fix arrives: the route has a real position, so the approximate one is no longer asked for.
  fix(35.2, 129.2);
  await wait(60);
  const asked = current.mock.calls.length;
  await wait(80);
  expect(current.mock.calls.length).toBe(asked);
  control.dispose();
});

test('when the phone has no approximate position either, nothing is shown', async () => {
  const { control } = setup();
  await control.start(goal);
  await wait(60);
  expect(control.getState().approxPosition).toBeNull();
  control.dispose();
});

test('the watch screen values (LIVE_METRICS) show on the phone during a watch run (S15P31E105-549)', async () => {
  const { control, repositories } = setup();
  await control.start(goal);
  const sessionId = control.getState().sessionId!;
  const watch = repositories.watchSession as unknown as { emit: (event: unknown) => void };
  const shown = (measuredAt: string, paceSecPerKm: number | null) => ({
    type: 'LIVE_METRICS',
    sessionId,
    measuredAt,
    paceSecPerKm,
    heartRateBpm: 150,
    cadenceSpm: 170,
    distanceM: 1200,
    activeSec: 400,
  });
  watch.emit(shown('2026-11-10T01:00:05Z', 330));
  await wait(5);
  expect(control.getState().live).toMatchObject({ paceSecPerKm: 330, heartRate: 150, distanceM: 1200 });
  // Another session's values change nothing.
  watch.emit({ ...shown('2026-11-10T01:00:06Z', 300), sessionId: '999999' });
  await wait(5);
  expect(control.getState().live?.paceSecPerKm).toBe(330);
  control.dispose();
});

test('a phone fix shows on the screen right away during a watch run, before its batch (S15P31E105-549)', async () => {
  const { control, fix } = setup();
  await control.start(goal);
  expect(control.getState().live?.here ?? null).toBeNull();
  fix(35.15, 129.13);
  expect(control.getState().live?.here).toEqual([129.13, 35.15]);
  control.dispose();
});

test('a denied location permission stops the approximate position from asking again (review)', async () => {
  let calls = 0;
  const { control } = setup({
    current: async () => {
      calls += 1;
      throw new DataError('LOCATION_PERMISSION_DENIED', '위치 권한 없음');
    },
  });
  await control.start(goal);
  await wait(120);
  // approxEveryMs is 20 ms in this setup: without the stop it would ask about six times.
  expect(calls).toBe(1);
  control.dispose();
});
