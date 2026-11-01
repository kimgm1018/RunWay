import React, { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { AppText, Button, Icon } from '../../components';
import {
  useResource,
  type CoursePlan,
  type GroupRunSummary,
  type ReadinessState,
  type Repositories,
  type RunRecordDetail,
  type RunRecordSummary,
  type RunStatistics,
  type TodayCondition,
} from '../../data';
import {
  formatClockTime,
  formatKm,
  formatLongDate,
  formatMonthDay,
  formatPace,
  formatSleep,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import {
  fontFamily,
  k1,
  spacing,
  ThemeProvider,
  useTheme,
  widgetPalette,
} from '../../theme';

const { steel, graphite, core } = widgetPalette;
const gap = 10;

// ── Data ────────────────────────────────────────────────────────────────

type Board = {
  plan: CoursePlan;
  upcoming: GroupRunSummary | null;
  lastRun: RunRecordDetail | null;
  week: RunStatistics;
  weekHeartRate: number | null;
  streakWeeks: number;
};

const dayMs = 24 * 60 * 60 * 1000;
const kstMs = 9 * 60 * 60 * 1000;

// Dates are counted in KST like the rest of the app.
const kstDate = (date: Date) =>
  new Date(date.getTime() + kstMs).toISOString().slice(0, 10);

// Monday 00:00 KST of the week that holds the time.
function weekStart(time: number) {
  const shifted = new Date(time + kstMs);
  const fromMonday = (shifted.getUTCDay() + 6) % 7;
  return (
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - fromMonday,
    ) - kstMs
  );
}

// YYYY-MM of this month and the ones before it.
function recentMonths(now: Date, count: number) {
  const shifted = new Date(now.getTime() + kstMs);
  return Array.from({ length: count }, (_, back) =>
    new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - back))
      .toISOString()
      .slice(0, 7),
  );
}

// 연속 러닝: weeks in a row with a run, counted back from this week (or last week while this one is empty).
function streakOf(runs: RunRecordSummary[], now: Date) {
  const weeks = new Set(runs.map(run => weekStart(Date.parse(run.startedAt))));
  let week = weekStart(now.getTime());
  if (!weeks.has(week)) {
    week -= 7 * dayMs;
  }
  let count = 0;
  while (weeks.has(week)) {
    count += 1;
    week -= 7 * dayMs;
  }
  return count;
}

// Distance-weighted average of a split value over the runs; null when no split has it.
function splitAverage(
  runs: RunRecordDetail[],
  pick: (split: RunRecordDetail['splits'][number]) => number | null,
) {
  let total = 0;
  let meters = 0;
  for (const split of runs.flatMap(run => run.splits)) {
    const value = pick(split);
    if (value !== null) {
      const length = split.endDistanceM - split.startDistanceM;
      total += value * length;
      meters += length;
    }
  }
  return meters ? Math.round(total / meters) : null;
}

const loadBoard = async (repositories: Repositories): Promise<Board> => {
  const now = repositories.clock.now();
  const [plan, mine, recent, week, months] = await Promise.all([
    repositories.courses.getTodayPlan(),
    repositories.groupRuns.listMine(),
    repositories.records.getRecent('recent', 1),
    repositories.records.getStatistics('WEEK', kstDate(now)),
    Promise.all(
      recentMonths(now, 3).map(month =>
        repositories.records.getMonth(month, 'ALL'),
      ),
    ),
  ]);
  const runs = months.flatMap(month => month.records);
  const thisWeek = runs.filter(
    run => Date.parse(run.startedAt) >= weekStart(now.getTime()),
  );
  const [lastRun, weekRuns] = await Promise.all([
    recent[0] ? repositories.records.getDetail(recent[0].id) : null,
    Promise.all(thisWeek.map(run => repositories.records.getDetail(run.id))),
  ]);
  return {
    plan,
    upcoming: mine.upcoming,
    lastRun,
    week,
    weekHeartRate: splitAverage(weekRuns, split => split.averageHeartRate),
    streakWeeks: streakOf(runs, now),
  };
};

// ── Readiness fallbacks ─────────────────────────────────────────────────

type Fallback = {
  pill: string;
  headline: string;
  emphasis: string;
  explain: string;
  action?: { title: string; route: RouteName };
};

