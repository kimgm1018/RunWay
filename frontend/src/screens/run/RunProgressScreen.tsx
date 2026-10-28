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
import { AppText, Icon, IconButton } from '../../components';
import { useRepositories, type MusicState } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import {
  palette,
  radius,
  size,
  spacing,
  typography,
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
        <AppText variant="label" tone="textTertiary">
          {`느림 ${formatPace(slow)}`}
        </AppText>
        <AppText variant="labelStrong" tone="accentText">
          {`${goalLabel} ${formatPace(goal)} ±${goalBandSec}″`}
        </AppText>
        <AppText variant="label" tone="textTertiary">
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
      <AppText variant="label" tone="textTertiary">
        {label}
      </AppText>
      <AppText variant="metricLarge">
        {value}
        {unit ? (
          <AppText variant="caption" tone="textTertiary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
    </View>
  );
}

// One-line player at the very bottom so it never covers the numbers (4.2 미니 플레이어).
export function MiniPlayer({ music }: { music: MusicState }) {
  const { colors } = useTheme();
  const [playing, setPlaying] = useState(music.nowPlaying?.playing ?? false);
  if (!music.nowPlaying) {
    return null;
  }
  return (
    <View
      style={[
        styles.mini,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <AlbumArt index={0} size={32} />
      <View style={styles.flex}>
        <AppText variant="captionStrong" numberOfLines={1}>
          {music.nowPlaying.title}
        </AppText>
        <AppText variant="label" tone="textTertiary" numberOfLines={1}>
          {music.nowPlaying.subtitle}
        </AppText>
      </View>
      <Icon name="skipBack" color={colors.text} size={14} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? '음악 일시정지' : '음악 재생'}
        onPress={() => setPlaying(value => !value)}
        hitSlop={8}
      >
        <Icon name={playing ? 'pause' : 'play'} color={colors.text} size={16} />
      </Pressable>
      <Icon name="skipForward" color={colors.text} size={14} />
    </View>
  );
}

// 4.2 러닝 진행 (낮) and 4.2N (밤): the run so far on the map, live numbers and pause.
export function RunProgressScreen() {
  const navigation = useNavigation();
  const { colors, name } = useTheme();
  const { music } = useRepositories();
  const { run, start, pause, resume } = useRunSession();
  const [player, setPlayer] = useState<MusicState | null>(null);
  const night = name === 'dark';
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
  const fade = night ? colors.background : palette.white;
  const showPlayer =
    player?.source && player.source !== 'NONE' && player.linked;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <MockMap
        night={night}
        route={plan?.route}
        trail={trail.length > 0 ? trail : undefined}
        routeArea={{ top: 230, bottom: 400 }}
      />
      {/* The map fades into the lower half where the pace sits. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="runFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.45" stopColor={fade} stopOpacity={0} />
            <Stop offset="0.62" stopColor={fade} stopOpacity={0.9} />
            <Stop offset="1" stopColor={fade} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#runFade)" />
      </Svg>
      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        <View style={styles.top}>
          <View style={styles.titleRow}>
            <View style={[styles.dot, { backgroundColor: colors.danger }]} />
            <AppText variant="label" tone="textSecondary">
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
                style={[styles.rival, { backgroundColor: colors.accentSoft }]}
              >
                <AppText variant="captionStrong">
                  {rivalGap >= 0
                    ? `${rivalGap}초 앞서는 중`
                    : `${-rivalGap}초 뒤처지는 중`}
                </AppText>
              </View>
            </View>
          ) : null}
          <View
            style={[
              styles.stats,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
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
              <View
                style={[styles.progress, { backgroundColor: colors.border }]}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(sample.distanceM / total, 1) * 100}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
          {guidance && plan ? (
            <View
              style={[
                styles.guide,
                { backgroundColor: night ? colors.accent : palette.ink },
              ]}
            >
              <View
                style={guidance.instruction.includes('오른쪽') && styles.mirror}
              >
                <Icon
                  name={
                    guidance.instruction.includes('직진')
                      ? 'straight'
                      : 'turnLeft'
                  }
                  color={night ? colors.onAccent : palette.white}
                  size={22}
                />
              </View>
              <View style={styles.flex}>
                <AppText
                  variant="bodyStrong"
                  style={{ color: night ? colors.onAccent : palette.white }}
                >
                  {guidance.instruction}
                </AppText>
                <AppText
                  variant="label"
                  style={{ color: night ? colors.onAccent : palette.pale }}
                >
                  {guidance.detail}
                </AppText>
              </View>
            </View>
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
          <AppText variant="caption" tone="textSecondary">
            내 페이스
          </AppText>
          <AppText style={styles.pace} accessibilityLabel="내 페이스">
            {sample.paceSecPerKm === null
              ? '– –'
              : formatPace(sample.paceSecPerKm)}
          </AppText>
          <AppText variant="caption" tone="textTertiary">
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
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  rival: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
  },
  stats: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  statRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xxs },
  progress: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  guide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
  },
  // A right turn is the left-turn arrow flipped.
  mirror: { transform: [{ scaleX: -1 }] },
  recenter: { alignItems: 'flex-end' },
  bottom: {
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  pace: { ...typography.metricHero, fontSize: 72, lineHeight: 80 },
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
    width: size.buttonLarge + 20,
    height: size.buttonLarge + 20,
    borderRadius: (size.buttonLarge + 20) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  pressed: { opacity: 0.8 },
  mini: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginTop: spacing.xl,
    padding: spacing.md,
    paddingRight: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
