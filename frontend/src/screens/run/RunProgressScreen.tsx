import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  CommonActions,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  AppText,
  Card,
  Icon,
  IconButton,
  LightGlass,
  MistFill,
  mistColors,
  useToast,
} from '../../components';
import {
  spotifyFailureMessage,
  useRepositories,
  type MusicState,
} from '../../data';
import {
  formatDuration,
  formatKm,
  formatPace,
  withoutDistance,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import {
  fontFamily,
  k1,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { RunMap } from '../../components/RunMap';
import { AlbumArt } from './musicParts';
import { K1Badge } from './parts';
import { useRunControlState, useRunSession } from './RunSession';
import { controlNotice } from './controlNotice';
import { GlassIconButton } from '../../components/GlassIconButton';

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

// ---- 4.2 by day (runway-running-handoff): light map, glass strip, the pace and music card. ----

const ink = '#02050E';

// 자유 러닝 / the course: a small glass pill with a recording dot.
function ModeChip({ label }: { label: string }) {
  return (
    <LightGlass radius={13} style={styles.modeChip}>
      <View style={styles.recDot} />
      <AppText style={styles.modeText} numberOfLines={1}>
        {label}
      </AppText>
    </LightGlass>
  );
}

function StripStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.stripStat}>
      <AppText style={styles.stripValue}>
        {value}
        {unit ? <AppText style={styles.stripUnit}>{` ${unit}`}</AppText> : null}
      </AppText>
      <AppText style={styles.stripLabel}>{label}</AppText>
    </View>
  );
}

// 거리 · 경과 시간 · 심박 (or 남은 거리 on a course) in a 88 glass pill; a course adds a thin progress line.
function StatStrip({
  children,
  ratio,
}: {
  children: React.ReactNode;
  ratio: number | null;
}) {
  return (
    <LightGlass radius={44} style={styles.strip}>
      <View style={styles.stripRow}>{children}</View>
      {ratio !== null ? (
        <View style={styles.stripTrack}>
          <View style={[styles.stripFill, { width: `${ratio * 100}%` }]} />
        </View>
      ) : null}
    </LightGlass>
  );
}

type MusicCommand = 'play' | 'pause' | 'next' | 'previous';

