import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type {
  CoachingGuide,
  RecordComparison,
  Repositories,
  RunningSessionView,
  SessionCommand,
  SessionGoalDraft,
  WatchSessionEvent,
} from '../data/types';

// 네이티브 WatchSession 모듈(워치 세션 메시지 중계)을 Repositories['watchSession']로 감싼다.
// dataSource='api'(S15P31E105-299)에서 쓰며, 기기 ID는 W01 연동(S15P31E105-308) 전까지 없다.

type NativeWatchSession = {
  send(path: string, type: string, sessionId: string, payloadJson: string): Promise<string>;
  drainInbox(): Promise<string>;
  ackInbox(messageIds: string[]): Promise<void>;
  setRunActive(active: boolean, sessionId: string | null, location: boolean): Promise<void>;
  getActiveSessionId(): Promise<string | null>;
  // S15P31E105-311 워치 batch. pendingBatches는 아직 W07 저장 확인이 없는 batch 이벤트의 JSON 배열.
  pendingBatches(): Promise<string>;
  commitBatch(batchId: string, acceptedCount: number): Promise<boolean>;
  failBatch(batchId: string, code: string): Promise<boolean>;
  // S15P31E105-464 폰 인계: 새 batch 수신을 멈추고 저장 확인이 없는 이 세션의 batch(JSON 배열)를 돌려준다.
  blockBatches(sessionId: string): Promise<string>;
  unblockBatches(sessionId: string): Promise<void>;
  isWatchConnected(): Promise<boolean>;
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

// 네이티브가 영속 저장한 워치 batch. 본문은 원문 문자열이고 ID는 문자열이다.
type NativeBatch = {
  type: 'BATCH_DATA';
  sessionId: string;
  batchId: string;
  deviceId: string;
  itemCount: number;
  body: string;
};

function toBatchEvent(raw: NativeBatch): WatchSessionEvent | null {
  if (typeof raw.body !== 'string' || typeof raw.batchId !== 'string') {
    return null;
  }
  return {
    type: 'BATCH_DATA',
    sessionId: String(raw.sessionId),
    batchId: raw.batchId,
    deviceId: String(raw.deviceId),
    itemCount: Number(raw.itemCount),
    body: raw.body,
  };
}

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

const COACHING_GUIDE_PATH = '/runway/v1/coaching/guide';

const isBpm = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 60 && value <= 220;

const nullableText = (value: unknown) => (typeof value === 'string' ? value : null);

// COACHING_GUIDE payload = S02 coaching 객체(9.3). ID는 숫자 토큰 그대로 넣는다.
function guideJson(guide: CoachingGuide) {
  return (
    `{"commandId":${idToken(guide.commandId)},"coachingId":${idToken(guide.coachingId)},` +
    `"expectedVersion":${JSON.stringify(guide.expectedVersion)},"targetBpm":${JSON.stringify(guide.targetBpm)},` +
    `"recommendedPaceSecPerKm":${JSON.stringify(guide.recommendedPaceSecPerKm)},` +
    `"expiresAt":${JSON.stringify(guide.expiresAt)}}`
  );
}

// STATE_RESULT comparison = S02 기록 비교 객체(sessions.md "기록 비교"). 알려진 필드만 옮긴다.
function comparisonJson(comparison: RecordComparison | null) {
  if (comparison === null) {
    return 'null';
  }
  return JSON.stringify({
    status: comparison.status,
    targetStartedAt: comparison.targetStartedAt,
    distanceM: comparison.distanceM,
    currentElapsedSec: comparison.currentElapsedSec,
    pastElapsedSec: comparison.pastElapsedSec,
  });
}

// STATE_RESULT의 pendingCommand·lastCommand는 S02 명령 객체 모양이다(9.3).
function commandJson(command: SessionCommand | null) {
  if (command === null) {
    return 'null';
  }
  return (
    `{"commandId":${idToken(command.commandId)},"action":${JSON.stringify(command.action)},` +
    `"targetBpm":${JSON.stringify(command.targetBpm ?? null)},` +
    `"expectedVersion":${JSON.stringify(command.expectedVersion)},` +
    `"coachingId":${idToken(command.coachingId ?? null)},"result":${JSON.stringify(command.result)},` +
    `"appliedAt":${JSON.stringify(command.appliedAt)},"reasonCode":${JSON.stringify(command.reasonCode)},` +
    `"coachingGuide":${command.coachingGuide ? guideJson(command.coachingGuide) : 'null'}}`
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
      if (payload.action === 'SET_BPM') {
        // 범위를 벗어난 박자는 서버에 보내지 않는다(P07 60~220).
        if (!isBpm(payload.targetBpm)) {
          return null;
        }
        return {
          type: 'COMMAND_REQUEST',
          sessionId: raw.sessionId,
          action: 'SET_BPM',
          expectedVersion: payload.expectedVersion as number,
          targetBpm: payload.targetBpm,
        };
      }
      return {
        type: 'COMMAND_REQUEST',
        sessionId: raw.sessionId,
        action: payload.action as 'PAUSE' | 'RESUME' | 'END' | 'CANCEL',
        expectedVersion: payload.expectedVersion as number,
      };
    case 'COACHING_RESULT':
      if (!['APPLIED', 'IGNORED', 'UNKNOWN'].includes(payload.result as string)) {
        return null;
      }
      return {
        type: 'COACHING_RESULT',
        sessionId: raw.sessionId,
        commandId: String(payload.commandId),
        coachingId:
          payload.coachingId === null || payload.coachingId === undefined
            ? null
            : String(payload.coachingId),
        result: payload.result as 'APPLIED' | 'IGNORED' | 'UNKNOWN',
        appliedAt: nullableText(payload.appliedAt),
        reasonCode: nullableText(payload.reasonCode),
      };
    case 'STATE_QUERY':
      if (payload.scope !== 'WATCH' && payload.scope !== 'SERVER') {
        return null;
      }
      return {
        type: 'STATE_QUERY',
        sessionId: raw.sessionId,
        scope: payload.scope,
        clientSendAt: nullableText(payload.clientSendAt),
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
  const handle = (input: NativeEvent | NativeBatch) => {
    if (input.type === 'BATCH_DATA') {
      // batch는 수신함이 아니라 네이티브 batch 저장소에 남는다. 리스너가 없으면 subscribe 때 다시 받는다.
      const batch = toBatchEvent(input as NativeBatch);
      if (batch) {
        listeners.forEach(listener => listener(batch));
      }
      return;
    }
    const raw = input as NativeEvent;
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
    if (event?.type === 'COMMAND_RESULT' || event?.type === 'COACHING_RESULT') {
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
      handle(JSON.parse(json) as NativeEvent | NativeBatch);
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

    prepare: (sessionId, { stateVersion, deviceId, goal }) =>
      new Promise(resolve => {
        // 워치 기기 ID가 없으면 batch 생산 기기를 정할 수 없어 보내지 않고 준비 실패로 답한다(9.3 SESSION_PREPARE).
        if (!/^[1-9]\d*$/.test(deviceId)) {
          resolve({ stateVersion, ready: false, reasonCode: 'DEVICE_ID_MISSING' });
          return;
        }
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
          `{"stateVersion":${stateVersion},"deviceId":${idToken(deviceId)},` +
            `"goal":${goalJson(goal)},"initialBpm":null}`,
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

    sendBpmCommand: (sessionId, approval) =>
      send(
        'command',
        'COMMAND_REQUEST',
        sessionId,
        `{"phase":"APPLY","action":"SET_BPM","expectedVersion":${approval.expectedVersion},` +
          `"targetBpm":${JSON.stringify(approval.targetBpm)},"commandId":${idToken(approval.commandId)},` +
          '"coachingId":null}',
      ),

    sendCoachingGuide: (sessionId, guide) =>
      send(COACHING_GUIDE_PATH, 'COACHING_GUIDE', sessionId, guideJson(guide)),

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

    commitBatch: async (batchId, acceptedCount) => {
      await native.commitBatch(batchId, acceptedCount);
    },
    failBatch: async (batchId, code) => {
      await native.failBatch(batchId, code);
    },
    blockBatches: async sessionId => {
      const raw = JSON.parse(await native.blockBatches(sessionId)) as NativeBatch[];
      return raw
        .map(toBatchEvent)
        .filter((event): event is Extract<WatchSessionEvent, { type: 'BATCH_DATA' }> =>
          event?.type === 'BATCH_DATA',
        );
    },
    unblockBatches: sessionId => native.unblockBatches(sessionId),
    isWatchConnected: () => native.isWatchConnected().catch(() => false),

    sendError: (sessionId, { code, retryable, failedType }) =>
      send('/runway/v1/error', 'ERROR', sessionId, JSON.stringify({ code, retryable, failedType })),

    // S02/S10 스냅샷을 그대로 옮긴다. 서버 시각이 없는 상태(취소 응답 등)는 null로 보낸다.
    sendServerState: (sessionId, session: RunningSessionView, clientSendAt = null) =>
      send(
        'state-result',
        'STATE_RESULT',
        sessionId,
        `{"scope":"SERVER","recordingMode":${JSON.stringify(session.recordingMode)},` +
          `"state":${JSON.stringify(session.state)},"stateVersion":${JSON.stringify(session.stateVersion)},` +
          `"currentBpm":${JSON.stringify(session.currentBpm ?? null)},` +
          `"pendingCommand":${commandJson(session.pendingCommand)},` +
          `"lastCommand":${commandJson(session.lastCommand)},"pendingBatchCount":0,` +
          `"clientSendAt":${JSON.stringify(clientSendAt)},` +
          `"serverReceiveAt":${JSON.stringify(session.serverReceiveAt ?? null)},` +
          `"serverSendAt":${JSON.stringify(session.serverSendAt ?? null)},` +
          // S02 기록 비교를 그대로 옮긴다(S15P31E105-422). 워치는 다시 계산하지 않는다.
          `"comparison":${comparisonJson(session.comparison ?? null)}}`,
      ),

    subscribe: listener => {
      listeners.add(listener);
      draining =
        draining ??
        native
          .drainInbox()
          .then(json => (JSON.parse(json) as NativeEvent[]).forEach(handle))
          .catch(() => undefined)
          // 앱이 없던 동안 저장만 되고 올리지 못한 워치 batch.
          .then(() => native.pendingBatches())
          .then(json => (JSON.parse(json ?? '[]') as NativeBatch[]).forEach(handle))
          .catch(() => undefined)
          .finally(() => {
            draining = null;
          });
      return () => {
        listeners.delete(listener);
      };
    },

    // Android 13+는 알림 권한이 있어야 "러닝 중" 알림이 보인다. 거절해도 서비스는 동작한다.
    setRunActive: async (active, sessionId, run) => {
      if (active && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).catch(
          () => undefined,
        );
      }
      await native.setRunActive(
        active,
        active ? sessionId ?? null : null,
        active && run?.location === true,
      );
    },
    getActiveSessionId: () => native.getActiveSessionId().catch(() => null),
  };
}
