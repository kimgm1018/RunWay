import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { AppText, Icon, Segmented, useToast } from '../../components';
import {
  useRepositories,
  useResource,
  type MonthlyRunSummary,
  type RecordSort,
  type Repositories,
  type RunRecordSummary,
  type SavedCourse,
} from '../../data';
import {
  formatDotDate,
  formatDuration,
  formatKm,
  formatMonth,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, useTheme, widgetPalette } from '../../theme';
import { RetryNotice, useHomeRefresh } from './parts';
import { spot, vignette, Widget, type Layer } from './widgets';

// The three sections under the 2.1 홈 widgets (S15P31E105-262): 러닝 분석, 과거 러닝 기록, 저장한 코스.
// They keep the prototype's items and moves and take the widget palette (DESIGN.md 2-14).

const { steel, graphite } = widgetPalette;

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

const sorts: { value: RecordSort; label: string }[] = [
  { value: 'recent', label: '최신순' },
  { value: 'distance', label: '거리순' },
  { value: 'pace', label: '페이스순' },
];

type Shape = [number, number][];

// The shape scaled to fit width × height without stretching, centered.
function fitShape(shape: Shape, width: number, height: number) {
  const xs = shape.map(([x]) => x);
  const ys = shape.map(([, y]) => y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const spanX = Math.max(...xs) - left || 1;
  const spanY = Math.max(...ys) - top || 1;
  const scale = Math.min(width / spanX, height / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return shape.map(([x, y]) => ({
    x: offsetX + (x - left) * scale,
    y: offsetY + (y - top) * scale,
  }));
}

// A route line with a dot where it starts and a ring where an open route ends.
function RouteLine({
  shape,
  width,
  height,
  color,
}: {
  shape: Shape;
  width: number;
  height: number;
  color: string;
}) {
  if (shape.length < 2) {
    return null;
  }
  const points = fitShape(shape, width, height);
  const start = points[0];
  const end = points[points.length - 1];
  const open = Math.hypot(start.x - end.x, start.y - end.y) > 1;
  return (
    <Svg width={width} height={height} style={styles.visible}>
      <Polyline
        points={points.map(point => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={start.x} cy={start.y} r={3} fill={color} />
      {open ? (
        <Circle
          cx={end.x}
          cy={end.y}
          r={3.2}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
        />
      ) : null}
    </Svg>
  );
}

// Full-width glass pill with › at the foot of a section (DESIGN.md 4 유리 버튼); ↗ is kept for leaving the app.
function SectionLink({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.link,
        {
          backgroundColor: pressed ? colors.borderStrong : colors.surfaceMuted,
          borderColor: colors.border,
        },
      ]}
    >
      <AppText variant="buttonSmall">{title}</AppText>
      <Icon name="forward" color={colors.text} size={14} />
    </Pressable>
  );
}

// ── 러닝 분석 ───────────────────────────────────────────────────────────

// This month's runs, distance and pace, the weekday bars and the change from last month (steel vignette).
export function AnalysisCard({ summary }: { summary: MonthlyRunSummary }) {
  return (
    <Widget id="analysis" layers={vignette(steel, 0.78, 0.72, 0.46)}>
      <AnalysisBody summary={summary} />
    </Widget>
  );
}

function AnalysisBody({ summary }: { summary: MonthlyRunSummary }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const peak = Math.max(...summary.weekdayRatios);
  const change = summary.paceImprovementSec;
  const stats = [
    { value: String(summary.runCount), unit: '회', label: '러닝' },
    {
      value: formatKm(summary.totalDistanceM, 1),
      unit: 'km',
      label: '누적 거리',
    },
    {
      value:
        summary.averagePaceSecPerKm === null
          ? '– –'
          : formatPace(summary.averagePaceSecPerKm),
      unit: summary.averagePaceSecPerKm === null ? '' : '/km',
      label: '평균 페이스',
    },
  ];
  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <AppText variant="bodyMedium">러닝 분석</AppText>
        <AppText variant="label" tone="textSecondary">
          {formatMonth(summary.month)}
        </AppText>
      </View>
      <View style={styles.trio}>
        {stats.map((stat, index) => (
          <View
            key={stat.label}
            style={[
              styles.stat,
              index > 0 && [styles.divided, { borderLeftColor: colors.border }],
            ]}
          >
            <AppText style={styles.statValue} numberOfLines={1}>
              {stat.value}
              <AppText style={styles.unit} tone="textSecondary">
                {stat.unit}
              </AppText>
            </AppText>
            <AppText style={styles.tiny} tone="textTertiary">
              {stat.label}
            </AppText>
          </View>
        ))}
      </View>
      <AppText style={styles.tiny} tone="textSecondary">
        {`${formatMonth(summary.month)} 요일별 누적 거리 · 가장 많은 요일 기준`}
      </AppText>
      <View
        style={styles.bars}
        accessibilityLabel={`${formatMonth(summary.month)} 요일별 누적 거리`}
      >
        <View style={styles.baseline}>
          {Array.from({ length: 40 }, (_, index) => (
            <View
              key={index}
              style={[styles.dash, { backgroundColor: steel.tick }]}
            />
          ))}
        </View>
        {summary.weekdayRatios.map((ratio, index) => {
          const top = ratio === peak;
          return (
            <View key={weekdays[index]} style={styles.barColumn}>
              <View style={styles.barTrack}>
                {ratio > 0.05 ? (
                  <View
                    style={[
                      styles.bar,
                      top && styles.barPeak,
                      {
                        height: ratio * 64,
                        backgroundColor: top ? colors.text : colors.accentSoft,
                      },
                    ]}
                  />
                ) : (
                  <View
                    style={[styles.restDay, { backgroundColor: steel.tick }]}
                  />
                )}
              </View>
              <AppText
                style={[styles.weekday, top && styles.weekdayPeak]}
                tone={top ? 'text' : 'textSecondary'}
              >
                {weekdays[index]}
              </AppText>
            </View>
          );
        })}
      </View>
      {change ? (
        <View style={[styles.compare, { borderTopColor: colors.border }]}>
          <View style={[styles.changeChip, { backgroundColor: colors.accent }]}>
            {/* A pace is time per km, so the chip names the change instead of an arrow. */}
            <AppText style={styles.changeText} tone="onAccent">
              {`${Math.abs(change)}초 ${change > 0 ? '단축' : '증가'}`}
            </AppText>
          </View>
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            지난달 대비 평균 페이스{' '}
            <AppText variant="captionStrong">
              {change > 0
                ? `${change}초 빨라졌어요`
                : `${-change}초 느려졌어요`}
            </AppText>
          </AppText>
        </View>
      ) : null}
      <SectionLink
        title="분석 자세히 보기"
        onPress={() => navigateTo(navigation, 'Analysis')}
      />
    </View>
  );
}

// ── 과거 러닝 기록 ──────────────────────────────────────────────────────

const recordScene: Layer[] = [
  {
    kind: 'linear',
    angle: 180,
    stops: [
      [0, graphite.sky[0]],
      [0.55, graphite.glass[0]],
      [1, graphite.glass[1]],
    ],
  },
  spot(0.3, 0.3, 0.55, 0.4, graphite.haze[0], 0.45),
  spot(0.8, 0.65, 0.6, 0.45, graphite.haze[1], 0.35),
];

// The sort switch at the top right and four runs as tiles that scroll sideways (graphite blurred scene).
// The tiles all look alike; the newest run carries a 최근 badge whatever the sort.
export function RecordsCard() {
  return (
    <Widget id="records" layers={recordScene}>
      <RecordsBody />
    </Widget>
  );
}

function RecordsBody() {
  const navigation = useNavigation();
  const [sort, setSort] = useState<RecordSort>('recent');
  const records = useResource(
    useCallback(
      (repositories: Repositories) => repositories.records.getRecent(sort, 4),
      [sort],
    ),
  );
  const newest = useResource(
    useCallback(
      (repositories: Repositories) =>
        repositories.records.getRecent('recent', 1),
      [],
    ),
  );
  useHomeRefresh(records.refresh);
  useHomeRefresh(newest.refresh);
  const newestId = newest.status === 'ready' ? newest.data[0]?.id : undefined;
  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <AppText variant="bodyMedium">과거 러닝 기록</AppText>
        <Segmented compact options={sorts} value={sort} onChange={setSort} />
      </View>
      {records.status === 'error' ? (
        // A failed load says so and can be tried again instead of spinning on.
        <RetryNotice
          message="기록을 불러오지 못했어요"
          onRetry={() => {
            records.reload();
            // The 최근 badge comes from its own load, which failed with the list.
            newest.reload();
          }}
        />
      ) : records.status === 'ready' && records.data.length === 0 ? (
        <View style={styles.railNotice}>
          <AppText variant="caption" tone="textSecondary">
            아직 러닝 기록이 없어요. 첫 러닝을 시작해 보세요
          </AppText>
        </View>
      ) : records.status === 'ready' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.rail}
          contentContainerStyle={styles.railContent}
        >
          {records.data.map(record => (
            <RecordTile
              key={record.id}
              record={record}
              newest={record.id === newestId}
              onPress={() =>
                navigation.navigate('RecordDetail', { recordId: record.id })
              }
            />
          ))}
        </ScrollView>
      ) : (
        <ActivityIndicator />
      )}
      <SectionLink
        title="전체 기록 보기"
        onPress={() => navigateTo(navigation, 'Records')}
      />
    </View>
  );
}

