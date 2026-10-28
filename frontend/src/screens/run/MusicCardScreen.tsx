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
import { AppText, Button, Icon, IconButton, useToast } from '../../components';
import { useRepositories, type MusicState, type Track } from '../../data';
import { formatClockTime, formatDuration } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { palette, radius, spacing, useTheme } from '../../theme';
import { AlbumArt, MusicSheet, SectionTitle } from './musicParts';
import { ServiceMark } from './parts';

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
    <View style={[styles.player, { backgroundColor: colors.surfaceMuted }]}>
      <View style={styles.playerHead}>
        {track ? (
          <AlbumArt index={0} size={52} />
        ) : (
          <View style={[styles.emptyArt, { backgroundColor: colors.border }]}>
            <Icon name="music" color={colors.textSecondary} size={20} />
          </View>
        )}
        <View style={styles.flex}>
          <AppText variant="heading" numberOfLines={1}>
            {track?.title ?? '--'}
          </AppText>
          <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
            {track?.subtitle ?? '--'}
          </AppText>
        </View>
        <IconButton
          icon="settings"
          accessibilityLabel="음원 선택"
          onPress={onSettings}
        />
      </View>
      <View style={[styles.progress, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${progress * 100}%`, backgroundColor: colors.text },
          ]}
        />
        <View
          style={[
            styles.knob,
            { left: `${progress * 100}%`, backgroundColor: colors.text },
          ]}
        />
      </View>
      <View style={styles.times}>
        <AppText variant="label" tone="textTertiary">
          {track ? formatDuration(track.positionSec) : '0:00'}
        </AppText>
        <AppText variant="label" tone="textTertiary">
          {track ? formatDuration(track.durationSec) : '0:00'}
        </AppText>
      </View>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 곡"
          disabled={!track}
          style={[styles.control, { backgroundColor: colors.surfaceMuted }]}
        >
          <Icon name="skipBack" color={colors.text} size={16} />
        </Pressable>
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
            size={20}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다음 곡"
          disabled={!track}
          style={[styles.control, { backgroundColor: colors.surfaceMuted }]}
        >
          <Icon name="skipForward" color={colors.text} size={16} />
        </Pressable>
      </View>
    </View>
  );
}

function TrackRow({ track, index }: { track: Track; index: number }) {
  return (
    <View style={styles.track}>
      <AlbumArt index={index + 1} size={36} />
      <View style={styles.flex}>
        <AppText variant="captionStrong" numberOfLines={1}>
          {track.title}
        </AppText>
        <AppText variant="label" tone="textTertiary">
          {track.subtitle}
        </AppText>
      </View>
      <AppText variant="label" tone="textTertiary">
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
          <AppText variant="label" numberOfLines={1}>
            {title}
          </AppText>
        </View>
      ))}
    </View>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${serviceNames[service]} 열기`}
            onPress={openApp}
            style={[styles.open, { backgroundColor: colors.surfaceMuted }]}
          >
            <ServiceMark service={service} size={20} />
            <AppText variant="bodyStrong">{`${serviceNames[service]} 열기`}</AppText>
          </Pressable>
        ) : null
      }
    >
      <View style={styles.top}>
        {!service ? (
          <Player state={state} onSettings={openSettings} />
        ) : !state.linked ? (
          // 2.7b: the player is replaced by the reconnect prompt; the list below stays.
          <View
            style={[styles.player, { backgroundColor: colors.surfaceMuted }]}
          >
            <View style={styles.playerHead}>
              <View
                style={[
                  styles.emptyArt,
                  { backgroundColor: colors.dangerSurface },
                ]}
              >
                <Icon name="musicOff" color={colors.danger} size={20} />
              </View>
              <View style={styles.flex}>
                <AppText variant="heading">연결이 끊겼어요</AppText>
                <AppText variant="caption" tone="textSecondary">
                  {`${serviceNames[service]} 앱과 연결을 다시 확인해 주세요`}
                </AppText>
              </View>
              <IconButton
                icon="settings"
                accessibilityLabel="음원 선택"
                onPress={openSettings}
              />
            </View>
            <Button
              title="다시 연결"
              variant="danger"
              size="medium"
              loading={reconnecting}
              onPress={reconnect}
            />
          </View>
        ) : (
          <Player state={state} onSettings={openSettings} />
        )}
      </View>
      {!service ? (
        <View style={styles.connect}>
          <View
            style={[
              styles.connectIcon,
              { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Icon name="music" color={colors.textSecondary} size={22} />
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
                    <AppText
                      variant="captionStrong"
                      style={{ color: palette.periwinkle }}
                    >
                      Spotify Premium
                    </AppText>
                    이 필요해요. 무료 계정은 셔플 재생만 돼요.
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
  player: { borderRadius: radius.xl, padding: spacing.xl, gap: spacing.lg },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  emptyArt: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: { height: 4, borderRadius: 2, marginTop: spacing.sm },
  progressFill: { height: 4, borderRadius: 2 },
  knob: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  control: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  library: { padding: spacing.xl, gap: spacing.xl },
  track: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  // Three per row, as in the prototype.
  gridItem: { width: '31.5%', gap: spacing.xs },
  notice: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
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
    height: 48,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
});
