import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { RouteStroke } from '../../components/RouteStroke';
import {
  StackActions,
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  BottomSheet,
  EmptyState,
  Icon,
  type IconName,
  PressableScale,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type GroupRunDetail,
  type Repositories,
  type SavedCourse,
} from '../../data';
import { formatDotDateWeekday, formatKm, formatPace } from '../../format';
import { RulerPicker } from '../../components/RulerPicker';
import { navigateTo } from '../../navigation/navigateTo';
import { formatGoalDuration } from '../run/goal/runGoal';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, size, spacing, ThemeProvider } from '../../theme';
import { groupTone, NightBackground, NumText } from './look';
import { BottomFade, useGroupRunDraft } from './parts';
import {
  dayAfter,
  kstOffsetMs,
  scheduleDays,
  scheduleProblem,
  scheduleProblemText,
  timesOn as timesOnDay,
} from './groupRunSchedule';
import { groupRunValidationText } from './groupRunErrors';
import { BackButton } from '../../components/BackButton';
import {
  ColorBar,
  crewColor,
  stand,
  StandButton,
  StandHeader,
  standType,
  UnderlineTabs,
} from './stand';

type Mode = 'COURSE' | 'FREE';

const modes: { value: Mode; label: string }[] = [
  { value: 'COURSE', label: '코스 러닝' },
  { value: 'FREE', label: '자유 러닝' },
];
// 목표 시간 and a free run's 거리 on rulers like 3.1's (S15P31E105-696): 5–180 minutes, and C01's 1–21.1km.
const goalLimits = { min: 5, max: 180 };
const freeKmLimits = { min: 1, max: 21.1 };
const clampMinutes = (value: number) =>
  Math.min(goalLimits.max, Math.max(goalLimits.min, Math.round(value)));
