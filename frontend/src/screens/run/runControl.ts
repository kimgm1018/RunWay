import { DataError, errorCode, type DataErrorCode } from '../../data/errors';
import { createBatchRelay } from '../../watch/batchRelay';
import type {
  CommandApproval,
  ControlAction,
  LinkedDevices,
  Repositories,
  RunningSessionView,
  SessionGoalDraft,
  SessionStatus,
  WatchSessionEvent,
} from '../../data/types';

// 개인 러닝(자유·코스)의 세션 제어. 서버 승인(REQUEST) → 워치 실행 → 실제 결과 저장(RESULT) 순서로만 상태를 바꾼다.
// 승인 응답이나 워치 수신 확인만으로 시작·일시정지·종료를 확정하지 않는다(sessions.md 세션 제어 공통 계약).

export type ControlProblem =
  | { kind: 'watchRequired' }
  | { kind: 'watchNotReady'; reasonCode: string | null }
  | { kind: 'rejected'; action: ControlAction; reasonCode: string | null }
  // 실행 미확인. 시작이면 "시작 여부를 확인할 수 없습니다".
  | { kind: 'unconfirmed'; action: ControlAction }
  // 종료 2분 초과 또는 마지막 기록 저장 미확인(UPLOAD_PENDING).
  | { kind: 'saveUnconfirmed' }
  | { kind: 'error'; code: DataErrorCode };

export type RunControlState = {
  sessionId: string | null;
  status: SessionStatus | null;
  stateVersion: number;
  startedAt: string | null;
  endedAt: string | null;
  pending: { action: ControlAction | 'CANCEL'; commandId: string | null } | null;
  problem: ControlProblem | null;
};

