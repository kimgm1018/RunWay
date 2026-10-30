import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Card, Icon, IconButton } from '../../components';
import { useRepositories, type MusicState } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import {
  fontFamily,
  k1,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { MockMap } from './MockMap';
import { AlbumArt } from './musicParts';
import { useRunSession } from './RunSession';

// The pace bar spans 20 seconds either side of the goal, with ±10 seconds highlighted.
const barSpanSec = 20;
const goalBandSec = 10;

export function PaceBar({
  pace,
  goal,
  goalLabel = '목표',
}: {
  pace: number | null;
  goal: number;
  // 6.6 그룹런 shows 공동 목표.
  goalLabel?: string;
}) {
  const { colors } = useTheme();
  const slow = goal + barSpanSec;
  const fast = goal - barSpanSec;
  const at = (value: number) =>
    Math.min(1, Math.max(0, (slow - value) / (slow - fast)));
  return (
    <View style={styles.paceBarBlock}>
      <View style={[styles.paceTrack, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.paceBand,
            {
              left: `${at(goal + goalBandSec) * 100}%`,
              width: `${
                (at(goal - goalBandSec) - at(goal + goalBandSec)) * 100
              }%`,
              backgroundColor: colors.accentSoft,
            },
          ]}
        />
        {pace !== null ? (
          <View
            accessibilityLabel={`현재 페이스 위치`}
            style={[
              styles.paceMarker,
              { left: `${at(pace) * 100}%`, backgroundColor: colors.text },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.paceLabels}>
        <AppText variant="label" tone="textSecondary">
          {`느림 ${formatPace(slow)}`}
        </AppText>
        <AppText variant="labelStrong">
          {`${goalLabel} ${formatPace(goal)} ±${goalBandSec}″`}
        </AppText>
        <AppText variant="label" tone="textSecondary">
          {`빠름 ${formatPace(fast)}`}
        </AppText>
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.stat}>
      <AppText style={styles.statValue}>
        {value}
        {unit ? (
          <AppText variant="label" tone="textSecondary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

// One-line player at the very bottom so it never covers the numbers (4.2 미니 플레이어),
// on the dark glass card (DESIGN.md 2-7 진한 유리).
export function MiniPlayer({ music }: { music: MusicState }) {
  const [playing, setPlaying] = useState(music.nowPlaying?.playing ?? false);
  if (!music.nowPlaying) {
    return null;
  }
  return (
    <Card variant="deep" style={styles.mini}>
      <MiniPlayerRow
        title={music.nowPlaying.title}
        subtitle={music.nowPlaying.subtitle}
        playing={playing}
        onToggle={() => setPlaying(value => !value)}
      />
    </Card>
  );
}

function MiniPlayerRow({
  title,
  subtitle,
  playing,
  onToggle,
}: {
  title: string;
  subtitle: string;
  playing: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.miniRow}>
      <AlbumArt index={2} size={44} />
      <View style={styles.flex}>
        <AppText variant="bodyMedium" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="label" tone="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      <Icon name="skipBack" color={colors.text} size={14} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? '음악 일시정지' : '음악 재생'}
        onPress={onToggle}
        hitSlop={8}
        style={[styles.miniPlay, { backgroundColor: colors.accent }]}
      >
        <Icon
          name={playing ? 'pause' : 'play'}
          color={colors.onAccent}
          size={16}
        />
      </Pressable>
      <Icon name="skipForward" color={colors.text} size={14} />
    </View>
  );
}

// 거리 · 경과 시간 · 남은 거리 on the white see-through card (DESIGN.md 2-7 흰 반투명), read in the light tone.
function StatsCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.stats}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="statsFill" x1="0.2" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor="#F0F4F8" stopOpacity={0.95} />
            <Stop offset="1" stopColor={k1.top} stopOpacity={0.86} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#statsFill)" />
      </Svg>
      <ThemeProvider tone="light">{children}</ThemeProvider>
    </View>
  );
}

// The light progress track inside the stats card.
function Progress({ ratio }: { ratio: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.progress, { backgroundColor: colors.border }]}>
      <View
        style={[
          styles.progressFill,
          { width: `${ratio * 100}%`, backgroundColor: colors.accent },
        ]}
      />
    </View>
  );
}

// 4.2 러닝 진행 (낮) and 4.2N (밤): the run so far on the map, live numbers and pause.
export function RunProgressScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { music } = useRepositories();
  const { run, start, pause, resume } = useRunSession();
  const [player, setPlayer] = useState<MusicState | null>(null);
  const status = useRef(run?.status);
  status.current = run?.status;
  const latest = useRef({ pause, resume });
  latest.current = { pause, resume };

  const openPause = useCallback(() => {
    latest.current.pause();
    navigateTo(navigation, 'RunPause');
  }, [navigation]);

  // Coming back from 4.3 (재개 or the back key) carries on the run.
  useFocusEffect(
    useCallback(() => {
      if (status.current === 'paused') {
        latest.current.resume();
      }
      // The back key pauses instead of leaving a run that is still going.
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        openPause();
        return true;
      });
      return () => back.remove();
    }, [openPause]),
  );

  // Opened without a configured run (for example from a deep link): start a free run.
  useEffect(() => {
    if (!run) {
      start({
        mode: 'FREE',
        plan: null,
        goalDistanceM: null,
        goalPaceSecPerKm: null,
      });
    }
  }, [run, start]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      music.getState().then(
        state => active && setPlayer(state),
        () => undefined,
      );
      return () => {
        active = false;
      };
    }, [music]),
  );

  if (!run) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]} />
    );
  }
  const { config, sample, guidance, trail } = run;
  const plan = config.plan;
  const total = plan?.distanceM ?? config.goalDistanceM;
  const remaining = total ? Math.max(total - sample.distanceM, 0) : null;
  // 경쟁 모드: compare with the earlier run at the same point of the course.
  const rivalGap =
    plan?.rival && sample.distanceM > 0
      ? Math.round(
          (plan.rival.durationSec * sample.distanceM) / plan.distanceM -
            sample.elapsedSec,
        )
      : null;
  const showPlayer =
    player?.source && player.source !== 'NONE' && player.linked;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      {/* The whole screen is the K1 dark map, day and night (DESIGN.md 2-7). */}
      <MockMap
        k1Style
        night
        route={plan?.route}
        trail={trail.length > 0 ? trail : undefined}
        routeArea={{ top: 275, bottom: 420 }}
      />
      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        <View style={styles.top}>
          {/* Status chip: dark pill, coral dot (DESIGN.md 2-7 상태 칩). */}
          <View style={styles.chip}>
            <View style={styles.dot} />
            <AppText variant="labelStrong">
              {plan
                ? `${plan.name} ${formatKm(plan.distanceM, 1)}km${
                    plan.rival ? ' · 경쟁 모드' : ''
                  }`
                : '자유 러닝'}
            </AppText>
          </View>
          {rivalGap !== null && plan?.rival ? (
            <View style={styles.titleRow}>
              <AppText variant="caption" tone="textSecondary">
                {`${Number(
                  plan.rival.startedAt.slice(5, 7),
                )}.${plan.rival.startedAt.slice(8, 10)} 기록보다`}
              </AppText>
              <View
                style={[styles.rival, { backgroundColor: colors.surfaceMuted }]}
              >
                <AppText variant="captionStrong">
                  {rivalGap >= 0
                    ? `${rivalGap}초 앞서는 중`
                    : `${-rivalGap}초 뒤처지는 중`}
                </AppText>
              </View>
            </View>
          ) : null}
          <StatsCard>
            <View style={styles.statRow}>
              <Stat label="거리" value={formatKm(sample.distanceM)} unit="km" />
              <Stat
                label="경과 시간"
                value={formatDuration(sample.elapsedSec)}
              />
              {remaining !== null ? (
                <Stat label="남은 거리" value={formatKm(remaining)} unit="km" />
              ) : (
                <Stat
                  label="심박"
                  value={
                    sample.heartRate === null ? '– –' : String(sample.heartRate)
                  }
                  unit="bpm"
                />
              )}
            </View>
            {total ? (
              <Progress ratio={Math.min(sample.distanceM / total, 1)} />
            ) : null}
          </StatsCard>
          {guidance && plan ? (
            <Card variant="deep" style={styles.guide}>
              <View style={styles.guideRow}>
                <View
                  style={[
                    styles.guideIcon,
                    { backgroundColor: colors.surfaceMuted },
                    guidance.instruction.includes('오른쪽') && styles.mirror,
                  ]}
                >
                  <Icon
                    name={
                      guidance.instruction.includes('직진')
                        ? 'straight'
                        : 'turnLeft'
                    }
                    color={colors.text}
                    size={22}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{guidance.instruction}</AppText>
                  <AppText variant="label" tone="textSecondary">
                    {guidance.detail}
                  </AppText>
                </View>
              </View>
            </Card>
          ) : null}
          <View style={styles.recenter}>
            <IconButton
              icon="locate"
              accessibilityLabel="내 위치로 이동"
              onPress={() => undefined}
            />
          </View>
        </View>

        <View style={styles.bottom}>
          {/* 내 페이스 on the vignette card (DESIGN.md 2-7 비네트). */}
          <Card variant="vignette" style={styles.paceCard}>
            <AppText variant="caption" tone="textSecondary">
              내 페이스
            </AppText>
            <AppText style={styles.pace} accessibilityLabel="내 페이스">
              {sample.paceSecPerKm === null
                ? '– –'
                : formatPace(sample.paceSecPerKm)}
            </AppText>
            <AppText variant="caption" tone="textSecondary">
              {`/km${
                remaining === null || sample.heartRate === null
                  ? ''
                  : ` · 심박 ${sample.heartRate} bpm`
              }`}
            </AppText>
            {config.goalPaceSecPerKm ? (
              <PaceBar
                pace={sample.paceSecPerKm}
                goal={config.goalPaceSecPerKm}
              />
            ) : null}
          </Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="일시정지"
            onPress={openPause}
            style={({ pressed }) => [
              styles.pause,
              { backgroundColor: colors.accent },
              pressed && styles.pressed,
            ]}
          >
            <Icon name="pause" color={colors.onAccent} size={24} />
          </Pressable>
          {showPlayer && player ? <MiniPlayer music={player} /> : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  layout: { flex: 1, justifyContent: 'space-between' },
  top: {
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(2,5,14,0.72)',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: k1.coral },
  rival: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
  },
  stats: {
    borderRadius: 28,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: spacing.lg,
  },
  statRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 36,
  },
  progress: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  guide: { paddingVertical: 16 },
  guideRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  guideIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A right turn is the left-turn arrow flipped.
  mirror: { transform: [{ scaleX: -1 }] },
  recenter: { alignItems: 'flex-end' },
  bottom: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  paceCard: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs },
  // Big numbers stay Barlow Regular at the sheet's 64.
  pace: { fontFamily: fontFamily.numberRegular, fontSize: 64, lineHeight: 72 },
  paceBarBlock: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  paceTrack: { height: 12, borderRadius: 6, justifyContent: 'center' },
  paceBand: { position: 'absolute', top: 0, bottom: 0, borderRadius: 6 },
  paceMarker: {
    position: 'absolute',
    width: 4,
    height: 26,
    borderRadius: 2,
    marginLeft: -2,
  },
  paceLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  pause: {
    width: size.buttonLarge + 8,
    height: size.buttonLarge + 8,
    borderRadius: (size.buttonLarge + 8) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  mini: { alignSelf: 'stretch', paddingVertical: 12, paddingHorizontal: 12 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  miniPlay: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