const fallbackShape: [number, number][] = [
  [0.1, 0.6],
  [0.5, 0.3],
  [0.9, 0.5],
];
const pad = (value: number) => String(value).padStart(2, '0');
const timeLabel = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  return `${hours < 12 ? '오전' : '오후'} ${pad(
    hours % 12 === 0 ? 12 : hours % 12,
  )}:${pad(minutes % 60)}`;
};
// A route as the 0–1 outline the course thumbnails draw (y grows downward).
function outlineOf(route: [number, number][]): [number, number][] {
  const xs = route.map(point => point[0]);
  const ys = route.map(point => point[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-6);
  return route.map(([x, y]) => [
    0.1 + ((x - minX) / span) * 0.8,
    0.9 - ((y - minY) / span) * 0.8,
  ]);
}

const loadOptions = (repositories: Repositories) =>
  Promise.all([
    repositories.groupRuns.listMine(),
    repositories.courses.getSaved(),
    repositories.courses.getTodayPlan(),
    repositories.groupRuns.searchPlaces(''),
  ]);

// A 6.8 part's title in mint with an optional note on its right (그룹런 시안, S15P31E105-673).
function Label({ title, note }: { title: string; note?: string }) {
  return (
    <View style={styles.label}>
      <AppText
        style={[standType.label, styles.flex]}
        accessibilityRole="header"
      >
        {title}
      </AppText>
      {note ? <AppText style={styles.note}>{note}</AppText> : null}
    </View>
  );
}

// 코스 러닝 · 자유 러닝 (S15P31E105-594 담당자 시안): a full-width quiet track, halved, with the picked half white and
// its text navy, as the home's white buttons (담당자 요청: 민트는 작은 칩에만).
function ModeSwitch({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
}) {
  // Words on a line, the picked one bold over a mint line (그룹런 시안).
  return (
    <UnderlineTabs
      items={modes.map(option => ({ key: option.value, label: option.label }))}
      active={value}
      onSelect={onChange}
    />
  );
}

// The course's outline as the mockup's larger tile (S15P31E105-594 담당자 시안): the route in mint from a filled
// start dot to an open end ring on a faint tile inside the card, which reads well on the navy. Only the saved shape is drawn, with no map under
// it, since a course carries no map image of its own.
function CourseThumb({ shape }: { shape: [number, number][] }) {
  const points = shape.map(([x, y]) => [6 + x * 60, 6 + y * 34] as const);
  const first = points[0];
  const last = points[points.length - 1];
  // The outline in mint on the bare page with small square ends (그룹런 시안).
  return (
    <View style={styles.thumb}>
      <Svg width={72} height={46}>
        <RouteStroke
          points={points.map(point => point.join(',')).join(' ')}
          scale={0.3}
        />
        {first ? (
          <Rect
            x={first[0] - 3.5}
            y={first[1] - 3.5}
            width={7}
            height={7}
            fill={stand.mint}
          />
        ) : null}
        {last ? (
          <Rect
            x={last[0] - 3.5}
            y={last[1] - 3.5}
            width={7}
            height={7}
            fill={stand.page}
            stroke={stand.text}
            strokeWidth={1.6}
          />
        ) : null}
      </Svg>
    </View>
  );
}

// A ruler that keeps its own value while it is dragged and gives it to 6.8 once the drag rests, so the whole form
// does not redraw on every tick (S15P31E105-696: the drag stuttered). Given paceOverM, the value is minutes and
// the goal pace over that distance follows the moving value.
const settleMs = 150;
function SettledRuler({
  label,
  value,
  min,
  max,
  step,
  format,
  onSettle,
  paceOverM,
  live,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onSettle: (value: number) => void;
  paceOverM?: number | null;
  // Holds the value as it moves, so 그룹런 만들기 pressed before the drag rests saves what the ruler shows.
  live?: React.MutableRefObject<number>;
}) {
  const [shown, setShown] = useState(value);
  // The value last given to 6.8; a different one coming back was set from outside (a recommended course).
  const given = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (value !== given.current) {
      given.current = value;
      setShown(value);
    }
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );
  const change = (next: number) => {
    setShown(next);
    if (live) {
      live.current = next;
    }
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      given.current = next;
      onSettle(next);
    }, settleMs);
  };
  return (
    <>
      <RulerPicker
        compact
        label={label}
        value={shown}
        min={min}
        max={max}
        step={step}
        format={format}
        onChange={change}
        color={stand.text}
        mutedColor={stand.line}
      />
      {paceOverM !== undefined ? (
        <View style={styles.paceRow}>
          <AppText style={styles.rowDetail}>목표 페이스</AppText>
          <NumText
            text={
              paceOverM && paceOverM > 0
                ? `${formatPace((shown * 60) / (paceOverM / 1000))}/km`
                : '– –'
            }
            style={styles.paceValue}
          />
        </View>
      ) : null}
    </>
  );
}

// 변경 stays a bold text button (6.8-CourseCard), with the mockup's chevron after it (S15P31E105-594 담당자 시안).
function ChangeButton({
  label,
  text = '변경',
  onPress,
  disabled = false,
}: {
  label: string;
  text?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={styles.change}
    >
      <AppText style={styles.changeText}>{text}</AppText>
      <Icon name="forward" color={stand.text} size={16} />
    </Pressable>
  );
}

// 날짜 · 시간 (S15P31E105-594 담당자 시안): a faint field with a faint rim, its icon first, the value in Archivo
// digits and a chevron at the end.
function PickField({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.flex}
    >
      <View style={styles.pick}>
        <Icon name={icon} color={stand.sub} size={18} />
        <NumText text={label} style={styles.pickLabel} numberOfLines={1} />
        <Icon name="chevronDown" color={stand.text} size={18} />
      </View>
    </PressableScale>
  );
}

// A picker sheet's choice as a chip (S15P31E105-594 담당자 시안, 2. 날짜·시간 선택): mint with navy text when picked,
// otherwise faint with white text, as 6.8's minute chips.
function SheetChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.flex}
    >
      <View style={[styles.sheetChip, selected && styles.sheetChipOn]}>
        <NumText
          text={label}
          style={selected ? styles.sheetChipTextOn : styles.sheetChipText}
          numberOfLines={1}
        />
      </View>
    </PressableScale>
  );
}

// The chips three to a row; the last row is padded so its chips keep the same width.
function ChipGrid<T>({
  items,
  render,
}: {
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 3) {
    rows.push(items.slice(index, index + 3));
  }
  return (
    <View style={styles.grid}>
      {rows.map((row, index) => (
        <View key={index} style={styles.gridRow}>
          {row.map(render)}
          {Array.from({ length: 3 - row.length }, (_, gap) => (
            <View key={`gap${gap}`} style={styles.flex} />
          ))}
        </View>
      ))}
    </View>
  );
}

