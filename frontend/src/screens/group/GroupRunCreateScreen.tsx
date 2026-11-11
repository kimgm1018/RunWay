import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import {
  StackActions,
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
import { formatDotDateWeekday, formatKm } from '../../format';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, size, spacing, ThemeProvider } from '../../theme';
import { GroupCta, groupTone, NightBackground, NumText, Raised } from './look';
import { BottomFade, useGroupRunDraft } from './parts';
import { BackButton } from '../../components/BackButton';

type Mode = 'COURSE' | 'FREE';

const modes: { value: Mode; label: string }[] = [
  { value: 'COURSE', label: '코스 러닝' },
  { value: 'FREE', label: '자유 러닝' },
];
const goalMinutes = [30, 40, 50, 60];
// Start times offered on 6.8, every 30 minutes from 05:00 to 22:00.
const times = Array.from({ length: 35 }, (_, index) => 5 * 60 + index * 30);
const kstOffsetMs = 9 * 3600 * 1000;

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

// YYYY-MM-DD in Korea, `days` after `from`.
const dayAfter = (from: Date, days: number) =>
  new Date(from.getTime() + kstOffsetMs + days * 86400000)
    .toISOString()
    .slice(0, 10);

const loadOptions = (repositories: Repositories) =>
  Promise.all([
    repositories.groupRuns.listMine(),
    repositories.courses.getSaved(),
    repositories.courses.getTodayPlan(),
    repositories.groupRuns.searchPlaces(''),
  ]);

