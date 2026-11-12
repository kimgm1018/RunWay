import React from 'react';
import { AppState, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { MusicState, Repositories } from '../src/data';
import { liveMusicPollMs, useLiveMusic } from '../src/screens/run/useLiveMusic';

// 러닝 중 음악 줄이 실제 재생곡을 따라간다(S15P31E105-717). 곡 정보는 합성 값만 쓴다.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => effect(), [effect]);
  },
}));

type Music = Repositories['music'];

const state = (title: string, patch: Partial<MusicState> = {}): MusicState => ({
  source: 'MELON',
  services: {
    MELON: 'CONNECTED',
    SPOTIFY: 'CONNECTED',
  } as MusicState['services'],
  linked: true,
  library: null,
  premium: false,
  nowPlaying: {
    id: title,
    title,
    subtitle: 'Synthetic Artist',
    durationSec: 200,
    positionSec: 0,
    playing: true,
  },
  ...patch,
});

function fakeMusic(patch: Partial<Music> = {}) {
  let current = state('Song A');
  const music = {
    getState: jest.fn(async () => current),
    next: jest.fn(async () => current),
    ...patch,
  } as unknown as Music;
  return { music, set: (next: MusicState) => (current = next) };
}

function Probe({ music }: { music: Music }) {
  const { player } = useLiveMusic(music, () => {});
  return <Text>{player?.nowPlaying?.title ?? 'none'}</Text>;
}

const shown = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findByType(Text).props.children;

async function mount(music: Music) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Probe music={music} />);
  });
  return renderer;
}

describe('useLiveMusic', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('follows a song change on a source without change events', async () => {
    const { music, set } = fakeMusic();
    const renderer = await mount(music);
    expect(shown(renderer)).toBe('Song A');

    set(state('Song B'));
    await act(async () => {
      jest.advanceTimersByTime(liveMusicPollMs);
    });
    expect(shown(renderer)).toBe('Song B');
  });

  it('leaves a source with change events to its events', async () => {
    let listener: (next: MusicState) => void = () => {};
    const { music } = fakeMusic({
      subscribe: jest.fn(next => {
        listener = next;
        return () => {};
      }),
    });
    const spotify = state('Song A', { source: 'SPOTIFY' });
    (music.getState as jest.Mock).mockResolvedValue(spotify);
    const renderer = await mount(music);
    await act(async () => {
      jest.advanceTimersByTime(liveMusicPollMs * 3);
    });
    expect(music.getState).toHaveBeenCalledTimes(1);

    await act(async () => listener(state('Song B', { source: 'SPOTIFY' })));
    expect(shown(renderer)).toBe('Song B');
  });

  it('reads again when the app comes back', async () => {
    const handlers: ((next: string) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, handler) => {
        handlers.push(handler as (next: string) => void);
        return { remove: () => {} } as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    let listener: (next: MusicState) => void = () => {};
    const { music, set } = fakeMusic({
      subscribe: next => {
        listener = next;
        return () => {};
      },
    });
    set(state('Song A', { source: 'SPOTIFY' }));
    const renderer = await mount(music);
    await act(async () => listener(state('Song A', { source: 'SPOTIFY' })));

    set(state('Song B', { source: 'SPOTIFY' }));
    await act(async () => handlers.forEach(handler => handler('active')));
    expect(shown(renderer)).toBe('Song B');
  });

  it('keeps a command result over an older read that lands after it', async () => {
    let finishRead: (value: MusicState) => void = () => {};
    const { music } = fakeMusic();
    let command!: ReturnType<typeof useLiveMusic>['command'];
    function Commander() {
      const live = useLiveMusic(music, () => {});
      command = live.command;
      return <Text>{live.player?.nowPlaying?.title ?? 'none'}</Text>;
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<Commander />);
    });
    (music.getState as jest.Mock).mockImplementationOnce(
      () => new Promise<MusicState>(resolve => (finishRead = resolve)),
    );
    await act(async () => {
      jest.advanceTimersByTime(liveMusicPollMs);
    });
    (music.next as jest.Mock).mockResolvedValue(state('Song C'));
    await act(async () => command('next'));
    expect(shown(renderer)).toBe('Song C');

    await act(async () => finishRead(state('Song A')));
    expect(shown(renderer)).toBe('Song C');
  });

  it('shows nothing while the source is not linked', async () => {
    const { music, set } = fakeMusic();
    set(state('Song A', { linked: false }));
    const renderer = await mount(music);
    expect(shown(renderer)).toBe('none');
  });
});
