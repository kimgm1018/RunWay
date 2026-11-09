import { createMockRepositories } from '../../mock/createMockRepositories';
import {
  parseLibrary,
  parseRecent,
  parsePlayback,
  parseStatus,
  type MelonBridge,
  type MelonCommand,
  type MelonHeard,
  type MelonItem,
  type MelonPlayback,
  type MelonStatus,
} from '../bridge';
import { MelonError, withMelon } from '../music';

// 멜론 Android 연동 계층(S15P31E105-398, MUS-002·004·005). 곡 정보는 합성 값만 쓴다.

const ready: MelonStatus = {
  installed: true,
  browsable: true,
  permitted: true,
};

const song = (id: string, artworkUri: string | null = null) => ({
  id,
  title: `Synthetic ${id}`,
  artist: 'Synthetic Artist',
  durationMs: 200_400,
  positionMs: 12_600,
  artworkUri,
});

const playing: MelonPlayback = {
  connected: true,
  playing: true,
  loginRequired: false,
  commands: ['play', 'pause', 'next', 'previous'],
  track: song('m1', 'file:///cache/melon-art/a.jpg'),
};

// 상태를 바꿔 가며 답하는 가짜 네이티브 모듈. 보낸 명령을 기록하고, 명령에 맞춰 다음 재생 상태를 정한다.
function fakeMelon({
  status = ready,
  connects = true,
  playback = playing,
  onSend,
  items = [],
  onPlayItem,
  heard = [],
}: {
  status?: MelonStatus;
  connects?: boolean;
  playback?: MelonPlayback;
  onSend?: (command: MelonCommand, current: MelonPlayback) => MelonPlayback;
  items?: MelonItem[];
  onPlayItem?: (id: string, current: MelonPlayback) => MelonPlayback;
  heard?: MelonHeard[];
} = {}) {
  const sent: MelonCommand[] = [];
  const opened: string[] = [];
  let current = playback;
  let connectCalls = 0;
  const bridge: MelonBridge = {
    status: jest.fn(async () => status),
    connect: jest.fn(async () => {
      connectCalls++;
      return connects;
    }),
    playback: jest.fn(async () => current),
    send: jest.fn(async command => {
      if (!current.commands.includes(command)) {
        return false;
      }
      sent.push(command);
      if (onSend) {
        current = onSend(command, current);
      }
      return true;
    }),
    playDefault: jest.fn(async () => 'NONE' as const),
    library: jest.fn(async () => items),
    recent: jest.fn(async () => heard),
    playTrack: jest.fn(async id => {
      if (!heard.some(entry => entry.id === id)) {
        return false;
      }
      current = { ...current, track: { ...song(id), positionMs: 0 } };
      return true;
    }),
    playItem: jest.fn(async id => {
      if (!items.some(item => item.id === id)) {
        return false;
      }
      if (onPlayItem) {
        current = onPlayItem(id, current);
      }
      return true;
    }),
    openPermissionSettings: jest.fn(async () => {
      opened.push('settings');
      return true;
    }),
    openMelon: jest.fn(async () => {
      opened.push('melon');
      return true;
    }),
  };
  return { bridge, sent, opened, connectCalls: () => connectCalls };
}

const baseMusic = () => createMockRepositories().music;

