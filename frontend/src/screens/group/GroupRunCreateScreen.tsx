import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
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
  Button,
  Icon,
  LightGlass,
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
import { RouteThumb } from '../home/parts';
import {
  GroupBackground,
  GroupCta,
  groupLook,
  insetTrackLight,
  Raised,
  SectionLabel,
} from './look';
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

// A 6.8 group: a line-labelled title instead of a card (runway-group-handoff).
function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <SectionLabel tone="light">{title}</SectionLabel>
        {right}
      </View>
      {children}
    </View>
  );
}

// 코스 러닝 · 자유 러닝: a pressed-in track with the picked one a raised navy pill (6.8-CourseCard).
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
        const text = (
          <AppText style={selected ? styles.modeTextOn : styles.modeText}>
            {option.label}
          </AppText>
        );
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={styles.mode}
          >
            {selected ? (
              <Raised tone="navy" style={styles.modeOn}>
                {text}
              </Raised>
            ) : (
              text
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function ChangeRow({
  icon,
  title,
  detail,
  onChange,
  label,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onChange: () => void;
  label: string;
}) {
  return (
    <View style={styles.changeRow}>
      <View style={styles.tile}>{icon}</View>
      <View style={styles.flex}>
        <AppText style={styles.rowTitle} numberOfLines={1}>
          {title}
        </AppText>
        <AppText style={styles.rowDetail} numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      {/* 변경 is a bold text button (6.8-CourseCard). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onChange}
        hitSlop={8}
      >
        <AppText style={styles.change}>변경</AppText>
      </Pressable>
    </View>
  );
}

function PickChip({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: 'clock' | 'calendar';
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // A light glass pill with the icon on the right (6.8-DateTimeCard).
      style={styles.flex}
    >
      <LightGlass radius={24} style={styles.pick}>
        <AppText style={styles.pickLabel}>{label}</AppText>
        <Icon name={icon} color={groupLook.onLightSub} size={14} />
      </LightGlass>
    </PressableScale>
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

  return (
    <View style={[styles.root, { backgroundColor: groupLook.navy }]}>
      <StatusBar barStyle="dark-content" />
      <GroupBackground id="groupRunCreateBackground" kind="common" />
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <AppText style={styles.title} accessibilityRole="header">
            {editingId ? '그룹런 수정' : '그룹런 만들기'}
          </AppText>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText style={styles.crew}>
          {(edited ? edited.crewName : crew?.name) ?? ''}
        </AppText>
        <Section
          title="코스"
          right={<ModeSwitch value={mode} onChange={setMode} />}
        >
          {mode === 'COURSE' && course ? (
            <ChangeRow
              icon={<RouteThumb shape={course.shape} />}
              title={course.name}
              detail={`${formatKm(course.distanceM, 1)}km`}
              label="코스 변경"
              onChange={() => setSheet('course')}
            />
          ) : null}
          {/* Both modes pick minutes: a course run's TIME goal, a free run's name. */}
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
                >
                  {selected ? (
                    <Raised tone="navy" style={styles.chip}>
                      <AppText
                        style={styles.chipTextOn}
                      >{`${value}분`}</AppText>
                    </Raised>
                  ) : (
                    <LightGlass radius={18} style={styles.chip}>
                      <AppText style={styles.chipText}>{`${value}분`}</AppText>
                    </LightGlass>
                  )}
                </PressableScale>
              );
            })}
          </View>
        </Section>
        <Section
          title="만나는 곳"
          right={<AppText style={styles.note}>상세 위치</AppText>}
        >
          <ChangeRow
            icon={<Icon name="mapPin" color={groupLook.onLight} size={18} />}
            title={draft.place?.name ?? '만나는 곳 선택'}
            detail={draft.place?.address ?? '지도나 검색으로 위치를 골라 주세요'}
            label="만나는 곳 변경"
            onChange={() => navigation.navigate('MeetingPlace')}
          />
        </Section>
        <Section title="날짜·시간">
          <View style={styles.chips}>
            {day ? (
              <PickChip
                icon="calendar"
                label={formatDotDateWeekday(`${day}T12:00:00+09:00`)}
                accessibilityLabel="날짜 고르기"
                onPress={() => setSheet('day')}
              />
            ) : null}
            <PickChip
              icon="clock"
              label={timeLabel(time)}
              accessibilityLabel="시간 고르기"
              onPress={() => setSheet('time')}
            />
          </View>
        </Section>
        <Section
          title="공동 페이스"
          right={
            <AppText style={styles.note}>예상값 · 직접 입력하지 않아요</AppText>
          }
        >
          <View style={styles.auto}>
            <AppText style={styles.autoTitle}>자동 산출</AppText>
            <AppText style={[styles.rowDetail, styles.flex]}>
              지금 참가자 기록으로 낸 예상값이에요 · 출발 직전 다시 계산해요
            </AppText>
          </View>
        </Section>
      </ScrollView>
      {/* 6.8-CreateCTA: the raised white pill with a navy circle + on the navy foot. */}
      <ThemeProvider tone="dark">
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <GroupCta
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
      </ThemeProvider>
      <BottomSheet
        visible={sheet === 'course'}
        onClose={() => setSheet(null)}
        title="코스 고르기"
      >
        {(saved ?? []).map(item => (
          <Button
            key={item.id}
            title={`${item.myAlias ?? item.name} · ${formatKm(
              item.distanceM,
              1,
            )}km`}
            variant={item.id === course?.id ? 'primary' : 'secondary'}
            size="medium"
            onPress={() => chooseCourse(item)}
          />
        ))}
      </BottomSheet>
      <BottomSheet
        visible={sheet === 'day'}
        onClose={() => setSheet(null)}
        title="날짜"
      >
        <ScrollView style={styles.sheetList}>
          {days.map(value => (
            <Button
              key={value}
              title={formatDotDateWeekday(`${value}T12:00:00+09:00`)}
              variant={value === day ? 'primary' : 'secondary'}
              size="medium"
              style={styles.sheetItem}
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
          ))}
        </ScrollView>
      </BottomSheet>
      <BottomSheet
        visible={sheet === 'time'}
        onClose={() => setSheet(null)}
        title="시간"
      >
        <ScrollView style={styles.sheetList}>
          {timesOn(day).map(value => (
            <Button
              key={value}
              title={timeLabel(value)}
              variant={value === time ? 'primary' : 'secondary'}
              size="medium"
              style={styles.sheetItem}
              onPress={() => {
                setTime(value);
                setSheet(null);
              }}
            />
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

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
    color: groupLook.onLight,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 0,
    gap: 28,
    paddingBottom: spacing.xxxl * 4,
  },
  crew: {
    marginLeft: spacing.xs,
    marginBottom: -spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  card: { gap: spacing.lg },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupLook.onLightSub,
  },
  modes: {
    flexDirection: 'row',
    height: 32,
    padding: 3,
    gap: 2,
    borderRadius: 16,
    backgroundColor: 'rgba(2,5,14,0.05)',
    boxShadow: insetTrackLight,
  },
  mode: { justifyContent: 'center' },
  modeOn: {
    flex: 1,
    paddingHorizontal: 12,
    borderRadius: 13,
    justifyContent: 'center',
  },
  modeText: {
    paddingHorizontal: 12,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  modeTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onDark,
  },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(2,5,14,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  rowDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupLook.onLightSub,
  },
  change: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLight,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chip: {
    height: 36,
    paddingHorizontal: spacing.xxl,
    borderRadius: 18,
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLightSub2,
  },
  chipTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onDark,
  },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    paddingHorizontal: spacing.xl,
  },
  pickLabel: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 16,
    color: groupLook.onLight,
  },
  auto: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  autoTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 28,
    color: groupLook.onLight,
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
  sheetList: { maxHeight: 360 },
  sheetItem: { marginBottom: spacing.sm },
});
