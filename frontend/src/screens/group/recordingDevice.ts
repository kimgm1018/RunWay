import { DataError, type GroupRecordingDevice } from '../../data';

// 대기방의 기록 기기 기본값(S15P31E105-889). 워치가 등록돼 있고 지금 연결돼 있을 때만 워치, 아니면 폰이다.
// 연결 여부를 알 수 없으면(연결 확인 기능이 없는 환경) 등록만으로 워치를 고른다. 확인이 실패하면 미연결로 본다.
export function defaultRecordingDevice(
  watchLinked: boolean,
  watchConnected: boolean | null,
): GroupRecordingDevice {
  return watchLinked && watchConnected !== false ? 'WATCH' : 'PHONE';
}

// 이미 준비된 내 세션의 기록 모드를 대기방 선택으로 바꾼다. 모르면 null.
export function recordingDeviceOfMode(
  mode: 'WATCH' | 'PHONE_FALLBACK' | 'PHONE_ONLY' | null | undefined,
): GroupRecordingDevice | null {
  if (mode === 'PHONE_ONLY' || mode === 'PHONE_FALLBACK') {
    return 'PHONE';
  }
  return mode === 'WATCH' ? 'WATCH' : null;
}

// 준비 완료(G16) 실패를 대기방에 남겨 보일 문구(S15P31E105-889). 사라지는 토스트만으로는 실패를 놓쳤다.
export function readyErrorMessage(error: unknown): string {
  const code = error instanceof DataError ? error.code : null;
  if (code === 'ACTIVE_SESSION_EXISTS') {
    return '끝나지 않은 러닝 기록이 남아 있어 준비하지 못했어요. 러닝 화면에서 남은 기록을 끝내거나 취소한 뒤 다시 준비해 주세요.';
  }
  if (code === 'DEVICE_NOT_FOUND') {
    return '고른 기록 기기가 연결되어 있지 않아 준비하지 못했어요. 기록 기기를 폰으로 바꾸거나 워치를 연결한 뒤 다시 준비해 주세요.';
  }
  if (code === 'INVALID_SESSION_STATE') {
    return '이미 다른 기기로 준비돼 있어요. 준비를 취소한 뒤 기록 기기를 바꿔 다시 준비해 주세요.';
  }
  if (code === 'INVALID_GROUP_STATE') {
    return '그룹런이 이미 출발했거나 끝나서 준비 상태를 바꿀 수 없어요.';
  }
  return '준비 상태를 바꾸지 못했어요. 대기방 상태를 확인한 뒤 다시 시도해 주세요.';
}

// 지금 합류(G18) 실패 문구(S15P31E105-889).
export function joinErrorMessage(error: unknown): string {
  const code = error instanceof DataError ? error.code : null;
  if (code === 'INVALID_GROUP_STATE') {
    return '그룹런이 끝났거나 아직 출발 전이라 합류할 수 없어요.';
  }
  if (code === 'INVALID_SESSION_STATE') {
    return '내 기록이 이미 시작돼 있어요. 진행 화면에서 확인해 주세요.';
  }
  if (code === 'ACTIVE_SESSION_EXISTS' || code === 'DEVICE_NOT_FOUND') {
    return readyErrorMessage(error);
  }
  return '합류하지 못했어요. 잠시 후 다시 눌러 주세요.';
}

// 출발한 그룹런에서 내 기록이 시작되지 못한 사유(S15P31E105-889). 그룹 START는 그룹장의 출발(G09)·지금 합류(G18)로만
// 생기므로 이 상태면 그룹은 이미 출발했다.
// - watchFailed: 워치가 START 결과를 돌려주지 않았다(전송 실패·시간 초과). 다시 시도하거나 폰으로 시작한다.
// - rejected: 기기가 시작을 거절했다. 폰으로 시작한다.
// - retry: 기기는 결과를 냈지만 서버 저장을 확인하지 못했다(또는 폰 기록). 기기가 이미 시작했을 수 있어 같은 결과를 다시
//   보고만 한다. 다른 기기로 새로 시작하지 않는다.
// - location: 폰으로 기록하려면 위치 권한이 필요하다. 허용한 뒤 다시 시도한다.
export type GroupStartIssue = 'watchFailed' | 'rejected' | 'retry' | 'location';

export function groupStartIssue(
  status: string | null | undefined,
  problem:
    | { kind: string; action?: string | null; afterResult?: boolean }
    | null
    | undefined,
  recordingMode: string | null | undefined,
): GroupStartIssue | null {
  if (status !== 'READY' || !problem) {
    return null;
  }
  if (problem.kind === 'locationRequired') {
    return recordingMode === 'PHONE_ONLY' ? 'location' : null;
  }
  if (problem.action !== 'START') {
    return null;
  }
  if (problem.kind === 'rejected') {
    return 'rejected';
  }
  if (problem.kind !== 'unconfirmed') {
    return null;
  }
  return problem.afterResult || recordingMode !== 'WATCH'
    ? 'retry'
    : 'watchFailed';
}
