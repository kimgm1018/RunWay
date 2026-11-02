import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type {
  Repositories,
  RunningSessionView,
  SessionGoalDraft,
  WatchSessionEvent,
} from '../data/types';

// 네이티브 WatchSession 모듈(워치 세션 메시지 중계)을 Repositories['watchSession']로 감싼다.
// dataSource='api'(S15P31E105-299)에서 쓰며, 기기 ID는 W01 연동(S15P31E105-308) 전까지 없다.

type NativeWatchSession = {
  send(path: string, type: string, sessionId: string, payloadJson: string): Promise<string>;
  drainInbox(): Promise<string>;
  ackInbox(messageIds: string[]): Promise<void>;
  setRunActive(active: boolean, sessionId: string | null): Promise<void>;
  getActiveSessionId(): Promise<string | null>;
};

type Subscription = { remove: () => void };
type EventSource = {
  addListener: (name: string, listener: (event: string) => void) => Subscription;
};

type NativeEvent = {
  type: string;
  messageId: string;
  sessionId: string;
  payload: Record<string, unknown>;
};

const EVENT = 'RunwayWatchSession';
const PATH = '/runway/v1/session';

function nativeModule() {
  return NativeModules.WatchSession as NativeWatchSession;
}

// 서버 ID는 문자열로 들고 있다가 JSON에는 숫자 토큰 그대로 넣는다(int64 정밀도 보존).
function idToken(value: string | null) {
  if (value === null) {
    return 'null';
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('invalid id');
  }
  return value;
}

function goalJson(goal: SessionGoalDraft) {
  return (
    `{"courseId":${idToken(goal.courseId)},` +
    `"comparisonSessionId":${idToken(goal.comparisonSessionId)},` +
    `"targetDistanceM":${JSON.stringify(goal.targetDistanceM)},` +
    `"targetDurationSec":${JSON.stringify(goal.targetDurationSec)},` +
    `"targetPaceSecPerKm":${JSON.stringify(goal.targetPaceSecPerKm)}}`
  );
}

function toEvent(raw: NativeEvent): WatchSessionEvent | null {
  const payload = raw.payload;
  switch (raw.type) {
    case 'COMMAND_RESULT':
      return {
        type: 'COMMAND_RESULT',
        sessionId: raw.sessionId,
        commandId: String(payload.commandId),
        result: payload.result as 'APPLIED' | 'REJECTED' | 'UNKNOWN',
        appliedAt: (payload.appliedAt as string | null | undefined) ?? null,
        reasonCode: (payload.reasonCode as string | null | undefined) ?? null,
        pendingBatchCount: (payload.pendingBatchCount as number | undefined) ?? null,
        uploadComplete: (payload.uploadComplete as boolean | undefined) ?? null,
      };
    case 'START_REQUEST':
      return {
        type: 'START_REQUEST',
        sessionId: raw.sessionId,
        expectedVersion: payload.expectedVersion as number,
      };
    case 'COMMAND_REQUEST':
      if (payload.phase !== 'REQUEST') {
        return null;
      }
      return {
        type: 'COMMAND_REQUEST',
        sessionId: raw.sessionId,
        action: payload.action as 'PAUSE' | 'RESUME' | 'END' | 'CANCEL',
        expectedVersion: payload.expectedVersion as number,
      };
    default:
      return null;
  }
}

