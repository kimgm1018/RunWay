import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, useToast } from '../../components';
import { useRepositories, type MusicState, type Track } from '../../data';
import { formatClockTime, formatDuration } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, spacing, ThemeProvider, useTheme } from '../../theme';
import { AlbumArt, MusicSheet, SectionTitle } from './musicParts';

const serviceNames = { MELON: '멜론', SPOTIFY: 'Spotify' };

// Deep links into the music apps; a missing app falls back to a toast.
const appLinks = { MELON: 'melonapp://', SPOTIFY: 'spotify://' };

function useMusicState() {
  const { music } = useRepositories();
  const [state, setState] = useState<MusicState | null>(null);
  const [failed, setFailed] = useState(false);
  // 2.8 sits on top of this card, so re-read the state whenever the card shows again.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      music.getState().then(
        next => active && (setState(next), setFailed(false)),
        () => active && setFailed(true),
      );
      return () => {
        active = false;
      };
    }, [music]),
  );
  return { state, setState, failed };
}

// The black round gear that opens 2.8 (DESIGN.md 2-6 음악 카드).
function SettingsButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="음원 선택"
      onPress={onPress}
      hitSlop={6}
      style={[styles.gear, { backgroundColor: colors.accent }]}
    >
      <Icon name="settings" color={colors.onAccent} size={18} />
    </Pressable>
  );
}

