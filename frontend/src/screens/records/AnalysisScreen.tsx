import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  animateNextLayout,
  AppText,
  EmptyState,
  FadeIn,
  Icon,
} from '../../components';
import {
  useRepositories,
  useResource,
  type AnalysisPeriod,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import {
  formatClockTime,
  formatDotDate,
  formatDotDateWeekday,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo, openRecord } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import {
  MonthPicker,
  weeksOf,
  WeekPicker,
  YearPicker,
  PillTabs,
  recordsLook,
  RecordsShell,
  usePickerTop,
} from './look';
import { PeriodFigures } from './PeriodFigures';
import {
  addDays,
  kstDay,
  kstMonth,
  mondayOf,
  shiftMonth,
  shortDay,
} from './parts';

// DAY is 2.1 홈's 러닝 분석 (S15P31E105-564); 5.3 keeps 전체 · 년 · 월 · 주.
export type Mode = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';

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

export type Period = {
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

export async function loadPeriod(
  repositories: Repositories,
  mode: Mode,
  anchor: { day?: string; week: string; month: string; year: number },
  today: string,
): Promise<Period> {
  if (mode === 'DAY') {
    // One day: each of its runs is a bar, compared with the day before (담당자 결정: 하루치만).
    const day = anchor.day ?? today;
    const before = addDays(day, -1);
    const records = await monthRecords(repositories, [
      ...new Set([kstMonth(before), kstMonth(day)]),
    ]);
    const runs = records
      .filter(record => kstDay(record.startedAt) === day)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const previous = records.filter(
      record => kstDay(record.startedAt) === before,
    );
    const previousDistanceM = previous.reduce(
      (sum, record) => sum + record.distanceM,
      0,
    );
    const previousDurationSec = previous.reduce(
      (sum, record) => sum + record.durationSec,
      0,
    );
    const times = runs.map(record => formatClockTime(record.startedAt));
    return {
      // A day without a run still has one empty bar, so the figures show – –.
      buckets: runs.length
        ? runs.map((record, index) =>
            bucketOf(record.id, times[index], times[index], [record], false),
          )
        : [bucketOf(day, shortDay(day), shortDay(day), [], false)],
      axisAt: () => true,
      previousName: '전날',
      previous: {
        runCount: previous.length,
        totalDistanceM: previousDistanceM,
        averagePaceSecPerKm:
          previousDistanceM > 0
            ? Math.round(previousDurationSec / (previousDistanceM / 1000))
            : null,
      },
      name: `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`,
      rangeTo: index => `${times[0] ?? ''} – ${times[index] ?? ''}`,
      barsLabel: '러닝별 거리',
    };
  }
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

// 5.3 러닝 분석 (runway-records 2차): 주 · N월 ▾ · 년 · 전체, and one card with 평균 페이스 · 누적 거리 · 총 시간
// that ↻ turns over to the period's records.
// A swipe across the chart moves the period; the month tab opens the month picker.
// 29분 41초 under a record on the card back (runway-records 2차).
function minutesSeconds(totalSeconds: number) {
  const seconds = Math.round(totalSeconds);
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function AnalysisScreen() {
  const navigation = useNavigation();
  const pickerTop = usePickerTop(true);
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
  const turn = useRef(new Animated.Value(0)).current;
  const flipping = useRef(false);

  const data = useResource(
    useCallback(
      (repositories: Repositories) =>
        loadPeriod(repositories, mode, anchor, today),
      [mode, anchor, today],
    ),
  );
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
  // 전체 · 년 · 월 · 주, the big range first as dates read in Korean (담당자 요청).
  const tabs: { value: Mode; label: string; accessibilityLabel: string }[] = [
    { value: 'ALL', label: '전체', accessibilityLabel: '전체' },
    { value: 'YEAR', label: `${anchor.year}년 ▾`, accessibilityLabel: '년' },
    {
      value: 'MONTH',
      label: `${monthNumber(anchor.month)}월 ▾`,
      accessibilityLabel: '월',
    },
    {
      value: 'WEEK',
      label: `${weekIndex + 1}주차 ▾`,
      accessibilityLabel: '주',
    },
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
    animateNextLayout();
    setMode(next);
  };

  const open = (record: RunRecordSummary) =>
    record.runType === 'GROUP'
      ? navigateTo(navigation, 'GroupRunResult')
      : openRecord(navigation, record.id);

  // ↻ turns the card over (runway-records 2차, 담당자 결정): a quarter turn away, the other face swapped in
  // while the card stands on its edge, then a quarter turn back. A tap during the turn waits for it.
  const flip = () => {
    if (flipping.current) {
      return;
    }
    flipping.current = true;
    Animated.timing(turn, {
      toValue: 1,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setView(current => (current === 'list' ? 'tiles' : 'list'));
      turn.setValue(-1);
      Animated.timing(turn, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        flipping.current = false;
      });
    });
  };
  const cardTurn = {
    transform: [
      { perspective: 1200 },
      {
        rotateY: turn.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: ['-90deg', '0deg', '90deg'],
        }),
      },
    ],
  };

  return (
    <RecordsShell
      cardStyle={cardTurn}
      title="러닝 분석"
      onBack={() =>
        navigation.canGoBack()
          ? navigation.goBack()
          : navigateTo(navigation, 'Home')
      }
      tabs={
        <PillTabs glass options={tabs} value={mode} onChange={changeMode} />
      }
      after={
        picking ? (
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
                style={{ ...styles.picker, top: pickerTop }}
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
                style={{ ...styles.picker, top: pickerTop }}
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
                style={{ ...styles.picker, top: pickerTop }}
              />
            )}
          </>
        ) : null
      }
    >
      <ScrollView
        contentContainerStyle={styles.card}
        showsVerticalScrollIndicator={false}
      >
        <AnalysisContent
          data={data}
          mode={mode}
          appearKey={`${mode}:${anchor.week}:${anchor.month}:${anchor.year}`}
          view={view}
          onFlip={flip}
          onSwipe={swipe}
          onOpen={open}
        />
      </ScrollView>
    </RecordsShell>
  );
}

