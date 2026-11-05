import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { AppText, EmptyState } from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import {
  formatClockTime,
  formatDotDateWeekday,
  formatDuration,
  formatKm,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { HomeStackParamList } from '../../navigation/types';
import { fontFamily } from '../../theme';
import {
  glassCard,
  MonthPicker,
  recordsLook,
  RecordsShell,
  recordsFrame,
  usePickerTop,
  RoundGlassButton,
} from './look';
import { addDays, kstDay, kstMonth, mondayOf } from './parts';
import { RecordView } from './RecordView';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

// A swipe this far across the week strip moves a week.
const swipeDistance = 48;

// The newest day with a run in a month (ALL), or null.
async function newestDayIn(repositories: Repositories, month: string) {
  const { records } = await repositories.records.getMonth(month, 'ALL');
  return records[0] ? kstDay(records[0].startedAt) : null;
}

// The week's runs, newest first: one or two months of H01.
async function weekRuns(repositories: Repositories, monday: string) {
  const months = [...new Set([kstMonth(monday), kstMonth(addDays(monday, 6))])];
  const lists = await Promise.all(
    months.map(month => repositories.records.getMonth(month, 'ALL')),
  );
  // Each run once, even if two months' answers both carry it.
  const runs = new Map(
    lists.flatMap(list => list.records).map(record => [record.id, record]),
  );
  return [...runs.values()]
    .filter(record => {
      const day = kstDay(record.startedAt);
      return day >= monday && day <= addDays(monday, 6);
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function rowLabel(record: RunRecordSummary) {
  return `${record.title}, ${formatDotDateWeekday(
    record.startedAt,
  )} · ${formatDuration(record.durationSec)}, ${formatKm(record.distanceM)}km`;
}

// One day of the strip: weekday, date and a dot under a day with a run. The chosen day is a white tile.
function Day({
  day,
  weekday,
  hasRun,
  selected,
  disabled,
  onPress,
}: {
  day: string;
  weekday: string;
  hasRun: boolean;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${Number(day.slice(5, 7))}월 ${Number(
        day.slice(8),
      )}일`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.day, selected && styles.dayOn]}
    >
      <AppText
        style={[
          styles.weekday,
          selected && styles.weekdayOn,
          disabled && styles.future,
        ]}
      >
        {weekday}
      </AppText>
      <AppText
        style={[
          styles.date,
          selected && styles.dateOn,
          disabled && styles.future,
        ]}
      >
        {String(Number(day.slice(8)))}
      </AppText>
      <View style={[styles.dot, hasRun && styles.dotOn]} />
    </Pressable>
  );
}

// 5.1 내 기록 (runway-records): a week of days, then the chosen day's run on a glass card. A swipe across the
// week moves a week, and the calendar button opens the month picker. The card opens 5.2 (6.7 for a group
// run).
export function RecordsScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<HomeStackParamList, 'Records'>>();
  const pickerTop = usePickerTop();
  const { clock } = useRepositories();
  const today = kstDay(clock.now());
  const [day, setDay] = useState<string | null>(route.params?.day ?? null);
  const [runIndex, setRunIndex] = useState(0);
  const [picking, setPicking] = useState(false);
  const [pickerYear, setPickerYear] = useState(Number(today.slice(0, 4)));

  // Opened without a day: the newest day with a run (this month or the last), or today.
  const start = useResource(
    useCallback(
      async (repositories: Repositories) =>
        (await newestDayIn(repositories, kstMonth(today))) ??
        (await repositories.records.getRecent('recent', 1)).map(record =>
          kstDay(record.startedAt),
        )[0] ??
        today,
      [today],
    ),
  );
  const shown = day ?? (start.status === 'ready' ? start.data : null);
  const monday = shown ? mondayOf(shown) : null;

  const week = useResource(
    useCallback(
      async (repositories: Repositories) =>
        monday ? weekRuns(repositories, monday) : [],
      [monday],
    ),
  );
  const runs =
    week.status === 'ready' && shown
      ? week.data.filter(record => kstDay(record.startedAt) === shown)
      : [];
  const run = runs[Math.min(runIndex, runs.length - 1)] ?? null;
  const detail = useResource(
    useCallback(
      async (repositories: Repositories) =>
        run ? repositories.records.getDetail(run.id) : null,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [run?.id],
    ),
  );
  // A run deleted on 5.2 leaves the week (S15P31E105-394).
  const refreshWeek = week.refresh;
  useEffect(
    () =>
      onRecordsChanged(() => {
        void refreshWeek();
      }),
    [refreshWeek],
  );

  const marks = useResource(
    useCallback(
      async (repositories: Repositories) => {
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
      [pickerYear],
    ),
  );
  const choose = (next: string) => {
    setDay(next);
    setRunIndex(0);
  };
  const repositories = useRepositories();
  const pick = async (month: string) => {
    setPicking(false);
    const newest = await newestDayIn(repositories, month).catch(() => null);
    choose(newest ?? (month === kstMonth(today) ? today : `${month}-01`));
  };

  const touchX = useRef<number | null>(null);
  const swipe = (dx: number) => {
    if (!shown || !monday) {
      return;
    }
    const step = dx < 0 ? 7 : -7;
    const nextMonday = addDays(monday, step);
    if (nextMonday > mondayOf(today)) {
      return;
    }
    const next = addDays(shown, step);
    choose(next > today ? today : next);
  };

  const open = () => {
    if (!run) {
      return;
    }
    if (run.runType === 'GROUP') {
      navigateTo(navigation, 'GroupRunResult');
    } else {
      navigation.navigate('RecordDetail', { recordId: run.id });
    }
  };

  const days = monday
    ? weekdays.map((weekday, index) => ({
        weekday,
        day: addDays(monday, index),
      }))
    : [];
  const runDays = new Set(
    week.status === 'ready'
      ? week.data.map(record => kstDay(record.startedAt))
      : [],
  );

  return (
    <RecordsShell
      title="내 기록"
      onBack={() =>
        navigation.canGoBack()
          ? navigation.goBack()
          : navigateTo(navigation, 'Home')
      }
      right={
        <RoundGlassButton
          icon="calendar"
          label="월 선택"
          onPress={() => {
            setPickerYear(Number((shown ?? today).slice(0, 4)));
            setPicking(shownNow => !shownNow);
          }}
        />
      }
      tabs={
        <View
          style={[styles.week, glassCard]}
          onTouchStart={event => {
            touchX.current = event.nativeEvent.pageX;
          }}
          onTouchEnd={event => {
            const from = touchX.current;
            touchX.current = null;
            if (from !== null) {
              const dx = event.nativeEvent.pageX - from;
              if (Math.abs(dx) > swipeDistance) {
                swipe(dx);
              }
            }
          }}
        >
          {days.map(({ weekday, day: date }) => (
            <Day
              key={date}
              day={date}
              weekday={weekday}
              hasRun={runDays.has(date)}
              selected={date === shown}
              disabled={date > today}
              onPress={() => choose(date)}
            />
          ))}
        </View>
      }
      after={
        picking ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="월 선택 닫기"
              onPress={() => setPicking(false)}
              style={styles.scrim}
            />
            <MonthPicker
              year={pickerYear}
              selected={kstMonth(shown ?? today)}
              latest={kstMonth(today)}
              marked={marks.status === 'ready' ? marks.data : new Set()}
              onYear={setPickerYear}
              onPick={month => {
                pick(month).catch(() => undefined);
              }}
              style={{ ...styles.picker, top: pickerTop }}
            />
          </>
        ) : null
      }
    >
      <ScrollView
        contentContainerStyle={styles.card}
        showsVerticalScrollIndicator={false}
      >
        {start.status === 'error' || week.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="기록을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={() => {
              start.reload();
              week.reload();
            }}
          />
        ) : !shown || week.status !== 'ready' ? (
          <ActivityIndicator style={styles.loading} />
        ) : !run ? (
          <View style={styles.empty}>
            <AppText style={styles.emptyTitle}>
              이 날은 러닝 기록이 없어요
            </AppText>
            <AppText style={styles.emptyText}>
              점이 있는 날을 눌러 보세요
            </AppText>
          </View>
        ) : (
          <>
            {runs.length > 1 ? (
              // Two runs on one day: pick which one the card shows.
              <View style={styles.runs}>
                {runs.map((item, index) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={`${formatClockTime(
                      item.startedAt,
                    )} 러닝`}
                    accessibilityState={{ selected: item.id === run.id }}
                    onPress={() => setRunIndex(index)}
                    style={[
                      styles.runChip,
                      item.id === run.id && styles.runChipOn,
                    ]}
                  >
                    <AppText
                      style={[
                        styles.runChipText,
                        item.id === run.id && styles.runChipTextOn,
                      ]}
                    >
                      {`${formatClockTime(item.startedAt)} · ${formatKm(
                        item.distanceM,
                      )}km`}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {detail.status === 'ready' && detail.data ? (
              <RecordView
                key={detail.data.id}
                record={detail.data}
                chartHeight={300}
                onOpen={open}
                openLabel={rowLabel(run)}
              />
            ) : detail.status === 'error' ? (
              <EmptyState
                icon="alert"
                title="기록을 불러오지 못했어요"
                actionLabel="다시 시도"
                onAction={detail.reload}
              />
            ) : (
              <ActivityIndicator style={styles.loading} />
            )}
          </>
        )}
      </ScrollView>
    </RecordsShell>
  );
}

const styles = StyleSheet.create({
  week: {
    height: recordsFrame.tabsHeight,
    flexDirection: 'row',
    gap: 4,
    padding: 6,
    borderRadius: 20,
  },
  day: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dayOn: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    boxShadow:
      '0 4px 12px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
  },
  weekday: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.muted,
  },
  weekdayOn: { color: recordsLook.ink },
  date: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 20,
    color: recordsLook.sub,
  },
  dateOn: { fontFamily: fontFamily.bold, color: recordsLook.ink },
  future: { opacity: 0.45 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotOn: { backgroundColor: recordsLook.ink },
  card: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 22,
  },
  loading: { marginTop: 120 },
  empty: { marginTop: 150, alignItems: 'center', gap: 6 },
  emptyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: recordsLook.onCard,
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: recordsLook.onCardSub,
  },
  runs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  runChip: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  runChipOn: { backgroundColor: 'rgba(255,255,255,0.72)' },
  runChipText: {
    fontFamily: fontFamily.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCardSub,
  },
  runChipTextOn: { color: recordsLook.ink },
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
