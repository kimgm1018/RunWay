import type {
  CommandApproval,
  ControlAction,
  ControlResultCode,
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

type ServerCommand = {
  commandId: number;
  action: string;
  expectedVersion: number;
  result: ControlResultCode;
  appliedAt: string | null;
  reasonCode: string | null;
};

type ServerSession = {
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
};

const id = (value: string) => Number(value);
const text = (value: number | null) => (value === null ? null : String(value));

function command(value: ServerCommand | null): SessionCommand | null {
  return value === null
    ? null
    : {
        commandId: String(value.commandId),
        action: value.action,
        expectedVersion: value.expectedVersion,
        result: value.result,
        appliedAt: value.appliedAt,
        reasonCode: value.reasonCode,
      };
}

function sessionView(value: ServerSession): RunningSessionView {
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
  };
}

export function createApiSessionRepository(request: ApiRequest): Repositories['session'] {
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
