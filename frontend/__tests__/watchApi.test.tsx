import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

// 1.6w → 1.7 워치 연결 and 8.1 기기 against the server (dataSource 'api'): W01·W02·W03.

jest.mock('../src/health/watchHealth', () => ({
  setWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
  refreshWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const unavailable = () =>
  respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} });

// The linked watch lives here so W01 and W03 change what W02 answers.
let linked: boolean;
let failing: 'POST' | 'DELETE' | null;

function serve() {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string }) => {
      const path = new URL(address).pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/auth/login') {
        return respond(200, {
          user: { id: 101, loginId: 'minjun01' },
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresInSec: 600,
          refreshExpiresAt: '2026-12-02T01:00:00Z',
          onboardingCompleted: false,
        });
      }
      if (path === '/users/me/running-profile') {
        return init.method === 'PATCH'
          ? respond(200, {
              selfReportedLevel: 'INTERMEDIATE',
              baselineDistanceM: 5000,
              baselineDurationSec: 1800,
              usualPaceSecPerKm: 360,
              onboardingCompleted: false,
              updatedAt: '2026-11-02T00:00:00Z',
            })
          : respond(404, { code: 'PROFILE_NOT_SET', message: '', details: {} });
      }
      if (path === '/devices' && init.method === 'GET') {
        return respond(200, {
          items: linked
            ? [
                {
                  id: 31,
                  deviceType: 'WATCH',
                  linkedAt: '2026-11-02T00:00:00Z',
                  unlinkedAt: null,
                },
              ]
            : [],
        });
      }
      if (path === '/devices' && init.method === 'POST') {
        if (failing === 'POST') {
          return unavailable();
        }
        linked = true;
        return respond(201, { id: 31, deviceType: 'WATCH' });
      }
      if (path === '/devices/31' && init.method === 'DELETE') {
        if (failing === 'DELETE') {
          return unavailable();
        }
        linked = false;
        return respond(200, {});
      }
      // U04 for the 8.1 profile row (S15P31E105-321).
      if (path === '/users/me' && init.method === 'GET') {
        return respond(200, {
          id: 101,
          nickname: '민준',
          gender: 'MALE',
          birthDate: '1995-03-14',
          loginId: 'minjun01',
          status: 'ACTIVE',
          profileImageUrl: null,
          onboardingCompleted: true,
        });
      }
      throw new Error(`unexpected request ${init.method} ${address}`);
    },
  );
}

const sent = () =>
  fetchMock.mock.calls
    .map(([address, init]) => ({
      method: init.method as string,
      path: new URL(address).pathname.replace(/^.*\/api\/v1/, ''),
    }))
    .filter(call => call.path.startsWith('/devices'))
    .map(call => `${call.method} ${call.path}`);

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function last(screen: Screen, label: string, prop: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label} with ${prop}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    last(screen, label, 'onPress').props.onPress();
  });
  await settle();
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    last(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

async function launch(signedIn = false) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createApiRepositories({ latencyMs: 0 })}
        initialSignedIn={signedIn}
      />,
    );
  });
  await settle();
  return screen!;
}

// An account still in setup logs in, saves 1.6 and reaches 1.6w with 네 picked.
async function openWatchChoice() {
  const screen = await launch();
  await press(screen, '로그인');
  await type(screen, '아이디', 'minjun01');
  await type(screen, '비밀번호', 'runway123');
  await press(screen, '로그인');
  await press(screen, '중급, 5–10km 주 2–3회');
  await type(screen, '거리', '5');
  await type(screen, '완주 시간', '30:00');
  await press(screen, '저장');
  expect(texts(screen)).toContain('함께 쓰나요?');
  await press(screen, '네, 워치와 함께 쓸게요');
  return screen;
}

beforeEach(async () => {
  linked = false;
  failing = null;
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
  serve();
});

test('1.6w 네 links the watch before 1.7 opens', async () => {
  const screen = await openWatchChoice();

  await press(screen, '다음');

  expect(sent()).toEqual(['POST /devices', 'GET /devices']);
  expect(texts(screen)).toContain('연결됨');
  await act(async () => screen.unmount());
});

test('1.6w stays with a notice when the server cannot link the watch', async () => {
  failing = 'POST';
  const screen = await openWatchChoice();

  await press(screen, '다음');

  const page = texts(screen);
  expect(page).toContain('워치를 등록하지 못했어요.');
  expect(page).toContain('잠시 후 다시 시도해 주세요.');
  expect(page).toContain('함께 쓰나요?');
  await act(async () => screen.unmount());
});

test('8.1 shows the linked watch and unlinks it with W03', async () => {
  linked = true;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const screen = await launch(true);
  await press(screen, '설정');
  expect(texts(screen)).toContain('Galaxy Watch7');

  await press(screen, '연결 해제');

  expect(sent()).toContain('DELETE /devices/31');
  const page = texts(screen);
  expect(page).toContain('Galaxy Watch7 연결을 해제했어요');
  expect(() => last(screen, '연결', 'onPress')).not.toThrow();
  await act(async () => screen.unmount());
});

test('8.1 keeps the watch and says so when W03 fails', async () => {
  linked = true;
  failing = 'DELETE';
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const screen = await launch(true);
  await press(screen, '설정');

  await press(screen, '연결 해제');

  expect(texts(screen)).toContain(
    '연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  expect(() => last(screen, '연결 해제', 'onPress')).not.toThrow();
  await act(async () => screen.unmount());
});