// A glass tile per run; the title may take two lines so the numbers under it line up across tiles.
function RecordTile({
  record,
  newest,
  onPress,
}: {
  record: RunRecordSummary;
  newest: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const date = formatDotDate(record.startedAt);
  const km = formatKm(record.distanceM);
  const duration = formatDuration(record.durationSec);
  const pace = formatPace(record.averagePaceSecPerKm);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${record.title}, ${date} · ${km}km · ${duration}, ${pace}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.tileTop}>
        <AppText style={styles.tileDate} tone="textSecondary">
          {date}
        </AppText>
        {newest ? (
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <AppText style={styles.badgeText} tone="onAccent">
              최근
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={styles.tileRoute}>
        <RouteLine
          shape={record.shape}
          width={112}
          height={52}
          color={colors.text}
        />
      </View>
      <AppText variant="bodyMedium" numberOfLines={2} style={styles.tileName}>
        {record.title}
      </AppText>
      <AppText style={styles.tileDistance}>
        {km}
        <AppText style={styles.unit} tone="textSecondary">
          {' km'}
        </AppText>
      </AppText>
      <AppText style={styles.tileMeta} tone="textSecondary">
        {`${duration} · ${pace}/km`}
      </AppText>
    </Pressable>
  );
}

// ── 저장한 코스 ─────────────────────────────────────────────────────────

const courseScene: Layer[] = [
  {
    kind: 'linear',
    angle: 180,
    stops: [
      [0, steel.sky[0]],
      [0.45, steel.sky[1]],
      [1, steel.sky[2]],
    ],
  },
  spot(0.35, 0.4, 0.4, 0.3, steel.haze[0], 0.6),
  spot(0.75, 0.6, 0.45, 0.35, steel.haze[1], 0.6),
];

const shownCourses = 3;
const figureHeight = 190;
const gridStep = 27;

// Up to three saved courses drawn side by side on one grid, numbered like a figure,
// with a legend tile for each (steel blurred scene). Each course has its own slot and scale,
// so the slots are split by lines and the figure says it is not to scale.
export function CoursesCard({ courses }: { courses: SavedCourse[] }) {
  return (
    <Widget id="courses" layers={courseScene}>
      <CoursesBody courses={courses} />
    </Widget>
  );
}

function CoursesBody({ courses }: { courses: SavedCourse[] }) {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const toast = useToast();
  const shown = courses.slice(0, shownCourses);
  // A course that could not be chosen stays on 2.1 and says so, rather than opening the run without it.
  const choose = async (course: SavedCourse) => {
    try {
      await repositories.courses.choose(course.id);
    } catch {
      toast('코스를 고르지 못했어요. 잠시 후 다시 시도해 주세요');
      return;
    }
    navigateTo(navigation, 'CourseRun');
  };
  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <AppText variant="bodyMedium">저장한 코스</AppText>
        <AppText variant="label" tone="textSecondary">
          {courses.length > shown.length
            ? `총 ${courses.length}개 · ${shown.length}개 미리보기`
            : `${courses.length}개`}
        </AppText>
      </View>
      {shown.length ? (
        <>
          <View style={styles.figureBox}>
            <CourseFigure courses={shown} />
            <AppText style={styles.tiny} tone="textSecondary">
              코스별 경로 미리보기 · 거리 비례 아님
            </AppText>
          </View>
          <View style={styles.legend}>
            {shown.map((course, index) => (
              <CourseLegend
                key={course.id}
                course={course}
                index={index}
                onPress={() => choose(course)}
              />
            ))}
          </View>
        </>
      ) : (
        <AppText variant="caption" tone="textSecondary">
          코스를 저장하면 여기에 모여요
        </AppText>
      )}
      <SectionLink
        title="저장한 코스 전체 보기"
        onPress={() => navigateTo(navigation, 'SavedCourses')}
      />
    </View>
  );
}