// 2.1 states ②–⑤: no confirmed score and nothing that looks like a health-based recommendation.
function fallbackFor(today: TodayCondition): Fallback | null {
  const states: Record<Exclude<ReadinessState, 'ready'>, Fallback> = {
    collecting: {
      pill: '평가 전',
      headline: '준비도 수집 중',
      emphasis: '점수 산출 전',
      explain:
        '건강 데이터가 모이면 준비도를 알려 드려요. 지금은 수준·목표 기준으로 추천해요.',
    },
    stale: {
      pill: '평가 전',
      headline: today.lastAssessedDate
        ? `마지막 평가 ${formatMonthDay(today.lastAssessedDate)}`
        : '오래된 데이터',
      emphasis: '오늘 점수로 쓰지 않아요',
      explain: '워치를 동기화하면 오늘 준비도를 다시 평가해요.',
      action: { title: '워치 동기화', route: 'WatchConnect' },
    },
    permissionDenied: {
      pill: '평가 전',
      headline: '건강 데이터',
      emphasis: '권한 없음',
      explain:
        '설정 > Health Connect에서 권한을 허용하면 준비도를 볼 수 있어요.',
      action: { title: '설정 열기', route: 'Settings' },
    },
    watchDisconnected: {
      pill: '평가 전',
      headline: '워치',
      emphasis: '미연결',
      explain: '설정에서 워치를 연결하면 준비도를 볼 수 있어요.',
      action: { title: '워치 연결', route: 'WatchConnect' },
    },
  };
  return today.readinessState === 'ready' ? null : states[today.readinessState];
}

// ── Painting ────────────────────────────────────────────────────────────

type GradientStop = [offset: number, color: string, opacity?: number];
export type Layer =
  | { kind: 'linear'; angle: number; stops: GradientStop[] }
  | {
      kind: 'radial';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      stops: GradientStop[];
    };

// The CSS angle (0 = up, clockwise) as the two ends of an objectBoundingBox line.
function ends(angle: number) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = -Math.cos(radians) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

// A widget's background, built from the mockup's CSS gradients stacked bottom to top.
// It takes the card's measured size: an Svg sized in percent falls back to 300×150 on Android.
function Paint({
  id,
  layers,
  width,
  height,
}: {
  id: string;
  layers: Layer[];
  width: number;
  height: number;
}) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        {layers.map((layer, index) => {
          const stops = layer.stops.map(([offset, color, opacity = 1]) => (
            <Stop
              key={offset}
              offset={offset}
              stopColor={color}
              stopOpacity={opacity}
            />
          ));
          return layer.kind === 'linear' ? (
            <LinearGradient
              key={index}
              id={`${id}${index}`}
              {...ends(layer.angle)}
            >
              {stops}
            </LinearGradient>
          ) : (
            <RadialGradient
              key={index}
              id={`${id}${index}`}
              cx={layer.cx}
              cy={layer.cy}
              fx={layer.cx}
              fy={layer.cy}
              rx={layer.rx}
              ry={layer.ry}
            >
              {stops}
            </RadialGradient>
          );
        })}
      </Defs>
      {layers.map((_, index) => (
        <Rect
          key={index}
          width={width}
          height={height}
          fill={`url(#${id}${index})`}
        />
      ))}
    </Svg>
  );
}

// Dark center fading out to the palette's rim (DESIGN.md 2-2 비네트).
export const vignette = (
  palette: typeof steel | typeof graphite,
  rx = 0.75,
  ry = 0.75,
  cy = 0.5,
): Layer[] => [
  {
    kind: 'radial',
    cx: 0.5,
    cy,
    rx,
    ry,
    stops: [
      [0, core],
      [0.3, core],
      [0.62, palette.mid],
      [1, palette.rim],
    ],
  },
];

// A soft light spot standing in for the mockup's blurred color layers.
export const spot = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  opacity = 0.9,
): Layer => ({
  kind: 'radial',
  cx,
  cy,
  rx,
  ry,
  stops: [
    [0, color, opacity],
    [0.7, color, 0],
    [1, color, 0],
  ],
});

// ── Widget frame ────────────────────────────────────────────────────────

