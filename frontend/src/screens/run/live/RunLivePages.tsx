import React, { useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import { AppText, Icon } from '../../../components';
import {
  RunMap,
  type RunMapArea,
  type RunMapLogo,
  type RunMapMember,
} from '../../../components/RunMap';
import type { CoachingGuide, MusicState, RunGuidance } from '../../../data';
import { formatKm, formatPace } from '../../../format';
import type { LngLat } from '../../../geo';
import { fontFamily } from '../../../theme';
import type { ComparisonLine } from '../recordComparison';
import { liveLook } from './RunLiveFrame';

const none = '– –';

// How the current pace stands against the goal: 목표보다 2초 빠름. The app works this out itself, so it is
// never shown as the server's coaching.
export function goalGap(pace: number | null, goal: number | null) {
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

// The average over the run so far, from the run time without pauses and the distance.
export function averagePace(elapsedSec: number, distanceM: number) {
  return distanceM > 0 ? elapsedSec / (distanceM / 1000) : null;
}

function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string | null;
}) {
  return (
    <View style={styles.metric}>
      <AppText style={styles.metricLabel}>{label}</AppText>
      <View style={styles.metricLine}>
        <AppText
          style={styles.metricValue}
          accessibilityLabel={label}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </AppText>
        {unit ? <AppText style={styles.metricUnit}>{unit}</AppText> : null}
      </View>
      {note ? (
        <AppText style={styles.metricNote} numberOfLines={2}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

export type HistoryPoint = {
  t: number;
  pace: number | null;
  distanceM: number;
  heartRate: number | null;
  cadence: number | null;
};

// The run's values over time for the trend lines, kept by the screen for this run only. A new tick adds a
// point; a value that changes within the same second (a watch batch arriving) replaces the last one. Long
// runs keep every other point so the line stays light.
export function useRunHistory(
  sample: {
    elapsedSec: number;
    paceSecPerKm: number | null;
    distanceM: number;
    heartRate: number | null;
    cadence: number | null;
  },
  runKey: string,
) {
  const store = useRef<{ key: string; points: HistoryPoint[] }>({
    key: runKey,
    points: [],
  });
  if (store.current.key !== runKey) {
    store.current = { key: runKey, points: [] };
  }
  const points = store.current.points;
  const point: HistoryPoint = {
    t: sample.elapsedSec,
    pace: sample.paceSecPerKm,
    distanceM: sample.distanceM,
    heartRate: sample.heartRate,
    cadence: sample.cadence,
  };
  const last = points[points.length - 1];
  if (!last || last.t < point.t) {
    points.push(point);
    if (points.length > 720) {
      store.current.points = points.filter((_, index) => index % 2 === 0);
    }
  } else if (last.t === point.t) {
    points[points.length - 1] = point;
  }
  return store.current.points;
}

const chartHeight = 120;

// 시작 → 지금: the value's line over the run so far. Gaps where nothing was measured stay gaps. For pace a
// faster (smaller) pace draws higher.
function TrendChart({
  values,
  invert = false,
  color,
}: {
  values: (number | null)[];
  invert?: boolean;
  // A group run draws each metric's line in its colour on the bare page (그룹런 시안).
  color?: string;
}) {
  const g = color ? groupStyles : null;
  const [width, setWidth] = useState(0);
  const measured = values.filter((value): value is number => value !== null);
  const enough = measured.length >= 2;
  const min = enough ? Math.min(...measured) : 0;
  const max = enough ? Math.max(...measured) : 1;
  const span = max - min || 1;
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 1) {
        segments.push(current.join(' '));
      }
      current = [];
      return;
    }
    const x = values.length > 1 ? (index / (values.length - 1)) * width : 0;
    const ratio = (value - min) / span;
    const y = 8 + (invert ? ratio : 1 - ratio) * (chartHeight - 16);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) {
    segments.push(current.join(' '));
  }
  return (
    <View style={styles.chart}>
      <View
        style={[styles.chartBox, g?.chartBox]}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        {enough && width > 0 ? (
          <Svg width={width} height={chartHeight}>
            <Line
              x1={0}
              y1={chartHeight - 1}
              x2={width}
              y2={chartHeight - 1}
              stroke={color ? groupInk.rule : liveLook.line}
              strokeWidth={1}
            />
            {segments.map((points, index) => (
              <Polyline
                key={index}
                points={points}
                fill="none"
                stroke={color ?? liveLook.text}
                strokeWidth={color ? 2.5 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </Svg>
        ) : (
          <AppText style={[styles.chartEmpty, g?.chartEmpty]}>
            측정값이 쌓이면 추이를 보여 드려요
          </AppText>
        )}
      </View>
      <View style={styles.chartAxis}>
        <AppText style={[styles.axisText, g?.axisText]}>시작</AppText>
        <AppText style={[styles.axisText, g?.axisText]}>지금</AppText>
      </View>
    </View>
  );
}

function SubMetric({
  label,
  value,
  unit,
  group = false,
  after = false,
}: {
  label: string;
  value: string;
  unit?: string;
  // 그룹런 시안: no tile, the mint label on top, a line before the second one.
  group?: boolean;
  after?: boolean;
}) {
  const g = group ? groupStyles : null;
  return (
    <View style={[styles.sub, g?.sub, after && g?.subAfter]}>
      {g ? <AppText style={g.subLabel}>{label}</AppText> : null}
      <View style={styles.metricLine}>
        <AppText
          style={[styles.subValue, g?.subValue]}
          accessibilityLabel={label}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </AppText>
        {unit ? (
          <AppText style={[styles.metricUnit, g?.subUnit]}>{unit}</AppText>
        ) : null}
      </View>
      {g ? null : <AppText style={styles.metricLabel}>{label}</AppText>}
    </View>
  );
}

// One number per page (the reference's split pages): the value biggest, its line from the start, and two
// related numbers under it.
function MetricPage({
  label,
  value,
  unit,
  chip,
  note,
  trend,
  invert,
  subs,
  children,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  chip?: string | null;
  note?: string | null;
  trend: (number | null)[];
  invert?: boolean;
  subs: { label: string; value: string; unit?: string }[];
  children?: React.ReactNode;
  // A group run's colour for this metric (그룹런 시안): the mint label, the heavy figure, the coloured line.
  color?: string;
}) {
  const g = color ? groupStyles : null;
  return (
    <View style={[styles.page, g?.page]}>
      <View style={styles.hero}>
        <View style={styles.heroHead}>
          <AppText style={[styles.heroLabel, g?.heroLabel]}>{label}</AppText>
          {chip ? (
            <View style={[styles.chip, g?.chip]}>
              <AppText style={[styles.chipText, g?.chipText]}>{chip}</AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.heroLine}>
          <AppText
            style={[styles.heroValue, g?.heroValue]}
            accessibilityLabel={label}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {value}
          </AppText>
          <AppText style={[styles.heroUnit, g?.heroUnit]}>{unit}</AppText>
        </View>
        {note ? (
          <AppText style={[styles.metricNote, g?.note]}>{note}</AppText>
        ) : null}
      </View>
      <TrendChart values={trend} invert={invert} color={color} />
      <View style={[styles.subs, g?.subs]}>
        {subs.map((sub, index) => (
          <SubMetric
            key={sub.label}
            {...sub}
            group={!!color}
            after={index > 0}
          />
        ))}
      </View>
      {children}
    </View>
  );
}

const averageOf = (values: (number | null)[]) => {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length
    ? measured.reduce((sum, value) => sum + value, 0) / measured.length
    : null;
};

// 페이스 · 거리 · 심박 · 케이던스, one page each. A value nobody measured shows as none, never zero or a guess.
export function metricPages({
  pace,
  goalPace,
  distanceM,
  totalM,
  elapsedSec,
  heartRate,
  cadence,
  targetBpm,
  history,
  rival,
  guidance,
  group = false,
}: {
  pace: number | null;
  goalPace: number | null;
  distanceM: number;
  totalM: number | null;
  elapsedSec: number;
  heartRate: number | null;
  cadence: number | null;
  targetBpm: number | null;
  history: HistoryPoint[];
  rival: ComparisonLine | null;
  guidance: RunGuidance | null;
  // 그룹런 시안 (S15P31E105-673): each metric in its colour on the bare page.
  group?: boolean;
}) {
  const color = (key: keyof typeof groupInk.chart) =>
    group ? groupInk.chart[key] : undefined;
  const average = averagePace(elapsedSec, distanceM);
  const remaining = totalM ? Math.max(totalM - distanceM, 0) : null;
  const heartRates = history.map(point => point.heartRate);
  const measuredRates = heartRates.filter(
    (value): value is number => value !== null,
  );
  const averageRate = averageOf(heartRates);
  const averageCadence = averageOf(history.map(point => point.cadence));
  return [
    {
      key: 'pace',
      title: '페이스',
      content: (
        <MetricPage
          label="현재 페이스"
          value={pace === null ? none : formatPace(pace)}
          unit="/km"
          chip={goalPace ? `목표 ${formatPace(goalPace)}` : null}
          trend={history.map(point => point.pace)}
          color={color('pace')}
          invert
          subs={[
            {
              label: '평균 페이스',
              value: average === null ? none : formatPace(average),
              unit: '/km',
            },
            {
              label: '목표 페이스',
              value: goalPace ? formatPace(goalPace) : '설정 안 함',
              unit: goalPace ? '/km' : undefined,
            },
          ]}
        >
          {rival ? (
            <View style={styles.line}>
              <AppText style={styles.lineText} numberOfLines={2}>
                {`${rival.label} ${rival.text}`}
              </AppText>
            </View>
          ) : null}
          {guidance ? (
            <View style={styles.line}>
              <Icon
                name={
                  guidance.instruction.includes('직진')
                    ? 'straight'
                    : 'turnLeft'
                }
                color={liveLook.text}
                size={20}
              />
              <View style={styles.flex}>
                <AppText style={styles.lineText}>
                  {guidance.instruction}
                </AppText>
                <AppText style={styles.lineSub}>{guidance.detail}</AppText>
              </View>
            </View>
          ) : null}
        </MetricPage>
      ),
    },
    {
      key: 'distance',
      title: '거리',
      content: (
        <MetricPage
          label="거리"
          value={formatKm(distanceM)}
          unit="km"
          note={totalM ? `목표 ${formatKm(totalM)}km 중` : null}
          trend={history.map(point => point.distanceM)}
          color={color('distance')}
          subs={[
            {
              label: '남은 거리',
              value: remaining === null ? none : formatKm(remaining),
              unit: remaining === null ? undefined : 'km',
            },
            {
              label: '진행률',
              value: totalM
                ? String(Math.min(Math.round((distanceM / totalM) * 100), 100))
                : none,
              unit: totalM ? '%' : undefined,
            },
          ]}
        />
      ),
    },
    {
      key: 'heart',
      title: '심박',
      content: (
        <MetricPage
          label="심박"
          value={heartRate === null ? none : String(heartRate)}
          unit="bpm"
          note={heartRate === null ? '측정값 없음' : null}
          trend={heartRates}
          color={color('heart')}
          subs={[
            {
              label: '평균 심박',
              value:
                averageRate === null ? none : String(Math.round(averageRate)),
              unit: 'bpm',
            },
            {
              label: '최고 심박',
              value: measuredRates.length
                ? String(Math.max(...measuredRates))
                : none,
              unit: 'bpm',
            },
          ]}
        />
      ),
    },
    {
      key: 'cadence',
      title: '케이던스',
      content: (
        <MetricPage
          label="케이던스"
          value={cadence === null ? none : String(Math.round(cadence))}
          unit="spm"
          note={cadence === null ? '측정값 없음' : null}
          trend={history.map(point => point.cadence)}
          color={color('cadence')}
          subs={[
            {
              label: '평균 케이던스',
              value:
                averageCadence === null
                  ? none
                  : String(Math.round(averageCadence)),
              unit: 'spm',
            },
            {
              // The server's target beat, not the measured steps.
              label: '목표 BPM',
              value: targetBpm === null ? none : String(targetBpm),
              unit: 'bpm',
            },
          ]}
        />
      ),
    },
  ];
}

// 코칭: the goal and the app's own comparison first, then what the server's coaching says, then what the
// watch has applied. Target BPM, applied BPM and cadence are different numbers and are named apart.
export function CoachingPage({
  pace,
  goalPace,
  coaching,
  currentBpm,
  cadence,
  now,
}: {
  pace: number | null;
  goalPace: number | null;
  coaching: CoachingGuide | null;
  currentBpm: number | null;
  cadence: number | null;
  now: Date;
}) {
  const expired =
    coaching !== null && new Date(coaching.expiresAt).getTime() < now.getTime();
  return (
    <View style={styles.page}>
      <AppText style={styles.section}>목표</AppText>
      <View style={styles.grid}>
        <Metric
          label="목표 페이스"
          value={goalPace ? formatPace(goalPace) : '설정 안 함'}
          unit={goalPace ? '/km' : undefined}
        />
        <Metric
          label="현재와 차이"
          value={goalGap(pace, goalPace) ?? none}
          note="앱이 현재 페이스로 계산"
        />
      </View>
      <AppText style={styles.section}>서버 코칭</AppText>
      {coaching ? (
        <View style={styles.grid}>
          <Metric
            label="추천 페이스"
            value={formatPace(coaching.recommendedPaceSecPerKm)}
            unit="/km"
            note={expired ? '지난 코칭 · 새 코칭을 기다려요' : null}
          />
          <Metric
            label="목표 BPM"
            value={String(coaching.targetBpm)}
            unit="bpm"
            note={expired ? '지난 코칭' : null}
          />
        </View>
      ) : (
        <AppText style={styles.empty}>아직 받은 코칭이 없어요</AppText>
      )}
      <View style={styles.grid}>
        <Metric
          label="적용 BPM"
          value={currentBpm === null ? none : String(currentBpm)}
          unit="bpm"
          note={
            currentBpm === null
              ? '적용이 확인된 값 없음'
              : '워치 적용이 확인된 값'
          }
        />
        <Metric
          label="케이던스"
          value={cadence === null ? none : String(Math.round(cadence))}
          unit="spm"
          note={cadence === null ? '측정값 없음' : '걸음 측정값'}
        />
      </View>
    </View>
  );
}

// 지도 보기: the whole screen under the top and the foot, following me as I run, the whole course, or wherever
// the user moved the map. Following me, the map leans and turns to the way I run (S15P31E105-521); the whole
// course leans north up. The rotation gesture stays off, so there is never a hand-turned map to set back.
export function LiveMapPanel({
  route,
  trail,
  trailParts,
  notice,
  members,
  area,
  logo,
}: {
  route: LngLat[] | undefined;
  trail: LngLat[];
  // The measured path in parts (S15P31E105-549); without it the trail is one line.
  trailParts?: LngLat[][];
  // A short note on the map, e.g. 위치 확인 중 while no position comes in (S15P31E105-549).
  notice?: string | null;
  members?: RunMapMember[];
  area: RunMapArea | undefined;
  logo: RunMapLogo | undefined;
}) {
  const me = trail.length > 0 ? trail[trail.length - 1] : null;
  const canOverview = Boolean(route && route.length >= 2) || trail.length >= 2;
  const [camera, setCamera] = useState<'follow' | 'overview' | 'free'>(
    me ? 'follow' : 'overview',
  );
  const shown = camera === 'follow' && !me ? 'overview' : camera;
  // The buttons sit just under the top band, whatever its height.
  const buttonsAt: ViewStyle = {
    top: area ? (`${area.top * 100 + 2}%` as const) : 120,
  };
  return (
    <View style={styles.flex}>
      <RunMap
        route={route}
        trail={trail.length > 0 ? trail : undefined}
        trailParts={trailParts}
        members={members}
        fitTo={shown === 'follow' && me ? [me] : undefined}
        cameraLocked={shown === 'free'}
        onUserMove={() => setCamera('free')}
        rotatable={false}
        view={shown === 'follow' ? 'heading' : 'lean'}
        // The bright map with the mint course and run, the same as before the start (S15P31E105-683, 담당자 요청).
        look="mint"
        area={area}
        logo={logo}
        style={StyleSheet.absoluteFill}
      />
      {notice ? (
        <View
          style={[styles.mapNotice, buttonsAt]}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
        >
          <AppText style={styles.mapNoticeText}>{notice}</AppText>
        </View>
      ) : null}
      <View style={[styles.mapButtons, buttonsAt]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="내 위치로 이동"
          accessibilityState={{ selected: shown === 'follow', disabled: !me }}
          disabled={!me}
          onPress={() => setCamera('follow')}
          style={[styles.mapButton, shown === 'follow' && styles.mapButtonOn]}
        >
          <Icon
            name="locate"
            color={shown === 'follow' ? liveLook.ground : liveLook.text}
            size={20}
          />
        </Pressable>
        {canOverview ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="전체 코스 보기"
            accessibilityState={{ selected: shown === 'overview' }}
            onPress={() => setCamera('overview')}
            style={[
              styles.mapButton,
              shown === 'overview' && styles.mapButtonOn,
            ]}
          >
            <Icon
              name="route"
              color={shown === 'overview' ? liveLook.ground : liveLook.text}
              size={20}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export type MusicCommand = 'play' | 'pause' | 'next' | 'previous';

// The song as a small row above the run time. Its play button is round and small, apart from the run's
// own pause, and every button drives the linked service.
export function LiveMusicRow({
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
  return (
    <View style={styles.music}>
      {track.artworkUrl ? (
        <Image
          source={{ uri: track.artworkUrl }}
          accessibilityIgnoresInvertColors
          style={styles.cover}
        />
      ) : (
        <View style={[styles.cover, styles.coverEmpty]}>
          <Icon name="music" color={liveLook.muted} size={16} />
        </View>
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
        <Icon name="skipBack" color={liveLook.text} size={16} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={track.playing ? '음악 일시정지' : '음악 재생'}
        disabled={busy}
        onPress={() => onCommand(track.playing ? 'pause' : 'play')}
        style={styles.play}
      >
        <Icon
          name={track.playing ? 'pause' : 'play'}
          color={liveLook.text}
          size={14}
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
        <Icon name="skipForward" color={liveLook.text} size={16} />
      </Pressable>
    </View>
  );
}

// A notice above the controls, with an optional action (다시 확인 · 폰으로 기록 계속).
export function LiveNotice({
  label,
  text,
  action,
}: {
  label: string;
  text: string;
  action?: { label: string; onPress: () => void } | null;
}) {
  return (
    <View style={styles.notice}>
      <AppText
        style={styles.noticeText}
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
      >
        {text}
      </AppText>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={8}
        >
          <AppText style={styles.noticeAction}>{action.label}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 20, gap: 14 },
  hero: { gap: 2 },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: liveLook.sub,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: liveLook.button,
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.text,
  },
  heroLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroValue: {
    flexShrink: 1,
    fontFamily: fontFamily.numberMedium,
    fontSize: 84,
    lineHeight: 96,
    color: liveLook.text,
    fontVariant: ['tabular-nums'],
  },
  heroUnit: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 22,
    lineHeight: 28,
    color: liveLook.muted,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: liveLook.line,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: liveLook.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
    borderRadius: 18,
    backgroundColor: liveLook.tile,
    gap: 2,
  },
  metricLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.sub,
  },
  metricLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  metricValue: {
    flexShrink: 1,
    fontFamily: fontFamily.numberMedium,
    fontSize: 32,
    lineHeight: 40,
    color: liveLook.text,
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 16,
    lineHeight: 20,
    color: liveLook.muted,
  },
  metricNote: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  section: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.sub,
  },
  empty: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.muted,
    paddingVertical: 8,
  },
  chart: { gap: 6 },
  chartBox: {
    height: chartHeight,
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: liveLook.tile,
    overflow: 'hidden',
  },
  chartEmpty: {
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  subs: { flexDirection: 'row', gap: 10 },
  sub: {
    flex: 1,
    padding: 14,
    borderRadius: 18,
    backgroundColor: liveLook.tile,
  },
  subValue: {
    flexShrink: 1,
    fontFamily: fontFamily.numberMedium,
    fontSize: 30,
    lineHeight: 38,
    color: liveLook.text,
    fontVariant: ['tabular-nums'],
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: liveLook.tile,
  },
  lineText: {
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.text,
  },
  lineSub: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  mapButtons: { position: 'absolute', right: 12, gap: 8 },
  mapNotice: {
    position: 'absolute',
    left: 12,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 5, 14, 0.82)',
  },
  mapNoticeText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: liveLook.text,
  },
  mapButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 5, 14, 0.82)',
  },
  mapButtonOn: { backgroundColor: liveLook.text },
  music: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: liveLook.tile,
  },
  cover: { width: 40, height: 40, borderRadius: 10 },
  coverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: liveLook.button,
  },
  song: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.text,
  },
  album: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  skip: { padding: 6 },
  play: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: liveLook.line,
  },
  notice: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 10,
  },
  noticeText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    color: liveLook.sub,
    textAlign: 'center',
  },
  noticeAction: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 20,
    color: liveLook.text,
    textDecorationLine: 'underline',
  },
});

