import { DataError } from '../errors';
import type {
  CommandApproval,
  CommandReport,
  ControlAction,
  Repositories,
  RunningSessionView,
  SessionCommand,
  SessionStatus,
} from '../types';

// docs/design/api/sessions.md 세션 제어 공통 계약을 흉내 내는 메모리 서버. 화면·runControl을 서버 없이 검증하기 위한 것이며
// 그룹·코스·소유권·잠금은 다루지 않는다.

type Options = {
  latencyMs?: number;
  // 첫 RESULT 보고는 서버에 저장한 뒤 응답을 잃은 것처럼 NETWORK로 실패한다.
  resultResponseLost?: boolean;
  // 처음 세 번의 RESULT 보고는 저장하지 못하고 NETWORK로 실패한다(재시도 소진).
  resultDownTimes?: number;
};

type StoredCommand = SessionCommand & { action: ControlAction; deviceId: string };

type StoredSession = {
  view: Omit<RunningSessionView, 'pendingCommand' | 'lastCommand'>;
  commands: StoredCommand[];
};

const ACTIVE: SessionStatus[] = ['READY', 'RUNNING', 'PAUSED'];

const APPROVABLE: Record<ControlAction, SessionStatus[]> = {
  START: ['READY'],
  PAUSE: ['RUNNING'],
  RESUME: ['PAUSED'],
  END: ['RUNNING', 'PAUSED'],
};

const APPLIED_STATE: Record<ControlAction, SessionStatus> = {
  START: 'RUNNING',
  PAUSE: 'PAUSED',
  RESUME: 'RUNNING',
  END: 'COMPLETED',
};

function isConfirmed(command: SessionCommand) {
  return command.result === 'APPLIED' || command.result === 'REJECTED' || command.result === 'IGNORED';
}

function unconfirmed(command: SessionCommand) {
  return command.result === 'PENDING' || command.result === 'UNKNOWN';
}

function strip({ deviceId: _device, ...command }: StoredCommand): SessionCommand {
  return { ...command };
}