export function Widget({
  id,
  layers,
  light = false,
  style,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  id: string;
  layers?: Layer[];
  // White widgets keep the light tone; the painted ones switch to the dark tone.
  light?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  // What the press leads to, when the label alone does not say it.
  accessibilityHint?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setSize(event.nativeEvent.layout);
  const frame = [
    styles.widget,
    light && { backgroundColor: colors.surfaceRaised },
    style,
  ];
  const inside = (
    <>
      {layers && size ? (
        <Paint
          id={id}
          layers={layers}
          width={size.width}
          height={size.height}
        />
      ) : null}
      {light ? children : <ThemeProvider tone="dark">{children}</ThemeProvider>}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLayout={measure}
      style={({ pressed }) => [frame, pressed && styles.pressed]}
    >
      {inside}
    </Pressable>
  ) : (
    <View style={frame} onLayout={measure}>
      {inside}
    </View>
  );
}

// ── Widgets ─────────────────────────────────────────────────────────────

// 오늘 컨디션: the readiness glow in a white card, with sleep · resting heart rate · 7-day load under it.
// 컨디션 and 준비도 are separate values, so each is shown under its own name.
function ReadinessWidget({ today }: { today: TodayCondition }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const fallback = fallbackFor(today);
  const [grade, ...reason] = today.readinessSummary?.split(' · ') ?? [];
  const metrics = [
    {
      label: '수면',
      value:
        today.sleepMinutes === null ? '– –' : formatSleep(today.sleepMinutes),
      note: today.sleepLabel,
    },
    {
      label: '안정 심박',
      value:
        today.restingHeartRate === null
          ? '– –'
          : String(today.restingHeartRate),
      note: today.restingHeartRateLabel,
    },
    {
      label: '7일 부하',
      value: today.weeklyLoad ?? '– –',
      note: today.weeklyLoadLabel,
    },
  ];
  return (
    <Widget id="readiness" light style={styles.readiness}>
      <View style={styles.readinessTop}>
        <View style={styles.flex}>
          <AppText style={styles.cardTitle}>
            {fallback ? fallback.headline : '오늘 컨디션'}
          </AppText>
          <AppText variant="caption" tone="textSecondary">
            {fallback
              ? fallback.explain
              : [`컨디션 ${today.condition}`, ...reason].join(' · ')}
          </AppText>
        </View>
        {/* The sync time is information, not a button. */}
        <AppText variant="label" tone="textTertiary" style={styles.synced}>
          {today.syncedAt
            ? `${formatClockTime(today.syncedAt)} 동기화`
            : '동기화 전'}
        </AppText>
      </View>
      <Orb
        score={fallback ? null : today.readinessScore}
        label={fallback ? fallback.emphasis : `준비도 ${grade}`}
      />
      {fallback ? (
        fallback.action ? (
          <Button
            title={fallback.action.title}
            variant="secondary"
            size="small"
            style={styles.center}
            onPress={() => navigateTo(navigation, fallback.action!.route)}
          />
        ) : null
      ) : (
        <>
          <View style={[styles.row3, { borderTopColor: colors.border }]}>
            {metrics.map(metric => (
              <View key={metric.label} style={styles.cell}>
                <AppText style={styles.tiny} tone="textTertiary">
                  {metric.label}
                </AppText>
                <AppText variant="metric">{metric.value}</AppText>
                {metric.note ? (
                  <AppText style={styles.tiny} tone="textSecondary">
                    {metric.note}
                  </AppText>
                ) : null}
              </View>
            ))}
          </View>
          {today.aiAdvice ? (
            <AppText variant="caption" tone="textSecondary">
              <AppText variant="captionStrong">AI</AppText> {today.aiAdvice}
            </AppText>
          ) : null}
        </>
      )}
    </Widget>
  );
}

const orbSize = 186;

// The readiness glow: steel light spreading out from the middle of the white card,
// darkened behind the score so the light number stays readable.
function Orb({ score, label }: { score: number | null; label: string }) {
  return (
    <View style={styles.orb}>
      <Svg width={orbSize} height={orbSize} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="orb" cx="50%" cy="50%" r="50%">
            <Stop offset={0} stopColor={steel.orb[0]} />
            <Stop offset={0.38} stopColor={steel.orb[1]} />
            <Stop offset={0.62} stopColor={steel.haze[0]} stopOpacity={0.55} />
            <Stop offset={0.72} stopColor={steel.haze[0]} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="orbCore" cx="50%" cy="50%" r="50%">
            <Stop offset={0} stopColor={k1.deep} stopOpacity={0.55} />
            <Stop offset={0.6} stopColor={k1.deep} stopOpacity={0.3} />
            <Stop offset={1} stopColor={k1.deep} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle
          cx={orbSize / 2}
          cy={orbSize / 2}
          r={orbSize / 2}
          fill="url(#orb)"
        />
        <Circle
          cx={orbSize / 2}
          cy={orbSize / 2}
          r={orbSize * 0.36}
          fill="url(#orbCore)"
        />
      </Svg>
      <AppText tone="onAccent" style={styles.score}>
        {score ?? '– –'}
        {score !== null ? (
          <AppText tone="onAccent" style={styles.scoreUnit}>
            /100
          </AppText>
        ) : null}
      </AppText>
      <AppText variant="bodyMedium" tone="onAccent">
        {label}
      </AppText>
    </View>
  );
}

// 러닝 시작 with the AI course of the day (graphite glass). The press opens 러닝 방식 고르기, so the card says so.
function RunStartWidget({ plan }: { plan: CoursePlan | null }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  return (
    <Widget
      id="start"
      layers={[
        {
          kind: 'linear',
          angle: 150,
          stops: [
            [0, graphite.glass[0]],
            [1, graphite.glass[1]],
          ],
        },
        spot(0.22, 0.65, 0.4, 0.55, graphite.glassLight[0]),
        spot(0.78, 0.35, 0.45, 0.55, graphite.glassLight[1]),
      ]}
      style={styles.start}
      accessibilityLabel="러닝 시작"
      accessibilityHint="러닝 방식을 고르는 화면으로 이동해요"
      onPress={() => navigateTo(navigation, 'RunMode')}
    >
      <AppText variant="caption" tone="textSecondary">
        {plan ? `AI 추천 · ${plan.name}` : 'AI 추천'}
      </AppText>
      <AppText style={styles.startTitle}>러닝 시작</AppText>
      <AppText variant="caption" tone="textSecondary">
        눌러서 러닝 방식 선택
      </AppText>
      {/* In the dark tone the accent is the light ice color. */}
      <View style={[styles.play, { backgroundColor: colors.accent }]}>
        <Icon name="play" color={colors.onAccent} size={20} />
      </View>
      {plan ? (
        <AppText style={styles.startMeta}>
          {formatKm(plan.distanceM, 1)}
          <AppText variant="caption" tone="textSecondary">
            {` km · 목표 ${formatPace(plan.targetPaceSecPerKm)}/km`}
          </AppText>
        </AppText>
      ) : null}
    </Widget>
  );
}

// 오늘 안정 심박 on a steel vignette. The dotted line is decoration: there is no range to mark a spot on.
function RestingHeartWidget({
  today,
  width,
}: {
  today: TodayCondition;
  width: number;
}) {
  const shown = fallbackFor(today) === null && today.restingHeartRate !== null;
  return (
    <Widget
      id="heart"
      layers={vignette(steel)}
      style={[styles.tall, { width }]}
    >
      <AppText variant="bodyMedium">안정 심박</AppText>
      <AppText variant="label" tone="textSecondary">
        오늘
      </AppText>
      <AppText style={styles.big}>
        {shown ? today.restingHeartRate : '– –'}
        <AppText style={styles.bigUnit}> bpm</AppText>
      </AppText>
      <View
        style={styles.dotline}
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: 18 }, (_, index) => (
          <View
            key={index}
            style={[styles.tickDot, { backgroundColor: steel.tick }]}
          />
        ))}
      </View>
      {shown && today.restingHeartRateLabel ? (
        <AppText variant="caption" style={styles.foot}>
          {today.restingHeartRateLabel}
        </AppText>
      ) : null}
    </Widget>
  );
}

