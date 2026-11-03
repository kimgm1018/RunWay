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
  LinearGradient,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { AppText, Icon, mistColors } from '../../components';
import {
  useResource,
  type ReadinessState,
  type Repositories,
  type RunRecordDetail,
  type RunRecordSummary,
  type RunStatistics,
  type SavedCourse,
  type TodayCondition,
} from '../../data';
import {
  formatDotDate,
  formatKm,
  formatMonthDay,
  formatPace,
  formatSleep,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { fontFamily, homePalette as palette } from '../../theme';
import { RetryNotice, useHomeRefresh } from './parts';

// 2.1 홈 (S15P31E105-367 핸드오프, 390×844 한 화면): the condition card, then two columns of cards,
// 10 apart, 8 from the edges. A taller phone stretches the cards; their parts keep to the top or the bottom.
// S15P31E105-391 repainted the cards in the 2.0M colours: light and dark cards cross in the grid. The
// mockup's grain is left out (S15P31E105-385 담당자 결정).
export const gutter = 8;
export const gap = 10;
export const cardHeight = 216;
export const conditionHeight = 162;
// The title row of the small cards: 14 down and as tall as the ↗ circle (26).
const headTop = 14 + 26;

// ── Data ────────────────────────────────────────────────────────────────

type Board = {
  recent: RunRecordSummary[];
  lastRun: RunRecordDetail | null;
  week: RunStatistics;
};

const kstMs = 9 * 60 * 60 * 1000;

// Dates are counted in KST like the rest of the app.
const kstDate = (time: number) =>
  new Date(time + kstMs).toISOString().slice(0, 10);

const loadBoard = async (repositories: Repositories): Promise<Board> => {
  const now = repositories.clock.now();
  const [recent, week] = await Promise.all([
    repositories.records.getRecent('recent', 5),
    repositories.records.getStatistics('WEEK', kstDate(now.getTime())),
  ]);
  const lastRun = recent[0]
    ? await repositories.records.getDetail(recent[0].id)
    : null;
  return { recent, lastRun, week };
};

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

// One CSS linear-gradient as a layer: its angle, colours and where each colour sits.
const linear = (
  angle: number,
  colors: readonly string[],
  stops: readonly number[],
): Layer => ({
  kind: 'linear',
  angle,
  stops: colors.map((color, index): GradientStop => [stops[index], color]),
});

// The 2.0M mist, white at the top to black at the foot (지난 러닝), and turned over (저장한 코스).
const freeRun = linear(
  180,
  mistColors,
  mistColors.map((_, index) => index / 20),
);
const courseRun = linear(
  180,
  [...mistColors].reverse(),
  mistColors.map((_, index) => index / 20),
);

// The CSS angle (0 = up, clockwise) as the two ends of an objectBoundingBox line.
function ends(angle: number) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = -Math.cos(radians) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

// A card's background, built from the mockup's CSS gradients stacked bottom to top.
// It takes the measured size: an Svg sized in percent falls back to 300×150 on Android.
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

// A box that paints its gradient layers once it knows its size.
function Painted({
  id,
  layers,
  style,
  children,
}: {
  id: string;
  layers: Layer[];
  style: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setSize(event.nativeEvent.layout);
  return (
    <View style={style} onLayout={measure}>
      {size ? <Paint id={id} layers={layers} {...size} /> : null}
      {children}
    </View>
  );
}

// ── Card parts ──────────────────────────────────────────────────────────

// The title at the top left in the card's own tone, level with the ↗ circle and as
// far in from the corner (14). The second line was dropped (담당자 결정).
function CardLabel({ title, dark = false }: { title: string; dark?: boolean }) {
  return (
    <View style={styles.label}>
      <AppText style={[styles.labelTitle, dark && styles.labelTitleDark]}>
        {title}
      </AppText>
    </View>
  );
}

// A whole card that opens its screen, marked by the small ↗ circle at the top right.
// The mockup has no 보기 button on purpose: the card itself is the target, named by its title.
function CardFrame({
  title,
  dark = false,
  onPress,
  style,
  layers,
  id,
  children,
}: {
  title: string;
  dark?: boolean;
  onPress?: () => void;
  style: StyleProp<ViewStyle>;
  layers?: Layer[];
  id?: string;
  children: React.ReactNode;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setSize(event.nativeEvent.layout);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      onLayout={layers ? measure : undefined}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {layers && id && size ? (
        <Paint id={id} layers={layers} {...size} />
      ) : null}
      {children}
      {onPress ? (
        <View
          style={[styles.hint, dark && styles.hintDark]}
          importantForAccessibility="no-hide-descendants"
        >
          <Icon
            name="arrowUpRight"
            color={dark ? '#FFFFFF' : palette.ink}
            size={12}
            strokeWidth={2.4}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

// ── 오늘 컨디션 · 러닝 시작 ────────────────────────────────────────────────

type ConditionAction = { title: string; route: RouteName };

// What each readiness state says and where its button leads (핸드오프 ConditionCard 표).
const conditionStates: Record<
  ReadinessState,
  { action: ConditionAction; note: string | null }
> = {
  ready: { action: { title: '러닝 시작', route: 'RunMode' }, note: null },
  collecting: {
    action: { title: '워치 동기화', route: 'WatchConnect' },
    note: '데이터를 모으는 중이에요',
  },
  stale: {
    action: { title: '워치 동기화', route: 'WatchConnect' },
    note: '데이터가 오래됐어요',
  },
  permissionDenied: {
    action: { title: '설정 열기', route: 'Settings' },
    note: '건강 데이터 권한이 없어요',
  },
  watchDisconnected: {
    action: { title: '워치 연결', route: 'WatchConnect' },
    note: '연결된 워치가 없어요',
  },
};

const discSize = 106;

// The readiness disc: white mist in a white ring of four ticks, the score in dots at its centre.
function ReadinessDisc({ score }: { score: number | null }) {
  return (
    <View style={styles.discBox}>
      {[
        styles.tickTop,
        styles.tickBottom,
        styles.tickLeft,
        styles.tickRight,
      ].map((tick, index) => (
        <View key={index} style={[styles.tick, tick]} />
      ))}
      <View style={styles.disc}>
        <Svg width={discSize} height={discSize} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="disc" cx="50%" cy="50%" r="50%">
              {palette.conditionDisc.map((color, index) => (
                <Stop
                  key={color}
                  offset={palette.conditionDiscStops[index]}
                  stopColor={color}
                />
              ))}
            </RadialGradient>
          </Defs>
          <Circle
            cx={discSize / 2}
            cy={discSize / 2}
            r={discSize / 2}
            fill="url(#disc)"
          />
        </Svg>
        {/* The score alone in the middle (담당자 결정: 준비도 글자 없음); readers hear what it is. */}
        <AppText
          style={styles.score}
          accessibilityLabel={`준비도 ${score ?? '없음'}`}
        >
          {score ?? '--'}
        </AppText>
      </View>
    </View>
  );
}

function ConditionRow({
  icon,
  value,
}: {
  icon: 'moon' | 'heart';
  value: string;
}) {
  return (
    <View style={styles.conditionRow}>
      <View style={styles.conditionIcon}>
        <Icon
          name={icon}
          color="rgba(255,255,255,0.85)"
          size={15}
          strokeWidth={2}
        />
      </View>
      <AppText style={styles.conditionValue}>{value}</AppText>
    </View>
  );
}

const conditionLayers = [
  linear(115, palette.cardCondition, palette.cardConditionStops),
];

// 오늘 컨디션 with 러닝 시작 on one black-to-steel card. Without a usable score the button turns into what fixes it.
// R02 has no grade yet, so the title names one only when the data has it (mock data).
export function ConditionCard({ today }: { today: TodayCondition }) {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const ready = today.readinessState === 'ready';
  const { action, note: stateNote } = conditionStates[today.readinessState];
  // 2.P′ 오래된 데이터 says when the last score was made, when it is known.
  const note =
    today.readinessState === 'stale' && today.lastAssessedDate
      ? `마지막 평가 ${formatMonthDay(today.lastAssessedDate)}`
      : stateNote;
  const grade = today.readinessSummary?.split(' · ')[0];
  const sleep =
    ready && today.sleepMinutes !== null
      ? formatSleep(today.sleepMinutes)
      : '– –';
  const heart =
    ready && today.restingHeartRate !== null
      ? `${today.restingHeartRate} bpm`
      : '– –';
  return (
    <Painted
      id="condition"
      layers={conditionLayers}
      style={[styles.condition, { width: width - gutter * 2 }]}
    >
      <ReadinessDisc score={ready ? today.readinessScore : null} />
      <View style={styles.conditionSide}>
        <View>
          <AppText style={styles.conditionTitle}>
            {ready && grade ? `오늘 준비도 ${grade}` : '오늘 준비도'}
          </AppText>
          {note ? <AppText style={styles.conditionNote}>{note}</AppText> : null}
        </View>
        <View style={styles.conditionRows}>
          <ConditionRow icon="moon" value={sleep} />
          <ConditionRow icon="heart" value={heart} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.title}
          onPress={() => navigateTo(navigation, action.route)}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <View style={styles.ctaDot}>
            <Icon name="play" color="#FFFFFF" size={10} />
          </View>
          <AppText style={styles.ctaText}>{action.title}</AppText>
        </Pressable>
      </View>
    </Painted>
  );
}

// ── 지난 러닝 ──────────────────────────────────────────────────────────

const barWidth = 9;
const barGap = 5;
const barColumn = 52;
const barStep = 3;

// Each 1 km split as a bar: the deep teal top grows with the speed, the white rest makes up the column.
function SplitBars({ paces }: { paces: number[] }) {
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const width = paces.length * barWidth + (paces.length - 1) * barGap;
  return (
    <Svg width={width} height={barColumn + barStep}>
      <Defs>
        <LinearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor={palette.barAccent[0]} />
          <Stop offset={1} stopColor={palette.barAccent[1]} />
        </LinearGradient>
      </Defs>
      {paces.map((pace, index) => {
        const speed =
          slowest === fastest ? 0.5 : (slowest - pace) / (slowest - fastest);
        const top = Math.round(14 + speed * 26);
        const x = index * (barWidth + barGap);
        return (
          <React.Fragment key={index}>
            <Rect
              x={x}
              y={0}
              width={barWidth}
              height={top}
              rx={barWidth / 2}
              fill="url(#bar)"
            />
            <Rect
              x={x}
              y={top + barStep}
              width={barWidth}
              height={barColumn - top}
              rx={barWidth / 2}
              fill={palette.barRest}
            />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

function LastRunCard({
  run,
  width,
  height,
}: {
  run: RunRecordDetail | null;
  width: number;
  height: number;
}) {
  const navigation = useNavigation();
  const paces = (run?.splits ?? [])
    .map(split => split.paceSecPerKm)
    .filter((pace): pace is number => pace !== null)
    .slice(0, 7);
  return (
    <CardFrame
      title="지난 러닝"
      id="lastRun"
      layers={[freeRun]}
      onPress={
        run
          ? () => navigation.navigate('RecordDetail', { recordId: run.id })
          : undefined
      }
      style={[styles.card, styles.shadowMist, { width, height }]}
    >
      <CardLabel title="지난 러닝" />
      {/* The bars sit in the middle of the room between the title and the pace. */}
      {paces.length > 1 ? (
        <View
          style={styles.bars}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        >
          <SplitBars paces={paces} />
        </View>
      ) : null}
      {/* The pace leads, the distance under it in a faint white (담당자 결정). */}
      <AppText style={styles.lastValue}>
        {run ? formatPace(run.averagePaceSecPerKm) : '– –'}
        <AppText style={styles.lastUnit}> /km</AppText>
      </AppText>
      <AppText style={styles.lastPace}>
        {run ? `${formatKm(run.distanceM, 1)} km` : '아직 기록이 없어요'}
      </AppText>
    </CardFrame>
  );
}

// ── 러닝 분석 ──────────────────────────────────────────────────────────

// The mockup's scatter of mist blue dots: decoration, not data (left, top, diameter, color), in the
// 84×130 box of the two axes.
const [mist100, mist300, mist400, mist500, steel500, steel600, teal700] =
  palette.scatter;
const scatter: [number, number, number, string][] = [
  [22, 24, 9, mist300],
  [36, 37, 12, mist100],
  [28, 52, 8, mist500],
  [46, 54, 10, mist400],
  [18, 67, 7, steel500],
  [40, 74, 9, mist400],
  [54, 32, 6, steel600],
  [32, 87, 6, steel600],
  [10, 43, 5, teal700],
];
const analysisLayers = [
  linear(180, palette.cardAnalysis, palette.cardAnalysisStops),
];

// This week's heart rate zones grouped as 이지 (1–2), 템포 (3) and 인터벌 (4–5); the server has no intensity mix.
function intensityOf(zones: number[]) {
  if (zones.length < 5) {
    return null;
  }
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return [
    { name: '이지', value: percent(zones[0] + zones[1]) },
    { name: '템포', value: percent(zones[2]) },
    { name: '인터벌', value: percent(zones[3] + zones[4]) },
  ];
}

function AnalysisCard({
  week,
  width,
  height,
}: {
  week: RunStatistics | null;
  width: number;
  height: number;
}) {
  const navigation = useNavigation();
  const mix = week ? intensityOf(week.heartRateZones) : null;
  return (
    <CardFrame
      title="러닝 분석"
      dark
      id="analysis"
      layers={analysisLayers}
      onPress={() => navigateTo(navigation, 'Analysis')}
      style={[styles.card, styles.shadowDark, { width, height }]}
    >
      <CardLabel title="러닝 분석" dark />
      {/* The scatter and the legend as one group in the middle of the room under the label, the same
          space left and right and above and below (담당자 결정). */}
      <View style={styles.analysisBody} pointerEvents="box-none">
        <View
          style={styles.scatterBox}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        >
          <View style={styles.scatterV} />
          <View style={styles.scatterH} />
          {scatter.map(([left, top, size, color]) => (
            <View
              key={`${left}-${top}`}
              style={[
                styles.dot,
                {
                  left,
                  top,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: color,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.legend}>
          {(
            mix ?? [
              { name: '이지', value: '– –' },
              { name: '템포', value: '– –' },
              { name: '인터벌', value: '– –' },
            ]
          ).map(item => (
            <View key={item.name} style={styles.legendItem}>
              <AppText style={styles.legendName}>{item.name}</AppText>
              <AppText style={styles.legendValue}>{item.value}</AppText>
            </View>
          ))}
        </View>
      </View>
    </CardFrame>
  );
}

// ── 과거 러닝 기록 ─────────────────────────────────────────────────────

const pastRecordsLayers = [
  linear(180, palette.cardPastRecords, palette.cardPastRecordsStops),
];

const recordsPanel = [
  linear(180, palette.recordsPanel, palette.recordsPanelStops),
];

function PastRecordsCard({
  recent,
  width,
  height,
}: {
  recent: RunRecordSummary[];
  width: number;
  height: number;
}) {
  const navigation = useNavigation();
  return (
    <CardFrame
      title="과거 러닝 기록"
      id="records"
      layers={pastRecordsLayers}
      onPress={() => navigateTo(navigation, 'Records')}
      style={[styles.card, styles.shadowLight, { width, height }]}
    >
      <CardLabel title="과거 러닝 기록" />
      {/* The panel grows with the card. */}
      <Painted id="recordsPanel" layers={recordsPanel} style={styles.panel}>
        {recent.length ? (
          recent.map(run => (
            <View key={run.id} style={styles.panelRow}>
              <AppText style={styles.panelText}>
                {formatDotDate(run.startedAt)}
              </AppText>
              <AppText style={styles.panelText}>
                {`${formatKm(run.distanceM, 1)}km`}
              </AppText>
            </View>
          ))
        ) : (
          <AppText style={styles.panelText}>아직 기록이 없어요</AppText>
        )}
      </Painted>
    </CardFrame>
  );
}

// ── 저장한 코스 ────────────────────────────────────────────────────────

const glowWidth = 112;
const glowHeight = 150;
const courseGlow: Layer[] = [
  {
    kind: 'radial',
    cx: 0.5,
    cy: 0.6,
    rx: 0.7,
    ry: 0.55,
    stops: palette.courseEllipse.map(
      (color, index): GradientStop => [
        palette.courseEllipseStops[index],
        color,
      ],
    ),
  },
];

const lineWidth = 112;
const lineHeight = 56;

// The first course's route in the white line where the mockup drew an elevation curve; there is no elevation data.
function CourseLine({ shape }: { shape: [number, number][] }) {
  const xs = shape.map(([x]) => x);
  const ys = shape.map(([, y]) => y);
  const spanX = Math.max(...xs) - Math.min(...xs) || 1;
  const spanY = Math.max(...ys) - Math.min(...ys) || 1;
  const scale = Math.min((lineWidth - 28) / spanX, (lineHeight - 8) / spanY);
  const offsetX = (lineWidth - spanX * scale) / 2 - Math.min(...xs) * scale;
  const offsetY = (lineHeight - spanY * scale) / 2 - Math.min(...ys) * scale;
  const points = shape
    .map(
      ([x, y]) =>
        `${(offsetX + x * scale).toFixed(1)},${(offsetY + y * scale).toFixed(
          1,
        )}`,
    )
    .join(' ');
  return (
    <Svg width={lineWidth} height={lineHeight} style={styles.courseLine}>
      <Polyline
        points={points}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SavedCoursesCard({
  courses,
  width,
  height,
}: {
  courses: SavedCourse[] | null;
  width: number;
  height: number;
}) {
  const navigation = useNavigation();
  const first = courses?.[0];
  return (
    <CardFrame
      title="저장한 코스"
      dark
      id="savedCourses"
      layers={[courseRun]}
      onPress={() => navigateTo(navigation, 'SavedCourses')}
      style={[styles.card, styles.shadowGraphite, { width, height }]}
    >
      <CardLabel title="저장한 코스" dark />
      {/* The oval sits in the middle of the room under the title. */}
      <Painted
        id="courseGlow"
        layers={courseGlow}
        style={[
          styles.glow,
          {
            left: (width - glowWidth) / 2,
            top: headTop + (height - headTop - glowHeight) / 2,
          },
        ]}
      >
        {first ? (
          <>
            <View style={styles.distanceTag}>
              <AppText style={styles.distanceText}>
                {`${formatKm(first.distanceM, 1)}km`}
              </AppText>
            </View>
            <CourseLine shape={first.shape} />
          </>
        ) : null}
        <View style={styles.countRow}>
          <View style={styles.countBadge}>
            <AppText style={styles.countText}>
              {courses ? `${courses.length}개` : '– –'}
            </AppText>
          </View>
        </View>
      </Painted>
    </CardFrame>
  );
}

// ── Grid ────────────────────────────────────────────────────────────────

// The four cards under 오늘 컨디션. 러닝 분석·지난 러닝·과거 기록 share one load (H01·H02·H06);
// saved courses come from 2.1's own load. height is each card's, 216 or taller.
export function HomeGrid({
  courses,
  height = cardHeight,
}: {
  courses: SavedCourse[] | null;
  height?: number;
}) {
  const { width } = useWindowDimensions();
  const board = useResource(useCallback(loadBoard, []));
  useHomeRefresh(board.refresh);
  const data = board.status === 'ready' ? board.data : null;
  const half = (width - gutter * 2 - gap) / 2;
  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        <LastRunCard run={data?.lastRun ?? null} width={half} height={height} />
        <AnalysisCard week={data?.week ?? null} width={half} height={height} />
      </View>
      <View style={styles.row}>
        <PastRecordsCard
          recent={data?.recent ?? []}
          width={half}
          height={height}
        />
        <SavedCoursesCard courses={courses} width={half} height={height} />
      </View>
      {board.status === 'error' ? (
        <RetryNotice
          message="러닝 기록을 불러오지 못했어요"
          onRetry={board.reload}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap },
  row: { flexDirection: 'row', gap },
  card: { borderRadius: 26, overflow: 'hidden' },
  shadowLight: { boxShadow: palette.shadowLight },
  shadowDark: { boxShadow: palette.shadowDark },
  shadowGraphite: { boxShadow: palette.shadowGraphite },
  shadowMist: { boxShadow: palette.shadowMist },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  // Card label: 16 bold, 14 from the corner like the ↗ circle and as tall as it; no line beside it
  // (담당자 결정), so it lines up with the 지난 러닝 figures under it.
  label: {
    position: 'absolute',
    left: 14,
    top: 14,
    height: 26,
    justifyContent: 'center',
  },
  labelTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: palette.ink,
  },
  labelTitleDark: { color: '#FFFFFF' },
  // The ↗ circle of a card that opens a screen.
  hint: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.tapHintOnLight,
  },
  hintDark: { backgroundColor: palette.tapHintOnDark },
  // 오늘 컨디션
  condition: {
    height: conditionHeight,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 28,
    flexDirection: 'row',
    gap: 14,
    overflow: 'hidden',
    boxShadow: palette.shadowDark,
  },
  discBox: { width: 134, height: 134 },
  tick: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 1,
  },
  tickTop: { left: 66, top: 0, width: 1.5, height: 9 },
  tickBottom: { left: 66, bottom: 0, width: 1.5, height: 9 },
  tickLeft: { top: 66, left: 0, height: 1.5, width: 9 },
  tickRight: { top: 66, right: 0, height: 1.5, width: 9 },
  disc: {
    position: 'absolute',
    left: 14,
    top: 14,
    width: discSize,
    height: discSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontFamily: fontFamily.score,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: 1,
    color: '#1A1A1A',
    // Doto leaves more room after a digit than before it; this centres the dots themselves.
    transform: [{ translateX: 2 }],
  },
  conditionSide: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
    justifyContent: 'space-between',
  },
  conditionTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.5,
    color: '#FFFFFF',
  },
  conditionNote: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.5)',
  },
  // 수면 and 안정 심박 side by side (담당자 결정).
  conditionRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  conditionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  conditionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  conditionValue: {
    fontFamily: fontFamily.mono,
    fontSize: 13,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.85)',
  },
  cta: {
    alignSelf: 'flex-end',
    height: 36,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
  },
  ctaDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 1,
    backgroundColor: palette.button,
  },
  ctaText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: palette.ink,
  },
  // 지난 러닝: the pace and distance keep to the bottom left, 14 in; the bars sit centred in the room
  // between the title and the pace.
  bars: {
    position: 'absolute',
    top: headTop,
    right: 14,
    bottom: 14 + 15 + 2 + 38,
    justifyContent: 'center',
  },
  // The figures sit on the black foot of the mist, so they are white.
  lastValue: {
    position: 'absolute',
    left: 14,
    bottom: 14 + 15 + 2,
    fontFamily: fontFamily.medium,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -1,
    color: '#FFFFFF',
  },
  lastUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    letterSpacing: 0,
    color: 'rgba(255,255,255,0.7)',
  },
  lastPace: {
    position: 'absolute',
    left: 14,
    bottom: 14,
    fontFamily: fontFamily.mono,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.55)',
  },
  // 러닝 분석: the scatter and legend keep to the top.
  // Everything under the title row, the group centred in it.
  analysisBody: {
    position: 'absolute',
    top: headTop,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  scatterBox: { width: 84, height: 130 },
  scatterV: {
    position: 'absolute',
    left: 30,
    top: 0,
    width: 1,
    height: 130,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  scatterH: {
    position: 'absolute',
    left: 0,
    top: 61,
    width: 84,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  dot: { position: 'absolute' },
  legend: { gap: 16 },
  legendItem: {
    paddingLeft: 7,
    borderLeftWidth: 1.5,
    borderLeftColor: 'rgba(255,255,255,0.85)',
  },
  legendName: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    lineHeight: 15,
    color: '#FFFFFF',
  },
  legendValue: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  // 과거 러닝 기록
  // 12 from the sides and the foot, and 12 under the title row.
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: headTop + 12,
    bottom: 12,
    padding: 12,
    borderRadius: 22,
    overflow: 'hidden',
  },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  // 13 over 24 (담당자 결정; the mockup's 10 was hard to read on the phone).
  panelText: {
    fontFamily: fontFamily.mono,
    fontSize: 13,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.92)',
  },
  // 저장한 코스
  glow: {
    position: 'absolute',
    width: glowWidth,
    height: glowHeight,
    // A tall oval, as border-radius 50% in the mockup, with a faint white rim.
    borderRadius: '50%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  distanceTag: {
    position: 'absolute',
    right: 16,
    top: 26,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  distanceText: {
    fontFamily: fontFamily.mono,
    fontSize: 9.5,
    lineHeight: 12,
    color: palette.courseTag,
  },
  courseLine: { position: 'absolute', left: 0, top: 50 },
  countRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: 'center',
  },
  countBadge: {
    height: 20,
    paddingHorizontal: 10,
    borderRadius: 11,
    justifyContent: 'center',
    backgroundColor: 'rgba(6,6,6,0.45)',
  },
  countText: {
    fontFamily: fontFamily.regular,
    fontSize: 10.5,
    lineHeight: 14,
    color: '#FFFFFF',
  },
});
