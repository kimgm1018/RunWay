import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, {
  Defs,
  LinearGradient,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { AppText, Icon, useToast } from '../../components';
import {
  spotifyFailureMessage,
  SpotifyStateError,
  useRepositories,
  type MusicState,
} from '../../data';
import { formatDuration } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import { MusicOverlay, useLivePosition } from './musicParts';
import { GlassIconButton } from '../../components/GlassIconButton';

const serviceNames = { MELON: '멜론', SPOTIFY: 'Spotify' };

// Deep links into the music apps; a missing app falls back to a toast.
const appLinks = { MELON: 'melonapp://', SPOTIFY: 'spotify://' };

// 2.7 핸드오프 (S15P31E105-374): the card is 370×500 on a 390 screen; a shorter phone gets a shorter card.
const cardHeight = 500;
// A song without album art (멜론, mock data) takes the mockup's default 'ocean' cover.
const ocean = ['#2F5174', '#22446A', '#1A3A5C', '#12304D'];

// Spotify and 멜론 play outside RunWay, so a linked card re-reads the state every few seconds.
const pollMs = 5000;
// A new song whose length has not come in yet (멜론 buffers for about a second) is read again this soon.
const lengthPollMs = 300;

function useMusicState() {
  const { music } = useRepositories();
  const toast = useToast();
  const [state, setState] = useState<MusicState | null>(null);
  const [failed, setFailed] = useState(false);
  const polling = useRef(false);
  const reread = useRef<() => void>(() => {});
  polling.current =
    (state?.source === 'MELON' ||
      (state?.source === 'SPOTIFY' && !music.subscribe)) &&
    state.linked;
  const lengthMissing = Boolean(
    polling.current && state?.nowPlaying && !state.nowPlaying.durationSec,
  );
  useEffect(() => {
    if (!lengthMissing) {
      return;
    }
    const timer = setTimeout(() => reread.current(), lengthPollMs);
    return () => clearTimeout(timer);
  }, [lengthMissing, state]);
  // 2.8 opens on top of this card, so re-read the state whenever the card shows again.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let revision = 0;
      const read = () => {
        const requested = revision;
        return music.getState().then(
          next =>
            active &&
            requested === revision &&
            (setState(next), setFailed(false)),
          error => {
            if (!active || requested !== revision) {
              return;
            }
            setFailed(true);
            setState(error instanceof SpotifyStateError ? error.state : null);
            const message = spotifyFailureMessage(
              error,
              '음악 정보를 불러오지 못했어요',
            );
            if (message) {
              toast(message);
            }
          },
        );
      };
      const stop = music.subscribe?.(next => {
        if (active) {
          revision++;
          setState(next);
          setFailed(false);
        }
      });
      const appState = AppState.addEventListener('change', next => {
        if (next === 'active') {
          read();
        }
      });
      reread.current = read;
      read();
      const timer = setInterval(() => polling.current && read(), pollMs);
      return () => {
        active = false;
        reread.current = () => {};
        clearInterval(timer);
        stop?.();
        appState.remove();
      };
    }, [music, toast]),
  );
  return { state, setState, failed };
}

// The cover behind the whole card: the ocean gradient, a soft light, fine slanted lines and a tint
// that darkens the bottom 300 under the text. It takes the measured size (Android drops percent Svgs).
function Cover({ width, height }: { width: number; height: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <LinearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
          {ocean.map((color, index) => (
            <Stop
              key={color}
              offset={[0, 0.45, 0.75, 1][index]}
              stopColor={color}
            />
          ))}
        </LinearGradient>
        <RadialGradient
          id="coverLight"
          cx={0.68}
          cy={0.34}
          fx={0.68}
          fy={0.34}
          rx={0.8}
          ry={0.3}
        >
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.24} />
          <Stop offset={0.7} stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <Pattern
          id="coverLines"
          width={9}
          height={9}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-4)"
        >
          <Rect width={9} height={2} fill="#FFFFFF" fillOpacity={0.05} />
        </Pattern>
        <LinearGradient id="coverTint" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#0E2238" stopOpacity={0} />
          <Stop offset={0.45} stopColor="#0E2238" stopOpacity={0.16} />
          <Stop offset={1} stopColor="#0E2238" stopOpacity={0.16} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#cover)" />
      <Rect width={width} height={height} fill="url(#coverLight)" />
      <Rect width={width} height={height} fill="url(#coverLines)" />
      <Rect
        y={height - 300}
        width={width}
        height={300}
        fill="url(#coverTint)"
      />
    </Svg>
  );
}