const ringSize = 112;

// 케이던스 averaged over the last run, inside a decorative ring of dots with a brighter arc at the top.
// The title sits top left like 안정 심박 beside it.
function CadenceWidget({
  cadence,
  width,
}: {
  cadence: number | null;
  width: number;
}) {
  const center = ringSize / 2;
  const radius = 51;
  return (
    <Widget
      id="cadence"
      layers={vignette(graphite)}
      style={[styles.tall, { width }]}
    >
      <AppText variant="bodyMedium">케이던스</AppText>
      <AppText variant="label" tone="textSecondary">
        지난 러닝 평균
      </AppText>
      <View style={[styles.ringBox, { left: (width - ringSize) / 2 }]}>
        <Svg width={ringSize} height={ringSize} style={StyleSheet.absoluteFill}>
          {Array.from({ length: 80 }, (_, index) => {
            const angle = -Math.PI / 2 + (2 * Math.PI * index) / 80;
            const strong = index >= 2 && index <= 16;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            if (!strong) {
              return (
                <Circle
                  key={index}
                  cx={x}
                  cy={y}
                  r={0.9}
                  fill={graphite.tick}
                  opacity={0.6}
                />
              );
            }
            const length = 15 - Math.abs(index - 9) * 1.2;
            return (
              <Line
                key={index}
                x1={x}
                y1={y}
                x2={center + (radius - length) * Math.cos(angle)}
                y2={center + (radius - length) * Math.sin(angle)}
                stroke={steel.haze[0]}
                strokeWidth={1.2}
                opacity={0.4 + 0.6 * (1 - Math.abs(index - 9) / 8)}
              />
            );
          })}
        </Svg>
        <AppText style={styles.cadence}>{cadence ?? '– –'}</AppText>
        <AppText variant="label" tone="textSecondary">
          spm
        </AppText>
      </View>
    </Widget>
  );
}

