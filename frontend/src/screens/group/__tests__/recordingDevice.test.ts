import { DataError } from '../../../data';
import {
  defaultRecordingDevice,
  groupStartIssue,
  joinErrorMessage,
  readyErrorMessage,
  recordingDeviceOfMode,
} from '../recordingDevice';

// S15P31E105-889: 대기방 기록 기기 기본값과 준비 실패 문구.
describe('defaultRecordingDevice', () => {
  test('a registered and connected watch records', () => {
    expect(defaultRecordingDevice(true, true)).toBe('WATCH');
  });

  test('a registered but disconnected watch falls back to the phone', () => {
    expect(defaultRecordingDevice(true, false)).toBe('PHONE');
  });

  test('no registered watch records with the phone', () => {
    expect(defaultRecordingDevice(false, true)).toBe('PHONE');
    expect(defaultRecordingDevice(false, null)).toBe('PHONE');
  });

  test('an unknown connection keeps the registered watch', () => {
    expect(defaultRecordingDevice(true, null)).toBe('WATCH');
  });
});

test('recordingDeviceOfMode maps the session mode', () => {
  expect(recordingDeviceOfMode('PHONE_ONLY')).toBe('PHONE');
  expect(recordingDeviceOfMode('PHONE_FALLBACK')).toBe('PHONE');
  expect(recordingDeviceOfMode('WATCH')).toBe('WATCH');
  expect(recordingDeviceOfMode(null)).toBeNull();
});

describe('readyErrorMessage', () => {
  test('a leftover active session says what to do', () => {
    const error = new DataError('ACTIVE_SESSION_EXISTS', 'x', null, 409, {
      sessionId: 596,
    });
    expect(readyErrorMessage(error)).toContain('끝나지 않은 러닝 기록');
  });

  test('a missing device suggests the phone', () => {
    const error = new DataError('DEVICE_NOT_FOUND', 'x', null, 404);
    expect(readyErrorMessage(error)).toContain('폰으로 바꾸');
  });

  test('a device mismatch asks to cancel first', () => {
    const error = new DataError('INVALID_SESSION_STATE', 'x', null, 409);
    expect(readyErrorMessage(error)).toContain('준비를 취소한 뒤');
  });

  test('anything else gets the general message', () => {
    expect(readyErrorMessage(new Error('boom'))).toContain(
      '준비 상태를 바꾸지 못했어요',
    );
  });
});

// S15P31E105-889 2단계: 출발한 그룹런의 시작 실패 판정과 지금 합류(G18) 실패 문구.
describe('groupStartIssue', () => {
  test('a watch that never answered START can retry or switch to the phone', () => {
    expect(groupStartIssue('READY', { kind: 'unconfirmed', action: 'START' }, 'WATCH')).toBe('watchFailed');
  });

  test('a START the device answered but the server did not confirm is only retried (no second device)', () => {
    // B-1: 워치가 실제로 시작했을 수 있다. 폰으로 새로 시작하면 워치 기록을 버리게 된다.
    expect(
      groupStartIssue('READY', { kind: 'unconfirmed', action: 'START', afterResult: true }, 'WATCH'),
    ).toBe('retry');
    expect(groupStartIssue('READY', { kind: 'unconfirmed', action: 'START' }, 'PHONE_ONLY')).toBe('retry');
  });

  test('a rejected START switches to the phone', () => {
    expect(groupStartIssue('READY', { kind: 'rejected', action: 'START' }, 'WATCH')).toBe('rejected');
  });

  test('a phone start without location permission asks again', () => {
    expect(groupStartIssue('READY', { kind: 'locationRequired' }, 'PHONE_ONLY')).toBe('location');
    expect(groupStartIssue('READY', { kind: 'locationRequired' }, 'WATCH')).toBeNull();
  });

  test('other problems or a started session are not start issues', () => {
    expect(groupStartIssue('READY', { kind: 'watchNotReady' }, 'WATCH')).toBeNull();
    expect(groupStartIssue('READY', { kind: 'unconfirmed', action: 'END' }, 'WATCH')).toBeNull();
    expect(groupStartIssue('RUNNING', { kind: 'unconfirmed', action: 'START' }, 'WATCH')).toBeNull();
    expect(groupStartIssue('READY', null, 'WATCH')).toBeNull();
  });
});

describe('joinErrorMessage', () => {
  test('an ended or not yet started group cannot be joined', () => {
    const error = new DataError('INVALID_GROUP_STATE', 'x', null, 409);
    expect(joinErrorMessage(error)).toContain('합류할 수 없어요');
  });

  test('an already started record points to the progress screen', () => {
    const error = new DataError('INVALID_SESSION_STATE', 'x', null, 409);
    expect(joinErrorMessage(error)).toContain('진행 화면');
  });

  test('a leftover session says the same as getting ready', () => {
    const error = new DataError('ACTIVE_SESSION_EXISTS', 'x', null, 409);
    expect(joinErrorMessage(error)).toContain('끝나지 않은 러닝 기록');
  });

  test('anything else asks to press again', () => {
    expect(joinErrorMessage(new Error('x'))).toContain('다시 눌러');
  });
});
