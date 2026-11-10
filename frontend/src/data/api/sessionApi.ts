import type {
  BpmApproval,
  CoachingGuide,
  CoachingLevel,
  CommandApproval,
  ControlAction,
  ControlResultCode,
  RecordComparison,
  Repositories,
  RunningSessionView,
  SessionCommand,
  SessionStatus,
} from '../types';
import type { ApiRequest } from './request';

// S01·S02·S03~S07·S08 (docs/design/api/sessions.md). 앱 안에서는 ID를 문자열로, 서버에는 숫자로 보낸다.
// dataSource='api'(S15P31E105-299) 전에는 앱에 연결하지 않는다.

// appConfig.apiBaseUrl이 /api/v1까지 포함한다(S15P31E105-299 http.ts).
const BASE = '/running-sessions';

const ACTION_PATH: Record<ControlAction, string> = {
  START: 'start',
  PAUSE: 'pause',
  RESUME: 'resume',
  END: 'finish',
};

type ServerGuide = {
  commandId: number;
  coachingId: number;
  expectedVersion: number;
  targetBpm: number;
  recommendedPaceSecPerKm: number;
  expiresAt: string;
  coachingLevel?: string | null;
};

// 알 수 없는 단계는 없는 것(null)으로 본다. 음성 안내는 null을 OK로 읽는다(S15P31E105-579).
const LEVELS: readonly CoachingLevel[] = ['OK', 'CAUTION', 'DANGER'];
const level = (value: string | null | undefined): CoachingLevel | null =>
  LEVELS.includes(value as CoachingLevel) ? (value as CoachingLevel) : null;

type ServerCommand = {
  commandId: number;
  action: string;
  expectedVersion: number;
  result: ControlResultCode;
  appliedAt: string | null;
  reasonCode: string | null;
  targetBpm?: number | null;
  coachingId?: number | null;
  coachingGuide?: ServerGuide | null;
};

export type ServerSession = {
  sessionId: number;
  controlDeviceId: number | null;
  relayDeviceId: number | null;
  state: SessionStatus;
  stateVersion: number;
  startedAt: string | null;
  endedAt: string | null;
  recordingMode: 'WATCH' | 'PHONE_FALLBACK' | null;
  pendingCommand: ServerCommand | null;
  lastCommand: ServerCommand | null;
  analysis: { status: string };
  // S15P31E105-257. 이전 응답에는 없을 수 있어 선택으로 둔다.
  currentBpm?: number | null;
  coaching?: ServerGuide | null;
  // S15P31E105-422. 이전 응답에는 없을 수 있어 선택으로 둔다.
  comparison?: RecordComparison | null;
  serverReceiveAt?: string | null;
  serverSendAt?: string | null;
  // S15P31E105-420에서 읽는다. 이전 응답에는 없을 수 있어 선택으로 둔다.
  groupEndedAt?: string | null;
  // S15P31E105-643. 이전 응답에는 없을 수 있어 선택으로 둔다.
  movingDurationSec?: number | null;
};

const id = (value: string) => Number(value);
const text = (value: number | null) => (value === null ? null : String(value));

function guide(value: ServerGuide | null | undefined): CoachingGuide | null {
  return value === null || value === undefined
    ? null
    : {
        commandId: String(value.commandId),
        coachingId: String(value.coachingId),
        expectedVersion: value.expectedVersion,
        targetBpm: value.targetBpm,
        recommendedPaceSecPerKm: value.recommendedPaceSecPerKm,
        expiresAt: value.expiresAt,
        coachingLevel: level(value.coachingLevel),
      };
}

function command(value: ServerCommand | null | undefined): SessionCommand | null {
  return value === null || value === undefined
    ? null
    : {
        commandId: String(value.commandId),
        action: value.action,
        expectedVersion: value.expectedVersion,
        result: value.result,
        appliedAt: value.appliedAt,
        reasonCode: value.reasonCode,
        targetBpm: value.targetBpm ?? null,
        coachingId: value.coachingId === null || value.coachingId === undefined ? null : String(value.coachingId),
        coachingGuide: guide(value.coachingGuide),
      };
}

// S02 응답과 S10 스냅샷(data)을 앱 모양으로 바꾼다.
export function sessionView(value: ServerSession): RunningSessionView {
  return {
    sessionId: String(value.sessionId),
    controlDeviceId: text(value.controlDeviceId),
    relayDeviceId: text(value.relayDeviceId),
    state: value.state,
    stateVersion: value.stateVersion,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    recordingMode: value.recordingMode,
    pendingCommand: command(value.pendingCommand),
    lastCommand: command(value.lastCommand),
    analysisStatus: value.analysis.status,
    currentBpm: value.currentBpm ?? null,
    coaching: guide(value.coaching),
    comparison: value.comparison ?? null,
    serverReceiveAt: value.serverReceiveAt ?? null,
    serverSendAt: value.serverSendAt ?? null,
    groupEndedAt: value.groupEndedAt ?? null,
    movingDurationSec:
      typeof value.movingDurationSec === 'number' &&
      Number.isFinite(value.movingDurationSec) &&
      value.movingDurationSec >= 0
        ? value.movingDurationSec
        : null,
  };
}

