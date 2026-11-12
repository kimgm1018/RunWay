import React from 'react';
import { Linking, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { ToastProvider } from '../src/components';
import {
  createMockRepositories,
  DataError,
  DataProvider,
  type Repositories,
  type SharedRun,
} from '../src/data';
import { ShareLinkOpener } from '../src/navigation/ShareLinkOpener';
import { parseShareLink } from '../src/navigation/shareLinks';
import { RouteReplay } from '../src/screens/community/RouteReplay';
import {
  sharedRunMissing,
  sharedRunOffline,
} from '../src/screens/community/SharedRunReplay';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// S15P31E105-704: https links to a shared run (/r/{token}) or a post (/p/{postId}) open in the app.

const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

test('only our run and post links are read', () => {
  expect(token).toHaveLength(43);
  expect(parseShareLink(`https://k15e105.p.ssafy.io/r/${token}`)).toEqual({
    kind: 'run',
    token,
  });
  expect(parseShareLink(`https://k15e105.p.ssafy.io/r/${token}/?x=1#y`)).toEqual(
    { kind: 'run', token },
  );
  expect(parseShareLink('https://k15e105.p.ssafy.io/p/12')).toEqual({
    kind: 'post',
    postId: '12',
  });
  [
    null,
    '',
    'runway://spotify-callback?code=abc',
    'https://k15e105.p.ssafy.io/',
    'https://k15e105.p.ssafy.io/r/short',
    `https://k15e105.p.ssafy.io/r/${token}/more`,
    `https://k15e105.p.ssafy.io/x/${token}`,
    'https://k15e105.p.ssafy.io/p/1 2',
    `https://k15e105.p.ssafy.io.evil.example/r/${token}`,
    `https://evil.example/r/${token}`,
  ].forEach(url => expect(parseShareLink(url)).toBeNull());
});

const shared: SharedRun = {
  title: '아침 러닝',
  startedAt: '2026-11-08T22:10:00Z',
  distanceM: 200,
  durationSec: 80,
  averagePaceSecPerKm: 400,
  cadence: null,
  runner: { nickname: '민준', profileImageUrl: null },
  parts: [
    Array.from({ length: 5 }, (_, index): [number, number] => [
      129.1,
      35.15 + (50 * index) / 111320,
    ]),
  ],
};

let initialUrl: string | null = null;
let listener: ((event: { url: string }) => void) | null = null;
beforeEach(() => {
  initialUrl = null;
  listener = null;
  jest.spyOn(Linking, 'getInitialURL').mockImplementation(async () => initialUrl);
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (event: { url: string }) => void,
  ) => {
    listener = handler;
    return { remove: () => (listener = null) };
  }) as unknown as typeof Linking.addEventListener);
});
afterEach(() => jest.restoreAllMocks());

const navigation = () => ({
  isReady: () => true,
  navigate: jest.fn(),
  addListener: jest.fn(() => () => undefined),
});

async function open(
  repositories: Repositories,
  nav: ReturnType<typeof navigation>,
  signedIn: boolean,
) {
  let screen!: TestRenderer.ReactTestRenderer;
  const tree = (signed: boolean) => (
    <DataProvider repositories={repositories}>
      <ToastProvider>
        <ShareLinkOpener navigation={nav as never} signedIn={signed} />
      </ToastProvider>
    </DataProvider>
  );
  await act(async () => {
    screen = TestRenderer.create(tree(signedIn));
  });
  return {
    screen,
    signIn: () => act(async () => screen.update(tree(true))),
  };
}

const texts = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');

test('a run link that started the app plays the run, signed out', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const get = jest.fn(async () => shared);
  repositories.sharedRuns.get = get;
  initialUrl = `https://k15e105.p.ssafy.io/r/${token}`;
  const { screen } = await open(repositories, navigation(), false);
  expect(get).toHaveBeenCalledWith(token);
  const replay = screen.root.findByType(RouteReplay);
  expect(replay.props.run.title).toBe('아침 러닝');
  expect(replay.props.run.runner.mine).toBe(false);
  await expect(replay.props.run.link()).resolves.toBe(
    `https://k15e105.p.ssafy.io/r/${token}`,
  );
  await act(async () => screen.unmount());
});

test('a run link that cannot be shown says so and opens nothing', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.sharedRuns.get = jest.fn(() =>
    Promise.reject(
      new DataError('SHARED_RUN_NOT_FOUND', '없음', null, 404),
    ),
  );
  const { screen } = await open(repositories, navigation(), true);
  await act(async () => {
    listener?.({ url: `https://k15e105.p.ssafy.io/r/${token}` });
  });
  expect(screen.root.findAllByType(RouteReplay)).toHaveLength(0);
  expect(texts(screen)).toContain(sharedRunMissing);

  repositories.sharedRuns.get = jest.fn(() =>
    Promise.reject(new DataError('NETWORK_ERROR', '연결 없음')),
  );
  await act(async () => {
    listener?.({ url: `https://k15e105.p.ssafy.io/r/${token}` });
  });
  expect(texts(screen)).toContain(sharedRunOffline);
  await act(async () => screen.unmount());
});

test('a post link waits for sign-in, then opens 7.2 with its replay', async () => {
  const nav = navigation();
  initialUrl = 'https://k15e105.p.ssafy.io/p/12';
  const { screen, signIn } = await open(
    createMockRepositories({ latencyMs: 0 }),
    nav,
    false,
  );
  expect(nav.navigate).not.toHaveBeenCalled();
  await signIn();
  expect(nav.navigate).toHaveBeenCalledTimes(1);
  expect(nav.navigate).toHaveBeenCalledWith('PostDetail', {
    postId: '12',
    replay: true,
  });
  await act(async () => screen.unmount());
});

test('other links (the Spotify callback) are left alone', async () => {
  const nav = navigation();
  const repositories = createMockRepositories({ latencyMs: 0 });
  const get = jest.fn(async () => shared);
  repositories.sharedRuns.get = get;
  const { screen } = await open(repositories, nav, true);
  await act(async () => {
    listener?.({ url: 'runway://spotify-callback?code=abc' });
  });
  expect(get).not.toHaveBeenCalled();
  expect(nav.navigate).not.toHaveBeenCalled();
  await act(async () => screen.unmount());
});

test('the mock shares a run by a link it can open again', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const [first] = await repositories.records.getRecent('recent', 1);
  const url = await repositories.records.shareLink(first.id, '아침 러닝');
  const link = parseShareLink(url);
  expect(link?.kind).toBe('run');
  const run = await repositories.sharedRuns.get(
    (link as { token: string }).token,
  );
  expect(run.title).toBe('아침 러닝');
  await expect(repositories.sharedRuns.get(token)).rejects.toMatchObject({
    code: 'SHARED_RUN_NOT_FOUND',
  });
});