// 그룹런 시안 (S15P31E105-673) on top of the styles above: no tiles, lines instead, the labels in mint, the figures
// in heavy Archivo and each metric's line in its colour.
const groupInk = {
  text: '#FFFFFF',
  sub: '#B9C0CA',
  mint: '#4DFFD2',
  line: 'rgba(255,255,255,0.12)',
  rule: 'rgba(255,255,255,0.4)',
  chart: {
    pace: '#4DFFD2',
    distance: '#4D9BFF',
    heart: '#D44A4A',
    cadence: '#FFD84D',
  },
} as const;

const groupStyles = StyleSheet.create({
  page: { paddingHorizontal: 19 },
  heroLabel: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: groupInk.mint,
  },
  // 목표 6′15″ as an outlined square tag.
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: groupInk.rule,
    backgroundColor: 'transparent',
  },
  chipText: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 12,
    lineHeight: 16,
    color: groupInk.text,
  },
  heroValue: {
    fontFamily: fontFamily.resultBlack,
    fontSize: 76,
    lineHeight: 90,
    letterSpacing: -2,
    color: groupInk.text,
  },
  heroUnit: {
    fontFamily: fontFamily.numberBold,
    fontSize: 22,
    lineHeight: 28,
    color: groupInk.sub,
  },
  note: { fontSize: 12.5, lineHeight: 17, color: groupInk.sub },
  // The chart on the bare page between a thin line over it and the axis line under it.
  chartBox: {
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderTopColor: groupInk.line,
  },
  chartEmpty: { fontSize: 13, color: groupInk.text },
  axisText: { fontSize: 12.5, lineHeight: 17, color: groupInk.sub },
  subs: { gap: 0 },
  sub: { padding: 0, borderRadius: 0, backgroundColor: 'transparent' },
  subAfter: {
    paddingLeft: 24,
    borderLeftWidth: 1,
    borderLeftColor: groupInk.rule,
  },
  subLabel: {
    fontFamily: fontFamily.black,
    fontSize: 13,
    lineHeight: 18,
    color: groupInk.mint,
  },
  subValue: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 28,
    lineHeight: 36,
    color: groupInk.text,
  },
  subUnit: {
    fontFamily: fontFamily.numberBold,
    fontSize: 13,
    color: groupInk.sub,
  },
});
