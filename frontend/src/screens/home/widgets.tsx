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
import { AppText, Icon } from '../../components';
import {
  useRepositories,
  useResource,
  type MonthlyRunSummary,
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
export const gutter = 8;
export const gap = 10;
export const cardHeight = 216;
export const conditionHeight = 162;

// ── Data ────────────────────────────────────────────────────────────────

type Board = {
  recent: RunRecordSummary[];
  lastRun: RunRecordDetail | null;
  week: RunStatistics;
};

const kstMs = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

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

// 오늘, 어제, 3일 전, then 10.15.
function dayLabel(startedAt: string, now: Date) {
  const days = Math.round(
    (Date.parse(kstDate(now.getTime())) -
      Date.parse(kstDate(Date.parse(startedAt)))) /
      dayMs,
  );
  if (days <= 0) {
    return '오늘';
  }
  if (days === 1) {
    return '어제';
  }
  return days < 7 ? `${days}일 전` : formatDotDate(startedAt);
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

// The title block at the top left, behind a thin line, in the card's own tone.
function CardLabel({
  title,
  sub,
  dark = false,
}: {
  title: string;
  sub: string;
  dark?: boolean;
}) {
  return (
    <View style={[styles.label, dark && styles.labelDark]}>
      <AppText style={[styles.labelTitle, dark && styles.labelTitleDark]}>
        {title}
      </AppText>
      <AppText style={[styles.labelSub, dark && styles.labelSubDark]}>
        {sub}
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

// The readiness disc: sky blue light in a white ring of four ticks, the score in dots.
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
                  offset={[0, 0.5, 0.82, 1][index]}
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
        <AppText style={styles.score}>{score ?? '--'}</AppText>
        <AppText style={styles.scoreLabel}>준비도</AppText>
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

// 오늘 컨디션 with 러닝 시작 on one black card. Without a usable score the button turns into what fixes it.
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
    <View style={[styles.condition, { width: width - gutter * 2 }]}>
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
    </View>
  );
}

// ── 지난 러닝 ──────────────────────────────────────────────────────────

const barWidth = 9;
const barGap = 5;
const barColumn = 52;
const barStep = 3;

// Each 1 km split as a bar: the sky blue top grows with the speed, the grey rest makes up the column.
function SplitBars({ paces }: { paces: number[] }) {
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const width = paces.length * barWidth + (paces.length - 1) * barGap;
  return (
    <Svg width={width} height={barColumn + barStep}>
      <Defs>
        <LinearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor={palette.accent} />
          <Stop offset={1} stopColor={palette.accentLight} />
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
  now,
  width,
  height,
}: {
  run: RunRecordDetail | null;
  now: Date;
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
      onPress={
        run
          ? () => navigation.navigate('RecordDetail', { recordId: run.id })
          : undefined
      }
      style={[
        styles.card,
        styles.shadowLight,
        { width, height, backgroundColor: palette.cardWhite },
      ]}
    >
      <CardLabel
        title="지난 러닝"
        sub={
          run
            ? `${dayLabel(run.startedAt, now)} · ${Math.round(
                run.durationSec / 60,
              )}분`
            : '아직 기록이 없어요'
        }
      />
      {paces.length > 1 ? (
        <View
          style={styles.bars}
          importantForAccessibility="no-hide-descendants"
        >
          <SplitBars paces={paces} />
        </View>
      ) : null}
      <View style={styles.baseline} />
      <AppText style={styles.lastValue}>
        {run ? formatKm(run.distanceM, 1) : '– –'}
        <AppText style={styles.lastUnit}> km</AppText>
      </AppText>
      <AppText style={styles.lastPace}>
        {run ? `${formatPace(run.averagePaceSecPerKm)} /km` : ''}
      </AppText>
    </CardFrame>
  );
}

// ── 러닝 분석 ──────────────────────────────────────────────────────────

// The mockup's scatter of grey dots: decoration, not data (left, top, diameter, color).
const scatter: [number, number, number, string][] = [
  [34, 84, 9, '#8A8A8A'],
  [48, 97, 12, '#A3A3A3'],
  [40, 112, 8, '#6F6F6F'],
  [58, 114, 10, '#9A9A9A'],
  [30, 127, 7, '#5E5E5E'],
  [52, 134, 9, '#7C7C7C'],
  [66, 93, 6, '#5A5A5A'],
  [44, 147, 6, '#505050'],
  [22, 103, 5, '#4A4A4A'],
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
      onPress={() => navigateTo(navigation, 'Analysis')}
      style={[
        styles.card,
        styles.shadowDark,
        { width, height, backgroundColor: palette.cardBlack },
      ]}
    >
      <CardLabel title="러닝 분석" sub="이번 주 강도" dark />
      <View
        style={StyleSheet.absoluteFill}
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
    </CardFrame>
  );
}

// ── 과거 러닝 기록 ─────────────────────────────────────────────────────

const greige: Layer[] = [
  {
    kind: 'linear',
    angle: 155,
    stops: palette.cardGreige.map(
      (color, index): GradientStop => [[0, 0.42, 0.72, 1][index], color],
    ),
  },
  {
    kind: 'radial',
    cx: 0,
    cy: 0.6,
    rx: 0.6,
    ry: 0.7,
    stops: [
      [0, palette.greigeShade, 0.35],
      [0.7, palette.greigeShade, 0],
      [1, palette.greigeShade, 0],
    ],
  },
];

const recordsPanel: Layer[] = [
  {
    kind: 'linear',
    angle: 180,
    stops: palette.recordsPanel.map(
      (color, index): GradientStop => [[0, 0.4, 0.82, 1][index], color],
    ),
  },
];

function PastRecordsCard({
  recent,
  summary,
  width,
  height,
}: {
  recent: RunRecordSummary[];
  summary: MonthlyRunSummary | null;
  width: number;
  height: number;
}) {
  const navigation = useNavigation();
  const month = summary ? `${Number(summary.month.split('-')[1])}월` : '';
  return (
    <CardFrame
      title="과거 러닝 기록"
      id="records"
      layers={greige}
      onPress={() => navigateTo(navigation, 'Records')}
      style={[styles.card, styles.shadowLight, { width, height }]}
    >
      <CardLabel
        title="과거 러닝 기록"
        sub={summary ? `${month} · ${summary.runCount}회` : ' '}
      />
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
        {summary ? (
          <AppText style={styles.panelTotal}>
            {`누적 ${Math.round(summary.totalDistanceM / 1000)}km · ${
              summary.runCount
            }회`}
          </AppText>
        ) : null}
      </Painted>
    </CardFrame>
  );
}

// ── 저장한 코스 ────────────────────────────────────────────────────────

const glowWidth = 112;
const glowHeight = 150;
const glowTop = 54;
const courseGlow: Layer[] = [
  {
    kind: 'radial',
    cx: 0.5,
    cy: 0.6,
    rx: 0.7,
    ry: 0.55,
    stops: palette.courseGlow.map(
      (color, index): GradientStop => [[0, 0.34, 0.7, 1][index], color],
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
      onPress={() => navigateTo(navigation, 'SavedCourses')}
      style={[
        styles.card,
        styles.shadowGraphite,
        { width, height, backgroundColor: palette.cardGraphite },
      ]}
    >
      <CardLabel
        title="저장한 코스"
        sub={courses ? `${courses.length}개 코스` : ' '}
        dark
      />
      {/* The oval sits in the middle of the room a taller card gains. */}
      <Painted
        id="courseGlow"
        layers={courseGlow}
        style={[
          styles.glow,
          {
            left: (width - glowWidth) / 2,
            top: glowTop + (height - cardHeight) / 2,
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
// the month summary and saved courses come from 2.1's own loads. height is each card's, 216 or taller.
export function HomeGrid({
  summary,
  courses,
  height = cardHeight,
}: {
  summary: MonthlyRunSummary | null;
  courses: SavedCourse[] | null;
  height?: number;
}) {
  const { width } = useWindowDimensions();
  const board = useResource(useCallback(loadBoard, []));
  useHomeRefresh(board.refresh);
  const data = board.status === 'ready' ? board.data : null;
  const half = (width - gutter * 2 - gap) / 2;
  // 오늘·어제 follow the app clock, so the mock data's day reads the same as on the server.
  const now = useRepositories().clock.now();
  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        <LastRunCard
          run={data?.lastRun ?? null}
          now={now}
          width={half}
          height={height}
        />
        <AnalysisCard week={data?.week ?? null} width={half} height={height} />
      </View>
      <View style={styles.row}>
        <PastRecordsCard
          recent={data?.recent ?? []}
          summary={summary}
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
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  // Card label: 13 bold over 10.5, behind a 1.5 line.
  label: {
    position: 'absolute',
    left: 16,
    top: 16,
    paddingLeft: 8,
    borderLeftWidth: 1.5,
    borderLeftColor: palette.ink,
  },
  labelDark: { borderLeftColor: 'rgba(255,255,255,0.9)' },
  labelTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: palette.ink,
  },
  labelTitleDark: { color: '#FFFFFF' },
  labelSub: {
    fontFamily: fontFamily.regular,
    fontSize: 10.5,
    lineHeight: 15,
    color: palette.muted,
  },
  labelSubDark: { color: 'rgba(255,255,255,0.5)' },
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
    backgroundColor: palette.cardBlack,
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
    gap: 4,
  },
  score: {
    fontFamily: fontFamily.score,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: 1,
    color: '#1A1A1A',
  },
  scoreLabel: {
    fontFamily: fontFamily.mono,
    fontSize: 9,
    lineHeight: 12,
    color: 'rgba(26,26,26,0.6)',
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
  conditionRows: { gap: 8 },
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
    backgroundColor: palette.accent,
  },
  ctaText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: palette.ink,
  },
  // 지난 러닝: the bars, baseline and figures keep to the bottom (216 card: bars from 60, line at 134).
  bars: { position: 'absolute', right: 14, bottom: 101 },
  baseline: {
    position: 'absolute',
    left: 16,
    right: 70,
    bottom: 81,
    height: 1,
    backgroundColor: palette.ink,
  },
  lastValue: {
    position: 'absolute',
    left: 16,
    bottom: 36,
    fontFamily: fontFamily.medium,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -1,
    color: palette.ink,
  },
  lastUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    letterSpacing: 0,
    color: palette.unit,
  },
  lastPace: {
    position: 'absolute',
    left: 16,
    bottom: 22,
    fontFamily: fontFamily.mono,
    fontSize: 10,
    lineHeight: 14,
    color: palette.muted,
  },
  // 러닝 분석: the scatter and legend keep to the top.
  scatterV: {
    position: 'absolute',
    left: 42,
    top: 60,
    width: 1,
    height: 130,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  scatterH: {
    position: 'absolute',
    left: 12,
    top: 121,
    width: 84,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  dot: { position: 'absolute' },
  legend: { position: 'absolute', left: 104, top: 66, gap: 16 },
  legendItem: {
    paddingLeft: 7,
    borderLeftWidth: 1.5,
    borderLeftColor: '#FFFFFF',
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
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 58,
    bottom: 12,
    padding: 12,
    borderRadius: 22,
    overflow: 'hidden',
  },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  panelText: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.92)',
  },
  panelTotal: {
    marginTop: 8,
    fontFamily: fontFamily.mono,
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.75)',
  },
  // 저장한 코스
  glow: {
    position: 'absolute',
    width: glowWidth,
    height: glowHeight,
    // A tall oval, as border-radius 50% in the mockup.
    borderRadius: '50%',
    overflow: 'hidden',
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
    color: palette.cardGraphite,
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
    backgroundColor: 'rgba(90,90,90,0.55)',
  },
  countText: {
    fontFamily: fontFamily.regular,
    fontSize: 10.5,
    lineHeight: 14,
    color: '#FFFFFF',
  },
});