function Player({
  state,
  onSettings,
}: {
  state: MusicState;
  onSettings: () => void;
}) {
  const { colors } = useTheme();
  const track = state.nowPlaying;
  const [playing, setPlaying] = useState(track?.playing ?? false);
  useEffect(() => setPlaying(track?.playing ?? false), [track]);
  const progress = track ? track.positionSec / track.durationSec : 0;
  return (
    <View style={styles.player}>
      <View style={styles.playerHead}>
        {track ? (
          <AlbumArt index={0} size={52} />
        ) : (
          <View style={[styles.emptyArt, { backgroundColor: colors.border }]}>
            <Icon name="music" color={colors.textSecondary} size={20} />
          </View>
        )}
        <View style={styles.flex}>
          <AppText style={styles.trackTitle} numberOfLines={1}>
            {track?.title ?? '--'}
          </AppText>
          <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
            {track?.subtitle ?? '--'}
          </AppText>
        </View>
        <SettingsButton onPress={onSettings} />
      </View>
      <View style={[styles.progress, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${progress * 100}%`, backgroundColor: colors.text },
          ]}
        />
      </View>
      <View style={styles.times}>
        <AppText variant="label" tone="textSecondary" style={styles.number}>
          {track ? formatDuration(track.positionSec) : '0:00'}
        </AppText>
        <AppText variant="label" tone="textSecondary" style={styles.number}>
          {track ? formatDuration(track.durationSec) : '0:00'}
        </AppText>
      </View>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 곡"
          disabled={!track}
          style={styles.control}
        >
          <Icon name="skipBack" color={colors.text} size={16} />
        </Pressable>
        {/* The play button sits inside a dashed ring. */}
        <View style={[styles.playRing, { borderColor: colors.borderStrong }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? '일시정지' : '재생'}
            disabled={!track}
            onPress={() => setPlaying(value => !value)}
            style={[styles.play, { backgroundColor: colors.accent }]}
          >
            <Icon
              name={playing ? 'pause' : 'play'}
              color={colors.onAccent}
              size={24}
            />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다음 곡"
          disabled={!track}
          style={styles.control}
        >
          <Icon name="skipForward" color={colors.text} size={16} />
        </Pressable>
      </View>
    </View>
  );
}

// Rows after the first get a thin line above them.
function TrackRow({ track, index }: { track: Track; index: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.track,
        index > 0 && [styles.trackLine, { borderTopColor: colors.border }],
      ]}
    >
      <AlbumArt index={index} size={40} />
      <View style={styles.flex}>
        <AppText style={styles.rowTitle} numberOfLines={1}>
          {track.title}
        </AppText>
        <AppText variant="label" tone="textSecondary">
          {track.subtitle}
        </AppText>
      </View>
      <AppText variant="label" tone="textSecondary" style={styles.number}>
        {formatDuration(track.durationSec)}
      </AppText>
    </View>
  );
}

function PlaylistGrid({ titles }: { titles: string[] }) {
  return (
    <View style={styles.grid}>
      {titles.map((title, index) => (
        <View key={title} style={styles.gridItem}>
          <AlbumArt index={index} />
          <AppText variant="label" tone="textSecondary" numberOfLines={1}>
            {title}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// 멜론 열기 on the black bottom of the card: the light pill with a dot in a ring (DESIGN.md 2-6 시트 버튼).
function OpenButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.open,
        { backgroundColor: colors.accent },
        pressed && styles.pressed,
      ]}
    >
      <AppText variant="bodyStrong" style={{ color: colors.onAccent }}>
        {label}
      </AppText>
      <View style={[styles.ring, { borderColor: colors.onAccent }]}>
        <View style={[styles.ringDot, { backgroundColor: colors.onAccent }]} />
      </View>
    </Pressable>
  );
}

// 2.7 음악 카드 — 멜론, 2.7S Spotify, 2.7a 미연결, 2.7b 연결 끊김.
export function MusicCardScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { music } = useRepositories();
  const toast = useToast();
  const { state, setState, failed } = useMusicState();
  const [reconnecting, setReconnecting] = useState(false);
  const openSettings = () => navigateTo(navigation, 'MusicSource');

  if (!state) {
    return (
      <MusicSheet>
        <View style={styles.center}>
          {failed ? (
            <AppText tone="danger">음악 정보를 불러오지 못했어요</AppText>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      </MusicSheet>
    );
  }

  const service =
    state.source === 'MELON' || state.source === 'SPOTIFY'
      ? state.source
      : null;
  const library = state.library;
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

  const reconnect = async () => {
    setReconnecting(true);
    try {
      setState(await music.reconnect());
    } catch {
      toast('다시 연결하지 못했어요');
    }
    setReconnecting(false);
  };

  return (
    <MusicSheet
      footer={
        service ? (
          <OpenButton
            label={`${serviceNames[service]} 열기`}
            onPress={openApp}
          />
        ) : null
      }
    >
      <View style={styles.top}>
        {!service ? (
          <Player state={state} onSettings={openSettings} />
        ) : !state.linked ? (
          // 2.7b: the player is replaced by the reconnect prompt, a black row with a coral rim; the list below stays.
          <ThemeProvider tone="dark">
            <View style={styles.cut}>
              <View style={styles.playerHead}>
                <View style={[styles.emptyArt, styles.cutArt]}>
                  <Icon name="musicOff" color={k1.coral} size={20} />
                </View>
                <View style={styles.flex}>
                  <AppText style={styles.trackTitle}>연결이 끊겼어요</AppText>
                  <AppText variant="caption" tone="textSecondary">
                    {`${serviceNames[service]} 앱과 연결을 다시 확인해 주세요`}
                  </AppText>
                </View>
                <SettingsButton onPress={openSettings} />
              </View>
              <Button
                title="다시 연결"
                variant="danger"
                size="medium"
                loading={reconnecting}
                onPress={reconnect}
              />
            </View>
          </ThemeProvider>
        ) : (
          <Player state={state} onSettings={openSettings} />
        )}
      </View>
      {!service ? (
        <View style={styles.connect}>
          <View
            style={[styles.connectIcon, { backgroundColor: colors.accent }]}
          >
            <Icon name="music" color={colors.onAccent} size={22} />
          </View>
          <AppText variant="heading">음악 서비스를 연결해 주세요</AppText>
          <AppText
            variant="caption"
            tone="textSecondary"
            style={styles.centerText}
          >
            멜론이나 Spotify를 연결하면{'\n'}여기서 재생목록을 고를 수 있어요
          </AppText>
          <Button title="음원 선택" size="medium" onPress={openSettings} />
        </View>
      ) : library ? (
        <ScrollView style={styles.flex} contentContainerStyle={styles.library}>
          {service === 'SPOTIFY' ? (
            <>
              {!state.premium ? (
                <View
                  style={[
                    styles.notice,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Icon name="alert" color={colors.textSecondary} size={16} />
                  <AppText
                    variant="caption"
                    tone="textSecondary"
                    style={styles.flex}
                  >
                    곡을 골라 재생하려면{' '}
                    <AppText variant="captionStrong">Spotify Premium</AppText>이
                    필요해요. 무료 계정은 셔플 재생만 돼요.
                  </AppText>
                </View>
              ) : null}
              <SectionTitle
                title="내 플레이리스트"
                note={`${library.playlists.length}개`}
              />
              <PlaylistGrid
                titles={library.playlists.map(item => item.title)}
              />
            </>
          ) : (
            <>
              <SectionTitle
                title="좋아요한 곡"
                note={`${library.likedCount}곡`}
              />
              {library.liked.map((track, index) => (
                <TrackRow key={track.id} track={track} index={index} />
              ))}
              <SectionTitle title="최근 들은 곡" />
              <PlaylistGrid titles={library.recent.map(item => item.title)} />
              <SectionTitle title="내 플레이리스트" />
              <PlaylistGrid
                titles={library.playlists.map(item => item.title)}
              />
              {library.top100.length > 0 ? (
                <>
                  <SectionTitle
                    title="TOP100"
                    note={
                      library.top100UpdatedAt
                        ? `오늘 ${formatClockTime(
                            library.top100UpdatedAt,
                          )} 기준`
                        : undefined
                    }
                  />
                  {library.top100.map((track, index) => (
                    <TrackRow key={track.id} track={track} index={index} />
                  ))}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : null}
    </MusicSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { padding: spacing.xxxl, alignItems: 'center' },
  centerText: { textAlign: 'center' },
  top: { padding: spacing.xl, paddingBottom: 0 },
  // The player sits right on the card, without a box of its own.
  player: { gap: spacing.lg },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  trackTitle: { fontFamily: fontFamily.medium, fontSize: 17, lineHeight: 24 },
  rowTitle: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20 },
  number: { fontFamily: fontFamily.numberRegular },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyArt: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {
    height: 3,
    borderRadius: 2,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: { height: 3, borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  control: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(2,5,14,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 2.7b 연결 끊김: a black row with a coral 60% rim.
  cut: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(226,135,111,0.6)',
    backgroundColor: k1.night,
  },
  cutArt: { backgroundColor: 'rgba(226,135,111,0.14)' },
  library: { padding: spacing.xl, gap: spacing.lg },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.sm,
  },
  trackLine: { borderTopWidth: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  // Three per row, as in the prototype.
  gridItem: { width: '31.5%', gap: spacing.xs },
  notice: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: 22,
    borderWidth: 1,
  },
  connect: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxxl * 2,
    paddingHorizontal: spacing.xxl,
  },
  connectIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  open: {
    height: 54,
    minWidth: 206,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 10,
    gap: spacing.xl,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  ring: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringDot: { width: 8, height: 8, borderRadius: 4 },
});
