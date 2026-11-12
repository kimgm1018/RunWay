import type {
  CommandApproval,
  LinkedDevices,
  Repositories,
  WatchSessionEvent,
} from '../types';

// 서버 승인 명령을 받아 실제로 실행한 것처럼 COMMAND_RESULT를 돌려주는 가짜 워치(watch-mobile-server-integration.md 9.3·9.4).
// 같은 commandId는 처음 결과를 보관했다가 다시 보낸다. 시작은 준비한 버전과 승인 버전이 같을 때만 실행한다.

export type MockWatchBehavior =
  | 'normal'
  // 첫 START만 거절한다(다시 준비한 뒤의 시작은 받는다).
  | 'rejectsStart'
  // START를 매번 거절한다(다시 준비해도 시작하지 못함, S15P31E105-533).
  | 'alwaysRejectsStart'
  // 명령을 처음 받았을 때는 응답하지 않고, 같은 명령을 다시 받으면 보관한 결과를 보낸다(재연결 후 재확인).
  | 'noResult'
  | 'duplicateResult'
  // 준비하지 못했다고 답한다.
  | 'notReady';

type Options = {
  latencyMs: number;
  linked: () => boolean;
  behavior: MockWatchBehavior;
  // 실제 적용 시각의 기준. 목업 시계는 고정이므로 실제 경과 시간을 더해 시각이 앞으로 가게 한다.
  baseTime: Date;
  timing?: { resultWaitMs: number; endResultWaitMs: number };
};

export type MockWatchSession = Repositories['watchSession'] & {
  // 테스트에서 워치가 보낸 메시지(시작 요청·조작 요청·결과)를 흉내 낸다.
  emit: (event: WatchSessionEvent) => void;
};

export function createMockWatchSession(options: Options): MockWatchSession {
  const listeners = new Set<(event: WatchSessionEvent) => void>();
  const inbox: WatchSessionEvent[] = [];
  const results = new Map<string, WatchSessionEvent>();
  const delivered = new Set<string>();
  const preparedVersion = new Map<string, number>();
  const startedAtMs = Date.now();
  let lastAppliedMs = 0;
  let rejectedOnce = false;
  let activeSessionId: string | null = null;

  const deliver = (event: WatchSessionEvent) => {
    if (listeners.size === 0) {
      inbox.push(event);
      return;
    }
    listeners.forEach(listener => listener(event));
  };

  const appliedAt = () => {
    const now = options.baseTime.getTime() + (Date.now() - startedAtMs);
    lastAppliedMs = Math.max(now, lastAppliedMs + 1);
    return new Date(lastAppliedMs).toISOString();
  };

  const rejected = (sessionId: string, approval: CommandApproval): WatchSessionEvent => ({
    type: 'COMMAND_RESULT',
    sessionId,
    commandId: approval.commandId,
    result: 'REJECTED',
    appliedAt: null,
    reasonCode: 'VERSION_MISMATCH',
    pendingBatchCount: null,
    uploadComplete: null,
  });

  const execute = (sessionId: string, approval: CommandApproval): WatchSessionEvent => {
    if (approval.action === 'START') {
      if (options.behavior === 'alwaysRejectsStart') {
        return rejected(sessionId, approval);
      }
      if (options.behavior === 'rejectsStart' && !rejectedOnce) {
        rejectedOnce = true;
        return rejected(sessionId, approval);
      }
      if (preparedVersion.get(sessionId) !== approval.expectedVersion) {
        return rejected(sessionId, approval);
      }
    }
    const end = approval.action === 'END';
    return {
      type: 'COMMAND_RESULT',
      sessionId,
      commandId: approval.commandId,
      result: 'APPLIED',
      appliedAt: appliedAt(),
      reasonCode: null,
      pendingBatchCount: end ? 0 : null,
      uploadComplete: end ? true : null,
    };
  };

  const after = (work: () => void) => setTimeout(work, options.latencyMs);

  const sendCommand = (sessionId: string, approval: CommandApproval) => {
    const firstDelivery = !delivered.has(approval.commandId);
    delivered.add(approval.commandId);
    if (options.behavior === 'noResult' && firstDelivery) {
      return Promise.resolve();
    }
    after(() => {
      const stored = results.get(approval.commandId) ?? execute(sessionId, approval);
      results.set(approval.commandId, stored);
      deliver(stored);
      if (options.behavior === 'duplicateResult') {
        deliver(stored);
      }
    });
    return Promise.resolve();
  };

  return {
    timing: options.timing,
    getLinkedDevices: () =>
      Promise.resolve<LinkedDevices | null>(
        options.linked() ? { watchDeviceId: '101', phoneDeviceId: '102' } : null,
      ),
    getPhoneDeviceId: () => Promise.resolve('102'),
    prepare: (sessionId, { stateVersion }) =>
      new Promise(resolve =>
        after(() => {
          if (options.behavior === 'notReady') {
            resolve({ stateVersion, ready: false, reasonCode: 'SENSOR_UNAVAILABLE' });
            return;
          }
          preparedVersion.set(sessionId, stateVersion);
          resolve({ stateVersion, ready: true, reasonCode: null });
        }),
      ),
    sendCommand,
    // SERVER_END(S15P31E105-420): 워치는 승인된 END와 똑같이 실행하고 COMMAND_RESULT로 답한다.
    sendServerEnd: (sessionId, end) =>
      sendCommand(sessionId, {
        commandId: end.commandId,
        action: 'END',
        expectedVersion: end.expectedVersion,
        result: 'PENDING',
      }),
    sendGroupStatus: () => Promise.resolve(),
    sendBpmCommand: () => Promise.resolve(),
    sendCoachingGuide: () => Promise.resolve(),
    sendReceived: () => Promise.resolve(),
    sendServerState: () => Promise.resolve(),
    sendError: () => Promise.resolve(),
    commitBatch: () => Promise.resolve(),
    failBatch: () => Promise.resolve(),
    subscribe: listener => {
      listeners.add(listener);
      inbox.splice(0).forEach(event => listener(event));
      return () => {
        listeners.delete(listener);
      };
    },
    setRunActive: (active, sessionId) => {
      activeSessionId = active ? sessionId ?? activeSessionId : null;
      return Promise.resolve();
    },
    getActiveSessionId: () => Promise.resolve(activeSessionId),
    emit: deliver,
  };
}
