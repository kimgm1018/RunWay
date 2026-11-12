import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  spotifyFailureMessage,
  SpotifyStateError,
  type MusicState,
  type Repositories,
} from '../../data';
import type { MusicCommand } from './live/RunLivePages';

type Music = Repositories['music'];

// 2.7 카드와 같은 간격. 음악은 RunWay 밖에서 재생되므로 알림을 주지 않는 연동은 몇 초마다 다시 읽는다.
export const liveMusicPollMs = 5000;

// 연동이 곡 변화를 알려 주지 않으면(멜론, App Remote 없는 Spotify) 주기적으로 다시 읽는다.
function needsPolling(state: MusicState | null, music: Music) {
  return Boolean(
    state?.linked &&
      (state.source === 'MELON' ||
        (state.source === 'SPOTIFY' && !music.subscribe)),
  );
}

// 4.2·6.6 러닝 중 음악 줄의 상태(S15P31E105-717). 러닝 진행·일시정지와 관계없이 화면이 보이는 동안 실제 재생곡을
// 따라간다: 변화 알림을 받고, 알림이 없는 연동은 주기적으로 다시 읽고, 앱으로 돌아오면 다시 읽는다.
export function useLiveMusic(music: Music, toast: (message: string) => void) {
  const [player, setPlayer] = useState<MusicState | null>(null);
  const [busy, setBusy] = useState(false);
  // 늦게 도착한 이전 읽기가 더 새 상태(알림·명령 결과)를 덮지 않게 한다.
  const revision = useRef(0);
  const polling = useRef(false);
  polling.current = needsPolling(player, music);

  const apply = (state: MusicState) => {
    revision.current++;
    setPlayer(state);
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let reading = false;
      const read = () => {
        if (reading) {
          return;
        }
        reading = true;
        const requested = revision.current;
        music
          .getState()
          .then(
            state => {
              if (active && requested === revision.current) {
                setPlayer(state);
              }
            },
            error => {
              if (
                active &&
                requested === revision.current &&
                error instanceof SpotifyStateError
              ) {
                setPlayer(error.state);
              }
            },
          )
          .finally(() => {
            reading = false;
          });
      };
      const stop = music.subscribe?.(state => {
        if (active) {
          revision.current++;
          setPlayer(state);
        }
      });
      const appState = AppState.addEventListener('change', next => {
        if (next === 'active') {
          read();
        }
      });
      read();
      const timer = setInterval(
        () => polling.current && read(),
        liveMusicPollMs,
      );
      return () => {
        active = false;
        clearInterval(timer);
        stop?.();
        appState.remove();
      };
    }, [music]),
  );

  const command = async (name: MusicCommand) => {
    setBusy(true);
    try {
      apply(await music[name]());
    } catch (error) {
      if (error instanceof SpotifyStateError) {
        apply(error.state);
      }
      const message = spotifyFailureMessage(error, '음악을 조작하지 못했어요');
      if (message) {
        toast(message);
      }
    }
    setBusy(false);
  };

  const shown =
    player?.source && player.source !== 'NONE' && player.linked ? player : null;
  return { player: shown, busy, command };
}