export function createMockSession(options: Options = {}): Repositories['session'] {
  const sessions = new Map<string, StoredSession>();
  let nextSessionId = 1;
  let nextCommandId = 501;
  let resultLost = options.resultResponseLost === true;
  let resultDown = options.resultDownTimes ?? 0;

  const later = <T>(work: () => T) =>
    new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(work());
        } catch (error) {
          reject(error);
        }
      }, options.latencyMs ?? 0);
    });

  const find = (sessionId: string) => {
    const stored = sessions.get(sessionId);
    if (!stored) {
      throw new DataError('SESSION_NOT_FOUND', '러닝 세션을 찾을 수 없습니다.');
    }
    return stored;
  };

  const pendingOf = (stored: StoredSession) =>
    stored.commands.find(
      command => command.deviceId === stored.view.controlDeviceId && unconfirmed(command),
    ) ?? null;

  const view = (stored: StoredSession): RunningSessionView => {
    const pending = stored.view.state === 'INTERRUPTED' ? null : pendingOf(stored);
    const last = stored.commands[stored.commands.length - 1] ?? null;
    return {
      ...stored.view,
      pendingCommand: pending ? strip(pending) : null,
      lastCommand: last ? strip(last) : null,
    };
  };

  const approval = (command: StoredCommand): CommandApproval => ({
    commandId: command.commandId,
    action: command.action,
    expectedVersion: command.expectedVersion,
    result: command.result,
  });

  const bump = (stored: StoredSession) => {
    stored.view.stateVersion += 1;
  };

  return {
    create: ({ controlDeviceId, relayDeviceId }) =>
      later(() => {
        for (const [id, stored] of sessions) {
          if (ACTIVE.includes(stored.view.state)) {
            throw new DataError('ACTIVE_SESSION_EXISTS', '진행 중인 러닝 세션이 있습니다.', null, 409, {
              sessionId: id,
            });
          }
        }
        const sessionId = String(nextSessionId++);
        const stored: StoredSession = {
          view: {
            sessionId,
            controlDeviceId,
            relayDeviceId,
            state: 'READY',
            stateVersion: 1,
            startedAt: null,
            endedAt: null,
            recordingMode: 'WATCH',
            analysisStatus: 'PENDING',
          },
          commands: [],
        };
        sessions.set(sessionId, stored);
        return view(stored);
      }),

    get: sessionId => later(() => view(find(sessionId))),

    reportPrepared: (sessionId, { deviceId, expectedVersion }) =>
      later(() => {
        const stored = find(sessionId);
        if (deviceId !== stored.view.controlDeviceId) {
          throw new DataError('DEVICE_FORBIDDEN', '본인 등록 기기가 아닙니다.');
        }
        if (stored.view.state !== 'READY') {
          throw new DataError('INVALID_SESSION_STATE', '현재 세션 상태에서 처리할 수 없습니다.');
        }
        if (expectedVersion !== stored.view.stateVersion) {
          throw new DataError('STALE_STATE', '세션 상태가 변경되었습니다.');
        }
      }),

    // 슬롯 → 기기 → 끝난 세션 → 버전 → 허용 상태 → 미확정 명령 순서(백엔드와 같다).
    requestControl: (sessionId, action, { deviceId, expectedVersion }) =>
      later(() => {
        const stored = find(sessionId);
        const slot = stored.commands.find(command => command.expectedVersion === expectedVersion);
        if (slot) {
          if (slot.deviceId !== deviceId || slot.action !== action) {
            throw new DataError('COMMAND_CONFLICT', '같은 제어 요청에 다른 내용이 이미 처리되었습니다.');
          }
          return approval(slot);
        }
        if (deviceId !== stored.view.controlDeviceId) {
          throw new DataError('DEVICE_FORBIDDEN', '본인 등록 기기가 아닙니다.');
        }
        if (!ACTIVE.includes(stored.view.state)) {
          throw new DataError('INVALID_SESSION_STATE', '현재 세션 상태에서 처리할 수 없습니다.');
        }
        if (expectedVersion !== stored.view.stateVersion) {
          throw new DataError('STALE_STATE', '세션 상태가 변경되었습니다.');
        }
        if (!APPROVABLE[action].includes(stored.view.state)) {
          throw new DataError('INVALID_SESSION_STATE', '현재 세션 상태에서 처리할 수 없습니다.');
        }
        if (pendingOf(stored)) {
          throw new DataError('COMMAND_PENDING', '처리 중인 제어 명령이 있습니다.');
        }
        const command: StoredCommand = {
          commandId: String(nextCommandId++),
          action,
          deviceId,
          expectedVersion,
          result: 'PENDING',
          appliedAt: null,
          reasonCode: null,
        };
        stored.commands.push(command);
        return approval(command);
      }),

    reportResult: (sessionId, action, report: CommandReport) =>
      later(() => {
        if (resultDown > 0) {
          resultDown -= 1;
          throw new DataError('NETWORK_ERROR', '응답을 받지 못했습니다.');
        }
        const stored = find(sessionId);
        const command = stored.commands.find(
          item => item.commandId === report.commandId && item.action === action,
        );
        if (!command) {
          throw new DataError('COMMAND_NOT_FOUND', '제어 명령을 찾을 수 없습니다.');
        }
        if (command.deviceId !== report.deviceId) {
          throw new DataError('DEVICE_FORBIDDEN', '본인 등록 기기가 아닙니다.');
        }
        const same =
          command.result === report.result &&
          command.appliedAt === report.appliedAt &&
          command.reasonCode === report.reasonCode;
        const respond = () => ({
          commandId: command.commandId,
          result: command.result,
          session: view(stored),
        });
        if (isConfirmed(command)) {
          if (same || report.result === 'UNKNOWN') {
            return respond();
          }
          throw new DataError('COMMAND_CONFLICT', '같은 명령에 다른 결과가 이미 저장되었습니다.');
        }
        if (stored.view.state === 'INTERRUPTED') {
          throw new DataError('INVALID_SESSION_STATE', '현재 세션 상태에서 처리할 수 없습니다.');
        }
        if (report.result === 'APPLIED') {
          const appliedAt = report.appliedAt as string;
          if (
            action === 'END' &&
            stored.view.startedAt !== null &&
            Date.parse(appliedAt) <= Date.parse(stored.view.startedAt)
          ) {
            throw new DataError('VALIDATION_ERROR', '실제 종료시각은 실제 시작시각보다 늦어야 합니다.');
          }
          if (action === 'END' && report.uploadComplete !== true) {
            throw new DataError('UPLOAD_PENDING', '마지막 기록의 저장을 확인하지 못했습니다.');
          }
          Object.assign(command, { result: 'APPLIED', appliedAt, reasonCode: report.reasonCode });
          stored.view.state = APPLIED_STATE[action];
          if (action === 'START') {
            stored.view.startedAt = appliedAt;
          }
          if (action === 'END') {
            stored.view.endedAt = appliedAt;
          }
          bump(stored);
        } else if (report.result === 'REJECTED') {
          Object.assign(command, { result: 'REJECTED', appliedAt: null, reasonCode: report.reasonCode });
          bump(stored);
        } else {
          Object.assign(command, { result: 'UNKNOWN', appliedAt: null, reasonCode: report.reasonCode });
        }
        if (resultLost) {
          resultLost = false;
          throw new DataError('NETWORK_ERROR', '응답을 받지 못했습니다.');
        }
        return respond();
      }),

    cancel: sessionId =>
      later(() => {
        const stored = find(sessionId);
        const pending = pendingOf(stored);
        if (pending?.action === 'START') {
          throw new DataError('COMMAND_PENDING', '처리 중인 제어 명령이 있습니다.');
        }
        if (stored.view.state !== 'CANCELLED') {
          if (stored.view.state !== 'READY') {
            throw new DataError('INVALID_STATE', '현재 상태에서는 취소할 수 없습니다.');
          }
          stored.view.state = 'CANCELLED';
          bump(stored);
        }
        return { id: sessionId, status: stored.view.state };
      }),

    abortUnconfirmedStart: (sessionId, { expectedVersion }) =>
      later(() => {
        const stored = find(sessionId);
        if (stored.view.state === 'INTERRUPTED') {
          return view(stored);
        }
        const pending = pendingOf(stored);
        if (stored.view.state !== 'READY' || pending?.action !== 'START') {
          throw new DataError('INVALID_SESSION_STATE', '현재 세션 상태에서 처리할 수 없습니다.');
        }
        if (expectedVersion !== stored.view.stateVersion) {
          throw new DataError('STALE_STATE', '세션 상태가 변경되었습니다.');
        }
        if (pending.result === 'PENDING') {
          Object.assign(pending, { result: 'UNKNOWN', reasonCode: 'START_UNCONFIRMED_ABORTED' });
        }
        stored.view.state = 'INTERRUPTED';
        stored.view.analysisStatus = 'FAILED';
        bump(stored);
        return view(stored);
      }),

    // W07 목업: 받은 batch를 그대로 저장 확인한다. 본문의 id·items 개수만 읽는다.
    uploadBatch: body =>
      later(() => {
        const parsed = JSON.parse(body) as { id: string; items: unknown[] };
        return { status: 'COMMITTED', batchId: parsed.id, acceptedCount: parsed.items.length };
      }),
  };
}
