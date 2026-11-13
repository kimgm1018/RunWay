import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
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
  SpotifyError,
  spotifyFailureMessage,
  SpotifyStateError,
  useRepositories,
  type MusicState,
  type Playlist,
  type Track,
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
// 내 재생 목록 (담당자 요청) makes the card this much taller.
const playlistsHeight = 136;
// A song without album art (멜론, mock data) takes the mockup's default 'ocean' cover.
const ocean = ['#2F5174', '#22446A', '#1A3A5C', '#12304D'];

// Spotify and 멜론 play outside RunWay, so a linked card re-reads the state every few seconds.
const pollMs = 5000;
// A new song whose length has not come in yet (멜론 buffers for about a second), or one still buffering after
// 재생 (about 3 s when 멜론 wakes, S15P31E105-717), is read again this soon.
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
    polling.current &&
      state?.nowPlaying &&
      (!state.nowPlaying.durationSec || state.nowPlaying.buffering),
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

// The song's album cover over the card (2.7 핸드오프: art with a 10px blur over the lower part that fades upward).
// React Native cannot fade a blur with a mask, so the same blurred cover is laid on in faint bands, each a little
// shorter than the last: the blur builds up softly toward the foot (담당자 요청: 끊김 없이 은은하게). The bands sit
// closest together at the top, where the first ones would otherwise show an edge.
const blurBandCount = 14;
const blurBandOpacity = 0.24;
const blurRadius = 10;
// The faint blur starts this far up the card, at most 470.
const blurReach = 0.64;

