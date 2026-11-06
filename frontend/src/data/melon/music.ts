import type { MusicServiceStatus, MusicState, Repositories } from '../types';
import type { MelonBridge, MelonCommand, MelonPlayback } from './bridge';

type Music = Repositories['music'];

export class MelonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MelonError';
  }
}

// 멜론 Android 연동의 2.7·2.8 음악 저장소(S15P31E105-398). Spotify·음악 없음은 `base`가 맡는다.
// 상태 구분(MUS-002): 미설치·MediaBrowser 미지원 → 설치, 알림 접근 미허용 → 허용, 연결 거부·인증 오류 → 로그인.
// 확인하지 못한 상태와 권한이 없는 상태에서는 제어 명령을 보내지 않는다. 명령 뒤에는 `settleMs`마다 상태를 다시
// 읽어 반영을 확인하고(MUS-004), 끝내 확인되지 않으면 멜론이 알린 상태를 그대로 보여 준다.
export function withMelon(
  base: Music,
  melon: MelonBridge,
  { settleMs = 100 } = {},
): Music {
  // 멜론은 기기 안에서 바로 상태를 알리므로 짧은 간격으로 자주 확인해 반영되는 즉시 돌려준다. 최대 약 2초,
  // 이전 곡의 다시 재생 판단은 최대 약 0.6초까지 기다린다.
  const settleTries = 20;
  const restartTries = 6;
  // 음원 선택값을 가진 기본 저장소 상태. 이 계층을 거쳐서만 바뀌므로 한 번 읽은 값을 재사용한다(목업은 호출마다
  // 지연이 있어 명령마다 다시 읽으면 전환이 느려진다).
  let baseCache: MusicState | null = null;
  const baseState = async () => (baseCache ??= await base.getState());
  const keep = (state: MusicState) => {
    baseCache = state;
    return state;
  };
  // 2.8에서 멜론을 고르지 않았으면 MediaBrowser에 연결하지 않고 설치·권한만 본다.
  async function service(
    picked: boolean,
  ): Promise<{ status: MusicServiceStatus; playback: MelonPlayback | null }> {
    const status = await melon.status();
    if (!status.installed || !status.browsable) {
      return { status: 'INSTALL_REQUIRED', playback: null };
    }
    if (!status.permitted) {
      return { status: 'PERMISSION_REQUIRED', playback: null };
    }
    if (!picked) {
      return { status: 'CONNECTED', playback: null };
    }
    // 권한이 있는데 멜론이 연결을 받지 않으면 로그인 전으로 본다(실기기 미검증 가정).
    if (!(await melon.connect())) {
      return { status: 'LOGIN_REQUIRED', playback: null };
    }
    const playback = await melon.playback();
    return {
      status: playback.loginRequired ? 'LOGIN_REQUIRED' : 'CONNECTED',
      playback,
    };
  }

  function nowPlaying(playback: MelonPlayback): MusicState['nowPlaying'] {
    const track = playback.track;
    if (!track) {
      return null;
    }
    return {
      id: track.id,
      title: track.title,
      // MUS-004: 카드에 아티스트를 보여 준다.
      subtitle: track.artist,
      durationSec: Math.round(track.durationMs / 1000),
      // 메타데이터에 앨범 아트가 없으면 null이라 2.7은 기본 커버를 그린다.
      artworkUrl: track.artworkUri,
      positionSec: Math.round(track.positionMs / 1000),
      playing: playback.playing,
    };
  }

  async function read(): Promise<{
    state: MusicState;
    playback: MelonPlayback | null;
  }> {
    const state = await baseState();
    const picked = state.source === 'MELON';
    const { status, playback } = await service(picked);
    const services = { ...state.services, MELON: status };
    if (!picked) {
      return { state: { ...state, services }, playback: null };
    }
    // 좋아요한 곡·플레이리스트·TOP100 목록은 이번 범위가 아니어서 목업 목록을 실제처럼 보이지 않게 비운다.
    const melonState = { ...state, services, library: null };
    if (status !== 'CONNECTED' || !playback?.connected) {
      // 2.7b 연결이 끊겼어요: 다시 연결에서 권한·로그인·연결을 다시 확인한다(MUS-005).
      return {
        state: { ...melonState, linked: false, nowPlaying: null },
        playback,
      };
    }
    return {
      state: { ...melonState, linked: true, nowPlaying: nowPlaying(playback) },
      playback,
    };
  }

  const getState = async () => (await read()).state;

  // 멜론 앱·설정으로 보내 문제를 풀게 한다. 돌아온 것만으로 연결됐다고 보지 않고 상태를 다시 읽는다(MUS-005).
  async function fix(status: MusicServiceStatus) {
    if (status === 'PERMISSION_REQUIRED') {
      await melon.openPermissionSettings();
    } else if (status === 'INSTALL_REQUIRED' || status === 'LOGIN_REQUIRED') {
      await melon.openMelon();
    }
  }

  const isPlaying = (state: MusicState) => state.nowPlaying?.playing === true;
  const moved = (state: MusicState, before: string | null) =>
    (state.nowPlaying?.id ?? null) !== before;
  // 이전 명령에 멜론이 같은 곡을 처음부터 다시 재생한 상태.
  const restarted = (state: MusicState, before: string | null) =>
    !moved(state, before) && (state.nowPlaying?.positionSec ?? 0) <= 1;

  function command(
    name: MelonCommand,
    fallback: () => Promise<MusicState>,
    applied: (state: MusicState, before: string | null) => boolean,
  ) {
    return async () => {
      const current = await baseState();
      if (current.source !== 'MELON') {
        return keep(await fallback());
      }
      const { state, playback } = await read();
      // MUS-002: 확인되지 않았거나 권한이 없으면 제어하지 않는다.
      if (!state.linked || !playback?.connected) {
        throw new MelonError('멜론과 연결되지 않았어요');
      }
      const before = state.nowPlaying?.id ?? null;
      const startedAt = state.nowPlaying?.positionSec ?? 0;
      // MUS-003: 재생할 곡이 없으면 기본 재생목록, 없으면 TOP100을 처음부터 재생한다.
      if (name === 'play' && !playback.track) {
        if ((await melon.playDefault()) === 'NONE') {
          throw new MelonError('멜론에서 재생할 목록을 찾지 못했어요');
        }
        return settle(
          state,
          next => isPlaying(next) && next.nowPlaying !== null,
        );
      }
      if (!playback.commands.includes(name)) {
        throw new MelonError('멜론에서 지원하지 않는 조작이에요');
      }
      await send(name);
      if (name === 'previous') {
        // 멜론은 몇 초 이상 들은 곡에서 이전을 누르면 처음부터 다시 재생하고, 바로 한 번 더 누르면 앞 곡으로
        // 간다(갤럭시 S22 실기기 확인). 같은 곡이 처음으로 돌아간 것을 보면 바로 한 번 더 보낸다.
        const first = await settle(
          state,
          next =>
            moved(next, before) || (startedAt > 1 && restarted(next, before)),
          restartTries,
        );
        if (!moved(first, before)) {
          await send(name);
        }
      }
      return settle(state, next => applied(next, before));
    };
  }

  async function send(name: MelonCommand) {
    if (!(await melon.send(name))) {
      throw new MelonError('멜론을 조작하지 못했어요');
    }
  }

  // `settleMs`마다 다시 읽어 명령이 반영됐는지 본다. 끝내 확인되지 않으면 멜론이 알린 마지막 상태를 돌려준다.
  async function settle(
    state: MusicState,
    done: (next: MusicState) => boolean,
    tries = settleTries,
  ) {
    let next = state;
    for (let attempt = 0; attempt < tries; attempt++) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), settleMs));
      next = await getState();
      if (done(next)) {
        break;
      }
    }
    return next;
  }

  return {
    getState,
    selectSource: async source => {
      keep(await base.selectSource(source));
      return getState();
    },
    resolveService: async name => {
      if (name !== 'MELON') {
        keep(await base.resolveService(name));
        return getState();
      }
      await fix((await service(false)).status);
      return getState();
    },
    reconnect: async () => {
      const current = await baseState();
      if (current.source !== 'MELON') {
        keep(await base.reconnect());
        return getState();
      }
      const { status } = await service(true);
      await fix(status);
      return getState();
    },
    play: command('play', base.play, isPlaying),
    pause: command('pause', base.pause, state => !isPlaying(state)),
    // 멜론은 새 곡을 약 0.1초 만에 알리고 길이는 버퍼링 뒤(0.8~1.5초) 알린다(갤럭시 S22 실기기 측정). 새 곡이
    // 보이면 바로 돌려주고, 길이는 2.7 카드가 짧은 간격으로 다시 읽어 채운다.
    next: command('next', base.next, moved),
    previous: command('previous', base.previous, moved),
  };
}