// The song's album cover over the card (2.7 핸드오프: art with a 10px blur over the bottom 300 that fades upward).
// React Native cannot fade a blur with a mask, so stacked bands blur a little harder every 40 toward the foot,
// and a dark tint over the bottom keeps the white text readable on any cover.
const blurBands = [
  { height: 300, radius: 1 },
  { height: 260, radius: 2 },
  { height: 220, radius: 4 },
  { height: 180, radius: 6 },
  { height: 140, radius: 8 },
  { height: 100, radius: 10 },
];

function Artwork({
  uri,
  width,
  height,
  onLoad,
}: {
  uri: string;
  width: number;
  height: number;
  onLoad: () => void;
}) {
  return (
    <>
      <Image
        source={{ uri }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        onLoad={onLoad}
        style={StyleSheet.absoluteFill}
      />
      {blurBands.map(band => (
        <View
          key={band.height}
          pointerEvents="none"
          style={[styles.band, { height: band.height }]}
        >
          <Image
            source={{ uri }}
            resizeMode="cover"
            blurRadius={band.radius}
            style={[
              styles.bandImage,
              { width, height, top: band.height - height },
            ]}
          />
        </View>
      ))}
      {/* 2 taller than the card: the measured height is fractional, and a tint that stops short leaves a
          bright hairline of bare art along the round bottom edge. */}
      <Svg
        style={styles.tint}
        width={width}
        height={height + 2}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="artTint" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor="#000000" stopOpacity={0} />
            <Stop offset={0.3} stopColor="#000000" stopOpacity={0.3} />
            <Stop offset={1} stopColor="#000000" stopOpacity={0.6} />
          </LinearGradient>
        </Defs>
        <Rect
          y={height - 340}
          width={width}
          height={342}
          fill="url(#artTint)"
        />
      </Svg>
    </>
  );
}

// The glass ⚙ at the top right opens 2.8 음원 선택 in every state (runway-music-handoff).
function SettingsButton({ onPress }: { onPress: () => void }) {
  return (
    <GlassIconButton
      icon="cog"
      tone="dark"
      accessibilityLabel="음악 연결 설정"
      onPress={onPress}
      style={styles.settings}
    />
  );
}

// The white button at the foot of the card.
function WideButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.wide,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <AppText style={styles.wideText}>{label}</AppText>
    </Pressable>
  );
}

type Command = 'play' | 'pause' | 'next' | 'previous';