// Each course gets its own slot across the figure, staggered up and down, all drawn alike.
function CourseFigure({ courses }: { courses: SavedCourse[] }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) =>
    setWidth(event.nativeEvent.layout.width);
  const slot = width / courses.length;
  const center = { x: width / 2, y: figureHeight / 2 };
  // Grid lines fade out toward the edges.
  const fade = (distance: number) => Math.max(0, 1 - distance ** 2) * 0.14;
  return (
    <View style={styles.figure} onLayout={measure}>
      {width ? (
        <Svg width={width} height={figureHeight} style={styles.visible}>
          {Array.from({ length: Math.floor(width / gridStep) + 1 }, (_, i) => (
            <Line
              key={`x${i}`}
              x1={i * gridStep}
              y1={0}
              x2={i * gridStep}
              y2={figureHeight}
              stroke={colors.text}
              strokeOpacity={fade((i * gridStep - center.x) / center.x)}
            />
          ))}
          {Array.from(
            { length: Math.floor(figureHeight / gridStep) + 1 },
            (_, i) => (
              <Line
                key={`y${i}`}
                x1={0}
                y1={i * gridStep}
                x2={width}
                y2={i * gridStep}
                stroke={colors.text}
                strokeOpacity={fade((i * gridStep - center.y) / center.y)}
              />
            ),
          )}
          {courses.slice(1).map((course, index) => (
            <Line
              key={`slot${course.id}`}
              x1={(index + 1) * slot}
              y1={8}
              x2={(index + 1) * slot}
              y2={figureHeight - 8}
              stroke={colors.text}
              strokeOpacity={0.3}
              strokeDasharray="2 4"
            />
          ))}
          {courses.map((course, index) => {
            const top = index % 2 ? 40 : 18;
            const points = fitShape(
              course.shape,
              slot - 24,
              figureHeight - 58,
            ).map(point => ({
              x: index * slot + 12 + point.x,
              y: top + point.y,
            }));
            const start = points[0];
            return (
              <React.Fragment key={course.id}>
                <Polyline
                  points={points
                    .map(point => `${point.x},${point.y}`)
                    .join(' ')}
                  fill="none"
                  stroke={colors.text}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Circle
                  cx={start.x}
                  cy={start.y}
                  r={9}
                  fill={steel.mid}
                  stroke={colors.text}
                  strokeOpacity={0.6}
                />
                <SvgText
                  x={start.x}
                  y={start.y + 3.5}
                  textAnchor="middle"
                  fontFamily={fontFamily.numberRegular}
                  fontSize={10}
                  fill={colors.text}
                >
                  {index + 1}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

// A glass tile per course, numbered like its pin in the figure. The press sets up a course run.
function CourseLegend({
  course,
  index,
  onPress,
}: {
  course: SavedCourse;
  index: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const name = course.myAlias ?? course.name;
  const meta = `${formatKm(course.distanceM, 1)}km · ${
    course.expectedMinutes
  }분`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${meta}`}
      accessibilityHint="이 코스로 러닝을 준비해요"
      onPress={onPress}
      style={({ pressed }) => [
        styles.legendTile,
        { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.pin,
          { backgroundColor: steel.mid, borderColor: colors.borderStrong },
        ]}
      >
        <AppText style={styles.pinText}>{index + 1}</AppText>
      </View>
      <AppText
        variant="labelStrong"
        numberOfLines={2}
        style={styles.legendName}
      >
        {name}
      </AppText>
      <AppText style={styles.tileMeta} tone="textSecondary">
        {meta}
      </AppText>
      <View style={styles.legendGo}>
        <AppText variant="label">러닝 준비</AppText>
        <Icon name="forward" color={colors.text} size={12} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  visible: { overflow: 'visible' },
  body: { gap: spacing.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  link: {
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  unit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 12,
    letterSpacing: 0,
  },
  tiny: { fontSize: 11, lineHeight: 15 },
  // 러닝 분석
  trio: { flexDirection: 'row', marginTop: spacing.xs },
  stat: { flex: 1, gap: spacing.xs },
  divided: { borderLeftWidth: 1, paddingLeft: 14 },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
  },
  bars: { flexDirection: 'row', height: 88 },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    opacity: 0.35,
  },
  dash: { width: 4, height: 1 },
  barColumn: { flex: 1, alignItems: 'center', gap: spacing.md },
  barTrack: { height: 66, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: 6, borderRadius: 3 },
  barPeak: { width: 8, borderRadius: 4 },
  restDay: { width: 4, height: 4, borderRadius: 2, opacity: 0.6 },
  weekday: { fontSize: 10.5, lineHeight: 14 },
  weekdayPeak: { fontFamily: fontFamily.bold },
  compare: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    paddingTop: 14,
  },
  changeChip: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
  },
  changeText: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 12,
    lineHeight: 16,
  },
  // 과거 러닝 기록
  rail: { marginRight: -18 },
  railNotice: { alignItems: 'flex-start', gap: spacing.md },
  railContent: { gap: 10, paddingRight: 18 },
  tile: {
    width: 150,
    height: 222,
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  tileTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 18,
  },
  tileDate: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
  },
  badge: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fontFamily.bold, fontSize: 10, lineHeight: 13 },
  tileRoute: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Two lines are always reserved so the numbers line up across tiles.
  tileName: { fontSize: 13, lineHeight: 18, height: 36 },
  tileDistance: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
  },
  tileMeta: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 12,
    lineHeight: 16,
  },
  // 저장한 코스
  figureBox: { gap: spacing.xs },
  figure: { height: figureHeight },
  legend: { flexDirection: 'row', gap: spacing.md },
  legendTile: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  legendName: {
    fontSize: 12.5,
    lineHeight: 17,
    height: 34,
    marginTop: spacing.sm,
  },
  pin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 10,
    lineHeight: 13,
  },
  legendGo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.sm,
  },
});
