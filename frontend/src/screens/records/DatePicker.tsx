import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import { AppText, Icon, useReduceMotion } from '../../components';
import { useRepositories } from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import { fontFamily } from '../../theme';
import { glassCard, recordsFrame, recordsLook } from './look';
import { addDays, kstDay, kstMonth, mondayOf, shiftMonth } from './parts';

// The date picker of 2.1 홈 and 5.1 내 기록 (S15P31E105-564, 담당자 레퍼런스): a week of days that swipes a week at a
// time, and a month calendar that swipes a month at a time. Both go back as far as `historyMonths` and stop at
// today; later days are dimmed and cannot be picked.

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
// How far back the week strip and the calendar go.
const historyMonths = 36;
// The week strip (담당자 시안 2026-11-10, S15P31E105-657): each day a tall capsule, deep navy on a day with a run,
// white on a day without, grey after today; the chosen day ringed. 80-high capsules with room for the ring (1.5 line,
// 2 gap) above and below, then the legend: recordsFrame.tabsHeight in all.
const dayHeight = 80;
const ringWidth = 1.5;
const ringGap = 2;
const stripPadding = ringWidth + ringGap;
const legendHeight = 26;
const dayLook = {
  // A day with a run deep navy, one without white (담당자 요청 2026-11-10).
  ran: '#03050D',
  rest: '#FFFFFF',
  // After today: the strip's grey (#A9AEB3 on the light page).
  later: 'rgba(2,5,14,0.26)',
  // The chosen day's ring: a thin line of the app's mint (담당자 요청 2026-11-10).
  ring: '#4DFFD2',
  onRan: '#FFFFFF',
  onRest: '#03050D',
  onLater: 'rgba(255,255,255,0.78)',
};

const monthNumber = (month: string) => Number(month.slice(5, 7));
const dayNumber = (day: string) => Number(day.slice(8));
const weekdayIndex = (day: string) =>
  (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

// 11월 9일 일요일
export function longDay(day: string) {
  return `${monthNumber(day)}월 ${dayNumber(day)}일 ${
    weekdays[weekdayIndex(day)]
  }요일`;
}

// The days with a run in the given months (H01 ALL), read once per month and again when a run is added or
// deleted. A month that does not load just has no dots.
export function useRunDays(months: string[]) {
  const { records } = useRepositories();
  const [byMonth, setByMonth] = useState<Record<string, string[]>>({});
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      onRecordsChanged(() => {
        setByMonth({});
        setVersion(value => value + 1);
      }),
    [],
  );
  const key = [...new Set(months)].sort().join(',');
  useEffect(() => {
    let active = true;
    const wanted = key ? key.split(',') : [];
    wanted.forEach(month => {
      records
        .getMonth(month, 'ALL')
        .then(list => {
          if (active) {
            setByMonth(current => ({
              ...current,
              [month]: list.records.map(record => kstDay(record.startedAt)),
            }));
          }
        })
        .catch(() => undefined);
    });
    return () => {
      active = false;
    };
  }, [key, records, version]);
  return useMemo(() => new Set(Object.values(byMonth).flat()), [byMonth]);
}

