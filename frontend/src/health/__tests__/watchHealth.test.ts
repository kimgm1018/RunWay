import { NativeModules } from 'react-native';

const native = {
  setHealthConsent: jest.fn(),
  republishConsent: jest.fn(),
  getDailyHr: jest.fn(),
  markUploaded: jest.fn(),
  markRejected: jest.fn(),
};

function load() {
  // The module reads NativeModules per call, so no module reset is needed.
  return require('../watchHealth.android') as typeof import('../watchHealth.android');
}

beforeEach(() => {
  Object.values(native).forEach(fn =>
    fn.mockReset().mockResolvedValue(undefined),
  );
  (NativeModules as Record<string, unknown>).WatchHealth = native;
});

afterAll(() => {
  delete (NativeModules as Record<string, unknown>).WatchHealth;
});

test('setWatchHealthConsent forwards the choice to the native module', async () => {
  await load().setWatchHealthConsent('AGREEE');
  expect(native.setHealthConsent).toHaveBeenCalledWith('AGREEE');
});

test('refresh sets the server value when the reader returns one', async () => {
  await load().refreshWatchHealthConsent(async () => 'DISAGREE');
  expect(native.setHealthConsent).toHaveBeenCalledWith('DISAGREE');
  expect(native.republishConsent).not.toHaveBeenCalled();
});

test('refresh republishes when the reader returns null or is absent', async () => {
  const { refreshWatchHealthConsent } = load();
  await refreshWatchHealthConsent(async () => null);
  await refreshWatchHealthConsent();
  expect(native.republishConsent).toHaveBeenCalledTimes(2);
  expect(native.setHealthConsent).not.toHaveBeenCalled();
});

test('refresh republishes when the server reader fails', async () => {
  await load().refreshWatchHealthConsent(async () => {
    throw new Error('offline');
  });
  expect(native.republishConsent).toHaveBeenCalledTimes(1);
});

test('read and mark pass through to the native module', async () => {
  const row = {
    metricDate: '2026-10-29',
    revision: 1,
    estimatedRestingHrBpm: 58,
    method: 'ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2',
    validSampleCount: 12,
    computedAt: '2026-10-30T00:00:00Z',
    uploaded: false,
    rejected: false,
  };
  native.getDailyHr.mockResolvedValue([row]);
  const {
    readWatchDailyHr,
    markWatchDailyHrUploaded,
    markWatchDailyHrRejected,
  } = load();
  await expect(readWatchDailyHr()).resolves.toEqual([row]);
  await markWatchDailyHrUploaded('2026-10-29', 1);
  expect(native.markUploaded).toHaveBeenCalledWith('2026-10-29', 1);
  await markWatchDailyHrRejected('2026-10-29', 1);
  expect(native.markRejected).toHaveBeenCalledWith('2026-10-29', 1);
});

test('a missing native module is a silent no-op', async () => {
  delete (NativeModules as Record<string, unknown>).WatchHealth;
  const m = load();
  await expect(m.setWatchHealthConsent('AGREEE')).resolves.toBeUndefined();
  await expect(m.refreshWatchHealthConsent()).resolves.toBeUndefined();
  await expect(m.readWatchDailyHr()).resolves.toEqual([]);
  await expect(
    m.markWatchDailyHrUploaded('2026-10-29', 1),
  ).resolves.toBeUndefined();
  await expect(
    m.markWatchDailyHrRejected('2026-10-29', 1),
  ).resolves.toBeUndefined();
});

test('rejecting native calls never throw', async () => {
  const err = { code: 'WATCH_UNAVAILABLE' };
  Object.values(native).forEach(fn => fn.mockRejectedValue(err));
  const m = load();
  await expect(m.setWatchHealthConsent('AGREEE')).resolves.toBeUndefined();
  await expect(m.refreshWatchHealthConsent()).resolves.toBeUndefined();
  await expect(m.readWatchDailyHr()).resolves.toEqual([]);
  await expect(
    m.markWatchDailyHrUploaded('2026-10-29', 1),
  ).resolves.toBeUndefined();
  await expect(
    m.markWatchDailyHrRejected('2026-10-29', 1),
  ).resolves.toBeUndefined();
});

test('the fallback module is a no-op that returns no records', async () => {
  const m = require('../watchHealth') as typeof import('../watchHealth');
  await expect(m.setWatchHealthConsent('DISAGREE')).resolves.toBeUndefined();
  await expect(m.refreshWatchHealthConsent()).resolves.toBeUndefined();
  await expect(m.readWatchDailyHr()).resolves.toEqual([]);
  await expect(
    m.markWatchDailyHrUploaded('2026-10-29', 1),
  ).resolves.toBeUndefined();
  await expect(
    m.markWatchDailyHrRejected('2026-10-29', 1),
  ).resolves.toBeUndefined();
});