export type RunControl = {
  getState: () => RunControlState;
  subscribe: (listener: (state: RunControlState) => void) => () => void;
  // 세션 생성·워치 준비 후 시작까지.
  start: (goal: SessionGoalDraft) => Promise<void>;
  // 세션 생성·워치 준비만 한다. 시작은 워치의 START_REQUEST나 start로 이어진다.
  prepare: (goal: SessionGoalDraft) => Promise<void>;
  // 앱 재실행 뒤 기존 세션에 다시 붙는다. 수신함에 남은 워치 결과가 있으면 서버에 보고한다.
  attach: (sessionId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  finish: () => Promise<void>;
  cancel: () => Promise<void>;
  // 미확인 명령을 같은 commandId로 워치에 다시 보내 보관한 결과를 확인한다. 새 명령을 만들지 않는다.
  recheck: () => Promise<void>;
  // S08 ABORT_UNCONFIRMED_START.
  abortUnconfirmedStart: () => Promise<void>;
  dispose: () => void;
};

type Deps = {
  session: Repositories['session'];
  watch: Repositories['watchSession'];
  timers?: { resultWaitMs?: number; endResultWaitMs?: number; retryDelaysMs?: number[] };
};

type ResultEvent = Extract<WatchSessionEvent, { type: 'COMMAND_RESULT' }>;

const TERMINAL: SessionStatus[] = ['COMPLETED', 'CANCELLED', 'INTERRUPTED'];
// 응답 없음(NETWORK_ERROR)·서버 장애(SERVER_ERROR, 5xx). 같은 요청으로만 재시도하며 서버는 같은 요청을 같은 결과로 답한다.
const RETRYABLE: DataErrorCode[] = ['NETWORK_ERROR', 'SERVER_ERROR'];
const RESYNC: DataErrorCode[] = ['STALE_STATE', 'CONTROL_DEVICE_CHANGED', 'INVALID_SESSION_STATE'];

const initialState: RunControlState = {
  sessionId: null,
  status: null,
  stateVersion: 0,
  startedAt: null,
  endedAt: null,
  pending: null,
  problem: null,
};

const emptyGoal: SessionGoalDraft = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createRunControl({ session, watch, timers }: Deps): RunControl {
  const resultWaitMs = timers?.resultWaitMs ?? watch.timing?.resultWaitMs ?? 30_000;
  const endResultWaitMs = timers?.endResultWaitMs ?? watch.timing?.endResultWaitMs ?? 120_000;
  // 최초 포함 최대 3회, 추가 1초·2초 + jitter (watch-mobile-server-integration.md 9.5).
  const retryDelaysMs = timers?.retryDelaysMs ?? [0, 1000, 2000];

  let state = initialState;
  let devices: LinkedDevices | null = null;
  let controlDeviceId: string | null = null;
  let relayDeviceId: string | null = null;
  // 워치에 보낸 승인 명령. 재확인(recheck) 때 같은 명령을 다시 보낸다.
  let inflight: CommandApproval | null = null;
  // 이 세션을 만든 목표. 복구한 세션은 목표를 모르므로 null.
  let lastGoal: SessionGoalDraft | null = null;
  let busy: Promise<void> | null = null;
  // 다른 조작이 진행 중일 때 들어온 워치 요청. 진행 중인 조작이 끝나면 실행한다(마지막 요청만 남긴다).
  let queued: (() => Promise<void>) | null = null;
  let disposed = false;
  const listeners = new Set<(next: RunControlState) => void>();
  const waiters = new Map<string, (event: ResultEvent | null) => void>();
  // 기다리는 쪽이 없을 때 도착한 결과(앱이 없던 동안 쌓인 수신함, 시간 초과 뒤의 늦은 결과).
  const early = new Map<string, ResultEvent>();
  // 서버에 보고 중이거나 보고한 결과. 같은 결과를 두 번 받아도 한 번만 보고한다.
  const reported = new Set<string>();

  const setState = (change: Partial<RunControlState>) => {
    state = { ...state, ...change };
    listeners.forEach(listener => listener(state));
  };

  // 서버 상태를 한 번에 반영한다. extra로 진행 표시를 함께 바꿔 "운동 중인데 시작 확인 중" 같은 중간 상태를 내보내지 않는다.
  const applyView = (view: RunningSessionView, extra: Partial<RunControlState> = {}) => {
    controlDeviceId = view.controlDeviceId;
    relayDeviceId = view.relayDeviceId;
    setState({
      sessionId: view.sessionId,
      status: view.state,
      stateVersion: view.stateVersion,
      startedAt: view.startedAt,
      endedAt: view.endedAt,
      ...extra,
    });
  };

  // 같은 요청으로만 재시도한다. 409 등 내용·권한 오류는 재시도하지 않는다.
  async function call<T>(work: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const delay of retryDelaysMs) {
      if (delay > 0) {
        await sleep(delay + Math.floor(Math.random() * Math.min(500, delay)));
      }
      try {
        return await work();
      } catch (error) {
        lastError = error;
        if (!RETRYABLE.includes(errorCode(error))) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  // 한 번에 하나의 조작만 진행한다. 진행 중에 들어온 같은 조작은 진행 중인 것을 기다린다(중복 요청 방지).
  const run = (work: () => Promise<void>) => {
    if (busy) {
      return busy;
    }
    busy = work()
      .catch(error => {
        setState({ problem: { kind: 'error', code: errorCode(error) } });
      })
      .finally(() => {
        busy = null;
        const next = queued;
        queued = null;
        if (next && !disposed) {
          run(next);
        }
      });
    return busy;
  };

  const runOrQueue = (work: () => Promise<void>) => {
    if (busy) {
      queued = work;
      return;
    }
    run(work);
  };

  const refresh = async () => {
    if (state.sessionId) {
      applyView(await call(() => session.get(state.sessionId as string)));
    }
  };

  const settleActive = async () => {
    if (state.status && TERMINAL.includes(state.status)) {
      await watch.setRunActive(false).catch(() => undefined);
    }
  };

  const waitFor = (commandId: string, timeoutMs: number) =>
    new Promise<ResultEvent | null>(resolve => {
      const ready = early.get(commandId);
      if (ready) {
        early.delete(commandId);
        resolve(ready);
        return;
      }
      const timer = setTimeout(() => {
        waiters.delete(commandId);
        resolve(null);
      }, timeoutMs);
      waiters.set(commandId, event => {
        clearTimeout(timer);
        waiters.delete(commandId);
        resolve(event);
      });
    });

  async function report(action: ControlAction, event: ResultEvent) {
    if (reported.has(event.commandId) || !state.sessionId) {
      return;
    }
    reported.add(event.commandId);
    const sessionId = state.sessionId;
    try {
      const saved = await call(() =>
        session.reportResult(sessionId, action, {
          commandId: event.commandId,
          // 실행기기는 승인받은 제어기기다(워치 기록 모드).
          deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
          result: event.result,
          appliedAt: event.appliedAt,
          reasonCode: event.reasonCode,
          ...(action === 'END'
            ? { uploadComplete: event.uploadComplete === true && event.pendingBatchCount === 0 }
            : {}),
        }),
      );
      await watch
        .sendReceived(sessionId, {
          commandId: event.commandId,
          persisted: true,
          stateVersion: saved.session.stateVersion,
        })
        .catch(() => undefined);
      if (saved.result === 'UNKNOWN') {
        reported.delete(event.commandId);
        applyView(saved.session, { problem: { kind: 'unconfirmed', action } });
        return;
      }
      inflight = null;
      applyView(saved.session, {
        pending: null,
        problem:
          saved.result === 'REJECTED'
            ? { kind: 'rejected', action, reasonCode: event.reasonCode }
            : null,
      });
      await settleActive();
    } catch (error) {
      reported.delete(event.commandId);
      const code = errorCode(error);
      if (code === 'UPLOAD_PENDING') {
        setState({ problem: { kind: 'saveUnconfirmed' } });
        return;
      }
      // 저장 여부를 모른다(응답 없음·서버 장애). 워치는 실행했을 수 있으므로 실패로 단정하지 않고 재확인을 기다린다.
      if (RETRYABLE.includes(code)) {
        setState({ problem: { kind: 'unconfirmed', action } });
        return;
      }
      if (RESYNC.includes(code)) {
        await refresh().catch(() => undefined);
      }
      setState({ problem: { kind: 'error', code } });
    }
  }

  // 승인 명령을 워치에 보내고 실제 결과를 기다린다. 결과가 없으면 미확인으로 남기고 서버에 아무것도 보고하지 않는다.
  async function deliver(approval: CommandApproval) {
    inflight = approval;
    const sessionId = state.sessionId as string;
    const waiting = waitFor(
      approval.commandId,
      approval.action === 'END' ? endResultWaitMs : resultWaitMs,
    );
    await watch.sendCommand(sessionId, approval).catch(() => undefined);
    const event = await waiting;
    if (!event) {
      setState({
        problem:
          approval.action === 'END'
            ? { kind: 'saveUnconfirmed' }
            : { kind: 'unconfirmed', action: approval.action },
      });
      return;
    }
    await report(approval.action, event);
  }

  async function control(action: ControlAction) {
    if (!state.sessionId) {
      return;
    }
    const sessionId = state.sessionId;
    setState({ pending: { action, commandId: null }, problem: null });
    let approval: CommandApproval;
    try {
      approval = await call(() =>
        session.requestControl(sessionId, action, {
          deviceId: controlDeviceId ?? '',
          expectedVersion: state.stateVersion,
        }),
      );
    } catch (error) {
      const code = errorCode(error);
      if (RESYNC.includes(code)) {
        await refresh().catch(() => undefined);
      }
      setState({ pending: null, problem: { kind: 'error', code } });
      return;
    }
    setState({ pending: { action, commandId: approval.commandId } });
    if (approval.result === 'PENDING') {
      await deliver(approval);
      return;
    }
    if (approval.result === 'UNKNOWN') {
      // 응답 유실 뒤 재요청: 같은 명령이 미확인으로 남아 있다. 새로 실행하지 않고 재확인을 기다린다.
      inflight = approval;
      setState({ problem: { kind: 'unconfirmed', action } });
      return;
    }
    // 이미 확정된 슬롯의 재전송: 서버 상태로 맞춘다.
    inflight = null;
    applyView(await call(() => session.get(sessionId)), {
      pending: null,
      problem: approval.result === 'REJECTED' ? { kind: 'rejected', action, reasonCode: null } : null,
    });
  }

  // 워치에 현재 버전의 목표를 준비시키고, 준비 결과(실패 포함)를 서버에 그대로 전달한다(S08 REPORT_PREPARED).
  async function prepareWatch(goal: SessionGoalDraft): Promise<boolean> {
    const sessionId = state.sessionId as string;
    const stateVersion = state.stateVersion;
    // 워치는 이 기기 ID를 측정 batch의 생산 기기로 쓴다(S15P31E105-311).
    const prepared = await watch.prepare(sessionId, {
      stateVersion,
      deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
      goal,
    });
    const ready = prepared.ready && prepared.stateVersion === stateVersion;
    await call(() =>
      session.reportPrepared(sessionId, {
        deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
        expectedVersion: stateVersion,
        ready,
        reasonCode: ready ? null : prepared.reasonCode ?? 'VERSION_MISMATCH',
      }),
    );
    if (!ready) {
      setState({ problem: { kind: 'watchNotReady', reasonCode: prepared.reasonCode } });
    }
    return ready;
  }

  // 새 세션을 만든다. 응답 유실·앱 재시작으로 이미 활성 세션이 있으면 그 세션에 다시 붙는다(S01 409 details.sessionId).
  async function createSession(goal: SessionGoalDraft): Promise<boolean> {
    devices = await watch.getLinkedDevices();
    if (!devices) {
      setState({ problem: { kind: 'watchRequired' } });
      return false;
    }
    const linked = devices;
    setState({ problem: null });
    try {
      const created = await call(() =>
        session.create({
          controlDeviceId: linked.watchDeviceId,
          relayDeviceId: linked.phoneDeviceId,
          goal,
        }),
      );
      applyView(created);
      lastGoal = goal;
    } catch (error) {
      const activeId =
        error instanceof DataError && error.code === 'ACTIVE_SESSION_EXISTS'
          ? error.details?.sessionId
          : undefined;
      if (activeId === undefined || activeId === null) {
        throw error;
      }
      // 기존 세션의 목표는 덮어쓰지 않는다(S01 생성 응답 유실 복구).
      await attachTo(String(activeId));
      lastGoal = null;
    }
    await watch.setRunActive(true, state.sessionId ?? undefined).catch(() => undefined);
    return true;
  }

  async function attachTo(sessionId: string) {
    const view = await call(() => session.get(sessionId));
    applyView(view);
    // 재실행 후에도 러닝 중에는 서비스가 다시 떠 있어야 화면이 꺼져도 워치 메시지를 중계한다(AC-C4).
    const ended = state.status !== null && TERMINAL.includes(state.status);
    await watch
      .setRunActive(!ended, ended ? undefined : sessionId)
      .catch(() => undefined);
    const pending = view.pendingCommand;
    if (!pending || !['START', 'PAUSE', 'RESUME', 'END'].includes(pending.action)) {
      return;
    }
    const action = pending.action as ControlAction;
    inflight = {
      commandId: pending.commandId,
      action,
      expectedVersion: pending.expectedVersion,
      result: pending.result,
    };
    setState({ pending: { action, commandId: pending.commandId } });
    const event = early.get(pending.commandId);
    if (event) {
      early.delete(pending.commandId);
      await report(action, event);
    } else {
      setState({ problem: { kind: 'unconfirmed', action } });
    }
  }

  async function doCancel(notifyWatch: boolean) {
    if (!state.sessionId) {
      return;
    }
    const sessionId = state.sessionId;
    setState({ pending: { action: 'CANCEL', commandId: null }, problem: null });
    try {
      await call(() => session.cancel(sessionId));
      const view = await call(() => session.get(sessionId));
      applyView(view, { pending: null });
      await settleActive();
      if (notifyWatch) {
        await watch.sendServerState(sessionId, view).catch(() => undefined);
      }
    } catch (error) {
      const code = errorCode(error);
      setState({ pending: null, problem: { kind: 'error', code } });
      // 워치 CANCEL을 처리하지 못하면 상태가 아니라 ERROR로 알린다(9.3, 미확정 START면 COMMAND_PENDING).
      if (notifyWatch) {
        await watch
          .sendError(sessionId, { code, retryable: false, failedType: 'COMMAND_REQUEST' })
          .catch(() => undefined);
      }
    }
  }

  const currentStatus = (): SessionStatus | null => state.status;

  const sameGoal = (a: SessionGoalDraft, b: SessionGoalDraft) =>
    a.courseId === b.courseId &&
    a.comparisonSessionId === b.comparisonSessionId &&
    a.targetDistanceM === b.targetDistanceM &&
    a.targetDurationSec === b.targetDurationSec &&
    a.targetPaceSecPerKm === b.targetPaceSecPerKm;

  const startFlow = async (goal: SessionGoalDraft | null) => {
    if (state.status && state.status !== 'READY') {
      return;
    }
    // 실패한 시작 뒤 다른 목표로 다시 시작하면 남은 준비 세션을 취소하고 새로 만든다.
    if (state.sessionId && goal && lastGoal && !sameGoal(goal, lastGoal) && !inflight) {
      await doCancel(false);
      // doCancel이 state를 바꾸므로 좁혀진 타입이 아닌 현재 값을 다시 읽는다.
      if (currentStatus() !== 'CANCELLED') {
        return;
      }
      setState({ ...initialState });
    }
    if (!state.sessionId) {
      if (!goal || !(await createSession(goal))) {
        return;
      }
      if (state.status !== 'READY') {
        return;
      }
    }
    // 확인되지 않은 시작이 남아 있으면 새 시작을 만들지 않고 재확인을 기다린다.
    if (inflight) {
      if (!state.problem) {
        setState({ problem: { kind: 'unconfirmed', action: inflight.action } });
      }
      return;
    }
    // 거절·미준비 뒤에는 버전이 바뀌었을 수 있으므로 시작 전마다 워치를 현재 버전으로 다시 준비시킨다.
    if (!(await prepareWatch(goal ?? lastGoal ?? emptyGoal))) {
      return;
    }
    await control('START');
  };

  // 워치 측정 batch는 세션 제어 순서와 별개로 바로 W07에 올린다(제어 메시지를 batch 뒤에 묶지 않는다, 6장).
  const batches = createBatchRelay({ upload: session.uploadBatch, watch });

  const onEvent = (event: WatchSessionEvent) => {
    if (disposed) {
      return;
    }
    if (event.type === 'BATCH_DATA') {
      batches.handle(event);
      return;
    }
    if (event.type === 'COMMAND_RESULT') {
      const waiter = waiters.get(event.commandId);
      if (waiter) {
        waiter(event);
        return;
      }
      if (reported.has(event.commandId)) {
        return;
      }
      early.set(event.commandId, event);
      // 시간 초과로 미확인이 된 뒤 늦게 온 결과는 바로 보고한다.
      if (
        !busy &&
        inflight?.commandId === event.commandId &&
        state.sessionId === event.sessionId
      ) {
        const action = inflight.action;
        early.delete(event.commandId);
        run(() => report(action, event));
      }
      return;
    }
    if (event.sessionId !== state.sessionId) {
      return;
    }
    if (event.type === 'START_REQUEST') {
      runOrQueue(() => startFlow(null));
      return;
    }
    if (event.action === 'CANCEL') {
      runOrQueue(() => doCancel(true));
      return;
    }
    const action = event.action;
    runOrQueue(() => control(action));
  };

  const unsubscribe = watch.subscribe(onEvent);

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: goal => run(() => startFlow(goal)),
    prepare: goal =>
      run(async () => {
        if (!state.sessionId && (await createSession(goal))) {
          await prepareWatch(goal);
        }
      }),
    attach: sessionId => run(() => attachTo(sessionId)),
    pause: () => run(() => control('PAUSE')),
    resume: () => run(() => control('RESUME')),
    finish: () => run(() => control('END')),
    cancel: () => run(() => doCancel(false)),
    recheck: () =>
      run(async () => {
        if (!inflight) {
          return;
        }
        setState({ problem: null });
        await deliver(inflight);
      }),
    abortUnconfirmedStart: () =>
      run(async () => {
        if (!state.sessionId) {
          return;
        }
        const sessionId = state.sessionId;
        const view = await call(() =>
          session.abortUnconfirmedStart(sessionId, {
            deviceId: relayDeviceId ?? devices?.phoneDeviceId ?? '',
            expectedVersion: state.stateVersion,
          }),
        );
        inflight = null;
        applyView(view, { pending: null, problem: null });
        await settleActive();
      }),
    dispose: () => {
      disposed = true;
      unsubscribe();
      waiters.forEach(resolve => resolve(null));
      waiters.clear();
      listeners.clear();
    },
  };
}