// A 6.8 part's title in white on the navy page with an optional note on its right (S15P31E105-594 담당자 시안):
// the mockup's plain bold labels between the cards, in place of the grey bands and left lines.
function Label({ title, note }: { title: string; note?: string }) {
  return (
    <View style={styles.label}>
      <AppText style={styles.labelText} accessibilityRole="header">
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
  return (
    <View accessibilityRole="radiogroup" style={styles.modes}>
      {modes.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.mode, selected && styles.modeOn]}
          >
            <AppText style={selected ? styles.modeTextOn : styles.modeText}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// The course's outline as the mockup's larger tile (S15P31E105-594 담당자 시안): the route in mint from a filled
// start dot to an open end ring on a faint tile inside the card, which reads well on the navy. Only the saved shape is drawn, with no map under
// it, since a course carries no map image of its own.
function CourseThumb({ shape }: { shape: [number, number][] }) {
  const points = shape.map(([x, y]) => [8 + x * 72, 6 + y * 48] as const);
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <View style={styles.thumb}>
      <Svg width={88} height={60}>
        <Polyline
          points={points.map(point => point.join(',')).join(' ')}
          fill="none"
          stroke={groupTone.accent}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {first ? (
          <Circle cx={first[0]} cy={first[1]} r={3.6} fill={groupTone.accent} />
        ) : null}
        {last ? (
          <Circle
            cx={last[0]}
            cy={last[1]}
            r={3.6}
            fill={groupTone.page}
            stroke={groupTone.text}
            strokeWidth={1.8}
          />
        ) : null}
      </Svg>
    </View>
  );
}

// 변경 stays a bold text button (6.8-CourseCard), with the mockup's chevron after it (S15P31E105-594 담당자 시안).
function ChangeButton({
  label,
  text = '변경',
  onPress,
}: {
  label: string;
  text?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.change}
    >
      <AppText style={styles.changeText}>{text}</AppText>
      <Icon name="forward" color={groupTone.sub} size={16} />
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
        <Icon name={icon} color={groupTone.sub} size={18} />
        <NumText text={label} style={styles.pickLabel} numberOfLines={1} />
        <Icon name="chevronDown" color={groupTone.sub} size={18} />
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
  const { groupRuns, clock } = useRepositories();
  const toast = useToast();
  const { draft, setPlace, changed } = useGroupRunDraft();
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
    });
    return stop;
  }, [navigation, setPlace]);

  const ready = options.status === 'ready' ? options.data : null;
  const [mine, saved, plan, places] = ready ?? [];
  const crew =
    mine?.crews.find(item => item.crew.id === route.params?.crewId)?.crew ??
    mine?.crews.find(item => item.crew.membership === 'MEMBER')?.crew;
  const now = clock.now();
  // Today (KST) is offered too, but only the start times still ahead of now.
  const todayDay = dayAfter(now, 0);
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const nowMinutes = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
  const timesOn = (value: string | null) =>
    value === todayDay ? times.filter(item => item > nowMinutes) : times;
  const days = Array.from({ length: 14 }, (_, index) =>
    dayAfter(now, index),
  ).filter(value => timesOn(value).length > 0);
  const passed = day === todayDay && time <= nowMinutes;
  // An edited run's saved minutes stay pickable even when not one of the usual chips.
  const minuteOptions = goalMinutes.includes(minutes)
    ? goalMinutes
    : [...goalMinutes, minutes].sort((a, b) => a - b);

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
      setMinutes(Math.round(edited.targetDurationSec / 60));
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

  // Defaults: today's course, the nearest meeting place and the coming Saturday.
  useEffect(() => {
    if (!ready || (editingId && !filled)) {
      return;
    }
    if (!course) {
      const today = saved?.find(item => item.id === plan?.courseId);
      setCourse(
        plan
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
    // SYS-002: only ACTIVE saved courses may start a new group run.
    if (item.status === 'MERGED' || item.status === 'BLOCKED') {
      return;
    }
    setCourse({
      id: item.id,
      name: item.myAlias ?? item.name,
      distanceM: item.distanceM,
      shape: item.shape,
    });
    setSheet(null);
  };

  const create = async () => {
    if ((!crew && !edited) || !draft.place || !day) {
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
      targetDistanceM: mode === 'COURSE' ? course?.distanceM ?? null : null,
      // Course runs send it as the TIME goal; a free run's minutes only name the run.
      targetDurationSec: minutes * 60,
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
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <BackButton tone="dark" onPress={() => navigation.goBack()} />
          <AppText style={styles.title} accessibilityRole="header">
            {editingId ? '그룹런 수정' : '그룹런 만들기'}
          </AppText>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        {/* The crew as the mockup's top row. It only names the crew, so it has no chevron and no press. */}
        {crewName ? (
          <Raised tone="night" style={styles.crewCard}>
            <Icon name="users" color={groupTone.text} size={20} />
            <AppText style={styles.crew} numberOfLines={1}>
              {crewName}
            </AppText>
          </Raised>
        ) : null}
        <Label title="코스" />
        <ModeSwitch value={mode} onChange={setMode} />
        {mode === 'COURSE' ? (
          // Without a course yet the card asks for one (S15P31E105-637).
          <Raised tone="night" style={[styles.card, styles.courseCard]}>
            {course ? (
              <CourseThumb shape={course.shape} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Icon name="route" color={groupTone.sub} size={22} />
              </View>
            )}
            <View style={styles.flex}>
              <AppText style={styles.rowTitle} numberOfLines={1}>
                {course?.name ?? '코스 선택'}
              </AppText>
              {course ? (
                <AppText style={styles.km}>
                  {`${formatKm(course.distanceM, 1)}km`}
                </AppText>
              ) : (
                <AppText style={styles.courseHint}>
                  저장한 코스에서 골라 주세요
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
          </Raised>
        ) : null}
        {/* Both modes pick minutes: a course run's TIME goal, a free run's name. The mockup's 목표 시간 label
            names the chips that used to sit under 코스 without one. */}
        <Label title="목표 시간" />
        <View style={styles.chips}>
          {minuteOptions.map(value => {
            const selected = value === minutes;
            return (
              <PressableScale
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={`${value}분`}
                accessibilityState={{ selected }}
                onPress={() => setMinutes(value)}
                style={styles.flex}
              >
                <View style={[styles.chip, selected && styles.chipOn]}>
                  <NumText
                    text={`${value}분`}
                    style={selected ? styles.chipTextOn : styles.chipText}
                  />
                </View>
              </PressableScale>
            );
          })}
        </View>
        <Label title="만나는 곳" note="상세 위치" />
        <Raised tone="night" style={styles.card}>
          <Icon name="mapPin" color={groupTone.text} size={20} />
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
        </Raised>
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
        <Label title="공동 페이스" note="예상값 · 직접 입력하지 않아요" />
        <Raised tone="night" style={styles.card}>
          <Icon name="users" color={groupTone.text} size={20} />
          <AppText style={styles.autoTitle}>자동 산출</AppText>
          <AppText style={[styles.rowDetail, styles.flex]}>
            지금 참가자 기록으로 낸 예상값이에요 · 참가·탈퇴·수정 때마다 다시 계산해요
          </AppText>
        </Raised>
      </ScrollView>
      {/* 6.8-CreateCTA: the white main button (GroupCta navy) over the navy page's foot. */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <BottomFade />
        <GroupCta
          navy
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
          {(saved ?? [])
            .filter(
              item => item.status !== 'MERGED' && item.status !== 'BLOCKED',
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
                      color={selected ? groupTone.text : groupTone.sub}
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
                        <Icon
                          name="check"
                          color={groupTone.onAccent}
                          size={14}
                        />
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
const sheetNavy = groupTone.sheet;

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
  content: {
    paddingHorizontal: 16,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl * 4,
    gap: 10,
  },
  // The parts are faint white cards (Raised night) on the navy page, 14 round.
  crewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 54,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  crew: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupTone.text,
  },
  // A label sits further from the card above it than from its own.
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  labelText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupTone.sub,
  },
  modes: {
    flexDirection: 'row',
    height: 46,
    padding: 3,
    gap: 3,
    borderRadius: 14,
    backgroundColor: groupTone.quiet,
  },
  mode: {
    flex: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeOn: { backgroundColor: groupTone.button },
  modeText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
  },
  modeTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.onButton,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
  },
  courseCard: { paddingLeft: 10, paddingVertical: 10 },
  thumb: {
    width: 88,
    height: 60,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: groupTone.inner,
  },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  courseHint: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  loading: { marginTop: spacing.xxxl },
  km: {
    marginTop: 2,
    fontFamily: fontFamily.numberBold,
    fontSize: 28,
    lineHeight: 32,
    color: groupTone.text,
  },
  // 코스 변경 past a thin line, as in the mockup.
  changeSide: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: groupTone.line,
  },
  change: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  changeText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
  rowTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 21,
    color: groupTone.text,
  },
  rowDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: groupTone.sub,
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.card,
  },
  // The picked minute is a small chip, so it takes the mint (navy text on it).
  chipOn: { borderColor: groupTone.accent, backgroundColor: groupTone.accent },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  chipTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.onAccent,
  },
  picks: { flexDirection: 'row', gap: 10 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.card,
  },
  pickLabel: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 21,
    color: groupTone.text,
  },
  autoTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 23,
    color: groupTone.text,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  // 1. 코스 고르기: a row per saved course, the picked one edged and marked with a small mint ✓ dot (S15P31E105-594
  // 담당자 시안). Every row keeps the border's room so picking does not shift the text.
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: groupTone.inner,
  },
  // The picked course edged in white (담당자 요청).
  courseRowOn: { borderColor: groupTone.text },
  courseRowText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.sub,
  },
  courseRowTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  checkDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: groupTone.accent,
  },
  sheetList: { maxHeight: 360 },
  grid: { gap: 8 },
  gridRow: { flexDirection: 'row', gap: 8 },
  sheetChip: {
    height: 44,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.inner,
  },
  sheetChipOn: {
    borderColor: groupTone.accent,
    backgroundColor: groupTone.accent,
  },
  sheetChipText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
  sheetChipTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.onAccent,
  },
});
