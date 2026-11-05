import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import { AppText, EmptyState, Icon, type IconName } from '../../components';
import {
  useRepositories,
  useResource,
  type AnalysisPeriod,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import { formatDotDateWeekday, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, size } from '../../theme';
import {
  BarLabel,
  glassCard,
  MonthPicker,
  weeksOf,
  WeekPicker,
  YearPicker,
  PillTabs,
  recordsLook,
  RecordsBackdrop,
  ScreenTitle,
} from './look';
import {
  addDays,
  kstDay,
  kstMonth,
  mondayOf,
  shiftMonth,
  shortDay,
} from './parts';

type Mode = 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';

// One bar of the daily chart: a day (주·월), a month (년) or a year (전체).
type Bucket = {
  key: string;
  // 10.15 · 10월 · 2026년, for the callout and the range chip.
  name: string;
  // The x-axis text under the bar (월, 15, 10, 2026).
  axis: string;
  distanceM: number;
  runCount: number;
  durationSec: number;
  future: boolean;
  records: RunRecordSummary[];
};

type Period = {
  buckets: Bucket[];
  // Which axis texts to print (all for 주·년·전체, every fifth day for 월).
  axisAt: (index: number) => boolean;
  // 9월 · 지난주 · 2025년; null for 전체.
  previousName: string | null;
  previous: {
    runCount: number;
    totalDistanceM: number;
    averagePaceSecPerKm: number | null;
  } | null;
  // 10월 · 이번 주 · 2026년 · 전체, for 총 시간's "… 누적".
  name: string;
  // The range chip: 10.1 – 10.15.
  rangeTo: (index: number) => string;
  // 일별 거리 · 월별 거리 · 연도별 거리 over the bars.
  barsLabel: string;
};

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
const swipeDistance = 48;
// 전체 goes back year by year until a year without runs, at most this many years.
const allYears = 5;

const monthNumber = (month: string) => Number(month.slice(5));
// The month the 주 tab counts a week in after a move: the one it already counts in when the week is one of its
// calendar rows, else the month it moved into (its Monday's going back, its Sunday's going forward). A week
// across two months is a row of both (9.28–10.04 is 9월 5주차 and 10월 1주차).
function weekMonthAfter(monday: string, current: string, direction: 1 | -1) {
  return weeksOf(current).some(week => week.start === monday)
    ? current
    : kstMonth(direction > 0 ? addDays(monday, 6) : monday);
}
const daysInMonth = (month: string) =>
  new Date(
    Date.UTC(Number(month.slice(0, 4)), monthNumber(month), 0),
  ).getUTCDate();

function bucketOf(
  key: string,
  name: string,
  axis: string,
  records: RunRecordSummary[],
  future: boolean,
): Bucket {
  return {
    key,
    name,
    axis,
    records,
    future,
    runCount: records.length,
    distanceM: records.reduce((sum, record) => sum + record.distanceM, 0),
    durationSec: records.reduce((sum, record) => sum + record.durationSec, 0),
  };
}

async function monthRecords(repositories: Repositories, months: string[]) {
  const lists = await Promise.all(
    months.map(month => repositories.records.getMonth(month, 'ALL')),
  );
  // Each run once, even if two months' answers both carry it.
  return [
    ...new Map(
      lists.flatMap(list => list.records).map(record => [record.id, record]),
    ).values(),
  ];
}

// H06 previousPeriod for 주 · 월 · 년; the totals are summed from the runs so a picked day adds up the same way.
async function previousOf(
  repositories: Repositories,
  period: AnalysisPeriod,
  baseDate: string,
) {
  const stats = await repositories.records.getStatistics(period, baseDate);
  return stats.previousPeriod;
}

async function loadPeriod(
  repositories: Repositories,
  mode: Mode,
  anchor: { week: string; month: string; year: number },
  today: string,
): Promise<Period> {
  if (mode === 'WEEK') {
    const monday = anchor.week;
    const sunday = addDays(monday, 6);
    const records = await monthRecords(repositories, [
      ...new Set([kstMonth(monday), kstMonth(sunday)]),
    ]);
    const days = weekdays.map((weekday, index) => addDays(monday, index));
    const thisWeek = monday === mondayOf(today);
    return {
      buckets: days.map((day, index) =>
        bucketOf(
          day,
          shortDay(day),
          weekdays[index],
          records.filter(record => kstDay(record.startedAt) === day),
          day > today,
        ),
      ),
      axisAt: () => true,
      previousName: thisWeek ? '지난주' : '전주',
      previous: await previousOf(repositories, 'WEEK', monday),
      name: thisWeek ? '이번 주' : `${shortDay(monday)} 주`,
      rangeTo: index => `${shortDay(monday)} – ${shortDay(days[index])}`,
      barsLabel: '일별 거리',
    };
  }
  if (mode === 'MONTH') {
    const { month } = anchor;
    const records = await monthRecords(repositories, [month]);
    const count = daysInMonth(month);
    const m = monthNumber(month);
    return {
      buckets: Array.from({ length: count }, (_, index) => {
        const day = `${month}-${String(index + 1).padStart(2, '0')}`;
        return bucketOf(
          day,
          `${m}.${index + 1}`,
          String(index + 1),
          records.filter(record => kstDay(record.startedAt) === day),
          day > today,
        );
      }),
      // 1, 5, 10, … and the last day, leaving out a fifth too close to it (30 next to 31).
      axisAt: index =>
        index === 0 ||
        index === count - 1 ||
        ((index + 1) % 5 === 0 && index < count - 3),
      previousName: `${monthNumber(shiftMonth(month, -1))}월`,
      previous: await previousOf(repositories, 'MONTH', `${month}-01`),
      name: `${m}월`,
      rangeTo: index => `${m}.1 – ${m}.${index + 1}`,
      barsLabel: '일별 거리',
    };
  }
  if (mode === 'YEAR') {
    const { year } = anchor;
    const months = Array.from(
      { length: 12 },
      (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`,
    );
    const past = months.filter(month => month <= kstMonth(today));
    const records = await monthRecords(repositories, past);
    return {
      buckets: months.map((month, index) =>
        bucketOf(
          month,
          `${index + 1}월`,
          String(index + 1),
          records.filter(record => kstMonth(record.startedAt) === month),
          month > kstMonth(today),
        ),
      ),
      axisAt: () => true,
      previousName: `${year - 1}년`,
      previous: await previousOf(repositories, 'YEAR', `${year}-01-01`),
      name: `${year}년`,
      rangeTo: index => `1월 – ${index + 1}월`,
      barsLabel: '월별 거리',
    };
  }
  // 전체 has no H06 period: each year's H06 totals, back to the first year without runs.
  const thisYear = Number(today.slice(0, 4));
  const years: {
    year: number;
    runCount: number;
    distanceM: number;
    durationSec: number;
  }[] = [];
  for (let year = thisYear; year > thisYear - allYears; year -= 1) {
    const stats = await repositories.records.getStatistics(
      'YEAR',
      `${year}-01-01`,
    );
    if (stats.runCount === 0 && year !== thisYear) {
      break;
    }
    years.unshift({
      year,
      runCount: stats.runCount,
      distanceM: stats.totalDistanceM,
      durationSec: stats.totalDurationSec,
    });
  }
  return {
    buckets: years.map(item => ({
      key: String(item.year),
      name: `${item.year}년`,
      axis: String(item.year),
      distanceM: item.distanceM,
      runCount: item.runCount,
      durationSec: item.durationSec,
      future: false,
      records: [],
    })),
    axisAt: () => true,
    previousName: null,
    previous: null,
    name: '전체',
    rangeTo: index => `${years[0].year} – ${years[index].year}`,
    barsLabel: '연도별 거리',
  };
}

// Round a top value up to 2, 5 or 10 times a power of ten.
function niceCeil(value: number) {
  if (value <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find(factor => factor * power >= value) ?? 10;
  return step * power;
}

const chartHeight = 330;
const axisWidth = 42;
// The cumulative line runs from y 146 (0 km) up to y 13 (the larger of this and the previous total).
const cumulativeZero = 146;
const cumulativeTop = 13;
// The daily bars stand on y 296, the tallest bar 100 high.
const barBase = 296;
const barSpan = 100;

// 누적 거리 over 일별 거리 (runway-records 5.3): the running total as a thick line with the previous period's
// total dashed, and the distance of each day (month, year) as thin bars. The chosen bar is navy, with a
// callout at its point; every bar is a button that picks it.
function DistanceChart({
  period,
  selected,
  onSelect,
  onSwipe,
}: {
  period: Period;
  selected: number | null;
  onSelect: (index: number) => void;
  onSwipe: (direction: 1 | -1) => void;
}) {
  // The handoff's 342 until the chart is measured.
  const [width, setWidth] = useState(342);
  const touchX = useRef<number | null>(null);
  const { buckets } = period;
  const plot = Math.max(width - axisWidth, 0);
  const slot = buckets.length ? plot / buckets.length : 0;
  const barWidth = Math.min(Math.max(slot * 0.72, 4), 16);
  const center = (index: number) => slot * index + slot / 2;
  const totals = buckets.reduce<number[]>(
    (sums, bucket) => [
      ...sums,
      (sums[sums.length - 1] ?? 0) + bucket.distanceM,
    ],
    [],
  );
  const lastPast = buckets.reduce(
    (last, bucket, index) => (bucket.future ? last : index),
    -1,
  );
  const previousKm = (period.previous?.totalDistanceM ?? 0) / 1000;
  const topKm = Math.max((totals[lastPast] ?? 0) / 1000, previousKm, 1);
  const yCumulative = (km: number) =>
    cumulativeZero - (km / topKm) * (cumulativeZero - cumulativeTop);
  const step = niceCeil(topKm / 4);
  const ticks = [1, 2, 3].map(n => n * step).filter(tick => tick <= topKm);
  const runBuckets = buckets.filter(bucket => bucket.runCount > 0);
  const barMaxKm = Math.max(
    Math.ceil(Math.max(...buckets.map(bucket => bucket.distanceM), 0) / 1000),
    1,
  );
  const barHeight = (km: number) => (km / barMaxKm) * barSpan;
  const averageKm = runBuckets.length
    ? runBuckets.reduce((sum, bucket) => sum + bucket.distanceM, 0) /
      runBuckets.length /
      1000
    : null;
  // The line joins the days (months, years) with runs, from 0 at the start, like the handoff. After a long
  // gap (three or more empty buckets) it stays flat until just before the next run, so it does not climb
  // through months without runs.
  let lastRun = -1;
  const points = [
    `0,${cumulativeZero}`,
    ...buckets.flatMap((bucket, index) => {
      if (bucket.runCount === 0 || bucket.future) {
        return [];
      }
      const flat =
        index - lastRun > 3
          ? [
              `${center(index - 1)},${yCumulative(
                (totals[index - 1] ?? 0) / 1000,
              )}`,
            ]
          : [];
      lastRun = index;
      return [...flat, `${center(index)},${yCumulative(totals[index] / 1000)}`];
    }),
  ];
  const line = points.length > 1 ? points.join(' ') : '';
  const chosen = selected !== null ? buckets[selected] : null;
  const chosenX = selected !== null ? center(selected) : 0;
  const chosenKm = selected !== null ? totals[selected] : 0;
  const chosenY = selected !== null ? yCumulative(totals[selected] / 1000) : 0;
  const calloutRight = chosenX > plot * 0.6;
  return (
    <View
      style={styles.chart}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      onTouchStart={event => {
        touchX.current = event.nativeEvent.pageX;
      }}
      onTouchEnd={event => {
        const from = touchX.current;
        touchX.current = null;
        if (from !== null) {
          const dx = event.nativeEvent.pageX - from;
          if (Math.abs(dx) > swipeDistance) {
            onSwipe(dx < 0 ? 1 : -1);
          }
        }
      }}
    >
      {width > 0 ? (
        <>
          <Svg width={width} height={chartHeight}>
            {period.previous ? (
              <Line
                x1={0}
                x2={plot}
                y1={yCumulative(previousKm)}
                y2={yCumulative(previousKm)}
                stroke={recordsLook.ink}
                strokeOpacity={0.28}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
            ) : null}
            {line ? (
              <Polyline
                points={line}
                fill="none"
                stroke={recordsLook.ink}
                strokeWidth={2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {selected !== null ? (
              <>
                <Line
                  x1={center(selected)}
                  x2={center(selected)}
                  y1={chosenY + 7}
                  y2={
                    barBase - barHeight(buckets[selected].distanceM / 1000) - 4
                  }
                  stroke={recordsLook.ink}
                  strokeOpacity={0.35}
                  strokeWidth={1.2}
                />
                <Circle
                  cx={center(selected)}
                  cy={chosenY}
                  r={5.5}
                  fill="#FFFFFF"
                  stroke={recordsLook.ink}
                  strokeWidth={2.4}
                />
              </>
            ) : null}
            {buckets.map((bucket, index) =>
              bucket.runCount > 0 ? (
                <Rect
                  key={bucket.key}
                  x={center(index) - barWidth / 2}
                  y={barBase - barHeight(bucket.distanceM / 1000)}
                  width={barWidth}
                  height={barHeight(bucket.distanceM / 1000)}
                  rx={3}
                  fill={index === selected ? recordsLook.ink : recordsLook.bar}
                />
              ) : (
                <Rect
                  key={bucket.key}
                  x={center(index) - barWidth / 2}
                  y={barBase - 3}
                  width={barWidth}
                  height={3}
                  rx={1.5}
                  fill={recordsLook.ink}
                  fillOpacity={bucket.future ? 0.09 : 0.16}
                />
              ),
            )}
            {averageKm !== null ? (
              <Line
                x1={0}
                x2={plot}
                y1={barBase - barHeight(averageKm)}
                y2={barBase - barHeight(averageKm)}
                stroke={recordsLook.ink}
                strokeOpacity={0.55}
                strokeWidth={1.2}
              />
            ) : null}
          </Svg>
          <View style={[styles.label, styles.labelTop]}>
            <BarLabel label="누적 거리" />
          </View>
          <View style={[styles.label, styles.labelBars]}>
            <BarLabel label={period.barsLabel} />
          </View>
          {period.previous && period.previousName ? (
            <AppText
              style={[
                styles.previous,
                { top: yCumulative(previousKm) + 4, right: axisWidth + 8 },
              ]}
            >
              {`${period.previousName} ${formatKm(
                period.previous.totalDistanceM,
                1,
              )}km`}
            </AppText>
          ) : null}
          {ticks.map(tick => (
            <AppText
              key={tick}
              style={[styles.axis, { top: yCumulative(tick) - 7 }]}
            >
              {String(tick)}
            </AppText>
          ))}
          <AppText style={[styles.axis, { top: barBase - barSpan - 7 }]}>
            {String(barMaxKm)}
          </AppText>
          {averageKm !== null ? (
            <AppText
              style={[
                styles.axis,
                styles.axisStrong,
                { top: barBase - barHeight(averageKm) - 7 },
              ]}
            >
              {averageKm.toFixed(1)}
            </AppText>
          ) : null}
          <AppText style={[styles.axis, { top: barBase - 9 }]}>km</AppText>
          {buckets.map((bucket, index) =>
            period.axisAt(index) || index === selected ? (
              <AppText
                key={bucket.key}
                style={[
                  styles.tick,
                  { left: center(index) - 16 },
                  index === selected && styles.tickOn,
                ]}
              >
                {bucket.axis}
              </AppText>
            ) : null,
          )}
          {chosen ? (
            <View
              pointerEvents="none"
              style={[
                styles.callout,
                { top: Math.max(chosenY - 11, 0) },
                calloutRight
                  ? { right: width - chosenX + 10 }
                  : { left: chosenX + 10 },
              ]}
            >
              <AppText style={styles.calloutText}>
                {`${chosen.name} · ${formatKm(chosenKm, 1)}km`}
              </AppText>
            </View>
          ) : null}
          {/* Each column picks its day (month, year). */}
          {buckets.map((bucket, index) => (
            <Pressable
              key={bucket.key}
              accessibilityRole="button"
              accessibilityLabel={`${bucket.name} ${formatKm(
                bucket.distanceM,
                1,
              )}km`}
              accessibilityState={{
                selected: index === selected,
                disabled: bucket.future,
              }}
              disabled={bucket.future}
              onPress={() => onSelect(index)}
              style={[styles.column, { left: slot * index, width: slot }]}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

// One of the four 요약 tiles; the first (평균 페이스) is navy.
function Tile({
  label,
  value,
  unit,
  extra,
  note,
  icon,
  dark = false,
}: {
  label: string;
  value: string;
  unit: string;
  // A second number after the first (21 m in 3h 21m).
  extra?: { value: string; unit: string };
  note: string;
  // What the tile counts (담당자 결정): heart rate for 평균 페이스, a route for 거리, a runner for 러닝, a clock for 시간.
  icon: IconName;
  dark?: boolean;
}) {
  const ink = dark ? '#FFFFFF' : recordsLook.ink;
  const soft = dark ? 'rgba(255,255,255,0.6)' : recordsLook.sub;
  return (
    <View
      accessibilityLabel={`${label} ${value}${unit}${
        extra ? ` ${extra.value}${extra.unit}` : ''
      }, ${note}`}
      style={[styles.tile, dark ? styles.tileDark : glassCard]}
    >
      {/* The label at the top left, the comparison small at the top right (담당자 결정). */}
      <View style={styles.tileHead}>
        <AppText style={[styles.tileLabel, { color: soft }]}>{label}</AppText>
        <AppText numberOfLines={1} style={[styles.tileNote, { color: soft }]}>
          {note}
        </AppText>
      </View>
      <View style={styles.tileRow}>
        <View style={[styles.tileIcon, dark ? styles.tileIconDark : null]}>
          <Icon name={icon} color={ink} size={16} strokeWidth={2.2} />
        </View>
        <View style={styles.tileValue}>
          <AppText style={[styles.tileNumber, { color: ink }]}>{value}</AppText>
          {/* 평균 페이스 shows 5′52″ alone, without /km (담당자 결정). */}
          {unit ? (
            <AppText style={[styles.tileUnit, { color: ink }]}>{unit}</AppText>
          ) : null}
          {extra ? (
            <>
              <AppText
                style={[styles.tileNumber, styles.tileExtra, { color: ink }]}
              >
                {extra.value}
              </AppText>
              <AppText style={[styles.tileUnit, { color: ink }]}>
                {extra.unit}
              </AppText>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const signed = (value: number, text: string) =>
  `${value > 0 ? '+' : value < 0 ? '−' : '±'}${text}`;

// Hours and minutes for the 총 시간 tile (3h 21m, 담당자 결정).
function hoursAndMinutes(totalSeconds: number) {
  const minutes = Math.round(totalSeconds / 60);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

// 5.3 러닝 분석 (runway-records): 주 · N월 ▾ · 년 · 전체, the distance chart and the 요약 of the chosen range.
// A swipe across the chart moves the period; the month tab opens the month picker.
export function AnalysisScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { clock } = useRepositories();
  const today = kstDay(clock.now());
  const [mode, setMode] = useState<Mode>('MONTH');
  const [anchor, setAnchor] = useState({
    week: mondayOf(today),
    month: kstMonth(today),
    year: Number(today.slice(0, 4)),
  });
  // Which tab's picker is open (주 · 월 · 년; 전체 has none).
  const [picking, setPicking] = useState<Exclude<Mode, 'ALL'> | null>(null);
  const [pickerYear, setPickerYear] = useState(anchor.year);
  // The month the 주 tab counts its weeks in (1주 · 2주 …), and the one its picker shows.
  const [weekMonth, setWeekMonth] = useState(kstMonth(today));
  const [pickerMonth, setPickerMonth] = useState(weekMonth);
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 5 }, (_, index) => thisYear - 4 + index);
  const [view, setView] = useState<'tiles' | 'list'>('tiles');
  const [selected, setSelected] = useState<number | null>(null);

  const data = useResource(
    useCallback(
      (repositories: Repositories) =>
        loadPeriod(repositories, mode, anchor, today),
      [mode, anchor, today],
    ),
  );
  const period = data.status === 'ready' ? data.data : null;
  // A new period starts on its latest day with a run.
  useEffect(() => {
    if (!period) {
      return;
    }
    const last = period.buckets.reduce(
      (found, bucket, index) =>
        !bucket.future && bucket.runCount > 0 ? index : found,
      -1,
    );
    setSelected(last >= 0 ? last : null);
  }, [period]);
  const refresh = data.refresh;
  useEffect(
    () =>
      onRecordsChanged(() => {
        void refresh();
      }),
    [refresh],
  );

  // The dots of the open picker: months with runs (월), weeks with runs (주) or years with runs (년).
  const marks = useResource(
    useCallback(
      async (repositories: Repositories): Promise<Set<string>> => {
        if (picking === 'WEEK') {
          const rows = weeksOf(pickerMonth);
          const months = [
            ...new Set([
              kstMonth(rows[0].start),
              pickerMonth,
              kstMonth(rows[rows.length - 1].end),
            ]),
          ];
          const lists = await Promise.all(
            months.map(month => repositories.records.getMonth(month, 'ALL')),
          );
          const days = lists
            .flatMap(list => list.records)
            .map(record => kstDay(record.startedAt));
          return new Set(
            weeksOf(pickerMonth)
              .filter(week =>
                days.some(day => day >= week.start && day <= week.end),
              )
              .map(week => week.start),
          );
        }
        if (picking === 'YEAR') {
          const counts = await Promise.all(
            years.map(year =>
              repositories.records.getStatistics('YEAR', `${year}-01-01`),
            ),
          );
          return new Set(
            years.filter((_, index) => counts[index].runCount > 0).map(String),
          );
        }
        const stats = await repositories.records.getStatistics(
          'YEAR',
          `${pickerYear}-01-01`,
        );
        return new Set(
          stats.breakdown.flatMap((distance, index) =>
            distance > 0
              ? [`${pickerYear}-${String(index + 1).padStart(2, '0')}`]
              : [],
          ),
        );
      },
      // years follows thisYear.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [picking, pickerMonth, pickerYear, thisYear],
    ),
  );
  const marked = marks.status === 'ready' ? marks.data : new Set<string>();

  const swipe = (direction: 1 | -1) => {
    setAnchor(current => {
      if (mode === 'WEEK') {
        const week = addDays(current.week, direction * 7);
        if (week > mondayOf(today)) {
          return current;
        }
        setWeekMonth(month => weekMonthAfter(week, month, direction));
        return { ...current, week };
      }
      if (mode === 'MONTH') {
        const month = shiftMonth(current.month, direction);
        return month > kstMonth(today) ? current : { ...current, month };
      }
      if (mode === 'YEAR') {
        const year = current.year + direction;
        return year > Number(today.slice(0, 4))
          ? current
          : { ...current, year };
      }
      return current;
    });
  };

  // 3주차 ▾: the chosen week's row in weekMonth's calendar.
  const weekIndex = weeksOf(weekMonth).findIndex(
    week => week.start === anchor.week,
  );
  const weekStart = weeksOf(weekMonth)[weekIndex]?.start ?? null;
  const tabs: { value: Mode; label: string; accessibilityLabel: string }[] = [
    {
      value: 'WEEK',
      label: `${weekIndex + 1}주차 ▾`,
      accessibilityLabel: '주',
    },
    {
      value: 'MONTH',
      label: `${monthNumber(anchor.month)}월 ▾`,
      accessibilityLabel: '월',
    },
    { value: 'YEAR', label: `${anchor.year}년 ▾`, accessibilityLabel: '년' },
    { value: 'ALL', label: '전체', accessibilityLabel: '전체' },
  ];
  // The chosen tab again opens (or closes) its picker; 전체 has none.
  const changeMode = (next: Mode) => {
    if (next === mode && next !== 'ALL') {
      setPickerYear(Number(anchor.month.slice(0, 4)));
      setPickerMonth(weekMonth);
      setPicking(current => (current === next ? null : next));
      return;
    }
    setPicking(null);
    setMode(next);
  };

  // A pick from the period before can point past this one's end until the effect above resets it.
  const chosen =
    period && selected !== null && selected < period.buckets.length
      ? selected
      : null;
  const range =
    period && chosen !== null
      ? period.buckets.slice(0, chosen + 1)
      : period?.buckets ?? [];
  const runCount = range.reduce((sum, bucket) => sum + bucket.runCount, 0);
  const distanceM = range.reduce((sum, bucket) => sum + bucket.distanceM, 0);
  const durationSec = range.reduce(
    (sum, bucket) => sum + bucket.durationSec,
    0,
  );
  const pace =
    distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : null;
  const previous = period?.previous ?? null;
  const paceGap =
    previous?.averagePaceSecPerKm && pace
      ? previous.averagePaceSecPerKm - pace
      : null;
  const distanceGap = previous ? distanceM - previous.totalDistanceM : null;
  const countGap = previous ? runCount - previous.runCount : null;
  const records = range.flatMap(bucket => bucket.records);

  const open = (record: RunRecordSummary) =>
    record.runType === 'GROUP'
      ? navigateTo(navigation, 'GroupRunResult')
      : navigation.navigate('RecordDetail', { recordId: record.id });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <RecordsBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + 10,
            paddingBottom:
              insets.bottom + size.tabBar + size.tabBarInset * 2 + 12,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenTitle title="러닝 분석" />
        <PillTabs glass options={tabs} value={mode} onChange={changeMode} />
        {data.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="분석을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={data.reload}
          />
        ) : !period ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <>
            <DistanceChart
              period={period}
              selected={chosen}
              onSelect={setSelected}
              onSwipe={swipe}
            />
            {period.buckets.every(bucket => bucket.runCount === 0) ? (
              <AppText style={styles.none}>이 기간에는 기록이 없어요</AppText>
            ) : null}
            <View style={styles.summaryHead}>
              <View style={styles.summaryTitle}>
                <AppText style={styles.summaryText}>요약</AppText>
                {chosen !== null ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="선택 해제"
                    onPress={() => setSelected(null)}
                    style={styles.chip}
                  >
                    <AppText style={styles.chipText}>
                      {period.rangeTo(chosen)}
                    </AppText>
                    <Icon
                      name="close"
                      color="#FFFFFF"
                      size={11}
                      strokeWidth={2.6}
                    />
                  </Pressable>
                ) : null}
              </View>
              <View style={[styles.toggle, glassCard]}>
                {(['tiles', 'list'] as const).map(option => (
                  <Pressable
                    key={option}
                    accessibilityRole="tab"
                    accessibilityLabel={
                      option === 'tiles' ? '요약으로 보기' : '목록으로 보기'
                    }
                    accessibilityState={{ selected: view === option }}
                    onPress={() => setView(option)}
                    style={[
                      styles.toggleButton,
                      view === option && styles.toggleOn,
                    ]}
                  >
                    <Svg width={14} height={14} viewBox="0 0 24 24">
                      <Path
                        d={
                          option === 'tiles'
                            ? 'M6 20v-6M12 20V8M18 20v-10'
                            : 'M5 7h14M5 12h14M5 17h14'
                        }
                        stroke={
                          view === option ? recordsLook.ink : recordsLook.sub
                        }
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        fill="none"
                      />
                    </Svg>
                  </Pressable>
                ))}
              </View>
            </View>
            {view === 'tiles' ? (
              <View style={styles.tiles}>
                <Tile
                  dark
                  label="평균 페이스"
                  value={pace ? formatPace(pace) : '– –'}
                  unit=""
                  icon="heartPulse"
                  note={
                    paceGap === null
                      ? '비교 기록 없음'
                      : paceGap === 0
                      ? '같은 페이스'
                      : // 8초 빠름, without the period's name (담당자 결정).
                        `${Math.abs(paceGap)}초 ${
                          paceGap > 0 ? '빠름' : '느림'
                        }`
                  }
                />
                <Tile
                  label="누적 거리"
                  value={formatKm(distanceM, 1)}
                  unit="km"
                  icon="route"
                  note={
                    distanceGap === null
                      ? '비교 기록 없음'
                      : signed(
                          distanceGap,
                          `${formatKm(Math.abs(distanceGap), 1)}km`,
                        )
                  }
                />
                <Tile
                  label="러닝"
                  value={String(runCount)}
                  unit="회"
                  icon="runner"
                  note={
                    countGap === null
                      ? '비교 기록 없음'
                      : signed(countGap, `${Math.abs(countGap)}회`)
                  }
                />
                <Tile
                  icon="clock"
                  label="총 시간"
                  value={String(hoursAndMinutes(durationSec).hours)}
                  unit="h"
                  extra={{
                    value: String(hoursAndMinutes(durationSec).minutes),
                    unit: 'm',
                  }}
                  note={`${period.name} 누적`}
                />
              </View>
            ) : mode === 'ALL' ? (
              <View style={styles.list}>
                {range.map(bucket => (
                  <View key={bucket.key} style={[styles.row, glassCard]}>
                    <AppText style={styles.rowTitle}>{bucket.name}</AppText>
                    <AppText style={styles.rowMeta}>
                      {`${bucket.runCount}회 · ${formatKm(
                        bucket.distanceM,
                        1,
                      )}km`}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : records.length === 0 ? (
              <AppText style={styles.none}>이 기간에는 기록이 없어요</AppText>
            ) : (
              <View style={styles.list}>
                {[...records]
                  .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                  .map(record => (
                    <Pressable
                      key={record.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${
                        record.title
                      }, ${formatDotDateWeekday(record.startedAt)}`}
                      onPress={() => open(record)}
                      style={({ pressed }) => [
                        styles.row,
                        glassCard,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.flex}>
                        <AppText numberOfLines={1} style={styles.rowTitle}>
                          {record.title}
                        </AppText>
                        <AppText style={styles.rowDate}>
                          {formatDotDateWeekday(record.startedAt)}
                        </AppText>
                      </View>
                      <AppText style={styles.rowMeta}>
                        {`${formatKm(record.distanceM)}km · ${formatPace(
                          record.averagePaceSecPerKm,
                        )}`}
                      </AppText>
                    </Pressable>
                  ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
      {picking ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="선택 닫기"
            onPress={() => setPicking(null)}
            style={styles.scrim}
          />
          {picking === 'WEEK' ? (
            <WeekPicker
              month={pickerMonth}
              selected={pickerMonth === weekMonth ? weekStart : null}
              today={today}
              marked={marked}
              onMonth={step => setPickerMonth(shiftMonth(pickerMonth, step))}
              onPick={week => {
                setPicking(null);
                setWeekMonth(pickerMonth);
                setAnchor(current => ({
                  ...current,
                  week: mondayOf(week.start),
                }));
              }}
              style={{ ...styles.picker, top: insets.top + 134 }}
            />
          ) : picking === 'YEAR' ? (
            <YearPicker
              years={years}
              selected={anchor.year}
              marked={new Set([...marked].map(Number))}
              onPick={year => {
                setPicking(null);
                setAnchor(current => ({ ...current, year }));
              }}
              style={{ ...styles.picker, top: insets.top + 134 }}
            />
          ) : (
            <MonthPicker
              year={pickerYear}
              selected={anchor.month}
              latest={kstMonth(today)}
              marked={marked}
              onYear={setPickerYear}
              onPick={month => {
                setPicking(null);
                setAnchor(current => ({ ...current, month }));
              }}
              style={{ ...styles.picker, top: insets.top + 134 }}
            />
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#D7E1E7' },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  scroll: { paddingHorizontal: recordsLook.side, gap: 24 },
  loading: { marginTop: 120 },
  chart: { height: chartHeight },
  label: { position: 'absolute', left: 0 },
  labelTop: { top: 0 },
  labelBars: { top: 164 },
  previous: {
    position: 'absolute',
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: -0.3,
    color: recordsLook.sub,
  },
  axis: {
    position: 'absolute',
    right: 0,
    fontFamily: fontFamily.mono,
    fontSize: 10.5,
    lineHeight: 14,
    color: recordsLook.muted,
  },
  axisStrong: { fontFamily: fontFamily.monoMedium, color: recordsLook.ink },
  tick: {
    position: 'absolute',
    top: 306,
    width: 32,
    textAlign: 'center',
    fontFamily: fontFamily.mono,
    fontSize: 10.5,
    lineHeight: 14,
    color: recordsLook.muted,
  },
  tickOn: { fontFamily: fontFamily.monoMedium, color: recordsLook.ink },
  callout: {
    position: 'absolute',
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 8,
    justifyContent: 'center',
    backgroundColor: recordsLook.ink,
  },
  calloutText: {
    fontFamily: fontFamily.monoMedium,
    fontSize: 10.5,
    lineHeight: 14,
    color: '#FFFFFF',
  },
  column: { position: 'absolute', top: 0, height: chartHeight - 20 },
  none: {
    marginTop: -12,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: recordsLook.sub,
  },
  summaryHead: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: -12,
  },
  summaryTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryText: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: recordsLook.ink,
  },
  chip: {
    height: 24,
    paddingLeft: 9,
    paddingRight: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: recordsLook.ink,
  },
  chipText: {
    fontFamily: fontFamily.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    color: '#FFFFFF',
  },
  toggle: {
    height: 32,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 12,
  },
  toggleButton: {
    width: 30,
    height: 24,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: '#FFFFFF',
    boxShadow: '0 2px 6px rgba(9,17,26,0.1)',
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48.5%',
    height: 84,
    paddingTop: 12,
    paddingRight: 14,
    paddingLeft: 16,
    borderRadius: 20,
  },
  // The navy tile gets the same 1 rim as the glass ones, so all four lay out their text alike.
  tileDark: {
    borderWidth: 1,
    borderColor: recordsLook.ink,
    backgroundColor: recordsLook.ink,
    boxShadow: '0 10px 26px rgba(2,5,14,0.28)',
  },
  // The label at the top left, smaller than the handoff's 12.5 (담당자 결정).
  tileLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: -0.3,
  },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  // The icon on the left and the number on the right of one line, both centred on it (담당자 결정).
  tileRow: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  tileIconDark: { backgroundColor: 'rgba(255,255,255,0.16)' },
  // Every tile: the number line 26 high with its unit 3 after it (담당자 결정: 간격 통일). The digits sit low in
  // that line, so it is lifted 2 to put them on the icon's centre.
  tileValue: {
    height: 26,
    marginTop: -4,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  tileNumber: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 26,
    letterSpacing: -0.8,
    includeFontPadding: false,
  },
  // The minutes after the hours' h.
  tileExtra: { marginLeft: 6 },
  tileUnit: {
    marginLeft: 3,
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
  },
  // The comparison, small at the top right.
  tileNote: {
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: -0.3,
    includeFontPadding: false,
  },
  list: { gap: 8 },
  row: {
    minHeight: 58,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: recordsLook.ink,
  },
  rowDate: {
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: recordsLook.sub,
  },
  rowMeta: {
    fontFamily: fontFamily.monoMedium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.ink,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(9,17,26,0.18)',
  },
  picker: { position: 'absolute', left: 24, right: 24 },
});