describe('withMelon', () => {
  it('shows the song, artist, length, position and album art Melon reports', async () => {
    const { bridge } = fakeMelon();
    const state = await withMelon(baseMusic(), bridge).getState();
    expect(state.source).toBe('MELON');
    expect(state.services.MELON).toBe('CONNECTED');
    expect(state.linked).toBe(true);
    expect(state.library).toBeNull();
    expect(state.nowPlaying).toEqual({
      id: 'm1',
      title: 'Synthetic m1',
      subtitle: 'Synthetic Artist',
      durationSec: 200,
      positionSec: 13,
      artworkUrl: 'file:///cache/melon-art/a.jpg',
      playing: true,
    });
  });

  it('keeps the default cover when the metadata has no album art', async () => {
    const { bridge } = fakeMelon({
      playback: { ...playing, track: song('m2') },
    });
    const state = await withMelon(baseMusic(), bridge).getState();
    expect(state.nowPlaying?.artworkUrl).toBeNull();
  });

  it.each([
    [{ ...ready, installed: false }, 'INSTALL_REQUIRED'],
    [{ ...ready, browsable: false }, 'INSTALL_REQUIRED'],
    [{ ...ready, permitted: false }, 'PERMISSION_REQUIRED'],
  ] as const)(
    'tells a missing install or permission apart and does not connect (MUS-002)',
    async (status, expected) => {
      const melon = fakeMelon({ status });
      const state = await withMelon(baseMusic(), melon.bridge).getState();
      expect(state.services.MELON).toBe(expected);
      expect(state.linked).toBe(false);
      expect(state.nowPlaying).toBeNull();
      expect(melon.connectCalls()).toBe(0);
    },
  );

  it('asks for a login when Melon refuses the connection or reports an auth error', async () => {
    const refused = await withMelon(
      baseMusic(),
      fakeMelon({ connects: false }).bridge,
    ).getState();
    expect(refused.services.MELON).toBe('LOGIN_REQUIRED');
    expect(refused.linked).toBe(false);

    const expired = await withMelon(
      baseMusic(),
      fakeMelon({ playback: { ...playing, loginRequired: true } }).bridge,
    ).getState();
    expect(expired.services.MELON).toBe('LOGIN_REQUIRED');
    expect(expired.linked).toBe(false);
  });

  it('shows a dropped link when no Melon session is left (MUS-005)', async () => {
    const { bridge } = fakeMelon({
      playback: { ...playing, connected: false, track: null },
    });
    const state = await withMelon(baseMusic(), bridge).getState();
    expect(state.services.MELON).toBe('CONNECTED');
    expect(state.linked).toBe(false);
  });

  it('does not connect to Melon while another source is picked', async () => {
    const melon = fakeMelon();
    const music = withMelon(baseMusic(), melon.bridge);
    const state = await music.selectSource('SPOTIFY');
    expect(state.source).toBe('SPOTIFY');
    expect(state.services.MELON).toBe('CONNECTED');
    expect(melon.connectCalls()).toBe(0);
  });

  it('pauses Melon and shows the state read back (MUS-004)', async () => {
    const melon = fakeMelon({
      onSend: (command, current) => ({
        ...current,
        playing: command === 'play',
      }),
    });
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 0,
    }).pause();
    expect(melon.sent).toEqual(['pause']);
    expect(state.nowPlaying?.playing).toBe(false);
  });

  it('moves to the next song only once Melon reports it', async () => {
    let reads = 0;
    const melon = fakeMelon();
    const playbackOf = melon.bridge.playback as jest.Mock;
    playbackOf.mockImplementation(async () => {
      reads++;
      // 명령 전 두 번 읽고(명령 확인), 다음 한 번은 아직 이전 곡, 그 뒤에 다음 곡.
      return reads <= 3 ? playing : { ...playing, track: song('m2') };
    });
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 0,
    }).next();
    expect(melon.sent).toEqual(['next']);
    expect(state.nowPlaying?.id).toBe('m2');
  });

  it('shows what Melon reports when a command never shows up', async () => {
    const melon = fakeMelon();
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 0,
    }).next();
    expect(melon.sent).toEqual(['next']);
    expect(state.nowPlaying?.id).toBe('m1');
  });

  it('goes back once more when Melon only restarts the song', async () => {
    const melon = fakeMelon({
      // 첫 이전은 처음부터 다시, 바로 이어진 두 번째 이전에서 앞 곡으로.
      onSend: (_command, current) =>
        melon.sent.length >= 2 ? { ...current, track: song('m0') } : current,
    });
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 0,
    }).previous();
    expect(melon.sent).toEqual(['previous', 'previous']);
    expect(state.nowPlaying?.id).toBe('m0');
  });

  it('sends the second previous as soon as Melon restarts the song', async () => {
    const melon = fakeMelon({
      onSend: (_command, current) =>
        melon.sent.length >= 2
          ? { ...current, track: song('m0') }
          : { ...current, track: { ...song('m1'), positionMs: 0 } },
    });
    await withMelon(baseMusic(), melon.bridge, { settleMs: 0 }).previous();
    expect(melon.sent).toEqual(['previous', 'previous']);
    // 처음으로 돌아간 것을 본 첫 확인 바로 뒤에 다시 보낸다(읽기: 명령 전 1번, 확인 1번).
    expect(
      (melon.bridge.playback as jest.Mock).mock.calls.length,
    ).toBeLessThanOrEqual(3);
  });

  it('does not go back twice when the song had just started', async () => {
    const melon = fakeMelon({
      playback: { ...playing, track: { ...song('m1'), positionMs: 0 } },
      onSend: (_command, current) => ({ ...current, track: song('m0') }),
    });
    await withMelon(baseMusic(), melon.bridge, { settleMs: 0 }).previous();
    expect(melon.sent).toEqual(['previous']);
  });

  it('reads the base source once instead of before every check', async () => {
    const base = baseMusic();
    const getBase = jest.spyOn(base, 'getState');
    const melon = fakeMelon({
      onSend: (_command, current) => ({ ...current, track: song('m2') }),
    });
    const music = withMelon(base, melon.bridge, { settleMs: 0 });
    await music.getState();
    await music.next();
    expect(getBase).toHaveBeenCalledTimes(1);
  });

  it('goes back only once when the first previous already moved', async () => {
    const melon = fakeMelon({
      onSend: (_command, current) => ({ ...current, track: song('m0') }),
    });
    await withMelon(baseMusic(), melon.bridge, { settleMs: 0 }).previous();
    expect(melon.sent).toEqual(['previous']);
  });

  it('starts the default playlist (or TOP100) when nothing is queued (MUS-003)', async () => {
    const melon = fakeMelon({
      playback: { ...playing, playing: false, commands: [], track: null },
    });
    (melon.bridge.playDefault as jest.Mock).mockImplementation(async () => {
      (melon.bridge.playback as jest.Mock).mockResolvedValue(playing);
      return 'TOP100';
    });
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 0,
    }).play();
    expect(melon.bridge.playDefault).toHaveBeenCalledTimes(1);
    expect(melon.bridge.send).not.toHaveBeenCalled();
    expect(state.nowPlaying?.playing).toBe(true);
  });

  it('says so when Melon offers no list to start', async () => {
    const melon = fakeMelon({
      playback: { ...playing, playing: false, track: null },
    });
    await expect(
      withMelon(baseMusic(), melon.bridge, { settleMs: 0 }).play(),
    ).rejects.toBeInstanceOf(MelonError);
  });

  it('shows the next song as soon as Melon reports it, before its length', async () => {
    let reads = 0;
    const melon = fakeMelon();
    (melon.bridge.playback as jest.Mock).mockImplementation(async () => {
      reads++;
      if (reads <= 2) {
        return playing;
      }
      // 바뀐 직후에는 길이 0, 그다음 읽기에서 길이가 들어온다.
      return {
        ...playing,
        track: { ...song('m2'), durationMs: reads === 3 ? 0 : 180_000 },
      };
    });
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 0,
    }).next();
    expect(state.nowPlaying?.id).toBe('m2');
    // 길이는 기다리지 않는다(2.7 카드가 곧 다시 읽어 채운다).
    expect(state.nowPlaying?.durationSec).toBe(0);
    expect(reads).toBe(3);
  });

  it('sends nothing without the permission (MUS-002)', async () => {
    const melon = fakeMelon({ status: { ...ready, permitted: false } });
    await expect(
      withMelon(baseMusic(), melon.bridge, { settleMs: 0 }).play(),
    ).rejects.toBeInstanceOf(MelonError);
    expect(melon.bridge.send).not.toHaveBeenCalled();
  });

  it('sends nothing Melon does not support', async () => {
    const melon = fakeMelon({ playback: { ...playing, commands: ['pause'] } });
    await expect(
      withMelon(baseMusic(), melon.bridge, { settleMs: 0 }).next(),
    ).rejects.toBeInstanceOf(MelonError);
    expect(melon.bridge.send).not.toHaveBeenCalled();
  });

  it('leaves Spotify and 음악 없음 commands to the base', async () => {
    const melon = fakeMelon();
    const music = withMelon(baseMusic(), melon.bridge, { settleMs: 0 });
    await music.selectSource('NONE');
    await music.play();
    expect(melon.bridge.send).not.toHaveBeenCalled();
  });

  it('opens the notification access settings for 허용 and Melon for 설치·로그인', async () => {
    const permission = fakeMelon({ status: { ...ready, permitted: false } });
    await withMelon(baseMusic(), permission.bridge).resolveService('MELON');
    expect(permission.opened).toEqual(['settings']);

    const install = fakeMelon({ status: { ...ready, installed: false } });
    await withMelon(baseMusic(), install.bridge).resolveService('MELON');
    expect(install.opened).toEqual(['melon']);

    const login = fakeMelon({ connects: false });
    const state = await withMelon(baseMusic(), login.bridge).reconnect();
    expect(login.opened).toEqual(['melon']);
    // 돌아온 것만으로 연결됐다고 보지 않는다(MUS-005).
    expect(state.linked).toBe(false);
  });

  it('reconnects without leaving the app once everything is in place', async () => {
    const melon = fakeMelon();
    const state = await withMelon(baseMusic(), melon.bridge).reconnect();
    expect(melon.opened).toEqual([]);
    expect(state.linked).toBe(true);
  });
});

