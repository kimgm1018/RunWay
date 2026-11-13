import React from 'react';
import { Modal, Share, StyleSheet } from 'react-native';
import { NaverMapView } from '@mj-studio/react-native-naver-map';
import TestRenderer, { act } from 'react-test-renderer';
import ShareSheet from 'react-native-share';
import { captureRef } from 'react-native-view-shot';
import type { Post } from '../src/data';
import type { LngLat } from '../src/geo';
import {
  RouteReplay,
  replayOfPost,
  type ReplayRun,
} from '../src/screens/community/RouteReplay';
import {
  linkWaitMs,
  shareReplay,
} from '../src/screens/community/replayShare';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// S15P31E105-704: 경로 재생 공유 sends a picture of the replay with a link, and falls back to text.

const open = ShareSheet.open as jest.Mock;
const capture = captureRef as jest.Mock;
let textShare: jest.SpyInstance;

beforeEach(() => {
  open.mockReset().mockResolvedValue({ success: true, message: '' });
  capture.mockReset().mockResolvedValue('/data/cache/replay.png');
  textShare = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction' });
});
afterEach(() => textShare.mockRestore());

const link = 'https://k15e105.p.ssafy.io/r/abc';

test('the replay goes as a picture with the words and the link', async () => {
  const result = await shareReplay({
    message: '내 러닝 · 아침 러닝 5.0km',
    link: async () => link,
    capture: async () => '/data/cache/replay.png',
  });
  expect(result).toBe('image');
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'file:///data/cache/replay.png',
      type: 'image/png',
      message: `내 러닝 · 아침 러닝 5.0km\n${link}`,
      failOnCancel: false,
    }),
  );
  expect(textShare).not.toHaveBeenCalled();
});

test('without a picture the words and the link go as text', async () => {
  const result = await shareReplay({
    message: '내 러닝',
    link: async () => link,
    capture: () => Promise.reject(new Error('capture failed')),
  });
  expect(result).toBe('text');
  expect(open).not.toHaveBeenCalled();
  expect(textShare).toHaveBeenCalledWith({ message: `내 러닝\n${link}` });
});

test('an image share that fails falls back to text; closing the sheet does not', async () => {
  open.mockRejectedValueOnce(new Error('no app'));
  expect(
    await shareReplay({
      message: '내 러닝',
      link: null,
      capture: async () => 'file:///x.png',
    }),
  ).toBe('text');
  expect(textShare).toHaveBeenCalledWith({ message: '내 러닝' });

  textShare.mockClear();
  open.mockResolvedValueOnce({ dismissedAction: true });
  expect(
    await shareReplay({
      message: '내 러닝',
      link: null,
      capture: async () => 'file:///x.png',
    }),
  ).toBe('cancelled');
  expect(textShare).not.toHaveBeenCalled();
});

test('a link that cannot be made leaves only the picture', async () => {
  await shareReplay({
    message: '내 러닝',
    link: () => Promise.reject(new Error('offline')),
    capture: async () => 'file:///x.png',
  });
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ message: '내 러닝' }),
  );
});

test('a link that takes too long is left out instead of holding the share', async () => {
  jest.useFakeTimers();
  try {
    const sharing = shareReplay({
      message: '내 러닝',
      link: () => new Promise<string>(() => undefined),
      capture: async () => 'file:///x.png',
    });
    await jest.advanceTimersByTimeAsync(linkWaitMs);
    await expect(sharing).resolves.toBe('image');
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ message: '내 러닝' }),
    );
  } finally {
    jest.useRealTimers();
  }
});

test('a replay closed while the link was made shares nothing', async () => {
  let open_ = true;
  const result = await shareReplay({
    message: '내 러닝',
    link: async () => {
      open_ = false;
      return link;
    },
    capture: async () => 'file:///x.png',
    wanted: () => open_,
  });
  expect(result).toBe('cancelled');
  expect(open).not.toHaveBeenCalled();
  expect(textShare).not.toHaveBeenCalled();
});

test("a post's replay links to the post", async () => {
  const post = {
    id: 'post-7',
    isMine: false,
    courseShared: true,
    author: {
      handle: 'minjun.run',
      nickname: '민준',
      userId: 'user-1',
      profileImageUrl: null,
    },
    record: {
      startedAt: '2026-11-08T22:10:00Z',
      distanceM: 5000,
      durationSec: 1800,
      averagePaceSecPerKm: 360,
      cadence: null,
      shape: [],
      route: null,
    },
  } as unknown as Post;
  await expect(replayOfPost(post).link?.()).resolves.toBe(
    'https://k15e105.p.ssafy.io/p/post-7',
  );
});

const street: LngLat[] = Array.from({ length: 5 }, (_, index) => [
  129.1,
  35.15 + (50 * index) / 111320,
]);
const run: ReplayRun = {
  key: 'run-1',
  kind: '경로',
  title: '아침 러닝',
  byline: '0.20km',
  startedAt: '2026-11-08T22:10:00Z',
  shareMessage: '내 러닝 · 아침 러닝 0.2km',
  link: async () => link,
  runner: { nickname: '나', userId: '', photo: null, mine: true },
  distanceM: 200,
  durationSec: 80,
  averagePaceSecPerKm: 400,
  cadence: null,
  shape: [],
  parts: [street],
};

// TextureView needs a hardware accelerated window, including after Android recreates its surface on resume.
test('the real-map replay enables hardware acceleration in its own modal window', async () => {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <RouteReplay run={run} visible onClose={() => undefined} />,
    );
  });
  try {
    expect(
      screen.root.findByType(NaverMapView).props.isUseTextureViewAndroid,
    ).toBe(true);
    expect(screen.root.findByType(Modal).props.hardwareAccelerated).toBe(true);
  } finally {
    await act(async () => screen.unmount());
  }
});

test('공유 on the replay takes the picture without its buttons and shares it', async () => {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <RouteReplay run={run} visible onClose={() => undefined} />,
    );
  });
  const button = (label: string) =>
    screen.root.find(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === 'function',
    );
  const opacity = (label: string) =>
    StyleSheet.flatten(button(label).props.style({ pressed: false })).opacity;
  // At the moment of the picture the 공유 and 닫기 buttons are not drawn.
  let hidden: unknown[] = [];
  capture.mockImplementationOnce(async () => {
    hidden = [opacity('공유'), opacity('경로 재생 닫기')];
    return '/data/cache/replay.png';
  });
  // The press hides the buttons first; the picture is taken a frame later, once that has been drawn.
  let sharing: Promise<void> = Promise.resolve();
  await act(async () => {
    sharing = button('공유').props.onPress();
  });
  await act(async () => {
    await sharing;
  });
  expect(capture).toHaveBeenCalledTimes(1);
  expect(hidden).toEqual([0, 0]);
  expect(opacity('공유')).toBeUndefined();
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'file:///data/cache/replay.png',
      message: `내 러닝 · 아침 러닝 0.2km\n${link}`,
    }),
  );
  await act(async () => screen.unmount());
});