export function createNativeWatchSession(
  options: { emitter?: EventSource; prepareTimeoutMs?: number } = {},
): Repositories['watchSession'] {
  const native = nativeModule();
  const source: EventSource =
    options.emitter ?? new NativeEventEmitter(NativeModules.WatchSession);
  const prepareTimeoutMs = options.prepareTimeoutMs ?? 10_000;
  const listeners = new Set<(event: WatchSessionEvent) => void>();
  const preparing = new Map<string, (prepared: NativeEvent) => void>();
  let draining: Promise<void> | null = null;

  const ack = (messageId: string) => {
    native.ackInbox([messageId]).catch(() => undefined);
  };
  // 워치 결과는 서버 저장 확인(sendReceived persisted=true) 전까지 수신함에 남긴다. 앱이 그 사이 꺼지면 다시 받아 보고한다.
  const unsavedResults = new Map<string, string[]>();

  // 수신함에 남은 메시지는 리스너가 붙기 전까지 지우지 않는다(subscribe 때 drain으로 다시 받는다).
  const handle = (raw: NativeEvent) => {
    if (raw.type === 'SESSION_PREPARED') {
      // 기다리는 준비 요청이 없으면 지난 응답이므로 수신함에서 지운다.
      preparing.get(raw.sessionId)?.(raw);
      ack(raw.messageId);
      return;
    }
    if (listeners.size === 0) {
      return;
    }
    const event = toEvent(raw);
    if (event) {
      listeners.forEach(listener => listener(event));
    }
    if (event?.type === 'COMMAND_RESULT') {
      unsavedResults.set(event.commandId, [
        ...(unsavedResults.get(event.commandId) ?? []),
        raw.messageId,
      ]);
      return;
    }
    ack(raw.messageId);
  };

  source.addListener(EVENT, json => {
    try {
      handle(JSON.parse(json) as NativeEvent);
    } catch {
      // 형식이 맞지 않는 이벤트는 버린다. 값은 로그에 남기지 않는다.
    }
  });

  const send = (path: string, type: string, sessionId: string, payloadJson: string) =>
    native
      .send(path.startsWith('/') ? path : `${PATH}/${path}`, type, sessionId, payloadJson)
      .then(() => undefined);

  return {
    getLinkedDevices: async () => null,

    prepare: (sessionId, { stateVersion, goal }) =>
      new Promise(resolve => {
        const timer = setTimeout(() => {
          preparing.delete(sessionId);
          resolve({ stateVersion, ready: false, reasonCode: 'PREPARE_TIMEOUT' });
        }, prepareTimeoutMs);
        preparing.set(sessionId, prepared => {
          clearTimeout(timer);
          preparing.delete(sessionId);
          resolve({
            stateVersion: prepared.payload.stateVersion as number,
            ready: prepared.payload.ready === true,
            reasonCode: (prepared.payload.reasonCode as string | null | undefined) ?? null,
          });
        });
        send(
          'prepare',
          'SESSION_PREPARE',
          sessionId,
          `{"stateVersion":${stateVersion},"goal":${goalJson(goal)},"initialBpm":null}`,
        ).catch(() => undefined);
      }),

    sendCommand: (sessionId, approval) =>
      approval.action === 'START'
        ? send(
            'start-authorized',
            'START_AUTHORIZED',
            sessionId,
            `{"commandId":${idToken(approval.commandId)},"expectedVersion":${approval.expectedVersion},` +
              '"targetBpm":null,"coachingId":null}',
          )
        : send(
            'command',
            'COMMAND_REQUEST',
            sessionId,
            `{"phase":"APPLY","action":"${approval.action}","expectedVersion":${approval.expectedVersion},` +
              `"targetBpm":null,"commandId":${idToken(approval.commandId)},"coachingId":null}`,
          ),

    sendReceived: async (sessionId, { commandId, persisted, stateVersion }) => {
      if (persisted) {
        const saved = unsavedResults.get(commandId) ?? [];
        unsavedResults.delete(commandId);
        if (saved.length > 0) {
          native.ackInbox(saved).catch(() => undefined);
        }
      }
      await send(
        'command-received',
        'COMMAND_RECEIVED',
        sessionId,
        `{"commandId":${idToken(commandId)},"persisted":${persisted},` +
          `"stateVersion":${JSON.stringify(stateVersion)}}`,
      );
    },

    sendError: (sessionId, { code, retryable, failedType }) =>
      send('/runway/v1/error', 'ERROR', sessionId, JSON.stringify({ code, retryable, failedType })),

    sendServerState: (sessionId, session: RunningSessionView) =>
      send(
        'state-result',
        'STATE_RESULT',
        sessionId,
        JSON.stringify({
          scope: 'SERVER',
          recordingMode: session.recordingMode,
          state: session.state,
          stateVersion: session.stateVersion,
          currentBpm: null,
          pendingCommand: null,
          lastCommand: null,
          pendingBatchCount: 0,
          clientSendAt: null,
          serverReceiveAt: null,
          serverSendAt: null,
        }),
      ),

    subscribe: listener => {
      listeners.add(listener);
      draining =
        draining ??
        native
          .drainInbox()
          .then(json => (JSON.parse(json) as NativeEvent[]).forEach(handle))
          .catch(() => undefined)
          .finally(() => {
            draining = null;
          });
      return () => {
        listeners.delete(listener);
      };
    },

    // Android 13+는 알림 권한이 있어야 "러닝 중" 알림이 보인다. 거절해도 서비스는 동작한다.
    setRunActive: async (active, sessionId) => {
      if (active && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).catch(
          () => undefined,
        );
      }
      await native.setRunActive(active, active ? sessionId ?? null : null);
    },
    getActiveSessionId: () => native.getActiveSessionId().catch(() => null),
  };
}
