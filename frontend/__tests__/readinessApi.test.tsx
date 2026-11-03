import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

// 2.1 오늘 컨디션 against the server (dataSource 'api'): the readiness from R02 (S15P31E105-322).

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

// Answers R02 with the given response. The other home sections are not under test here:
// they fail on their own and leave the 오늘 컨디션 card on screen.
function serve(status: number, body: unknown) {
  fetchMock.mockImplementation(async (requested: string) =>
    new URL(requested).pathname.endsWith('/readiness-assessments/latest')
      ? respond(status, body)
      : respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }),
  );
}

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function launch() {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createApiRepositories({ latencyMs: 0 })}
        initialSignedIn
      />,
    );
  });
  await settle();
  await settle();
  return screen!;
}

beforeEach(async () => {
  // Monday 11.02 12:00 in Korea; timers still run so the screens settle.
  jest.useFakeTimers({
    now: new Date('2026-11-02T03:00:00Z'),
    advanceTimers: true,
  });
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

afterEach(() => {
  jest.useRealTimers();
});

test("2.1 shows today's R02 score without a made-up grade", async () => {
  serve(200, {
    id: 101,
    readinessScore: 74.6,
    readinessDate: '2026-11-02',
    readinessConfidence: 'MEDIUM',
  });
  const screen = await launch();

  const page = texts(screen);
  expect(page).toContain('오늘 컨디션');
  expect(page).toContain('75');
  expect(page).toContain('/100');
  expect(page).toContain('준비도');
  expect(page).not.toContain('준비도 양호');
  expect(page).not.toContain('undefined');
  await act(async () => screen.unmount());
});

test('2.1 shows 2.P′ 오래된 데이터 for an earlier day', async () => {
  serve(200, {
    id: 101,
    readinessScore: 81,
    readinessDate: '2026-10-30',
    readinessConfidence: 'HIGH',
  });
  const screen = await launch();

  const page = texts(screen);
  expect(page).toContain('마지막 평가 10월 30일');
  expect(page).toContain('오늘 점수로 쓰지 않아요');
  expect(page).not.toContain('81');
  await act(async () => screen.unmount());
});

test('2.1 shows 준비도 수집 중 when there is no result yet', async () => {
  serve(404, { code: 'ASSESSMENT_NOT_FOUND', message: '', details: {} });
  const screen = await launch();

  const page = texts(screen);
  expect(page).toContain('준비도 수집 중');
  expect(page).not.toContain('오늘 컨디션을 불러오지 못했어요');
  await act(async () => screen.unmount());
});

test('2.1 shows 권한 없음 without health consent', async () => {
  serve(403, { code: 'CONSENT_REQUIRED', message: '', details: {} });
  const screen = await launch();

  const page = texts(screen);
  expect(page).toContain('권한 없음');
  expect(page).not.toContain('오늘 컨디션을 불러오지 못했어요');
  await act(async () => screen.unmount());
});