describe('bridge parsing', () => {
  const drawer: MelonItem[] = [
    { id: 'like', title: '좋아요한 곡', kind: 'LIKED', artworkUri: null },
    { id: 'recent', title: '최근들은 곡', kind: 'RECENT', artworkUri: null },
    {
      id: 'list-1',
      title: 'Synthetic list',
      kind: 'PLAYLIST',
      artworkUri: 'https://example.com/cover.jpg',
    },
  ];

  it('shows the Melon drawer lists as 내 재생 목록 and no song-by-song recents (S15P31E105-566)', async () => {
    const { bridge } = fakeMelon({
      items: [...drawer.slice(0, 2), { ...drawer[2], trackCount: 12 }],
    });
    const music = withMelon(baseMusic(), bridge);
    // Spotify처럼 목록만 두고, 표지를 아직 모르는 좋아요한 곡은 기본 타일에 하트를 그린다.
    expect(await music.getPlaylists()).toEqual([
      { id: 'like', title: '좋아요한 곡', artworkUrl: null, icon: 'heart' },
      {
        id: 'list-1',
        title: 'Synthetic list',
        artworkUrl: 'https://example.com/cover.jpg',
        trackCount: 12,
      },
    ]);
    expect(await music.getRecentTracks()).toEqual([]);
  });

  const heardSongs: MelonHeard[] = [
    {
      id: 'h1',
      title: 'Synthetic h1',
      artist: 'Synthetic Artist',
      artworkUri: 'https://example.com/h1.jpg',
      durationMs: 180_400,
    },
    {
      id: 'h2',
      title: 'Synthetic h2',
      artist: '',
      artworkUri: null,
      durationMs: 0,
    },
  ];

  it('shows the songs Melon played on this phone as 최근 들은 곡, newest first', async () => {
    const { bridge } = fakeMelon({ heard: heardSongs });
    expect(await withMelon(baseMusic(), bridge).getRecentTracks()).toEqual([
      {
        id: 'h1',
        title: 'Synthetic h1',
        subtitle: 'Synthetic Artist',
        durationSec: 180,
        artworkUrl: 'https://example.com/h1.jpg',
      },
      {
        id: 'h2',
        title: 'Synthetic h2',
        subtitle: '',
        durationSec: 0,
        artworkUrl: null,
      },
    ]);
  });

  it('plays a recent song and returns once Melon reports it', async () => {
    const melon = fakeMelon({ heard: heardSongs });
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 1,
    }).playTrack('h2');
    expect(melon.bridge.playTrack).toHaveBeenCalledWith('h2');
    expect(state.nowPlaying?.id).toBe('h2');
  });

  it('lists and plays no recent song without the link', async () => {
    const { bridge } = fakeMelon({ heard: heardSongs, connects: false });
    const music = withMelon(baseMusic(), bridge);
    expect(await music.getRecentTracks()).toEqual([]);
    await expect(music.playTrack('h1')).rejects.toThrow(
      '멜론과 연결되지 않았어요',
    );
    expect(bridge.playTrack).not.toHaveBeenCalled();
  });

  it('says so when Melon does not take the recent song', async () => {
    const { bridge } = fakeMelon({ heard: heardSongs });
    await expect(
      withMelon(baseMusic(), bridge).playTrack('unknown'),
    ).rejects.toThrow('멜론에서 이 곡을 틀지 못했어요');
  });

  it('keeps recent songs with an id and title once, and only web covers', () => {
    expect(
      parseRecent(
        JSON.stringify([
          {
            id: 'a',
            title: ' A ',
            artist: 'X',
            artworkUri: 'file:///a.jpg',
            durationMs: 1000,
          },
          { id: 'a', title: 'again' },
          { id: '', title: 'no id' },
          null,
        ]),
      ),
    ).toEqual([
      { id: 'a', title: 'A', artist: 'X', artworkUri: null, durationMs: 1000 },
    ]);
    expect(parseRecent('oops')).toEqual([]);
  });

  it('lists nothing while Melon is not linked', async () => {
    const { bridge } = fakeMelon({ items: drawer, connects: false });
    expect(await withMelon(baseMusic(), bridge).getPlaylists()).toEqual([]);
    expect(bridge.library).not.toHaveBeenCalled();
  });

  it('plays a picked list and returns once Melon reports the new song', async () => {
    const melon = fakeMelon({
      items: drawer,
      onPlayItem: (_, current) => ({
        ...current,
        track: { ...song('m9'), positionMs: 0 },
      }),
    });
    const state = await withMelon(baseMusic(), melon.bridge, {
      settleMs: 1,
    }).playPlaylist('list-1');
    expect(melon.bridge.playItem).toHaveBeenCalledWith('list-1');
    expect(state.nowPlaying?.id).toBe('m9');
    expect(state.nowPlaying?.playing).toBe(true);
  });

  it('says so when Melon does not take the picked list', async () => {
    const { bridge } = fakeMelon({ items: drawer });
    await expect(
      withMelon(baseMusic(), bridge).playPlaylist('unknown'),
    ).rejects.toThrow(MelonError);
  });

  it('does not ask Melon to play a list without the link', async () => {
    const { bridge } = fakeMelon({ items: drawer, connects: false });
    await expect(
      withMelon(baseMusic(), bridge).playPlaylist('like'),
    ).rejects.toThrow('멜론과 연결되지 않았어요');
    expect(bridge.playItem).not.toHaveBeenCalled();
  });

  it('keeps library entries with an id and title once, and only web covers', () => {
    expect(
      parseLibrary(
        JSON.stringify([
          {
            id: 'a',
            title: ' A ',
            kind: 'PLAYLIST',
            artworkUri: 'https://example.com/a.jpg',
          },
          { id: 'a', title: 'again', artworkUri: null },
          { id: 'b', title: 'B', kind: 'LIKED', artworkUri: 'file:///x.jpg' },
          { id: 'd', title: 'D', kind: 'UNKNOWN' },
          { id: '', title: 'no id' },
          { id: 'c', title: '  ' },
          null,
        ]),
      ),
    ).toEqual([
      {
        id: 'a',
        title: 'A',
        kind: 'PLAYLIST',
        artworkUri: 'https://example.com/a.jpg',
      },
      { id: 'b', title: 'B', kind: 'LIKED', artworkUri: null },
      { id: 'd', title: 'D', kind: 'LIST', artworkUri: null },
    ]);
    expect(parseLibrary('not json')).toEqual([]);
    expect(parseLibrary('{}')).toEqual([]);
  });

  it('reads the status checks one by one and fails closed', () => {
    expect(
      parseStatus('{"installed":true,"browsable":true,"permitted":false}'),
    ).toEqual({ installed: true, browsable: true, permitted: false });
    expect(parseStatus('not json')).toEqual({
      installed: false,
      browsable: false,
      permitted: false,
    });
  });

  it('keeps known commands and drops a track without an id or title', () => {
    const parsed = parsePlayback(
      JSON.stringify({
        connected: true,
        playing: false,
        loginRequired: false,
        commands: ['play', 'shuffle', 'next'],
        track: { id: '', title: 'x' },
      }),
    );
    expect(parsed.commands).toEqual(['play', 'next']);
    expect(parsed.track).toBeNull();
    expect(parsePlayback('{"connected":false}').connected).toBe(false);
    expect(parsePlayback('oops').connected).toBe(false);
  });
});
