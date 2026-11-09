import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { NativeSleepAccess, SleepNative } from '../samsungSleep';
import {
  useSamsungSleep,
  useSamsungSleepUpload,
  type SamsungSleepView,
} from '../useSamsungSleep';

// S15P31E105-572 리뷰 A-4: the hooks re-check access on returning to the app and clear sent marks only on an
// actual sign-out. Values are synthetic.

jest.mock('../../config', () => ({ appConfig: { dataSource: 'mock' } }));

let listeners: ((state: AppStateStatus) => void)[] = [];
beforeEach(() => {
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: AppStateStatus) => void,
  ) => {
    listeners.push(listener);
    return { remove: () => {} };
  }) as never);
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
});
afterEach(() => jest.restoreAllMocks());

function native(status: () => NativeSleepAccess, state: string | null = null) {
  let saved = state;
  const fake: SleepNative & { saved: () => string | null } = {
    status: async () => status(),
    request: jest.fn(async () => false),
    read: jest.fn(async () => []),
    loadState: async () => saved,
    saveState: jest.fn(async (json: string | null) => {
      saved = json;
      return true;
    }),
    saved: () => saved,
  };
  return fake;
}

const flush = () =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

async function goBackground() {
  await act(async () => {
    listeners.forEach(listener => listener('background'));
  });
}

async function comeBack() {
  await act(async () => {
    listeners.forEach(listener => listener('active'));
  });
  await flush();
}

it('shows granted after allowing in Samsung Health and coming back to the app', async () => {
  let status: NativeSleepAccess = 'required';
  const fake = native(() => status);
  let view!: SamsungSleepView;
  function Probe() {
    view = useSamsungSleep(fake, () => new Date(2026, 10, 9, 9));
    return null;
  }
  await act(async () => {
    TestRenderer.create(<Probe />);
  });
  await flush();
  expect(view.access).toBe('notRequested');

  status = 'granted';
  await goBackground();
  await comeBack();
  expect(view.access).toBe('granted');
  expect(view.today).toEqual({ status: 'empty' });
});

it('clears sent marks on an actual sign-out, not on a cold start before the session is restored', async () => {
  const marks = JSON.stringify({
    requested: true,
    everGranted: true,
    owner: '7',
    uploaded: { '2026-11-08': 400 },
  });
  const fake = native(() => 'granted', marks);
  function Probe({ signedIn }: { signedIn: boolean }) {
    useSamsungSleepUpload(signedIn, fake);
    return null;
  }
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(<Probe signedIn={false} />);
  });
  await flush();
  expect(fake.saved()).toBe(marks);

  await act(async () => {
    screen.update(<Probe signedIn />);
  });
  await act(async () => {
    screen.update(<Probe signedIn={false} />);
  });
  await flush();
  expect(JSON.parse(fake.saved()!)).toMatchObject({
    everGranted: true,
    owner: null,
    uploaded: {},
  });
});

// S15P31E105-600: heart rate access and today's resting heart rate, one dialog for both, marks cleared on sign-out.
it('shows heart rate access and today’s resting heart rate, and asks for both in one dialog', async () => {
  let heartStatus: NativeSleepAccess = 'required';
  const sleep = native(() => 'granted');
  const heart = native(() => heartStatus);
  heart.read = jest.fn(async () =>
    Array.from({ length: 30 }, (_, i) => ({
      id: `h${i}`,
      metric: 'heartRate' as const,
      startTime: new Date(2026, 10, 9, 1, i).toISOString(),
      endTime: new Date(2026, 10, 9, 1, i).toISOString(),
      value: 57,
      source: { id: 'watch', name: 'Galaxy Watch' },
    })),
  );
  const requestBoth = jest.fn(async () => {
    heartStatus = 'granted';
    return { sleep: true, heartRate: true };
  });
  let view!: SamsungSleepView;
  function Probe() {
    view = useSamsungSleep(sleep, () => new Date(2026, 10, 9, 9), heart, requestBoth);
    return null;
  }
  await act(async () => {
    TestRenderer.create(<Probe />);
  });
  await flush();
  expect(view.heartAccess).toBe('notRequested');
  expect(view.todayRestingHr).toEqual({ status: 'accessRequired' });

  await act(async () => {
    await view.request();
  });
  await flush();
  expect(requestBoth).toHaveBeenCalledTimes(1);
  expect(view.access).toBe('granted');
  expect(view.heartAccess).toBe('granted');
  expect(view.todayRestingHr).toEqual({ status: 'ready', date: '2026-11-09', bpm: 57 });
});

it('clears resting heart rate marks on an actual sign-out too', async () => {
  const marks = JSON.stringify({ requested: true, everGranted: true, owner: '7', uploaded: { '2026-11-08': 57 } });
  const sleep = native(() => 'granted');
  const heart = native(() => 'granted', marks);
  function Probe({ signedIn }: { signedIn: boolean }) {
    useSamsungSleepUpload(signedIn, sleep, heart);
    return null;
  }
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(<Probe signedIn />);
  });
  await act(async () => {
    screen.update(<Probe signedIn={false} />);
  });
  await flush();
  expect(JSON.parse(heart.saved()!)).toMatchObject({ everGranted: true, owner: null, uploaded: {} });
});
