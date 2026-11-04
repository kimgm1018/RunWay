import { createMockRepositories } from '../../mock/createMockRepositories';
import type { MusicState, Repositories } from '../../types';
import { withSavedMusic } from '../withSavedMusic';

type Music = Repositories['music'];

const mockMusic = () => createMockRepositories({ latencyMs: 0 }).music;

// A fresh app: the mock starts on 멜론 again, as after a relaunch; the keystore carries over within a test.
const launch = (base: Music = mockMusic()) => withSavedMusic(base);

// Every answer passes through `change`, e.g. to report nothing playing as Spotify's 204 does.
function reshaped(base: Music, change: (state: MusicState) => MusicState) {
  const wrap =
    <A extends unknown[]>(call: (...args: A) => Promise<MusicState>) =>
    async (...args: A) =>
      change(await call(...args));
  return {
    getState: wrap(base.getState),
    selectSource: wrap(base.selectSource),
    resolveService: wrap(base.resolveService),
    reconnect: wrap(base.reconnect),
    play: wrap(base.play),
    pause: wrap(base.pause),
    next: wrap(base.next),
    previous: wrap(base.previous),
  };
}

const silent = (base: Music = mockMusic()) =>
  reshaped(base, state => ({ ...state, nowPlaying: null }));

// Picks 멜론 and moves one song on, so 멜론's second song is the one last heard.
async function heardOnMelon() {
  await launch().selectSource('MELON');
  return (await launch().next()).nowPlaying!;
}

describe('withSavedMusic', () => {
  it('opens on Spotify on a first launch', async () => {
    const state = await launch().getState();
    expect(state.source).toBe('SPOTIFY');
    expect(state.nowPlaying).toBeNull();
  });

  it('brings back the picked source after a relaunch', async () => {
    await launch().selectSource('MELON');
    expect((await launch().getState()).source).toBe('MELON');

    await launch().selectSource(null);
    const cleared = await launch().getState();
    expect(cleared.source).toBeNull();
    expect(cleared.nowPlaying).toBeNull();
  });

  it('shows the last song, paused, when the service reports none', async () => {
    const heard = await heardOnMelon();
    const state = await launch(silent()).getState();
    expect(state.source).toBe('MELON');
    expect(state.nowPlaying).toEqual({ ...heard, playing: false });
  });

  it("lets the service's own song win", async () => {
    await heardOnMelon();
    // The mock plays its first liked song again, and that is what the card shows.
    expect((await launch().getState()).nowPlaying?.id).toBe('track-sea');
  });

  it('starts a new pick without the old source’s song', async () => {
    await heardOnMelon();
    await launch(silent()).selectSource('SPOTIFY');
    expect((await launch(silent()).getState()).nowPlaying).toBeNull();
  });

  it('never shows a Spotify cover on 멜론', async () => {
    // Spotify playing a song with album art, as the Web API reports it.
    const spotify = reshaped(mockMusic(), state =>
      state.source === 'SPOTIFY'
        ? {
            ...state,
            nowPlaying: {
              id: 'trk1',
              title: 'Ocean Run',
              subtitle: 'A',
              durationSec: 221,
              artworkUrl: 'https://i.scdn.co/image/640',
              positionSec: 84,
              playing: true,
            },
          }
        : state,
    );
    const music = launch(spotify);
    expect((await music.getState()).nowPlaying?.artworkUrl).toBeTruthy();
    const melon = await music.selectSource('MELON');
    expect(melon.nowPlaying?.artworkUrl).toBeUndefined();
    expect((await launch(silent()).getState()).nowPlaying?.artworkUrl).toBe(
      undefined,
    );
  });

  it('tries the restore again after a failed read', async () => {
    const base = mockMusic();
    let fail = true;
    const flaky = {
      ...base,
      getState: async () => {
        if (fail) {
          fail = false;
          throw new Error('offline');
        }
        return base.getState();
      },
    };
    const music = launch(flaky);
    await expect(music.getState()).rejects.toThrow('offline');
    expect((await music.getState()).source).toBe('SPOTIFY');
  });

  it('keeps the restored source when Spotify cannot read what is playing', async () => {
    const base = mockMusic();
    const failing = {
      ...base,
      selectSource: async (source: Parameters<Music['selectSource']>[0]) => {
        await base.selectSource(source);
        throw new Error('spotify down');
      },
    };
    expect((await launch(failing).getState()).source).toBe('SPOTIFY');
  });

  it('hides the saved song while the link is broken', async () => {
    await heardOnMelon();
    const broken = reshaped(mockMusic(), state => ({
      ...state,
      linked: false,
      nowPlaying: null,
    }));
    expect((await launch(broken).getState()).nowPlaying).toBeNull();
  });
});