const chartHeight = 110;
const chartInset = 18;
// Room on the right for the guide labels, clear of the line.
const guideGutter = 58;

// 2.5, 3 (km) for a split edge.
const splitKm = (meters: number) => String(Number((meters / 1000).toFixed(1)));
// Faster splits sit higher: the fastest at 90% of the chart, the slowest at 30%, clear of the km labels.
const fastY = chartHeight * 0.1;
const slowY = chartHeight * 0.7;

// 지난 러닝: the pace of each 1 km split as a line, flagged at the fastest one (steel scene).
// Two guide lines carry the fastest and slowest pace, so up reads as faster.
function SegmentWidget({
  run,
  width,
}: {
  run: RunRecordDetail;
  width: number;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const splits = run.splits.filter(split => split.paceSecPerKm !== null);
  if (splits.length < 2) {
    return null;
  }
  const paces = splits.map(split => split.paceSecPerKm!);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const best = paces.indexOf(fastest);
  const plotRight = width - chartInset - guideGutter;
  const span = plotRight - chartInset;
  const points = paces.map((pace, index) => ({
    x: chartInset + (index / (paces.length - 1)) * span,
    y:
      slowest === fastest
        ? (fastY + slowY) / 2
        : slowY - ((slowest - pace) / (slowest - fastest)) * (slowY - fastY),
  }));
  const first = points[0];
  const last = points[points.length - 1];
  const line = points
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(' ');
  const flag = points[best];
  const guides = [
    { y: fastY, label: `${formatPace(fastest)} 빠름` },
    { y: slowY, label: `${formatPace(slowest)} 느림` },
  ];
  return (
    <Widget
      id="segment"
      layers={[
        {
          kind: 'linear',
          angle: 180,
          stops: [
            [0, steel.sky[0]],
            [0.45, steel.sky[1]],
            [1, steel.sky[2]],
          ],
        },
        spot(0.4, 0.55, 0.4, 0.35, steel.haze[0]),
        spot(0.75, 0.4, 0.5, 0.4, steel.haze[1]),
      ]}
      style={styles.segment}
      accessibilityLabel="지난 러닝 기록 보기"
      onPress={() => navigation.navigate('RecordDetail', { recordId: run.id })}
    >
      <AppText variant="label" tone="textSecondary" style={styles.eyebrow}>
        {`지난 러닝 · 최고 페이스 · ${splitKm(
          splits[best].startDistanceM,
        )}–${splitKm(splits[best].endDistanceM)} km 구간`}
      </AppText>
      <AppText style={styles.segmentPace}>
        {formatPace(fastest)}
        <AppText style={styles.bigUnit} tone="textSecondary">
          /km
        </AppText>
      </AppText>
      <View style={[styles.arrow, { borderColor: colors.borderStrong }]}>
        <Icon name="forward" color={colors.text} size={16} />
      </View>
      <Svg
        width={width}
        height={chartHeight + 26}
        viewBox={`0 -26 ${width} ${chartHeight + 26}`}
        style={styles.chart}
      >
        {guides.map(guide => (
          <React.Fragment key={guide.label}>
            <Line
              x1={chartInset}
              y1={guide.y}
              x2={plotRight}
              y2={guide.y}
              stroke={colors.text}
              strokeOpacity={0.28}
              strokeDasharray="2 4"
            />
            <SvgText
              x={width - chartInset}
              y={guide.y + 3.5}
              textAnchor="end"
              fontFamily={fontFamily.numberRegular}
              fontSize={10}
              fill={colors.textSecondary}
            >
              {guide.label}
            </SvgText>
          </React.Fragment>
        ))}
        <Path
          d={`${line} L${last.x} ${chartHeight} L${first.x} ${chartHeight} Z`}
          fill={colors.text}
          fillOpacity={0.12}
        />
        <Path
          d={line}
          fill="none"
          stroke={colors.text}
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        <Line
          x1={flag.x}
          y1={flag.y}
          x2={flag.x}
          y2={chartHeight}
          stroke={colors.text}
        />
        <Circle cx={flag.x} cy={flag.y} r={4.5} fill={colors.text} />
        <Path
          d={`M${flag.x} ${flag.y - 5} V${flag.y - 22} l10 4 -10 4`}
          stroke={colors.text}
          strokeWidth={1.3}
          fill={colors.text}
        />
      </Svg>
      {/* Each point is the end of a split; whole km and the finish get a label under it. */}
      {splits.map((split, index) => {
        const finish = index === splits.length - 1;
        return finish || split.endDistanceM % 1000 === 0 ? (
          <AppText
            key={split.endDistanceM}
            style={[
              styles.axisLabel,
              styles.axisTick,
              { left: points[index].x },
            ]}
            tone="textSecondary"
          >
            {finish
              ? `${splitKm(split.endDistanceM)} km`
              : splitKm(split.endDistanceM)}
          </AppText>
        ) : null;
      })}
    </Widget>
  );
}

// 어젯밤 수면 on a white card, with the sleep label instead of made-up stage bars.
function SleepWidget({
  today,
  width,
}: {
  today: TodayCondition;
  width: number;
}) {
  const { colors } = useTheme();
  const minutes = fallbackFor(today) === null ? today.sleepMinutes : null;
  return (
    <Widget id="sleep" light style={[styles.small, { width }]}>
      <View style={styles.titleRow}>
        <View style={[styles.iconRing, { borderColor: colors.borderStrong }]}>
          <Icon name="moon" color={colors.text} size={17} strokeWidth={1.4} />
        </View>
        <AppText variant="caption">어젯밤 수면</AppText>
      </View>
      <View style={styles.bottom}>
        {/* Hours and minutes in the same 7h 12m form as 오늘 컨디션. */}
        {minutes === null ? (
          <AppText style={styles.mid}>– –</AppText>
        ) : (
          <AppText style={styles.mid}>
            {Math.floor(minutes / 60)}
            <AppText style={styles.midUnit} tone="textSecondary">
              {'h '}
            </AppText>
            {String(minutes % 60).padStart(2, '0')}
            <AppText style={styles.midUnit} tone="textSecondary">
              m
            </AppText>
          </AppText>
        )}
        {minutes !== null && today.sleepLabel ? (
          <AppText variant="label" tone="textSecondary">
            {today.sleepLabel}
          </AppText>
        ) : null}
      </View>
    </Widget>
  );
}

const streakSlots = 6;

// The last six weeks, the ones in the streak filled. Inside the card so it takes the dark tone.
function WeekDots({ weeks }: { weeks: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.weekDots}
      accessibilityLabel={`최근 ${streakSlots}주 중 ${Math.min(
        weeks,
        streakSlots,
      )}주 연속`}
    >
      {Array.from({ length: streakSlots }, (_, index) => (
        <View
          key={index}
          style={[
            styles.weekDot,
            { borderColor: colors.text },
            index >= streakSlots - weeks && { backgroundColor: colors.text },
          ]}
        />
      ))}
    </View>
  );
}

