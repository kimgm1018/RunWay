import { AppState, type AppStateStatus } from 'react-native';

import {
  NOTIFICATION_REFRESH_MS,
  newerId,
  newestNotificationId,
  startNotificationRefresh,
} from '../notificationRefresh';

// S15P31E105-801: 2.1 reads the inbox again on return to the app and every minute while it stays in the
// foreground; 2.9 sends the newest id it loaded when leaving. Values are synthetic.

let listeners: ((state: AppStateStatus) => void)[] = [];
let removed = 0;
function setState(state: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
  listeners.forEach(listener => listener(state));
}

beforeEach(() => {
  jest.useFakeTimers();
  listeners = [];
  removed = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: AppStateStatus) => void,
  ) => {
    listeners.push(listener);
    return { remove: () => (removed += 1) };
  }) as never);
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('AC-8 reads again every 60 s while the app stays in the foreground', () => {
  const refresh = jest.fn();
  const stop = startNotificationRefresh(refresh);
  expect(NOTIFICATION_REFRESH_MS).toBe(60_000);
  jest.advanceTimersByTime(59_999);
  expect(refresh).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
});

test('AC-7·8 reads nothing in the background and reads at once on return to the app', () => {
  const refresh = jest.fn();
  const stop = startNotificationRefresh(refresh);
  setState('background');
  jest.advanceTimersByTime(5 * 60_000);
  expect(refresh).not.toHaveBeenCalled();
  setState('active');
  expect(refresh).toHaveBeenCalledTimes(1);
  // the minute starts again from the return, so it does not fire twice right away
  jest.advanceTimersByTime(59_999);
  expect(refresh).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
});

test('AC-8 inactive (a system sheet) pauses too, and an active→active change does not read again', () => {
  const refresh = jest.fn();
  const stop = startNotificationRefresh(refresh);
  setState('active');
  expect(refresh).not.toHaveBeenCalled();
  setState('inactive');
  jest.advanceTimersByTime(120_000);
  expect(refresh).not.toHaveBeenCalled();
  setState('active');
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
});

test('AC-8 stopping (2.1 loses focus) clears the timer and the listener', () => {
  const refresh = jest.fn();
  const stop = startNotificationRefresh(refresh);
  stop();
  expect(removed).toBe(1);
  jest.advanceTimersByTime(10 * 60_000);
  expect(refresh).not.toHaveBeenCalled();
});

test('starting while the app is in the background waits for the return', () => {
  Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
  const refresh = jest.fn();
  const stop = startNotificationRefresh(refresh);
  jest.advanceTimersByTime(120_000);
  expect(refresh).not.toHaveBeenCalled();
  setState('active');
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
});

test('AC-9 the newest loaded id is the largest numeric one, not the first', () => {
  expect(newestNotificationId([{ id: '3' }, { id: '7' }, { id: '5' }])).toBe(7);
  expect(newestNotificationId([{ id: '9007199254740993' }, { id: '12' }])).toBe(12);
  expect(newestNotificationId([])).toBeUndefined();
  expect(newestNotificationId(null)).toBeUndefined();
  // mock rows have no numeric id: the caller keeps the old mark-everything call
  expect(newestNotificationId([{ id: 'noti-1' }, { id: 'noti-2' }])).toBeUndefined();
});

test('pages loaded later never lower the newest id', () => {
  expect(newerId(undefined, undefined)).toBeUndefined();
  expect(newerId(9, undefined)).toBe(9);
  expect(newerId(undefined, 4)).toBe(4);
  expect(newerId(9, 4)).toBe(9);
  expect(newerId(4, 9)).toBe(9);
});