// The 5.3 card's content (also 2.1 홈's 러닝 분석, S15P31E105-564): the period chip with ↻, then the distance graph
// and its bars, or on the back the period's records.
export function AnalysisContent({
  data,
  mode,
  appearKey,
  view,
  onFlip,
  backLabel = '요약으로 보기',
  onSwipe,
  onOpen,
}: {
  data: { status: string; data?: Period | null; reload: () => void };
  mode: Mode;
  appearKey: string;
  view: 'tiles' | 'list';
  // ↻ turns the card over; without it the card is single (2.1 러닝 분석, 담당자 결정).
  onFlip?: () => void;
  // What ↻ says on the back (요약으로 보기 on 5.3).
  backLabel?: string;
  onSwipe: (direction: 1 | -1) => void;
  onOpen: (record: RunRecordSummary) => void;
}) {
  const period = data.status === 'ready' ? data.data ?? null : null;
  const range = period?.buckets ?? [];
  const runCount = range.reduce((sum, bucket) => sum + bucket.runCount, 0);
  const distanceM = range.reduce((sum, bucket) => sum + bucket.distanceM, 0);
  const records = range.flatMap(bucket => bucket.records);
  const flip = onFlip;
  const swipe = onSwipe;
  const open = onOpen;
  const none =
    mode === 'DAY' ? '이 날은 러닝 기록이 없어요' : '이 기간에는 기록이 없어요';
  return (
    <>
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
          {/* runway-records 2차: one frost card. ↻ turns it over to the period's records (담당자 결정:
              목록은 카드 뒤집기); the front keeps the distance graph and its bars. */}
          <View>
            <View style={styles.cardHead}>
              <View style={styles.cardChip}>
                <AppText style={styles.cardChipText}>
                  {`${view === 'list' ? '러닝 기록' : '러닝 분석'} | ${
                    period.name
                  }`}
                </AppText>
              </View>
              {flip ? (
                <View style={styles.cardBrand}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      view === 'list' ? backLabel : '목록으로 보기'
                    }
                    hitSlop={10}
                    onPress={flip}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <Icon
                      name="refresh"
                      color={recordsLook.onCardSub}
                      size={15}
                      strokeWidth={2}
                    />
                  </Pressable>
                </View>
              ) : null}
            </View>
            {/* The front has no title: the tab above already says the period (담당자 결정). */}
            {view === 'list' ? (
              <AppText
                style={styles.cardTitle}
              >{`${period.name} 기록`}</AppText>
            ) : null}
            {view === 'list' ? (
              <AppText style={styles.cardSub}>
                {`${runCount}번 · ${formatKm(distanceM, 1)}km`}
              </AppText>
            ) : null}
            {view === 'list' ? (
              mode === 'ALL' ? (
                <View style={styles.list}>
                  {range.map(bucket => (
                    <View key={bucket.key} style={styles.row}>
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
                <AppText style={styles.none}>{none}</AppText>
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
                          pressed && styles.pressed,
                        ]}
                      >
                        {/* runway-records 2차 card back: date · weekday, name · distance · time, pace. */}
                        <View style={styles.rowDay}>
                          <AppText
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            style={styles.rowDayNumber}
                          >
                            {formatDotDate(record.startedAt)}
                          </AppText>
                          <AppText style={styles.rowWeekday}>
                            {`${formatDotDateWeekday(record.startedAt).slice(
                              -1,
                            )}요일`}
                          </AppText>
                        </View>
                        <View style={styles.flex}>
                          <AppText numberOfLines={1} style={styles.rowTitle}>
                            {record.title}
                          </AppText>
                          <AppText style={styles.rowDate}>
                            {`${formatKm(
                              record.distanceM,
                            )}km · ${minutesSeconds(record.durationSec)}`}
                          </AppText>
                        </View>
                        <AppText style={styles.rowPace}>
                          {formatPace(record.averagePaceSecPerKm)}
                          <AppText style={styles.rowPaceUnit}>/km</AppText>
                        </AppText>
                      </Pressable>
                    ))}
                </View>
              )
            ) : (
              // A new period's figures fade in rather than swap at once (S15P31E105-478).
              <FadeIn appearKey={appearKey} style={styles.cardChart}>
                <PeriodFigures
                  buckets={period.buckets}
                  previousName={period.previousName}
                  previousDistanceM={period.previous?.totalDistanceM ?? null}
                  onSwipe={swipe}
                />
              </FadeIn>
            )}
            {view !== 'list' &&
            period.buckets.every(bucket => bucket.runCount === 0) ? (
              <AppText style={styles.none}>{none}</AppText>
            ) : null}
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  loading: { marginTop: 120 },
  none: {
    marginTop: 12,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: recordsLook.sub,
  },
  list: { marginTop: 14 },
  // The card back's rows, large enough to read at a glance (담당자 결정).
  row: {
    minHeight: 66,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: recordsLook.onCardLine,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 22,
    color: recordsLook.onCard,
  },
  rowDate: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: recordsLook.onCardSub,
  },
  // 10.15 on one line (S15P31E105-564: 좁아서 10.1 / 5로 끊기던 것).
  rowDay: { width: 64 },
  rowDayNumber: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: recordsLook.onCard,
  },
  rowWeekday: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.onCardMuted,
  },
  rowPace: {
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: recordsLook.onCard,
  },
  rowPaceUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    color: recordsLook.onCardSub,
  },
  rowMeta: {
    fontFamily: fontFamily.monoMedium,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.onCard,
  },
  // runway-records 2차 card: 16 from the sides like the tabs, the head chip and ↻ (no RUNWAY, 담당자 결정), a 22 title.
  card: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardChip: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  cardChipText: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.92)',
  },
  cardBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: {
    marginTop: 14,
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: recordsLook.onCard,
  },
  cardSub: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: recordsLook.onCardSub,
  },
  cardChart: { marginTop: 18 },
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