// The › of a card that opens a screen, in the card's own tone.
function CardArrow() {
  const { colors } = useTheme();
  return (
    <View style={[styles.arrow, { borderColor: colors.borderStrong }]}>
      <Icon name="forward" color={colors.text} size={16} />
    </View>
  );
}

// 연속 러닝 on a graphite tone card: weeks in a row with at least one run,
// with the last six weeks as dots, the counted ones filled.
function StreakWidget({ weeks, width }: { weeks: number; width: number }) {
  const { colors } = useTheme();
  return (
    <Widget
      id="streak"
      layers={[
        {
          kind: 'linear',
          angle: 150,
          stops: [
            [0, graphite.tone[0]],
            [1, graphite.tone[1]],
          ],
        },
      ]}
      style={[styles.small, { width }]}
    >
      <View style={styles.titleRow}>
        <View style={[styles.iconRing, { borderColor: colors.borderStrong }]}>
          <Icon name="flame" color={colors.text} size={17} strokeWidth={1.4} />
        </View>
        <AppText variant="caption">연속 러닝</AppText>
      </View>
      <View style={styles.bottom}>
        <View>
          <AppText style={styles.mid}>
            {weeks}
            <AppText style={styles.midUnit} tone="textSecondary">
              주
            </AppText>
          </AppText>
          <AppText style={styles.tiny} tone="textSecondary">
            매주 1회 이상
          </AppText>
        </View>
        <WeekDots weeks={weeks} />
      </View>
    </Widget>
  );
}

// Where the 7-day load sits on the 낮음 · 적정 · 높음 scale.
const loadPosition: Record<string, number> = {
  낮음: 0.15,
  적정: 0.47,
  높음: 0.85,
};