// One day of the strip (담당자 레퍼런스): the weekday over the date, flat on the screen, and a dot under a day with
// a run. The chosen day fills in navy (a short fade); a press darkens a day before it is chosen.
function Day({
  day,
  hasRun,
  selected,
  disabled,
  onPress,
}: {
  day: string;
  hasRun: boolean;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const on = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(on, {
      toValue: selected ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [on, selected]);
  const fill = disabled ? dayLook.later : hasRun ? dayLook.ran : dayLook.rest;
  const ink = disabled
    ? dayLook.onLater
    : hasRun
    ? dayLook.onRan
    : dayLook.onRest;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${monthNumber(day)}월 ${dayNumber(day)}일`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.dayBox}
    >
      {({ pressed }) => (
        <View style={styles.dayRoom}>
          {/* The chosen day's ring, 2 out from its capsule. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.ring, { opacity: on }]}
          />
          <View
            style={[
              styles.day,
              { backgroundColor: fill },
              pressed && styles.dayPressed,
            ]}
          >
            <AppText style={[styles.weekday, { color: ink }]}>
              {weekdays[weekdayIndex(day)]}
            </AppText>
            <AppText style={[styles.date, { color: ink }]}>
              {String(dayNumber(day))}
            </AppText>
          </View>
        </View>
      )}
    </Pressable>
  );
}

type TextStyle = React.ComponentProps<typeof AppText>['style'];

// A run of digits that rolls to its new value (담당자 요청: 글자는 그대로, 숫자만 바뀌는 모션): a larger number comes up
// from below and a smaller one down from above, the old one leaving the other way, inside its own line. The first
// value shows at once, and so does every value with 동작 줄이기.
// Each change mounts a fresh Roll with its own animated value, so the pair and the start of the roll reach the
// screen together; resetting one shared value could land a frame early and flash the old number.
function RollingNumber({
  value,
  up,
  style,
}: {
  value: string;
  // Which way the whole text moved, so every number in it rolls the same way.
  up: boolean;
  style: TextStyle;
}) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState({
    value,
    previous: value,
    up: true,
    turn: 0,
  });
  if (shown.value !== value) {
    setShown({
      value,
      previous: shown.value,
      up,
      turn: shown.turn + 1,
    });
  }
  return (
    <Roll
      key={shown.turn}
      value={shown.value}
      previous={shown.turn === 0 ? null : shown.previous}
      up={shown.up}
      still={reduce || shown.turn === 0}
      style={style}
    />
  );
}

function Roll({
  value,
  previous,
  up,
  still,
  style,
}: {
  value: string;
  previous: string | null;
  up: boolean;
  still: boolean;
  style: TextStyle;
}) {
  const line = StyleSheet.flatten(style)?.lineHeight ?? 20;
  const progress = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) {
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [still, progress]);
  const from = up ? line : -line;
  return (
    <View style={[styles.rolling, { height: line }]}>
      {previous !== null && !still ? (
        <Animated.View
          style={[
            styles.rollingOld,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              }),
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -from],
                  }),
                },
              ],
            },
          ]}
        >
          <AppText style={style}>{previous}</AppText>
        </Animated.View>
      ) : null}
      <Animated.View
        style={{
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [from, 0],
              }),
            },
          ],
        }}
      >
        <AppText style={style}>{value}</AppText>
      </Animated.View>
    </View>
  );
}

// The date line's text, where only the numbers move when it changes (RollingNumber); the words around them stay
// put. The whole text is laid down once, unseen, for its width and for screen readers; the moving copy lies over it
// and is hidden from them.
// Whether the numbers in `next` come after those in `previous`, read left to right as the date line writes them
// (year, month, day): the first number that differs decides.
function movesUp(previous: string, next: string) {
  const before = previous.match(/\d+/g)?.map(Number) ?? [];
  const after = next.match(/\d+/g)?.map(Number) ?? [];
  const index = after.findIndex((number, at) => number !== before[at]);
  return (
    index < 0 || before[index] === undefined || after[index] > before[index]
  );
}

export function MorphText({ text, style }: { text: string; style: TextStyle }) {
  const parts = text.split(/(\d+)/);
  // The month and the day turn the same way (담당자 요청): a later date comes up from below, an earlier one down
  // from above, even when 10월 31일 → 11월 1일 takes the day down.
  const [last, setLast] = useState({ text, up: true });
  if (last.text !== text) {
    setLast({ text, up: movesUp(last.text, text) });
  }
  return (
    <View>
      <AppText style={[style, styles.unseen]}>{text}</AppText>
      <View
        style={styles.morphParts}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {parts.map((part, index) =>
          /^\d+$/.test(part) ? (
            <RollingNumber
              key={index}
              value={part}
              up={last.up}
              style={style}
            />
          ) : part ? (
            <AppText key={index} style={style}>
              {part}
            </AppText>
          ) : null,
        )}
      </View>
    </View>
  );
}

// A horizontal pager of three pages, the one before, this one and the one after; a swipe turns to a neighbour and
// the pager comes back to the middle with the new pages, so it never runs out. A side with nothing there (before
// the history, after today) has no page.
function Pager({
  width,
  pageKey,
  hasPrevious,
  hasNext,
  renderPage,
  onTurn,
}: {
  width: number;
  // Changes when the middle page does, to come back to it.
  pageKey: string;
  hasPrevious: boolean;
  hasNext: boolean;
  renderPage: (offset: -1 | 0 | 1) => React.ReactNode;
  onTurn: (direction: -1 | 1) => void;
}) {
  const list = useRef<ScrollView>(null);
  const offsets: (-1 | 0 | 1)[] = [
    ...(hasPrevious ? [-1 as const] : []),
    0,
    ...(hasNext ? [1 as const] : []),
  ];
  const middle = hasPrevious ? width : 0;
  // Back to the middle once the new pages are in, and again a moment later: on Android the fling that turned the
  // page can still be settling and would leave the pager on a side page.
  useLayoutEffect(() => {
    list.current?.scrollTo({ x: middle, animated: false });
    const again = setTimeout(
      () => list.current?.scrollTo({ x: middle, animated: false }),
      120,
    );
    return () => clearTimeout(again);
  }, [pageKey, middle]);
  // Android can end one fling twice; the second end, before the pager is back in the middle, is the same turn.
  const turnedAt = useRef(0);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(
      event.nativeEvent.contentOffset.x / Math.max(width, 1),
    );
    const offset = offsets[Math.min(offsets.length - 1, Math.max(0, page))];
    if (offset !== -1 && offset !== 1) {
      return;
    }
    if (Date.now() - turnedAt.current > 400) {
      turnedAt.current = Date.now();
      onTurn(offset);
    } else {
      list.current?.scrollTo({ x: middle, animated: false });
    }
  };
  return (
    <ScrollView
      ref={list}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: middle, y: 0 }}
      onMomentumScrollEnd={settle}
    >
      {offsets.map(offset => (
        <View key={offset} style={{ width }}>
          {renderPage(offset)}
        </View>
      ))}
    </ScrollView>
  );
}

// The week strip: swipe for the week before (or after, up to this week). A swipe keeps the weekday, so 월 9일
// goes to 월 2일; a day after today becomes today.
export function WeekStrip({
  value,
  today,
  onChange,
  style,
}: {
  value: string;
  today: string;
  onChange: (day: string) => void;
  style?: ViewStyle;
}) {
  const { width: screen } = useWindowDimensions();
  // The strip spans the screen less the frame's 16 sides until it measures itself.
  const [width, setWidth] = useState(screen - recordsFrame.side * 2 - 2);
  const monday = mondayOf(value);
  const first = mondayOf(`${shiftMonth(kstMonth(today), -historyMonths)}-01`);
  const runDays = useRunDays([
    kstMonth(addDays(monday, -7)),
    kstMonth(monday),
    kstMonth(addDays(monday, 13)),
  ]);
  const turn = (direction: -1 | 1) => {
    const next = addDays(value, direction * 7);
    onChange(next > today ? today : next);
  };
  return (
    <View style={style}>
      <View
        style={styles.strip}
        onLayout={event => {
          const measured = Math.round(event.nativeEvent.layout.width) - 2;
          if (measured > 0 && measured !== width) {
            setWidth(measured);
          }
        }}
      >
        <Pager
          width={width}
          pageKey={monday}
          hasPrevious={monday > first}
          hasNext={monday < mondayOf(today)}
          onTurn={turn}
          renderPage={offset => {
            const start = addDays(monday, offset * 7);
            return (
              <View style={styles.week}>
                {weekdays.map((_, index) => {
                  const day = addDays(start, index);
                  return (
                    <Day
                      key={day}
                      day={day}
                      hasRun={runDays.has(day)}
                      selected={day === value}
                      disabled={day > today}
                      onPress={() => onChange(day)}
                    />
                  );
                })}
              </View>
            );
          }}
        />
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: dayLook.ran }]} />
          <AppText style={styles.legendText}>러닝한 날</AppText>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendDot,
              styles.legendDotLight,
              { backgroundColor: dayLook.rest },
            ]}
          />
          <AppText style={styles.legendText}>러닝 안 한 날</AppText>
        </View>
      </View>
    </View>
  );
}

// One month as calendar rows, Monday first, always six rows so the panel keeps its height.
function monthCells(month: string) {
  const first = `${month}-01`;
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, offset) => addDays(start, offset));
}

const cellHeight = 40;

// The calendar (담당자 레퍼런스): the month before · this month · the month after as chips, the weekday row, then the
// month's days. Swipe or tap a chip for another month; a day picks it. Days with a run have a dot, today is bold,
// the chosen day is navy, later days are dimmed.
export function CalendarPanel({
  value,
  today,
  onPick,
  onMonthChange,
  flat = false,
  style,
}: {
  value: string;
  today: string;
  onPick: (day: string) => void;
  // The month on show, for a title that follows it.
  onMonthChange?: (month: string) => void;
  // 2.1: laid flat on the light sheet that covers the screen, with taller rows (담당자 레퍼런스); 5.1 keeps the
  // glass panel over its card.
  flat?: boolean;
  style?: ViewStyle;
}) {
  const { width: screen } = useWindowDimensions();
  // The grid spans the panel less its 14 sides until it measures itself.
  const [width, setWidth] = useState(
    screen - recordsFrame.side * 2 - (flat ? 0 : 30),
  );
  const latest = kstMonth(today);
  const earliest = shiftMonth(latest, -historyMonths);
  const [month, setMonth] = useState(kstMonth(value));
  const runDays = useRunDays([
    shiftMonth(month, -1),
    month,
    shiftMonth(month, 1),
  ]);
  const report = useRef(onMonthChange);
  report.current = onMonthChange;
  useEffect(() => {
    report.current?.(month);
  }, [month]);
  // Every month the calendar can show, and the next one dimmed, in a row that scrolls sideways three at a time
  // (담당자 요청); the month on show sits in the middle.
  const chips = useMemo(() => {
    const all: string[] = [];
    for (
      let chip = earliest;
      chip <= shiftMonth(latest, 1);
      chip = shiftMonth(chip, 1)
    ) {
      all.push(chip);
    }
    return all;
  }, [earliest, latest]);
  const chipGap = 8;
  const chipWidth = Math.max(0, (width - chipGap * 2) / 3);
  const chipRow = useRef<ScrollView>(null);
  const chipX = (chip: string) =>
    Math.max(0, (chips.indexOf(chip) - 1) * (chipWidth + chipGap));
  const placed = useRef(false);
  useEffect(() => {
    if (chipWidth > 0) {
      chipRow.current?.scrollTo({ x: chipX(month), animated: placed.current });
      placed.current = true;
    }
    // chipX reads chips and chipWidth, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, chipWidth, chips]);
  const grid = (shown: string) => (
    <View style={styles.grid}>
      {monthCells(shown).map(day => {
        if (kstMonth(day) !== shown) {
          return (
            <View key={day} style={[styles.cell, flat && styles.cellTall]} />
          );
        }
        const future = day > today;
        const selected = day === value;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityLabel={`${monthNumber(day)}월 ${dayNumber(
              day,
            )}일 선택`}
            accessibilityState={{ selected, disabled: future }}
            disabled={future}
            onPress={() => onPick(day)}
            style={[styles.cell, flat && styles.cellTall]}
          >
            <View style={[styles.cellDay, selected && styles.cellOn]}>
              <AppText
                style={[
                  styles.cellText,
                  day === today && styles.cellToday,
                  selected && styles.cellTextOn,
                  future && styles.future,
                ]}
              >
                {String(dayNumber(day))}
              </AppText>
            </View>
            <View style={[styles.dot, runDays.has(day) && styles.dotOn]} />
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <View style={[flat ? styles.flatPanel : styles.panel, style]}>
      <ScrollView
        ref={chipRow}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: chipX(month), y: 0 }}
        contentContainerStyle={styles.chips}
      >
        {chips.map(chip => {
          const unavailable = chip > latest || chip < earliest;
          const selected = chip === month;
          return (
            <Pressable
              key={chip}
              accessibilityRole="button"
              accessibilityLabel={`${Number(chip.slice(0, 4))}년 ${monthNumber(
                chip,
              )}월`}
              accessibilityState={{ selected, disabled: unavailable }}
              disabled={unavailable || selected}
              onPress={() => setMonth(chip)}
              style={[
                styles.chip,
                { width: chipWidth },
                flat && styles.chipFlat,
                selected && styles.chipOn,
              ]}
            >
              <AppText
                style={[
                  styles.chipText,
                  selected && styles.chipTextOn,
                  unavailable && styles.future,
                ]}
              >
                {`${monthNumber(chip)}월`}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.weekdays}>
        {weekdays.map(weekday => (
          <AppText key={weekday} style={styles.weekdayHead}>
            {weekday}
          </AppText>
        ))}
      </View>
      <View
        onLayout={event => {
          const measured = Math.round(event.nativeEvent.layout.width);
          if (measured > 0 && measured !== width) {
            setWidth(measured);
          }
        }}
      >
        <Pager
          width={width}
          pageKey={month}
          hasPrevious={month > earliest}
          hasNext={month < latest}
          onTurn={direction => setMonth(shiftMonth(month, direction))}
          renderPage={offset => grid(shiftMonth(month, offset))}
        />
      </View>
    </View>
  );
}

// 2.1's date line over the week strip: 11월 9일 일요일 ⌄, or 2026년 11월 ⌃ with the calendar open. Tapping it opens
// or closes the calendar (레퍼런스의 Today ⌄).
export function DateLine({
  value,
  open,
  month,
  onToggle,
}: {
  value: string;
  open: boolean;
  month: string;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? '달력 닫기' : '달력 열기'}
      accessibilityHint={longDay(value)}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      onPress={onToggle}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
    >
      <MorphText
        style={styles.lineText}
        text={
          open
            ? `${Number(month.slice(0, 4))}년 ${monthNumber(month)}월`
            : longDay(value)
        }
      />
      <View style={[styles.lineIcon, open && styles.lineIconOpen]}>
        <Icon name="chevronDown" color={recordsLook.ink} size={14} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  unseen: { opacity: 0 },
  morphParts: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rolling: { overflow: 'hidden' },
  rollingOld: { position: 'absolute', left: 0, top: 0 },
  strip: {
    height: recordsFrame.tabsHeight - legendHeight,
    overflow: 'hidden',
  },
  week: {
    flexDirection: 'row',
    gap: 2,
  },
  dayBox: { flex: 1 },
  // Room round the capsule for the ring.
  dayRoom: { padding: stripPadding },
  ring: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
    borderWidth: ringWidth,
    borderColor: dayLook.ring,
  },
  day: {
    height: dayHeight,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dayPressed: { opacity: 0.8 },
  weekday: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
  },
  date: {
    fontFamily: fontFamily.numberBold,
    fontSize: 24,
    lineHeight: 28,
  },
  // The calendar's later days and run dots.
  future: { opacity: 0.4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotOn: { backgroundColor: recordsLook.ink },
  legend: {
    height: legendHeight,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
    paddingLeft: stripPadding,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  // The white dot keeps a faint edge on the light page.
  legendDotLight: { borderWidth: 1, borderColor: 'rgba(2,5,14,0.12)' },
  legendText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.muted,
  },
  panel: {
    ...glassCard,
    borderRadius: 26,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,5,14,0.05)',
  },
  chipFlat: { backgroundColor: 'rgba(2,5,14,0.06)' },
  chipOn: { backgroundColor: recordsLook.ink },
  flatPanel: { gap: 14, paddingTop: 4 },
  cellTall: { height: 54 },
  chipText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: recordsLook.sub,
  },
  chipTextOn: { color: '#FFFFFF' },
  weekdays: { flexDirection: 'row' },
  weekdayHead: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    color: recordsLook.muted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    height: cellHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  cellDay: {
    width: 32,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellOn: { backgroundColor: recordsLook.ink },
  cellText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 19,
    color: recordsLook.ink,
  },
  cellToday: { fontFamily: fontFamily.bold },
  cellTextOn: { color: '#FFFFFF', fontFamily: fontFamily.bold },
  line: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  pressed: { opacity: 0.7 },
  lineText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: recordsLook.ink,
  },
  lineIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  lineIconOpen: { transform: [{ rotate: '180deg' }] },
});