// 6.8 그룹런 만들기: course or free run, meeting place (6.9), date and time. The shared pace is estimated, not typed.
// Opened from 6.4 with a groupRunId, the same form edits that run (G04).
export function GroupRunCreateScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunCreate'>>();
  const editingId = route.params?.groupRunId;
  const { groupRuns, courses, clock } = useRepositories();
  // The saved courses read again after a recommendation was stored, so 코스 고르기 lists it (S15P31E105-696).
  const [savedAgain, setSavedAgain] = useState<SavedCourse[] | null>(null);
  const toast = useToast();
  const { draft, setPlace, setPickingCourse, setPicked, changed } =
    useGroupRunDraft();
  const options = useResource(useCallback(loadOptions, []));
  const editing = useResource(
    useCallback(
      (repositories: Repositories) =>
        editingId
          ? repositories.groupRuns.get(editingId)
          : Promise.resolve(null),
      [editingId],
    ),
  );
  const edited: GroupRunDetail | null =
    editing.status === 'ready' ? editing.data : null;
  const [filled, setFilled] = useState(false);
  const [mode, setMode] = useState<Mode>('COURSE');
  const [course, setCourse] = useState<{
    id: string;
    name: string;
    distanceM: number;
    shape: [number, number][];
  } | null>(null);
  const [minutes, setMinutes] = useState(40);
  // A free run's distance (S15P31E105-696); a course run uses the course's.
  const [freeKm, setFreeKm] = useState(5);
  // A course picked on 3.1b brings its finish time, which stays as searched until the course is changed
  // (S15P31E105-696). The meeting place stays free.
  const [locked, setLocked] = useState(false);
  // The rulers' values as they move, ahead of the state they settle into.
  const liveMinutes = useRef(minutes);
  const liveFreeKm = useRef(freeKm);
  useEffect(() => {
    liveMinutes.current = minutes;
  }, [minutes]);
  useEffect(() => {
    liveFreeKm.current = freeKm;
  }, [freeKm]);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState(7 * 60);
  const [sheet, setSheet] = useState<'course' | 'day' | 'time' | null>(null);
  const [saving, setSaving] = useState(false);

  // Leaving create/edit without saving must not reuse the previous meeting place
  // on the next open. MeetingPlace is pushed on top, so beforeRemove (not blur)
  // is the abandon signal; successful save already clears place first (S15P31E105-637).
  useEffect(() => {
    const stop = navigation.addListener('beforeRemove', () => {
      setPlace(null);
      // Leaving 6.8 for good also ends a recommendation asked for it, so 3.1b runs its own course again
      // (S15P31E105-696).
      setPickingCourse(false);
      setPicked(null);
    });
    return stop;
  }, [navigation, setPicked, setPickingCourse, setPlace]);

  const ready = options.status === 'ready' ? options.data : null;
  const [mine, savedFirst, plan, places] = ready ?? [];
  const saved = savedAgain ?? savedFirst;
  const crew =
    mine?.crews.find(item => item.crew.id === route.params?.crewId)?.crew ??
    mine?.crews.find(item => item.crew.membership === 'MEMBER')?.crew;
  // The clock is read again every half minute, so a start time that passes while the form is open, or a new day,
  // is noticed instead of being sent to the server (S15P31E105-798).
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(value => value + 1), 30000);
    return () => clearInterval(interval);
  }, []);
  const now = clock.now();
  const timesOn = (value: string | null) => timesOnDay(value, now);
  const days = scheduleDays(now);
  // An edited run keeps its own time as it is: the server checks the schedule only when it changes (779).
  const keptFromEdit =
    edited !== null &&
    Date.parse(edited.scheduledAt) ===
      Date.parse(
        `${day}T${pad(Math.floor(time / 60))}:${pad(time % 60)}:00+09:00`,
      );
  const problem = keptFromEdit ? null : scheduleProblem(day, time, now);
  const passed = problem !== null;
  // The goal's distance: the course's, or the free run's ruler.
  const goalDistanceM =
    mode === 'COURSE' ? course?.distanceM ?? null : Math.round(freeKm * 1000);

  // Back from 6.4 or 3.1: no recommendation is being asked for 6.8 any more.
  useFocusEffect(
    useCallback(() => {
      setPickingCourse(false);
    }, [setPickingCourse]),
  );
  // A course picked on 3.1b: its course and finish time (locked as searched), and its start for an empty
  // meeting place.
  useEffect(() => {
    const pick = draft.picked;
    if (!pick) {
      return;
    }
    setMode('COURSE');
    setCourse({
      id: pick.course.id,
      name: pick.course.name,
      distanceM: pick.course.distanceM,
      shape:
        pick.course.route.length > 1
          ? outlineOf(pick.course.route)
          : fallbackShape,
    });
    setMinutes(clampMinutes(pick.minutes));
    // The meeting place need not be the course's start: the start only fills an empty one, and it stays
    // free to change (담당자 결정, S15P31E105-696).
    if (!draft.place) {
      setPlace(pick.place);
    }
    setLocked(true);
    setPicked(null);
    courses.getSaved().then(setSavedAgain, () => undefined);
  }, [courses, draft.picked, draft.place, setPicked, setPlace]);
  const askRecommendation = () => {
    setSheet(null);
    setPickingCourse(true);
    navigateTo(navigation, 'TodayRun');
  };
  const changeMode = (next: Mode) => {
    setMode(next);
    // A free run has no course, so nothing stays locked to one.
    if (next === 'FREE') {
      setLocked(false);
    }
  };

  // Editing starts from the run as it is: its course or minutes, place, day and time (KST).
  useEffect(() => {
    if (!edited || !ready || filled) {
      return;
    }
    const at = new Date(Date.parse(edited.scheduledAt) + kstOffsetMs);
    setMode(edited.courseId ? 'COURSE' : 'FREE');
    setCourse(
      edited.courseId
        ? {
            id: edited.courseId,
            name: edited.courseName ?? '',
            distanceM: edited.targetDistanceM ?? 0,
            shape:
              saved?.find(item => item.id === edited.courseId)?.shape ??
              (edited.route && edited.route.length > 1
                ? outlineOf(edited.route)
                : [
                    [0.1, 0.6],
                    [0.5, 0.3],
                    [0.9, 0.5],
                  ]),
          }
        : null,
    );
    if (edited.targetDurationSec) {
      setMinutes(clampMinutes(edited.targetDurationSec / 60));
    }
    if (!edited.courseId && edited.targetDistanceM) {
      setFreeKm(
        Math.min(
          freeKmLimits.max,
          Math.max(freeKmLimits.min, edited.targetDistanceM / 1000),
        ),
      );
    }
    setPlace({
      name: edited.meetingPlaceName,
      address: edited.meetingAddress,
      position: edited.meetingPosition,
      distanceM: 0,
      note: null,
    });
    setDay(at.toISOString().slice(0, 10));
    setTime(at.getUTCHours() * 60 + at.getUTCMinutes());
    setFilled(true);
  }, [edited, filled, ready, saved, setPlace]);

  // Defaults: today's course, the nearest meeting place and the coming Saturday. A course just picked on 3.1b is
  // applied by the effect above in the same commit, so the defaults wait for it rather than read the old empty
  // course and overwrite it (S15P31E105-696).
  useEffect(() => {
    if (!ready || (editingId && !filled) || draft.picked) {
      return;
    }
    if (!course) {
      const today = saved?.find(item => item.id === plan?.courseId);
      setCourse(
        // Today's course stands in unless it is private (a free run's), which a group run cannot use.
        plan && !today?.isPrivate
          ? {
              id: plan.courseId,
              name: plan.name,
              distanceM: plan.distanceM,
              shape: today?.shape ?? [
                [0.1, 0.6],
                [0.5, 0.3],
                [0.9, 0.5],
              ],
            }
          : null,
      );
    }
    if (!draft.place && places?.[0]) {
      setPlace({ ...places[0], note: null });
    }
    if (!day) {
      const weekday = new Date(now.getTime() + kstOffsetMs).getUTCDay();
      setDay(dayAfter(now, (6 - weekday + 7) % 7 || 7));
    }
  }, [
    course,
    day,
    draft.picked,
    draft.place,
    editingId,
    filled,
    now,
    places,
    plan,
    ready,
    saved,
    setPlace,
  ]);

  const chooseCourse = (item: SavedCourse) => {
    // SYS-002: only ACTIVE saved courses may start a new group run, and no private one (S15P31E105-696).
    if (
      item.status === 'MERGED' ||
      item.status === 'BLOCKED' ||
      item.isPrivate
    ) {
      return;
    }
    setCourse({
      id: item.id,
      name: item.myAlias ?? item.name,
      distanceM: item.distanceM,
      shape: item.shape,
    });
    // Another course frees the finish time and place a recommendation set.
    setLocked(false);
    setSheet(null);
  };

  const create = async () => {
    if ((!crew && !edited) || !draft.place || !day) {
      return;
    }
    // The clock again at the tap: a start time can pass between two ticks (S15P31E105-798).
    const late = keptFromEdit ? null : scheduleProblem(day, time, clock.now());
    if (late) {
      toast(scheduleProblemText[late]);
      setTick(value => value + 1);
      return;
    }
    setSaving(true);
    const run = {
      courseId: mode === 'COURSE' ? course?.id ?? null : null,
      meetingPlaceName: draft.place.name,
      meetingAddress: draft.place.address,
      meetingPosition: draft.place.position,
      meetingNote: draft.place.note,
      scheduledAt: `${day}T${pad(Math.floor(time / 60))}:${pad(
        time % 60,
      )}:00+09:00`,
      // Both modes send a TIME goal: the course's distance, or the free run's (S15P31E105-696).
      targetDistanceM:
        mode === 'COURSE'
          ? course?.distanceM ?? null
          : Math.round(liveFreeKm.current * 1000),
      targetDurationSec: liveMinutes.current * 60,
    };
    try {
      if (edited) {
        await groupRuns.update(edited.id, run);
        setPlace(null);
        changed();
        toast('그룹런을 수정했어요');
        navigation.goBack();
        return;
      }
      const { id } = await groupRuns.create({ ...run, crewId: crew!.id });
      setPlace(null);
      changed();
      navigation.dispatch(
        StackActions.replace('GroupRunDetail', { groupRunId: id }),
      );
    } catch (error) {
      toast(
        errorCode(error) === 'INVALID_GOAL'
          ? '목표 시간을 저장하지 못했어요. 코스와 시간을 확인해 주세요'
          : // A course the server will not take for a group run: private (a free run's), merged or blocked, all
          // answered alike, so the notice does not guess which (S15P31E105-696 review B-1).
          errorCode(error) === 'COURSE_INACCESSIBLE'
          ? '이 코스는 그룹런에 쓸 수 없어요. 다른 코스를 골라 주세요'
          : // 400 VALIDATION_ERROR: the schedule window (S15P31E105-779) or a text that is too long. The answer names
          // the input the server pointed at instead of always blaming the date and time (S15P31E105-818).
          errorCode(error) === 'VALIDATION_ERROR'
          ? groupRunValidationText(error)
          : !edited
          ? '그룹런을 만들지 못했어요. 잠시 후 다시 시도해 주세요'
          : errorCode(error) === 'EDIT_NOT_ALLOWED'
          ? '출발 전 그룹런만 수정할 수 있어요'
          : '그룹런을 수정하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
      setSaving(false);
    }
  };

  const crewName = (edited ? edited.crewName : crew?.name) ?? '';
  const crewId = edited ? edited.crewId : crew?.id;

  if (options.status !== 'ready' || (editingId && editing.status !== 'ready')) {
    return (
      <ThemeProvider tone="dark">
        <View style={styles.root}>
          <NightBackground />
          <StatusBar barStyle="light-content" />
          <SafeAreaView edges={['top']}>
            <View style={styles.header}>
              <BackButton tone="dark" onPress={() => navigation.goBack()} />
              <AppText style={styles.title} accessibilityRole="header">
                {editingId ? '그룹런 수정' : '그룹런 만들기'}
              </AppText>
            </View>
          </SafeAreaView>
          <SafeAreaView edges={['bottom']} style={styles.flex}>
            {options.status === 'error' || editing.status === 'error' ? (
              <EmptyState
                icon="alert"
                title="그룹런 작성 정보를 불러오지 못했어요"
                actionLabel="다시 시도"
                onAction={() => {
                  if (options.status === 'error') {
                    options.reload();
                  }
                  if (editing.status === 'error') {
                    editing.reload();
                  }
                }}
              />
            ) : (
              <ActivityIndicator color={groupTone.sub} style={styles.loading} />
            )}
          </SafeAreaView>
        </View>
      </ThemeProvider>
    );
  }

  return (
    // S15P31E105-594 담당자 시안 in the home's tone (담당자 결정: 진한 네이비 배경): faint white cards on the navy page,
    // white text, a white main button and mint only on the small picked chips.
    <View style={styles.root}>
      <NightBackground />
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.top}>
        <StandHeader
          title={editingId ? '그룹런 수정' : '그룹런 만들기'}
          onBack={() => navigation.goBack()}
          dim={sheet !== null}
        />
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        {/* The crew as the top row over a heavier line, with its colour bar. It only names the crew, so it has no
            chevron and no press. */}
        {crewName ? (
          <View style={styles.crewCard}>
            <View style={styles.iconCell}>
              <Icon name="users" color={stand.sub} size={18} />
            </View>
            <AppText style={styles.crew} numberOfLines={1}>
              {crewName}
            </AppText>
            {crewId ? (
              <ColorBar
                color={crewColor(crewId)}
                height={14}
                style={styles.crewBar}
              />
            ) : null}
          </View>
        ) : null}
        <Label title="코스" />
        <ModeSwitch value={mode} onChange={changeMode} />
        {mode === 'COURSE' ? (
          // Without a course yet the card asks for one (S15P31E105-637).
          <View style={[styles.card, styles.courseCard]}>
            {course ? (
              <CourseThumb shape={course.shape} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Icon name="route" color={stand.sub} size={22} />
              </View>
            )}
            <View style={styles.flex}>
              <AppText
                style={course ? styles.courseName : styles.rowTitle}
                numberOfLines={1}
              >
                {course?.name ?? '코스 선택'}
              </AppText>
              {course ? (
                <AppText style={styles.km}>
                  {`${formatKm(course.distanceM, 1)}km`}
                </AppText>
              ) : (
                <AppText style={styles.courseHint}>
                  저장한 코스나 코스 추천에서 골라 주세요
                </AppText>
              )}
            </View>
            <View style={styles.changeSide}>
              <ChangeButton
                label={course ? '코스 변경' : '코스 고르기'}
                text={course ? '변경' : '고르기'}
                onPress={() => setSheet('course')}
              />
            </View>
          </View>
        ) : (
          // A free run picks its distance instead of a course (S15P31E105-696).
          <View style={[styles.card, styles.rulerCard]}>
            <SettledRuler
              label="목표 거리"
              value={freeKm}
              min={freeKmLimits.min}
              max={freeKmLimits.max}
              step={0.5}
              format={value => `${value.toFixed(1)}km`}
              onSettle={setFreeKm}
              live={liveFreeKm}
            />
          </View>
        )}
        {/* Both modes send a TIME goal: the finish time on a ruler as on 3.1, with the pace it means for the
            course's or the free run's distance (S15P31E105-696). Set by a recommended course, it stays as searched. */}
        <Label
          title="목표 시간"
          note={locked ? '코스 추천 조건으로 정했어요' : undefined}
        />
        <View
          style={[styles.card, styles.rulerCard, locked && styles.locked]}
          pointerEvents={locked ? 'none' : 'auto'}
        >
          <SettledRuler
            label="목표 완주 시간"
            value={minutes}
            min={goalLimits.min}
            max={goalLimits.max}
            step={1}
            format={value => formatGoalDuration(value * 60)}
            onSettle={setMinutes}
            live={liveMinutes}
            paceOverM={goalDistanceM}
          />
        </View>
        <Label title="만나는 곳" note="상세 위치" />
        <View style={styles.card}>
          <View style={styles.iconCell}>
            <Icon name="mapPin" color={stand.sub} size={18} />
          </View>
          <View style={styles.flex}>
            <AppText style={styles.rowTitle} numberOfLines={1}>
              {draft.place?.name ?? '만나는 곳 선택'}
            </AppText>
            <NumText
              text={
                draft.place?.address ?? '지도나 검색으로 위치를 골라 주세요'
              }
              style={styles.rowDetail}
              numberOfLines={1}
            />
          </View>
          <ChangeButton
            label="만나는 곳 변경"
            onPress={() => navigation.navigate('MeetingPlace')}
          />
        </View>
        <Label title="날짜·시간" />
        <View style={styles.picks}>
          {day ? (
            <PickField
              icon="calendar"
              label={formatDotDateWeekday(`${day}T12:00:00+09:00`)}
              accessibilityLabel="날짜 고르기"
              onPress={() => setSheet('day')}
            />
          ) : null}
          <PickField
            icon="clock"
            label={timeLabel(time)}
            accessibilityLabel="시간 고르기"
            onPress={() => setSheet('time')}
          />
        </View>
        {problem ? (
          // A day and time the server would refuse (a start that has passed since it was picked, say) says why the
          // button is off, rather than leaving it dim (S15P31E105-798).
          <AppText
            style={styles.scheduleProblem}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {scheduleProblemText[problem]}
          </AppText>
        ) : null}
        {/* 공동 페이스 is shown in the waiting room, not here (S15P31E105-696 담당자 결정). */}
      </ScrollView>
      {/* 6.8-CreateCTA: the white main button (GroupCta navy) over the navy page's foot. */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <BottomFade />
        <StandButton
          title={editingId ? '저장' : '그룹런 만들기'}
          icon={editingId ? 'check' : 'plus'}
          disabled={
            saving ||
            (editingId ? !edited : !crew) ||
            !draft.place ||
            !day ||
            passed ||
            (mode === 'COURSE' && !course)
          }
          onPress={create}
        />
      </SafeAreaView>
      {/* The pickers in the mockup's layout (S15P31E105-594 담당자 시안): course rows with a ✓ on the picked one,
          and dates and times as chips three to a row. Navy sheets; the dark theme gives their title, handle and
          scrim the light colours. */}
      <ThemeProvider tone="dark">
        <BottomSheet
          visible={sheet === 'course'}
          onClose={() => setSheet(null)}
          title="코스 고르기"
          background={sheetNavy}
        >
          {/* 3.1's recommendation, whose 이 코스로 정하기 brings the course back (S15P31E105-696). */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="코스 추천받기"
            onPress={askRecommendation}
          >
            <View style={styles.courseRow}>
              <Icon name="route" color={stand.mint} size={18} />
              <AppText style={[styles.courseRowTextOn, styles.flex]}>
                코스 추천받기
              </AppText>
              <Icon name="forward" color={stand.sub} size={16} />
            </View>
          </PressableScale>
          {(saved ?? [])
            // A private course made from a free run cannot be a group run's course (S15P31E105-696).
            .filter(
              item =>
                item.status !== 'MERGED' &&
                item.status !== 'BLOCKED' &&
                !item.isPrivate,
            )
            .map(item => {
              const selected = item.id === course?.id;
              const label = `${item.myAlias ?? item.name} · ${formatKm(
                item.distanceM,
                1,
              )}km`;
              return (
                <PressableScale
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                  onPress={() => chooseCourse(item)}
                >
                  <View
                    style={[styles.courseRow, selected && styles.courseRowOn]}
                  >
                    <Icon
                      name="mapPin"
                      color={selected ? stand.text : stand.sub}
                      size={18}
                    />
                    <NumText
                      text={label}
                      style={[
                        selected
                          ? styles.courseRowTextOn
                          : styles.courseRowText,
                        styles.flex,
                      ]}
                      numberOfLines={1}
                    />
                    {selected ? (
                      <View style={styles.checkDot}>
                        <Icon name="check" color={stand.onMint} size={14} />
                      </View>
                    ) : null}
                  </View>
                </PressableScale>
              );
            })}
        </BottomSheet>
        <BottomSheet
          visible={sheet === 'day'}
          onClose={() => setSheet(null)}
          title="날짜"
          background={sheetNavy}
        >
          <ScrollView style={styles.sheetList}>
            <ChipGrid
              items={days}
              render={value => (
                <SheetChip
                  key={value}
                  label={formatDotDateWeekday(`${value}T12:00:00+09:00`)}
                  selected={value === day}
                  onPress={() => {
                    // Today with a start time already gone moves to the next open slot.
                    const open = timesOn(value);
                    if (!open.includes(time)) {
                      setTime(open[0]);
                    }
                    setDay(value);
                    setSheet(null);
                  }}
                />
              )}
            />
          </ScrollView>
        </BottomSheet>
        <BottomSheet
          visible={sheet === 'time'}
          onClose={() => setSheet(null)}
          title="시간"
          background={sheetNavy}
        >
          <ScrollView style={styles.sheetList}>
            <ChipGrid
              items={timesOn(day)}
              render={value => (
                <SheetChip
                  key={value}
                  label={timeLabel(value)}
                  selected={value === time}
                  onPress={() => {
                    setTime(value);
                    setSheet(null);
                  }}
                />
              )}
            />
          </ScrollView>
        </BottomSheet>
      </ThemeProvider>
    </View>
  );
}

// The picker sheets' navy, a step above the page so the sheet stands off the scrim.
const sheetNavy = stand.sheet;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    color: groupTone.text,
  },
  top: { paddingHorizontal: 17 },
  // 그룹런 시안 (S15P31E105-673): no cards, each part a row over a thin line under its mint label.
  content: {
    paddingHorizontal: 19,
    paddingTop: 4,
    paddingBottom: spacing.xxxl * 4,
  },
  iconCell: { width: 30 },
  // The crew over a heavier line.
  crewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  crew: {
    flexShrink: 1,
    fontFamily: fontFamily.black,
    fontSize: 16,
    lineHeight: 21,
    color: stand.text,
  },
  crewBar: { marginLeft: 10 },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    minHeight: 22,
  },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: stand.sub,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  courseCard: { minHeight: 68, gap: 12 },
  thumb: { width: 72, height: 46 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  courseName: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: stand.sub,
  },
  courseHint: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: stand.sub,
  },
  loading: { marginTop: spacing.xxxl },
  km: {
    fontFamily: fontFamily.resultBlack,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: stand.text,
  },
  changeSide: { justifyContent: 'center' },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 44,
    paddingLeft: 10,
  },
  changeText: {
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 19,
    color: stand.text,
  },
  rowTitle: {
    fontFamily: fontFamily.black,
    fontSize: 16,
    lineHeight: 21,
    color: stand.text,
  },
  // The course's start under its name, small and grey, over the distance.
  rowDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  // A ruler on its own line (목표 시간, a free run's 거리), with the pace under the finish time.
  rulerCard: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4,
    paddingVertical: 10,
  },
  paceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  paceValue: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: stand.text,
  },
  // Set by a recommended course: faint and not pressable until the course changes.
  locked: { opacity: 0.45 },
  // 날짜 · 시간: two fields over a heavier line each.
  picks: { flexDirection: 'row', gap: 16 },
  scheduleProblem: { marginTop: 10, fontSize: 13, color: stand.danger },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  pickLabel: {
    flex: 1,
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.text,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 19,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  // 1. 코스 고르기: a row per saved course between thin lines, the picked one with a small mint ✓ dot.
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  courseRowOn: { borderBottomColor: stand.meLine },
  courseRowText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: stand.sub,
  },
  courseRowTextOn: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.text,
  },
  checkDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stand.mint,
  },
  sheetList: { maxHeight: 360 },
  grid: { gap: 8 },
  gridRow: { flexDirection: 'row', gap: 8 },
  // The date and time choices: square-cornered and outlined, the picked one mint.
  sheetChip: {
    height: 44,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: stand.glassLine,
  },
  sheetChipOn: { borderColor: stand.mint, backgroundColor: stand.mint },
  sheetChipText: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: stand.text,
  },
  sheetChipTextOn: {
    fontFamily: fontFamily.black,
    fontSize: 13.5,
    lineHeight: 18,
    color: stand.onMint,
  },
});