function blurBands(boxHeight: number) {
  const reach = Math.min(boxHeight * blurReach, 470);
  return Array.from({ length: blurBandCount }, (_, index) =>
    Math.round(reach * (1 - (index / blurBandCount) ** 1.5)),
  );
}

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
      {blurBands(height).map((bandHeight, index) => (
        <View
          key={index}
          pointerEvents="none"
          style={[
            styles.band,
            { height: bandHeight, opacity: blurBandOpacity },
          ]}
        >
          <Image
            source={{ uri }}
            resizeMode="cover"
            blurRadius={blurRadius}
            style={[
              styles.bandImage,
              { width, height, top: bandHeight - height },
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
      {/* No length badge beside the title (담당자 요청): the length shows at the end of the progress bar. */}
      <AppText style={styles.title} numberOfLines={1}>
        {track?.title ?? '재생 중인 곡이 없어요'}
      </AppText>
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

type Shelf = 'PLAYLISTS' | 'RECENT';

// One cover in the sideways row: a playlist or a song heard lately.
function ShelfItem({
  title,
  detail,
  artworkUrl,
  icon = 'music',
  label,
  busy,
  onPress,
}: {
  title: string;
  detail: string | null;
  artworkUrl?: string | null;
  icon?: 'music' | 'heart' | 'clock';
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.playlist,
        (pressed || busy) && styles.pressed,
      ]}
    >
      {artworkUrl ? (
        <Image
          source={{ uri: artworkUrl }}
          style={styles.playlistCover}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.playlistCover, styles.playlistBlank]}>
          <Icon name={icon} color="#FFFFFF" size={22} />
        </View>
      )}
      <AppText style={styles.playlistName} numberOfLines={1}>
        {title}
      </AppText>
      {detail ? (
        <AppText style={styles.playlistCount} numberOfLines={1}>
          {detail}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// 내 재생 목록 and 최근 들은 곡 between the controls and the app button (담당자 요청): two tabs over one sideways
// row of covers; a tap starts a list from the top, or a song, on the music app. A Spotify sign-in from before
// their scopes gets 다시 로그인 instead.
function Library({
  playlists,
  recent,
  busy,
  onPlayPlaylist,
  onPlayTrack,
  onSignIn,
}: {
  playlists: Playlist[];
  recent: Track[];
  busy: boolean;
  onPlayPlaylist: (playlist: Playlist) => void;
  onPlayTrack: (track: Track) => void;
  onSignIn?: { note: string; run: () => void };
}) {
  const shelves: { key: Shelf; label: string }[] = [
    ...(playlists.length > 0
      ? [{ key: 'PLAYLISTS' as const, label: '내 재생 목록' }]
      : []),
    ...(recent.length > 0
      ? [{ key: 'RECENT' as const, label: '최근 들은 곡' }]
      : []),
  ];
  const [picked, setPicked] = useState<Shelf>('PLAYLISTS');
  const shelf =
    shelves.find(item => item.key === picked)?.key ?? shelves[0]?.key;
  return (
    <View style={styles.playlists}>
      {shelves.length > 0 ? (
        <View style={styles.shelfTabs} accessibilityRole="tablist">
          {shelves.map(item => {
            const on = item.key === shelf;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: on }}
                onPress={() => setPicked(item.key)}
                hitSlop={8}
              >
                <AppText
                  style={[styles.playlistsTitle, !on && styles.shelfTabOff]}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <AppText style={styles.playlistsTitle} accessibilityRole="header">
          내 재생 목록
        </AppText>
      )}
      {onSignIn ? (
        <View style={styles.playlistSignIn}>
          <AppText style={[styles.notice, styles.signInNote]}>
            {onSignIn.note}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Spotify 다시 로그인"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onSignIn.run}
            style={({ pressed }) => [
              styles.signInPill,
              (pressed || busy) && styles.pressed,
            ]}
          >
            <AppText style={styles.signInText}>다시 로그인</AppText>
          </Pressable>
        </View>
      ) : null}
      {shelf ? (
        <ScrollView
          // A new tab starts at its first cover.
          key={shelf}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.playlistScroll}
          contentContainerStyle={styles.playlistRow}
        >
          {shelf === 'PLAYLISTS'
            ? playlists.map(playlist => (
                <ShelfItem
                  key={playlist.id}
                  title={playlist.title}
                  detail={
                    playlist.trackCount === undefined
                      ? null
                      : `${playlist.trackCount}곡`
                  }
                  artworkUrl={playlist.artworkUrl}
                  icon={playlist.icon}
                  label={`${playlist.title} 재생 목록 재생`}
                  busy={busy}
                  onPress={() => onPlayPlaylist(playlist)}
                />
              ))
            : recent.map(track => (
                <ShelfItem
                  key={track.id}
                  title={track.title}
                  detail={track.subtitle || null}
                  artworkUrl={track.artworkUrl}
                  label={`${track.title} 재생`}
                  busy={busy}
                  onPress={() => onPlayTrack(track)}
                />
              ))}
        </ScrollView>
      ) : null}
    </View>
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
  // 내 재생 목록 and 최근 들은 곡, read again when the service or its link changes (and 최근 들은 곡 on a new
  // song); a failed read just leaves its tab out.
  const linked = state?.linked ?? false;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [recent, setRecent] = useState<Track[]>([]);
  // Why a list needs a Spotify sign-in, if it does: no permission yet, one Spotify stopped refreshing, or a browser
  // sign-in that may be another account than the phone's Spotify app (S15P31E105-573).
  const [playlistsSignIn, setPlaylistsSignIn] = useState<string | null>(null);
  const [recentSignIn, setRecentSignIn] = useState<string | null>(null);
  const signInNote = playlistsSignIn ?? recentSignIn;
  const needsSignIn = signInNote !== null;
  // Bumped after 다시 로그인 to read both again.
  const [playlistRead, setPlaylistRead] = useState(0);
  const songId = state?.nowPlaying?.id ?? null;
  // 멜론 목록의 표지·곡 수는 이 앱에서 재생한 뒤 기억되므로 곡이 바뀌면 다시 읽는다(Spotify 목록은 그대로).
  const melonSong = service === 'MELON' ? songId : null;
  const scopeMissing = (error: unknown) =>
    error instanceof SpotifyError &&
    (error.reason === 'SCOPE_REQUIRED' ||
      error.reason === 'LIBRARY_EXPIRED' ||
      error.reason === 'ACCOUNT_CHECK')
      ? spotifyFailureMessage(error, '')
      : null;
  useEffect(() => {
    setPlaylistsSignIn(null);
    if (!service || !linked) {
      setPlaylists([]);
      return;
    }
    let live = true;
    music.getPlaylists().then(
      found => {
        if (live) setPlaylists(found);
      },
      error => {
        if (!live) return;
        setPlaylists([]);
        setPlaylistsSignIn(scopeMissing(error));
      },
    );
    return () => {
      live = false;
    };
  }, [music, service, linked, playlistRead, melonSong]);
  useEffect(() => {
    setRecentSignIn(null);
    if (!service || !linked) {
      setRecent([]);
      return;
    }
    let live = true;
    music.getRecentTracks().then(
      found => {
        if (live) setRecent(found);
      },
      error => {
        if (!live) return;
        setRecent([]);
        setRecentSignIn(scopeMissing(error));
      },
    );
    return () => {
      live = false;
    };
  }, [music, service, linked, playlistRead, songId]);
  const signInForPlaylists = async () => {
    setBusy(true);
    try {
      if (music.connectLibrary) {
        await music.connectLibrary();
        setState(await music.getState());
      } else {
        setState(await music.resolveService('SPOTIFY'));
      }
      setPlaylistRead(count => count + 1);
    } catch (error) {
      say(spotifyFailureMessage(error, 'Spotify에 로그인하지 못했어요'));
    }
    setBusy(false);
  };
  const playPlaylist = async (playlist: Playlist) => {
    setBusy(true);
    try {
      setState(await music.playPlaylist(playlist.id));
    } catch (error) {
      say(
        spotifyFailureMessage(
          error,
          error instanceof Error && error.message
            ? error.message
            : '재생 목록을 틀지 못했어요',
        ),
      );
    }
    setBusy(false);
  };
  const playTrack = async (track: Track) => {
    setBusy(true);
    try {
      setState(await music.playTrack(track.id));
    } catch (error) {
      say(
        spotifyFailureMessage(
          error,
          error instanceof Error && error.message
            ? error.message
            : '곡을 틀지 못했어요',
        ),
      );
    }
    setBusy(false);
  };
  const showPlaylists = Boolean(
    service &&
      linked &&
      (playlists.length > 0 || recent.length > 0 || needsSignIn),
  );
  const artwork = service ? state?.nowPlaying?.artworkUrl : null;
  const [loadedArt, setLoadedArt] = useState<string | null>(null);
  return (
    <MusicOverlay dark>
      <View
        style={[
          styles.card,
          {
            height: Math.min(
              cardHeight + (showPlaylists ? playlistsHeight : 0),
              screenHeight - 160,
            ),
          },
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
              <Player
                state={state}
                busy={busy}
                onCommand={runCommand}
                canStartWithoutTrack={music.canStartWithoutTrack}
              />
              {showPlaylists ? (
                <Library
                  playlists={playlists}
                  recent={recent}
                  busy={busy}
                  onPlayPlaylist={playPlaylist}
                  onPlayTrack={playTrack}
                  onSignIn={
                    signInNote !== null
                      ? { note: signInNote, run: signInForPlaylists }
                      : undefined
                  }
                />
              ) : null}
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
  title: {
    flexShrink: 1,
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.6,
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
  playlists: { marginTop: 12 },
  shelfTabs: { flexDirection: 'row', gap: 16 },
  shelfTabOff: { color: 'rgba(255,255,255,0.45)' },
  playlistSignIn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  signInNote: { flex: 1, marginTop: 0 },
  signInPill: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  signInText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: '#02050E',
  },
  playlistsTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.86)',
  },
  // Runs to the card's edges so a cover slides out under them.
  playlistScroll: { marginTop: 8, marginHorizontal: -18 },
  playlistRow: { gap: 10, paddingHorizontal: 18 },
  playlist: { width: 72 },
  playlistCover: { width: 72, height: 72, borderRadius: 14 },
  playlistBlank: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistName: {
    marginTop: 6,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: '#FFFFFF',
  },
  playlistCount: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.6)',
  },
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
