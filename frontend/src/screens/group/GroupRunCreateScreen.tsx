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
  Backdrop,
  BottomSheet,
  Button,
  Card,
  Icon,
  IconButton,
  Segmented,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type SavedCourse,
} from '../../data';
import { formatDotDateWeekday, formatKm } from '../../format';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { GlowButton } from '../course/TodayRunScreen';
import { RouteThumb } from '../home/parts';
import { BottomFade, useGroupRunDraft } from './parts';

type Mode = 'COURSE' | 'FREE';

const modes: { value: Mode; label: string }[] = [
  { value: 'COURSE', label: '코스 러닝' },
  { value: 'FREE', label: '자유 러닝' },
];
const freeMinutes = [30, 40, 50, 60];
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

// The 6.8 boxes: white cards, and the vignette for 공동 페이스 (DESIGN.md 2-10 만들기).
function Section({
  title,
  right,
  vignette = false,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  vignette?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card variant={vignette ? 'vignette' : 'solid'} style={styles.card}>
      <View style={styles.rowBetween}>
        <AppText variant="bodyMedium" style={styles.sectionTitle}>
          {title}
        </AppText>
        {right}
      </View>
      {children}
    </Card>
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
  const { colors } = useTheme();
  return (
    <View style={styles.changeRow}>
      <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
        {icon}
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyMedium" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      {/* 변경 is an underlined text button (DESIGN.md 2-10 만들기). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onChange}
        hitSlop={8}
      >
        <AppText variant="captionStrong" style={styles.underline}>
          변경
        </AppText>
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
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // A pill field with the icon on the right (DESIGN.md 2-10 날짜·시간).
      style={({ pressed }) => [
        styles.pick,
        { borderColor: colors.borderStrong },
        pressed && styles.pressed,
      ]}
    >
      <AppText style={styles.pickLabel}>{label}</AppText>
      <Icon name={icon} color={colors.textSecondary} size={16} />
    </Pressable>
  );
}

// 6.8 그룹런 만들기: course or free run, meeting place (6.9), date and time. The shared pace is estimated, not typed.
export function GroupRunCreateScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunCreate'>>();
  const { colors } = useTheme();
  const { groupRuns, clock } = useRepositories();
  const toast = useToast();
  const { draft, setPlace, changed } = useGroupRunDraft();
  const options = useResource(useCallback(loadOptions, []));
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

  // Defaults: today's course, the nearest meeting place and the coming Saturday.
  useEffect(() => {
    if (!ready) {
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
  }, [course, day, draft.place, now, places, plan, ready, saved, setPlace]);

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
    if (!crew || !draft.place || !day) {
      return;
    }
    setSaving(true);
    try {
      const scheduledAt = `${day}T${pad(Math.floor(time / 60))}:${pad(
        time % 60,
      )}:00+09:00`;
      const { id } = await groupRuns.create({
        crewId: crew.id,
        courseId: mode === 'COURSE' ? course?.id ?? null : null,
        meetingPlaceName: draft.place.name,
        meetingAddress: draft.place.address,
        meetingPosition: draft.place.position,
        meetingNote: draft.place.note,
        scheduledAt,
        targetDistanceM: mode === 'COURSE' ? course?.distanceM ?? null : null,
        targetDurationSec: mode === 'FREE' ? minutes * 60 : null,
      });
      setPlace(null);
      changed();
      navigation.dispatch(
        StackActions.replace('GroupRunDetail', { groupRunId: id }),
      );
    } catch {
      toast('그룹런을 만들지 못했어요. 잠시 후 다시 시도해 주세요');
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
          <AppText style={styles.title} accessibilityRole="header">
            그룹런 만들기
          </AppText>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="caption" tone="textSecondary" style={styles.crew}>
          {crew?.name ?? ''}
        </AppText>
        <Section
          title="코스"
          right={
            <Segmented
              compact
              options={modes}
              value={mode}
              onChange={setMode}
            />
          }
        >
          {mode === 'COURSE' ? (
            course ? (
              <ChangeRow
                icon={<RouteThumb shape={course.shape} />}
                title={course.name}
                detail={`${formatKm(course.distanceM, 1)}km`}
                label="코스 변경"
                onChange={() => setSheet('course')}
              />
            ) : null
          ) : (
            <View style={styles.chips}>
              {freeMinutes.map(value => {
                const selected = value === minutes;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={`${value}분`}
                    accessibilityState={{ selected }}
                    onPress={() => setMinutes(value)}
                    style={[
                      styles.chip,
                      selected
                        ? {
                            backgroundColor: colors.accent,
                            borderColor: colors.accent,
                          }
                        : { borderColor: colors.borderStrong },
                    ]}
                  >
                    <AppText
                      variant="captionStrong"
                      style={{
                        color: selected ? colors.onAccent : colors.text,
                      }}
                    >
                      {`${value}분`}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Section>
        <Section
          title="만나는 곳"
          right={
            <AppText variant="label" tone="textSecondary">
              상세 위치
            </AppText>
          }
        >
          {draft.place ? (
            <ChangeRow
              icon={<Icon name="mapPin" color={colors.text} size={18} />}
              title={draft.place.name}
              detail={draft.place.address}
              label="만나는 곳 변경"
              onChange={() => navigation.navigate('MeetingPlace')}
            />
          ) : null}
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
          vignette
          right={
            <AppText variant="label" tone="textSecondary">
              예상값 · 직접 입력하지 않아요
            </AppText>
          }
        >
          <View style={styles.auto}>
            <AppText style={styles.autoTitle}>자동 산출</AppText>
            <AppText variant="caption" tone="textSecondary" style={styles.flex}>
              지금 참가자 기록으로 낸 예상값이에요 · 출발 직전 다시 계산해요
            </AppText>
          </View>
        </Section>
      </ScrollView>
      {/* The glow pill with a white round + on the black lower part, as on 3.1. */}
      <ThemeProvider tone="dark">
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <GlowButton
            title="그룹런 만들기"
            loading={saving}
            disabled={
              !crew || !draft.place || !day || (mode === 'COURSE' && !course)
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
          {Array.from({ length: 14 }, (_, index) =>
            dayAfter(now, index + 1),
          ).map(value => (
            <Button
              key={value}
              title={formatDotDateWeekday(`${value}T12:00:00+09:00`)}
              variant={value === day ? 'primary' : 'secondary'}
              size="medium"
              style={styles.sheetItem}
              onPress={() => {
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
          {times.map(value => (
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
  title: { fontFamily: fontFamily.medium, fontSize: 19, lineHeight: 26 },
  content: {
    padding: 14,
    paddingTop: 0,
    gap: spacing.md,
    paddingBottom: spacing.xxxl * 4,
  },
  crew: { marginLeft: spacing.sm, marginBottom: spacing.xs },
  card: { gap: spacing.lg },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 15 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  underline: { textDecorationLine: 'underline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chip: {
    height: 36,
    paddingHorizontal: spacing.xxl,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  pick: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: 24,
    borderWidth: 1,
  },
  pickLabel: { fontFamily: fontFamily.numberRegular, fontSize: 16 },
  pressed: { opacity: 0.8 },
  auto: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  autoTitle: { fontFamily: fontFamily.medium, fontSize: 20, lineHeight: 28 },
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