// 7일 부하 리포트: the load of the last 7 days on its scale, then this calendar week's
// distance, runs and heart rate. The two periods differ, so each is named (wide steel vignette).
// Without a load value the scale shows no mark rather than a guessed one.
function LoadWidget({
  load,
  week,
  heartRate,
}: {
  load: string | null;
  week: RunStatistics;
  heartRate: number | null;
}) {
  const position = load === null ? undefined : loadPosition[load];
  return (
    <Widget
      id="load"
      layers={vignette(steel, 0.55, 0.75, 0.55)}
      style={styles.load}
    >
      <View style={styles.loadHead}>
        <AppText variant="bodyMedium">7일 부하 리포트</AppText>
        <AppText variant="label" tone="textSecondary">
          {position === undefined ? '측정 데이터 부족' : '최근 7일'}
        </AppText>
      </View>
      <View style={styles.scale}>
        <View style={styles.scaleLabels}>
          {['낮음', '적정', '높음'].map(label => (
            <AppText key={label} style={styles.axisLabel} tone="textSecondary">
              {label}
            </AppText>
          ))}
        </View>
        <View style={styles.ticks}>
          {Array.from({ length: 25 }, (_, index) => (
            <View
              key={index}
              style={[
                styles.tick,
                { backgroundColor: steel.tick },
                (index === 0 || index === 24) && styles.tickEnd,
              ]}
            />
          ))}
        </View>
        {position === undefined ? null : (
          <View style={[styles.scaleMark, { left: `${position * 100}%` }]} />
        )}
      </View>
      <AppText style={[styles.tiny, styles.period]} tone="textSecondary">
        이번 주 · 월–일
      </AppText>
      <View style={styles.trio}>
        {[
          {
            label: '거리',
            value: formatKm(week.totalDistanceM, 1),
            unit: ' km',
          },
          { label: '러닝', value: String(week.runCount), unit: '회' },
          {
            label: '평균 심박',
            value: heartRate === null ? '– –' : String(heartRate),
            unit: heartRate === null ? ' 측정 없음' : ' bpm',
          },
        ].map(item => (
          <View key={item.label} style={styles.flex}>
            <AppText style={styles.tiny} tone="textSecondary">
              {`● ${item.label}`}
            </AppText>
            <AppText style={styles.trioValue}>
              {item.value}
              <AppText style={styles.trioUnit} tone="textSecondary">
                {item.unit}
              </AppText>
            </AppText>
          </View>
        ))}
      </View>
    </Widget>
  );
}

// 5×7 dot glyphs for the group run time.
const glyphs: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['0', '1', '0', '0', '0', '1', '0'],
};

// The time drawn in dots like the mockup's dot matrix.
function DotTime({ time }: { time: string }) {
  const { colors } = useTheme();
  const dot = 6;
  const step = 8;
  const letterGap = 6;
  let x = 0;
  const dots: React.ReactNode[] = [];
  for (const char of time) {
    const rows = glyphs[char] ?? glyphs[':'];
    rows.forEach((row, y) =>
      [...row].forEach((on, column) =>
        dots.push(
          <Circle
            key={`${x}-${column}-${y}`}
            cx={x + column * step + dot / 2}
            cy={y * step + dot / 2}
            r={dot / 2}
            fill={colors.text}
            opacity={on === '1' ? 1 : 0.08}
          />,
        ),
      ),
    );
    x += rows[0].length * step + letterGap;
  }
  return (
    <Svg width={x - letterGap} height={7 * step} accessibilityLabel={time}>
      {dots}
    </Svg>
  );
}

// 다음 그룹런: the crew, the start time in dots, the place and how many joined (graphite).
function GroupWidget({ run }: { run: GroupRunSummary }) {
  const navigation = useNavigation();
  return (
    <Widget
      id="group"
      layers={[
        {
          kind: 'linear',
          angle: 160,
          stops: [
            [0, graphite.dots[0]],
            [0.55, graphite.dots[1]],
            [1, graphite.dots[2]],
          ],
        },
      ]}
      style={styles.group}
      accessibilityLabel={`다음 그룹런 ${run.title}`}
      onPress={() =>
        navigation.navigate('GroupRunDetail', { groupRunId: run.id })
      }
    >
      <AppText variant="bodyMedium">다음 그룹런</AppText>
      <AppText variant="label" tone="textSecondary">
        {`${run.crewName} · ${formatLongDate(run.scheduledAt)}`}
      </AppText>
      {/* The whole card opens the run, so it carries the same › as 지난 러닝. */}
      <CardArrow />
      <View style={styles.matrix}>
        <DotTime time={formatClockTime(run.scheduledAt)} />
      </View>
      <AppText variant="bodyMedium" style={styles.centerText}>
        {`${run.meetingPlaceName} 출발`}
      </AppText>
      <AppText variant="label" tone="textSecondary" style={styles.centerText}>
        {`참가 ${run.participantCount}명`}
      </AppText>
    </Widget>
  );
}

// ── Board ───────────────────────────────────────────────────────────────

