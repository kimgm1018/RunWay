import * as Keychain from 'react-native-keychain';
import type { MusicSource, MusicState, Repositories } from '../types';

type Music = Repositories['music'];
type Playing = NonNullable<MusicState['nowPlaying']>;

// The picked source and the song last heard on it. Not a secret, but the keystore is the one store the app
// already has, so it saves a native dependency.
type Saved = { source: MusicSource | null; track: Playing | null };

const service = 'com.runway.health.music';

// The source a first launch opens on, before anything is picked on 2.8.
const firstSource: MusicSource = 'SPOTIFY';

function parse(saved: string): Saved | null {
  try {
    const value = JSON.parse(saved);
    const source = ['MELON', 'SPOTIFY', 'NONE'].includes(value?.source)
      ? (value.source as MusicSource)
      : null;
    const track =
      typeof value?.track?.id === 'string' &&
      typeof value.track.title === 'string'
        ? { ...(value.track as Playing), playing: false }
        : null;
    return { source, track };
  } catch {
    return null;
  }
}

// Keeps what 2.7 shows across a relaunch (S15P31E105-397): a first launch opens on Spotify, the source picked on
// 2.8 comes back, and when the service reports nothing playing, the card shows the last song, paused. Spotify's
// own report wins.
export function withSavedMusic(base: Music): Music {
  // Read once on launch.
  let memo: Saved | null = null;
  let restoring: Promise<void> | null = null;

  async function write() {
    try {
      await Keychain.setGenericPassword('music', JSON.stringify(memo), {
        service,
      });
    } catch {
      // Losing the memo only means 2.7 starts over on the next launch.
    }
  }

  async function restore() {
    try {
      const saved = await Keychain.getGenericPassword({ service });
      memo = saved ? parse(saved.password) : null;
    } catch {
      memo = null;
    }
    memo ??= { source: firstSource, track: null };
    const state = await base.getState();
    if (state.source !== memo.source) {
      try {
        await base.selectSource(memo.source);
      } catch {
        // The pick is made before Spotify reads back what is playing, so a failed read still leaves the source
        // restored; the call that follows reports that failure itself.
      }
    }
  }

  async function view(state: MusicState): Promise<MusicState> {
    const heard = state.nowPlaying;
    if (heard) {
      // Saves on a new song or play/pause, not on every read, so the position is the one at the last pause.
      if (
        heard.id !== memo?.track?.id ||
        heard.playing !== memo.track.playing
      ) {
        memo = { source: state.source, track: heard };
        await write();
      }
      return state;
    }
    const track = memo?.track;
    return track && state.linked && memo?.source === state.source
      ? { ...state, nowPlaying: { ...track, playing: false } }
      : state;
  }

  // Every call waits for the launch restore, so no read sees the default source first. A restore that failed
  // (the base could not be read) is tried again by the next call instead of failing every call after it.
  const after =
    <A extends unknown[]>(call: (...args: A) => Promise<MusicState>) =>
    async (...args: A) => {
      restoring ??= restore().catch(error => {
        restoring = null;
        throw error;
      });
      await restoring;
      return view(await call(...args));
    };

  return {
    getState: after(base.getState),
    selectSource: after(async (source: MusicSource | null) => {
      const state = await base.selectSource(source);
      // A song belongs to the source it played on, so a new pick starts without one.
      memo = { source, track: null };
      await write();
      return state;
    }),
    resolveService: after(base.resolveService),
    reconnect: after(base.reconnect),
    play: after(base.play),
    pause: after(base.pause),
    next: after(base.next),
    previous: after(base.previous),
  };
}