// The song row at the foot of the pace card: the cover, the song, 이전 · 재생/일시정지 · 다음 and how far in.
function PaceCardMusic({
  music,
  busy,
  onCommand,
}: {
  music: MusicState;
  busy: boolean;
  onCommand: (command: MusicCommand) => void;
}) {
  const track = music.nowPlaying;
  if (!track) {
    return null;
  }
  const progress = track.durationSec
    ? Math.min(track.positionSec / track.durationSec, 1)
    : 0;
  return (
    <View style={styles.music}>
      <View style={styles.musicRow}>
        {track.artworkUrl ? (
          <Image
            source={{ uri: track.artworkUrl }}
            accessibilityIgnoresInvertColors
            style={styles.cover}
          />
        ) : (
          <K1Badge diameter={40}>{null}</K1Badge>
        )}
        <View style={styles.flex}>
          <AppText style={styles.song} numberOfLines={1}>
            {track.title}
          </AppText>
          <AppText style={styles.album} numberOfLines={1}>
            {track.subtitle}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 곡"
          disabled={busy}
          onPress={() => onCommand('previous')}
          hitSlop={6}
          style={styles.skip}
        >
          <Icon name="skipBack" color={ink} size={16} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={track.playing ? '음악 일시정지' : '음악 재생'}
          disabled={busy}
          onPress={() => onCommand(track.playing ? 'pause' : 'play')}
          style={styles.playRound}
        >
          <Icon
            name={track.playing ? 'pause' : 'play'}
            color="#E8EEF4"
            size={16}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다음 곡"
          disabled={busy}
          onPress={() => onCommand('next')}
          hitSlop={6}
          style={styles.skip}
        >
          <Icon name="skipForward" color={ink} size={16} />
        </Pressable>
      </View>
      <View style={styles.songTrack}>
        <View style={[styles.songFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

// How the pace stands against the goal: 목표보다 2초 빠름.
function goalGap(pace: number | null, goal: number | null) {
  if (pace === null || !goal) {
    return null;
  }
  const gap = Math.round(goal - pace);
  return gap === 0
    ? '목표 페이스'
    : gap > 0
    ? `목표보다 ${gap}초 빠름`
    : `목표보다 ${-gap}초 느림`;
}

// 내 페이스 and the music player as one card on the 코스 러닝 그라데이션 (dark at the top, light at the foot).
// Without music the card keeps only its dark top half (담당자 결정: 음악 줄 숨기기).
function PaceCard({
  pace,
  goal,
  side,
  music,
  busy,
  onCommand,
}: {
  pace: number | null;
  goal: number | null;
  // The note on the right of the pace: the goal gap, or the heart rate on a course.
  side: string | null;
  music: MusicState | null;
  busy: boolean;
  onCommand: (command: MusicCommand) => void;
}) {
  const withMusic = Boolean(music?.nowPlaying);
  return (
    <View style={styles.paceGlassCard}>
      <MistFill
        id="runPaceCard"
        colors={withMusic ? runGradient : runGradient.slice(0, 11)}
      />
      <View style={styles.paceHead}>
        <View style={styles.paceKicker}>
          <View style={styles.whiteDot} />
          <AppText style={styles.kickerText}>내 페이스</AppText>
        </View>
        {goal ? (
          <View style={styles.goalChip}>
            <AppText style={styles.goalChipText}>{`목표 ${formatPace(
              goal,
            )}`}</AppText>
          </View>
        ) : null}
      </View>
      <View style={styles.paceLine}>
        <AppText style={styles.bigPace} accessibilityLabel="내 페이스">
          {pace === null ? '– –' : formatPace(pace)}
        </AppText>
        <AppText style={styles.perKm}>/km</AppText>
        {side ? <AppText style={styles.paceSide}>{side}</AppText> : null}
      </View>
      {music && withMusic ? (
        <PaceCardMusic music={music} busy={busy} onCommand={onCommand} />
      ) : null}
    </View>
  );
}

// 코스 러닝 그라데이션 (runway-running-handoff 공통): the 2.0M mist turned upside down.
const runGradient = [...mistColors].reverse();

// 4.2 러닝 진행 (낮) and 4.2N (밤): the run so far on the map, live numbers and pause.
export function RunProgressScreen() {
  const navigation = useNavigation();
  const { colors, name: themeName } = useTheme();
  // By day the runway-running-handoff screen; after sunset the dark 4.2N (담당자 결정).
  const night = themeName === 'dark';
  const { music } = useRepositories();
  const toast = useToast();
  const [musicBusy, setMusicBusy] = useState(false);
  const runMusic = async (command: MusicCommand) => {
    setMusicBusy(true);
    try {
      setPlayer(await music[command]());
    } catch (error) {
      const message = spotifyFailureMessage(error, '음악을 조작하지 못했어요');
      if (message) {
        toast(message);
      }
    }
    setMusicBusy(false);
  };
  const { run, start, pause, resume, recheck } = useRunSession();
  const [player, setPlayer] = useState<MusicState | null>(null);
  const status = useRef(run?.status);
  status.current = run?.status;
  const latest = useRef({ pause, resume });
  latest.current = { pause, resume };

  const control = useRunControlState();
  const focused = useRef(false);

  // 일시정지는 요청만 한다. 실제로 멈춘 것이 확정되면(running → paused) 4.3을 연다.
  const openPause = useCallback(() => {
    latest.current.pause();
  }, []);
  const previous = useRef(run?.status);
  useEffect(() => {
    if (
      focused.current &&
      previous.current === 'running' &&
      run?.status === 'paused'
    ) {
      navigateTo(navigation, 'RunPause');
    }
    // 워치에서 종료해도 결과로 넘어간다. 결과는 진행 화면들을 대신하므로 뒤로 가도 끝난 러닝이 다시 열리지 않는다.
    if (focused.current && run?.status === 'finished') {
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [{ name: 'MainTabs' }, { name: 'RunResult' }],
        }),
      );
    }
    previous.current = run?.status;
  }, [navigation, run?.status]);
  const problem = control?.problem ?? null;
  const waiting =
    problem === null && control?.pending?.action === 'PAUSE'
      ? '일시정지 확인 중'
      : problem === null && control?.pending?.action === 'RESUME'
      ? '재개 확인 중'
      : null;
  const notice = controlNotice(problem, ['PAUSE', 'RESUME']);

  // Coming back from 4.3 (재개 or the back key) carries on the run.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (status.current === 'paused') {
        latest.current.resume();
      }
      // The back key pauses instead of leaving a run that is still going.
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        openPause();
        return true;
      });
      return () => {
        focused.current = false;
        back.remove();
      };
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
  const modeLabel = plan
    ? `${withoutDistance(plan.name)} ${formatKm(plan.distanceM, 1)}km${
        plan.rival ? ' · 경쟁 모드' : ''
      }`
    : '자유 러닝';

  if (!night) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <RunMap
          dark={false}
          route={plan?.route}
          trail={trail.length > 0 ? trail : undefined}
          // The run so far between the stat strip and the pace card; the course before the first metres.
          area={
            trail.length > 0
              ? { top: 0.39, bottom: 0.56 }
              : { top: 0.19, bottom: 0.56 }
          }
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
          <View style={styles.dayTop}>
            <ModeChip label={modeLabel} />
            {rivalGap !== null && plan?.rival ? (
              <LightGlass radius={14} style={styles.rivalGlass}>
                <AppText style={styles.rivalText}>
                  {`${Number(
                    plan.rival.startedAt.slice(5, 7),
                  )}.${plan.rival.startedAt.slice(8, 10)} 기록보다 ${
                    rivalGap >= 0
                      ? `${rivalGap}초 앞서는 중`
                      : `${-rivalGap}초 뒤처지는 중`
                  }`}
                </AppText>
              </LightGlass>
            ) : null}
            <StatStrip
              ratio={total ? Math.min(sample.distanceM / total, 1) : null}
            >
              <StripStat
                label="거리"
                value={formatKm(sample.distanceM)}
                unit="km"
              />
              <StripStat
                label="경과 시간"
                value={formatDuration(sample.elapsedSec)}
              />
              {remaining !== null ? (
                <StripStat
                  label="남은 거리"
                  value={formatKm(remaining)}
                  unit="km"
                />
              ) : (
                <StripStat
                  label="심박"
                  value={
                    sample.heartRate === null ? '– –' : String(sample.heartRate)
                  }
                  unit="bpm"
                />
              )}
            </StatStrip>
            {guidance && plan ? (
              <LightGlass radius={24} style={styles.guideGlass}>
                <View
                  style={[
                    styles.guideIconDay,
                    guidance.instruction.includes('오른쪽') && styles.mirror,
                  ]}
                >
                  <Icon
                    name={
                      guidance.instruction.includes('직진')
                        ? 'straight'
                        : 'turnLeft'
                    }
                    color={ink}
                    size={22}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText style={styles.guideTitle}>
                    {guidance.instruction}
                  </AppText>
                  <AppText style={styles.guideDetail}>
                    {guidance.detail}
                  </AppText>
                </View>
              </LightGlass>
            ) : null}
            <GlassIconButton
              icon="locate"
              accessibilityLabel="내 위치로 이동"
              onPress={() => undefined}
              style={styles.locateDay}
            />
          </View>
          <View style={styles.dayBottom}>
            {waiting ? (
              <AppText style={styles.dayNote} accessibilityLabel="제어 확인">
                {waiting}
              </AppText>
            ) : null}
            {notice ? (
              <View style={styles.notice}>
                <AppText style={styles.dayNote} accessibilityLabel="제어 안내">
                  {notice.text}
                </AppText>
                {notice.recheck ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="다시 확인"
                    onPress={recheck}
                  >
                    <AppText style={[styles.dayNote, styles.underline]}>
                      다시 확인
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {/* The mockup dropped the pause button (README 알려진 문제); its 4.2-PauseButton returns here. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="일시정지"
              accessibilityState={{ disabled: waiting !== null }}
              disabled={waiting !== null}
              onPress={openPause}
              style={({ pressed }) => [
                styles.pauseDay,
                (pressed || waiting !== null) && styles.pressed,
              ]}
            >
              <Icon name="pause" color="#E8EEF4" size={24} />
            </Pressable>
            <PaceCard
              pace={sample.paceSecPerKm}
              goal={config.goalPaceSecPerKm}
              side={
                goalGap(sample.paceSecPerKm, config.goalPaceSecPerKm) ??
                (remaining !== null && sample.heartRate !== null
                  ? `심박 ${sample.heartRate} bpm`
                  : null)
              }
              music={showPlayer ? player : null}
              busy={musicBusy}
              onCommand={runMusic}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      {/* After sunset the whole screen is the K1 dark map (DESIGN.md 2-7). */}
      <RunMap
        dark
        route={plan?.route}
        trail={trail.length > 0 ? trail : undefined}
        area={{ top: 0.36, bottom: 0.55 }}
        style={StyleSheet.absoluteFill}
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
          {waiting ? (
            <AppText variant="captionStrong" accessibilityLabel="제어 확인">
              {waiting}
            </AppText>
          ) : null}
          {notice ? (
            <View style={styles.notice}>
              <AppText variant="captionStrong" accessibilityLabel="제어 안내">
                {notice.text}
              </AppText>
              {notice.recheck ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="다시 확인"
                  onPress={recheck}
                >
                  <AppText variant="captionStrong" tone="accentText">
                    다시 확인
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="일시정지"
            accessibilityState={{ disabled: waiting !== null }}
            disabled={waiting !== null}
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
  root: { flex: 1, backgroundColor: '#F3F5F6' },
  dayTop: { paddingHorizontal: 14, paddingTop: 8, gap: 8 },
  modeChip: {
    alignSelf: 'center',
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 12,
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C4644B',
    boxShadow: '0 0 0 3px rgba(196,100,75,0.18)',
  },
  modeText: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: -0.2,
    color: ink,
  },
  rivalGlass: {
    alignSelf: 'center',
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  rivalText: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 16,
    color: ink,
  },
  strip: { minHeight: 88, justifyContent: 'center', paddingHorizontal: 20 },
  stripRow: { flexDirection: 'row' },
  stripStat: { flex: 1, alignItems: 'center', gap: 4 },
  stripValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: ink,
  },
  stripUnit: { fontFamily: fontFamily.medium, fontSize: 12, color: '#67696E' },
  stripLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: '#95969A',
  },
  stripTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 2,
    backgroundColor: 'rgba(2,5,14,0.1)',
    overflow: 'hidden',
  },
  stripFill: { height: 3, borderRadius: 2, backgroundColor: ink },
  guideGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  guideIconDay: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: ink,
  },
  guideDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 17,
    color: '#67696E',
  },
  locateDay: { alignSelf: 'flex-end' },

  dayBottom: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 12,
  },
  dayNote: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: ink,
  },
  underline: { textDecorationLine: 'underline' },
  pauseDay: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: ink,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(2,5,14,0.28)',
  },
  paceGlassCard: {
    alignSelf: 'stretch',
    borderRadius: 32,
    overflow: 'hidden',
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 16,
    boxShadow: '0 16px 36px rgba(2,5,14,0.24)',
  },
  paceHead: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paceKicker: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  whiteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F9F9F9',
    boxShadow: '0 0 0 3px rgba(255,255,255,0.18)',
  },
  kickerText: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.85)',
  },
  goalChip: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  goalChipText: {
    fontFamily: fontFamily.bold,
    fontSize: 11.5,
    lineHeight: 15,
    color: '#F9F9F9',
  },
  paceLine: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  bigPace: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 64,
    lineHeight: 68,
    letterSpacing: -1.5,
    color: '#F9F9F9',
  },
  perKm: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  paceSide: {
    marginLeft: 'auto',
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  music: { marginTop: 26 },
  musicRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  song: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: '#111111',
  },
  album: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: '#67696E',
  },
  skip: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playRound: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songTrack: {
    height: 2,
    borderRadius: 1,
    marginTop: 12,
    backgroundColor: 'rgba(17,17,17,0.1)',
    overflow: 'hidden',
  },
  songFill: { height: 2, borderRadius: 1, backgroundColor: ink },
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
  notice: { alignItems: 'center', gap: spacing.xs },
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