// 2.1 홈 위젯 (대표화면시안/홈-다크-라이트.png): two columns of widgets on the K1 background.
export function HomeWidgets({ today }: { today: TodayCondition }) {
  const { width } = useWindowDimensions();
  const board = useResource(useCallback(loadBoard, []));
  const data = board.status === 'ready' ? board.data : null;
  const half = (width - spacing.screen * 2 - gap) / 2;
  const full = width - spacing.screen * 2;
  const cadence = data?.lastRun
    ? splitAverage([data.lastRun], split => split.averageCadence)
    : null;
  return (
    <View style={styles.board}>
      <ReadinessWidget today={today} />
      <RunStartWidget plan={data?.plan ?? null} />
      <View style={styles.pair}>
        <RestingHeartWidget today={today} width={half} />
        <CadenceWidget cadence={cadence} width={half} />
      </View>
      {data?.lastRun ? <SegmentWidget run={data.lastRun} width={full} /> : null}
      <View style={styles.pair}>
        <SleepWidget today={today} width={half} />
        <StreakWidget weeks={data?.streakWeeks ?? 0} width={half} />
      </View>
      {data ? (
        <LoadWidget
          load={fallbackFor(today) ? null : today.weeklyLoad}
          week={data.week}
          heartRate={data.weekHeartRate}
        />
      ) : null}
      {data?.upcoming ? <GroupWidget run={data.upcoming} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignSelf: 'center' },
  centerText: { textAlign: 'center' },
  board: { gap },
  pair: { flexDirection: 'row', gap },
  // DESIGN.md 2-1: corner 30, inside 18, pressed boxes shrink to 96%.
  widget: { borderRadius: 30, overflow: 'hidden', padding: 18 },
  pressed: { transform: [{ scale: 0.96 }] },
  tiny: { fontSize: 10.5, lineHeight: 14 },
  readiness: { gap: spacing.md },
  readinessTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardTitle: { fontFamily: fontFamily.medium, fontSize: 17, lineHeight: 24 },
  synced: { paddingTop: 4 },
  orb: {
    width: orbSize,
    height: orbSize,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 72,
    lineHeight: 76,
    letterSpacing: -2,
  },
  scoreUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 22,
    opacity: 0.75,
    letterSpacing: 0,
  },
  row3: { flexDirection: 'row', borderTopWidth: 1, paddingTop: spacing.xl },
  cell: { flex: 1, alignItems: 'center', gap: 2 },
  start: { height: 150 },
  startTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 22,
    lineHeight: 30,
    marginTop: spacing.xs,
  },
  play: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  startMeta: {
    position: 'absolute',
    right: 18,
    bottom: 16,
    fontFamily: fontFamily.numberRegular,
    fontSize: 26,
    lineHeight: 32,
  },
  tall: { height: 174 },
  big: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 40,
    lineHeight: 46,
    marginTop: spacing.sm,
    letterSpacing: -1.5,
  },
  bigUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 12,
    opacity: 0.7,
    letterSpacing: 0,
  },
  dotline: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 124,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tickDot: { width: 3, height: 3, borderRadius: 1.5, opacity: 0.8 },
  foot: { position: 'absolute', left: 18, bottom: 16 },
  ringBox: {
    position: 'absolute',
    bottom: 2,
    width: ringSize,
    height: ringSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cadence: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
  },
  segment: { height: 220 },
  eyebrow: { letterSpacing: 0.4 },
  segmentPace: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 42,
    lineHeight: 48,
    letterSpacing: -1,
  },
  arrow: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chart: { position: 'absolute', left: 0, bottom: 0 },
  axisLabel: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 10,
    lineHeight: 13,
  },
  // Centered under its point.
  axisTick: {
    position: 'absolute',
    bottom: 10,
    width: 40,
    marginLeft: -20,
    textAlign: 'center',
  },
  small: { height: 150 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  iconRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    left: 18,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  mid: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
  },
  midUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 13,
    letterSpacing: 0,
  },
  weekDots: { flexDirection: 'row', gap: 4, paddingBottom: 6 },
  weekDot: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 1 },
  load: { height: 186 },
  loadHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scale: { height: 44, marginTop: spacing.lg },
  scaleLabels: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ticks: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tick: { width: 2, height: 10, borderRadius: 1, opacity: 0.5 },
  tickEnd: { height: 26, opacity: 1 },
  scaleMark: {
    position: 'absolute',
    top: 6,
    width: 3,
    height: 26,
    borderRadius: 2,
    backgroundColor: k1.ice,
  },
  period: { marginTop: spacing.md },
  trio: { flexDirection: 'row', marginTop: spacing.xs },
  trioValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.5,
  },
  trioUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 10,
    letterSpacing: 0,
  },
  group: { height: 184 },
  matrix: { alignItems: 'center', marginVertical: spacing.lg },
});