// 곡 제목 with its length, then the artist or album line, the position and 이전 · 재생/일시정지 · 다음.
// The mockup's 셔플·반복 are left out: the app has no shuffle or repeat (담당자 결정).
// The buttons show the state read back after a command, never a guess (MUS-004).
function Player({
  state,
  busy,
  onCommand,
  canStartWithoutTrack = false,
}: {
  canStartWithoutTrack?: boolean;
  state: MusicState;
  busy: boolean;
  onCommand: (command: Command) => void;
}) {
  const track = state.nowPlaying;
  const playing = track?.playing ?? false;
  // 멜론이 길이를 아직 알리지 않은 새 곡은 0:00 대신 --:--로 둔다.
  const length = track?.durationSec
    ? formatDuration(track.durationSec)
    : track
    ? '--:--'
    : '0:00';
  const position = useLivePosition(track);
  const progress = track?.durationSec
    ? Math.min(position / track.durationSec, 1)
    : 0;
  const idle = !track || busy;
  // 멜론은 곡이 없어도 재생으로 기본 재생목록(없으면 TOP100)을 처음부터 튼다(S15P31E105-398).
  const playIdle =
    busy || (!track && state.source !== 'MELON' && !canStartWithoutTrack);
  return (
    <>
      <View style={styles.titleRow}>
        <AppText style={styles.title} numberOfLines={1}>
          {track?.title ?? '재생 중인 곡이 없어요'}
        </AppText>
        {track ? (
          <View style={styles.length}>
            <AppText style={styles.lengthText}>{length}</AppText>
          </View>
        ) : null}
      </View>
      <AppText style={styles.subtitle} numberOfLines={1}>
        {track?.subtitle ??
          (state.source === 'SPOTIFY'
            ? canStartWithoutTrack
              ? '재생을 누르면 마지막으로 듣던 음악을 이어 틀어요'
              : 'Spotify 앱에서 곡을 재생하면 여기에 보여요'
            : state.source === 'MELON'
            ? '재생을 누르면 멜론 재생목록을 틀어요'
            : '--')}
      </AppText>
      {state.source === 'SPOTIFY' && !state.premium ? (
        <AppText style={styles.notice}>
          {canStartWithoutTrack
            ? '곡을 지정해 재생하려면 Spotify Premium이 필요해요'
            : '재생을 조작하려면 Spotify Premium이 필요해요'}
        </AppText>
      ) : null}
      <View
        accessibilityLabel="재생 위치"
        accessibilityValue={{
          min: 0,
          max: track?.durationSec ?? 0,
          now: Math.floor(position),
        }}
        style={styles.progress}
      >
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        <View style={[styles.knob, { left: `${progress * 100}%` }]} />
      </View>
      <View style={styles.times}>
        <AppText style={styles.time}>
          {track ? formatDuration(Math.floor(position)) : '0:00'}
        </AppText>
        <AppText style={styles.time}>{length}</AppText>
      </View>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 곡"
          accessibilityState={{ disabled: idle }}
          disabled={idle}
          onPress={() => onCommand('previous')}
          style={styles.control}
        >
          <Icon name="skipBack" color="#FFFFFF" size={22} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? '일시정지' : '재생'}
          accessibilityState={{ disabled: playIdle }}
          disabled={playIdle}
          onPress={() => onCommand(playing ? 'pause' : 'play')}
          style={styles.play}
        >
          {playing ? (
            <>
              <View style={styles.bar} />
              <View style={styles.bar} />
            </>
          ) : (
            <Icon name="play" color="#FFFFFF" size={22} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다음 곡"
          accessibilityState={{ disabled: idle }}
          disabled={idle}
          onPress={() => onCommand('next')}
          style={styles.control}
        >
          <Icon name="skipForward" color="#FFFFFF" size={22} />
        </Pressable>
      </View>
    </>
  );
}

// 2.7 음악 카드 — 멜론, 2.7S Spotify, 2.7a 미연결, 2.7b 연결 끊김, all on one cover card.
export function MusicCardScreen() {
  const navigation = useNavigation();
  const { height: screenHeight } = useWindowDimensions();
  const { music } = useRepositories();
  const toast = useToast();
  const { state, setState, failed } = useMusicState();
  const [reconnecting, setReconnecting] = useState(false);
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  const openSource = () => navigateTo(navigation, 'MusicSource');
  const service =
    state?.source === 'MELON' || state?.source === 'SPOTIFY'
      ? state.source
      : null;
  const openApp = async () => {
    if (!service) {
      return;
    }
    try {
      await Linking.openURL(appLinks[service]);
    } catch {
      toast(`${serviceNames[service]} 앱을 열 수 없어요`);
    }
  };
  const say = (message: string | null) => message && toast(message);
  const reconnect = async () => {
    setReconnecting(true);
    try {
      setState(await music.reconnect());
    } catch (error) {
      if (error instanceof SpotifyStateError) {
        setState(error.state);
      }
      say(spotifyFailureMessage(error, '다시 연결하지 못했어요'));
    }
    setReconnecting(false);
  };
  const [busy, setBusy] = useState(false);
  const runCommand = async (command: Command) => {
    setBusy(true);
    try {
      setState(await music[command]());
    } catch (error) {
      if (error instanceof SpotifyStateError) {
        setState(error.state);
      }
      say(spotifyFailureMessage(error, '음악을 조작하지 못했어요'));
    }
    setBusy(false);
  };
  const artwork = service ? state?.nowPlaying?.artworkUrl : null;
  const [loadedArt, setLoadedArt] = useState<string | null>(null);
  return (
    <MusicOverlay dark>
      <View
        style={[
          styles.card,
          { height: Math.min(cardHeight, screenHeight - 160) },
        ]}
        onLayout={measure}
      >
        {/* The ocean cover shows while a song's art loads, or if it never does. Once the art is in it goes,
            or its light blue would show through the soft pixels of the round edge. */}
        {box && loadedArt !== artwork ? <Cover {...box} /> : null}
        {box && artwork ? (
          <Artwork
            uri={artwork}
            onLoad={() => setLoadedArt(artwork)}
            {...box}
          />
        ) : null}
        <SettingsButton onPress={openSource} />
        <View style={styles.body}>
          {!state ? (
            failed ? (
              <AppText style={styles.message}>
                음악 정보를 불러오지 못했어요
              </AppText>
            ) : (
              <ActivityIndicator color="#FFFFFF" />
            )
          ) : !service ? (
            // 2.7a 미연결 (also 음악 없음): pick a service in 2.8.
            <>
              <AppText style={styles.title}>
                음악 서비스를 연결해 주세요
              </AppText>
              <AppText style={styles.subtitle}>
                멜론이나 Spotify를 연결하면 여기서 들을 수 있어요
              </AppText>
              <WideButton label="음원 선택" onPress={openSource} />
            </>
          ) : !state.linked ? (
            // 2.7b: the link to the music app dropped.
            <>
              <AppText style={styles.title}>연결이 끊겼어요</AppText>
              <AppText style={styles.subtitle}>
                {`${serviceNames[service]} 앱과 연결을 다시 확인해 주세요`}
              </AppText>
              <WideButton
                label={reconnecting ? '다시 연결하는 중' : '다시 연결'}
                disabled={reconnecting}
                onPress={reconnect}
              />
            </>
          ) : (
            <>
              {/* The page dots of the mockup: this card is the first of three. */}
              <View
                style={styles.dots}
                importantForAccessibility="no-hide-descendants"
              >
                <View style={[styles.dot, styles.dotOn]} />
                <View style={styles.dot} />
                <View style={styles.dot} />
              </View>
              <Player
                state={state}
                busy={busy}
                onCommand={runCommand}
                canStartWithoutTrack={music.canStartWithoutTrack}
              />
              <WideButton
                label={`${serviceNames[service]} 열기`}
                onPress={openApp}
              />
            </>
          )}
        </View>
      </View>
    </MusicOverlay>
  );
}

const styles = StyleSheet.create({
  // Dark behind the cover, so the soft pixels of the round edge blend into it.
  card: { borderRadius: 34, overflow: 'hidden', backgroundColor: '#0B1520' },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  bandImage: { position: 'absolute', left: 0 },
  tint: { position: 'absolute', top: 0, left: 0 },
  body: {
    flex: 1,
    paddingHorizontal: 18,
    paddingBottom: 18,
    justifyContent: 'flex-end',
  },
  message: {
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  // No border (핸드오프); the card's own blur stands in for the mockup's backdrop blur.
  settings: { position: 'absolute', top: 14, right: 14, zIndex: 1 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotOn: { backgroundColor: '#FFFFFF' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flexShrink: 1,
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  length: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(0,0,0,0.12)',
    justifyContent: 'center',
  },
  lengthText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
    color: '#FFFFFF',
  },
  subtitle: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.66)',
  },
  notice: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.66)',
  },
  progress: {
    height: 3,
    marginTop: 18,
    marginHorizontal: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  knob: {
    position: 'absolute',
    top: -3,
    width: 9,
    height: 9,
    marginLeft: -4,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginHorizontal: 4,
  },
  time: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
    color: 'rgba(255,255,255,0.72)',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
    marginTop: 6,
  },
  control: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  bar: { width: 4, height: 17, borderRadius: 1, backgroundColor: '#FFFFFF' },
  wide: {
    marginTop: 12,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  wideText: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: '#02050E',
  },
});