// W07 업로드(uploadBatch)는 본문 원문을 보내야 해서 syncBatches.ts가, S10 구독은 sessionEvents.ts가 맡는다.
export function createApiSessionRepository(
  request: ApiRequest,
): Omit<Repositories['session'], 'uploadBatch' | 'subscribeEvents'> {
  return {
    create: async ({ controlDeviceId, relayDeviceId, goal }) =>
      sessionView(
        await request<ServerSession>('POST', BASE, {
          controlDeviceId: id(controlDeviceId),
          relayDeviceId: id(relayDeviceId),
          courseId: goal.courseId === null ? null : id(goal.courseId),
          comparisonSessionId:
            goal.comparisonSessionId === null ? null : id(goal.comparisonSessionId),
          targetDistanceM: goal.targetDistanceM,
          targetDurationSec: goal.targetDurationSec,
          targetPaceSecPerKm: goal.targetPaceSecPerKm,
        }),
      ),

    get: async sessionId => sessionView(await request<ServerSession>('GET', `${BASE}/${sessionId}`)),

    // ready는 필수, reasonCode는 값이 없어도 키를 보낸다(S08 REPORT_PREPARED).
    reportPrepared: async (sessionId, { deviceId, expectedVersion, ready, reasonCode }) => {
      await request('PATCH', `${BASE}/${sessionId}`, {
        operation: 'REPORT_PREPARED',
        deviceId: id(deviceId),
        expectedVersion,
        ready,
        reasonCode,
      });
    },

    requestControl: async (sessionId, action, { deviceId, expectedVersion }) => {
      const approval = await request<{
        commandId: number;
        action: ControlAction;
        expectedVersion: number;
        result: ControlResultCode;
      }>('POST', `${BASE}/${sessionId}/${ACTION_PATH[action]}`, {
        phase: 'REQUEST',
        deviceId: id(deviceId),
        expectedVersion,
      });
      const result: CommandApproval = {
        commandId: String(approval.commandId),
        action: approval.action,
        expectedVersion: approval.expectedVersion,
        result: approval.result,
      };
      return result;
    },

    // RESULT의 appliedAt·reasonCode는 값이 없어도 키를 보낸다. uploadComplete는 종료(END)에서만 보낸다.
    reportResult: async (sessionId, action, report) => {
      const saved = await request<ServerSession & { commandId: number; result: ControlResultCode }>(
        'POST',
        `${BASE}/${sessionId}/${ACTION_PATH[action]}`,
        {
          phase: 'RESULT',
          commandId: id(report.commandId),
          deviceId: id(report.deviceId),
          result: report.result,
          appliedAt: report.appliedAt,
          reasonCode: report.reasonCode,
          ...(action === 'END' && report.uploadComplete !== undefined
            ? { uploadComplete: report.uploadComplete }
            : {}),
        },
      );
      return {
        commandId: String(saved.commandId),
        result: saved.result,
        session: sessionView(saved),
      };
    },

    cancel: async sessionId => {
      const cancelled = await request<{ id: number; status: SessionStatus }>(
        'POST',
        `${BASE}/${sessionId}/cancel`,
      );
      return { id: String(cancelled.id), status: cancelled.status };
    },

    // P07 REQUEST. 앱은 SET_BPM만 요청하며 coachingId 키는 null로 보낸다(pace-coaching.md).
    requestBpm: async (sessionId, { deviceId, expectedVersion, targetBpm }) => {
      const approval = await request<{
        commandId: number;
        action: BpmApproval['action'];
        expectedVersion: number;
        targetBpm: number;
        coachingId: number | null;
        result: ControlResultCode;
      }>('PUT', `${BASE}/${sessionId}/bpm`, {
        phase: 'REQUEST',
        operation: 'SET_BPM',
        deviceId: id(deviceId),
        expectedVersion,
        targetBpm,
        coachingId: null,
      });
      return {
        commandId: String(approval.commandId),
        action: approval.action,
        expectedVersion: approval.expectedVersion,
        targetBpm: approval.targetBpm,
        coachingId: approval.coachingId === null ? null : String(approval.coachingId),
        result: approval.result,
      };
    },

    // P07 RESULT. SET_BPM과 서버가 승인한 COACHING 명령 모두 같은 본문이다. appliedAt·reasonCode 키는 null이어도 보낸다.
    reportBpmResult: async (sessionId, report) => {
      const saved = await request<ServerSession & { commandId: number; result: ControlResultCode }>(
        'PUT',
        `${BASE}/${sessionId}/bpm`,
        {
          phase: 'RESULT',
          commandId: id(report.commandId),
          deviceId: id(report.deviceId),
          result: report.result,
          appliedAt: report.appliedAt,
          reasonCode: report.reasonCode,
        },
      );
      return {
        commandId: String(saved.commandId),
        result: saved.result,
        session: sessionView(saved),
      };
    },

    // S08 TAKE_OVER_PHONE(S15P31E105-464). 호출 쪽이 폰이 받은 워치 batch 전체의 COMMITTED를 확인한 뒤에만 부른다.
    takeOverPhone: async (sessionId, { deviceId, expectedVersion }) =>
      sessionView(
        await request<ServerSession>('PATCH', `${BASE}/${sessionId}`, {
          operation: 'TAKE_OVER_PHONE',
          deviceId: id(deviceId),
          expectedVersion,
          receivedWatchBatchesUploaded: true,
        }),
      ),

    abortUnconfirmedStart: async (sessionId, { deviceId, expectedVersion }) =>
      sessionView(
        await request<ServerSession>('PATCH', `${BASE}/${sessionId}`, {
          operation: 'ABORT_UNCONFIRMED_START',
          deviceId: id(deviceId),
          expectedVersion,
        }),
      ),
  };
}
