import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  AppText,
  Backdrop,
  Card,
  EmptyState,
  IconButton,
} from '../../components';
import {
  useRepositories,
  useResource,
  type RecordFilter,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import {
  formatDotDateWeekday,
  formatDuration,
  formatHours,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  mistGradient,
  palette,
  size,
  spacing,
  useTheme,
} from '../../theme';
import { MonthStepper, kstMonth, shiftMonth, weekGroups } from './parts';

const filters: { value: RecordFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'SOLO', label: '개인' },
  { value: 'GROUP', label: '그룹런' },
];

// A 14% line inside the summary card, read in the card's dark tone.
function Rule() {
  const { colors } = useTheme();
  return <View style={[styles.rule, { backgroundColor: colors.border }]} />;
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.stat}>
      <AppText style={styles.statValue}>
        {value}
        {unit ? (
          <AppText variant="label" tone="textSecondary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
      <AppText variant="labelStrong" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

// The run's outline in white on the course-card colors (DESIGN.md 2-8 기록 목록).
const thumbSize = 52;

function Thumb({ shape }: { shape: [number, number][] }) {
  const points = shape
    .map(([x, y]) => `${10 + x * 32},${10 + y * 32}`)
    .join(' ');
  return (
    <View style={styles.thumb}>
      <Svg width={thumbSize} height={thumbSize}>
        <Defs>
          <RadialGradient id="thumb" cx={0.5} cy={0.45} r={0.75}>
            <Stop offset={0.4} stopColor={k1.night} />
            <Stop offset={0.8} stopColor={k1.deep} />
            <Stop offset={1} stopColor={k1.mid} />
          </RadialGradient>
        </Defs>
        <Rect width={thumbSize} height={thumbSize} fill="url(#thumb)" />
        <Polyline
          points={points}
          fill="none"
          stroke={palette.white}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

// Also lists runs on 7.4 · 7.4b.
export function RecordRow({
  record,
  onPress,
}: {
  record: RunRecordSummary;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const missed = record.goalAchieved === false;
  const detail = record.group
    ? `${formatDotDateWeekday(record.startedAt)} · ${record.group.crewName} · ${
        record.group.finisherCount
      }명 완주`
    : `${formatDotDateWeekday(record.startedAt)} · ${formatDuration(
        record.durationSec,
      )}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${record.title}, ${detail}, ${formatKm(
        record.distanceM,
      )}km`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Thumb shape={record.shape} />
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <AppText style={[styles.flex, styles.rowTitle]}>
            {record.title}
          </AppText>
          {record.runType === 'GROUP' ? (
            <View
              style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}
            >
              <AppText variant="labelStrong">그룹런</AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" tone="textSecondary">
          {detail}
        </AppText>
      </View>
      <View style={styles.rowValue}>
        <AppText style={styles.distance}>
          {formatKm(record.distanceM)}
          <AppText variant="label" tone="textSecondary">
            km
          </AppText>
        </AppText>
        {/* A pace slower than the goal turns coral (DESIGN.md 2-8). */}
        <AppText
          style={[
            styles.rowPace,
            { color: missed ? colors.danger : colors.textSecondary },
          ]}
        >
          {formatPace(record.averagePaceSecPerKm)}
        </AppText>
      </View>
    </Pressable>
  );
}

// 5.1 전체 기록: the month's totals on a vignette card, then its runs by week on dark glass cards.
export function RecordsScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Records'>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { clock } = useRepositories();
  const scrollY = useRef(new Animated.Value(0)).current;
  const thisMonth = kstMonth(clock.now());
  const [month, setMonth] = useState(route.params?.month ?? thisMonth);
  const [filter, setFilter] = useState<RecordFilter>('ALL');
  const data = useResource(
    useCallback(
      (repositories: Repositories) =>
        repositories.records.getMonth(month, filter),
      [month, filter],
    ),
  );
  const records = data.status === 'ready' ? data.data : null;
  // A run deleted on 5.2 leaves the month list (S15P31E105-394).
  const refreshMonth = data.refresh;
  useEffect(
    () =>
      onRecordsChanged(() => {
        void refreshMonth();
      }),
    [refreshMonth],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <Animated.ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + size.header + spacing.xl,
            paddingBottom: insets.bottom + spacing.xxxl,
          },
        ]}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        <Card variant="vignette" style={styles.summary}>
          <View style={styles.monthRow}>
            <MonthStepper
              label={`${month.slice(0, 4)}년 ${Number(month.slice(5))}월`}
              onPrevious={() => setMonth(shiftMonth(month, -1))}
              onNext={
                month < thisMonth
                  ? () => setMonth(shiftMonth(month, 1))
                  : undefined
              }
            />
            {records ? (
              <AppText variant="caption" tone="textSecondary">
                {`${records.summary.runCount}회 러닝`}
              </AppText>
            ) : null}
          </View>
          <Rule />
          <View style={styles.stats}>
            <Stat
              label="총 거리"
              value={
                records ? formatKm(records.summary.totalDistanceM, 1) : '– –'
              }
              unit="km"
            />
            <Stat
              label="총 시간"
              value={
                records ? formatHours(records.summary.totalDurationSec) : '– –'
              }
            />
            <Stat
              label="평균 페이스"
              value={
                records?.summary.averagePaceSecPerKm
                  ? formatPace(records.summary.averagePaceSecPerKm)
                  : '– –'
              }
            />
          </View>
        </Card>
        <View style={styles.filters}>
          {filters.map(option => {
            const selected = option.value === filter;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => setFilter(option.value)}
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
                  style={{ color: selected ? colors.onAccent : colors.text }}
                >
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {data.status === 'loading' ? (
          <ActivityIndicator style={styles.loading} />
        ) : data.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="기록을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={data.reload}
          />
        ) : records && records.records.length === 0 ? (
          <EmptyState
            title={
              filter === 'GROUP'
                ? '이 달에는 그룹런 기록이 없어요'
                : '이 달에는 기록이 없어요'
            }
            description="러닝을 마치면 여기에 쌓여요."
          />
        ) : (
          weekGroups(records?.records ?? [], clock.now()).map(group => (
            <View key={group.label} style={styles.group}>
              {/* The background stays put while the list scrolls, so the label rides on a light
                  see-through pill to stay readable over the black lower part. */}
              <View
                style={[styles.groupLabel, { backgroundColor: colors.glass }]}
              >
                <AppText variant="captionStrong" tone="textSecondary">
                  {group.label}
                </AppText>
              </View>
              <Card variant="deep" style={styles.card}>
                {group.records.map((record, index) => (
                  <View key={record.id}>
                    {index > 0 ? <Rule /> : null}
                    <RecordRow
                      record={record}
                      onPress={() =>
                        record.runType === 'GROUP'
                          ? navigateTo(navigation, 'GroupRunResult')
                          : navigation.navigate('RecordDetail', {
                              recordId: record.id,
                            })
                      }
                    />
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </Animated.ScrollView>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        {/* As soon as the list moves under it, the header gets a solid background: the top of the mist
            background, so it does not show as a white band. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.headerFill,
            {
              backgroundColor: mistGradient.colors[0],
              opacity: scrollY.interpolate({
                inputRange: [0, spacing.xxxl],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
        <IconButton
          icon="back"
          accessibilityLabel="뒤로"
          onPress={() => navigation.goBack()}
        />
        <AppText style={styles.title} accessibilityRole="header">
          내 기록
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 14, gap: spacing.lg },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: undefined,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.md,
  },
  headerFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  title: { fontFamily: fontFamily.medium, fontSize: 22, lineHeight: 30 },
  summary: { gap: spacing.lg },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rule: { height: 1 },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, gap: 2 },
  // Big numbers stay Barlow Regular at the sheet's 30.
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 36,
  },
  filters: { flexDirection: 'row', gap: spacing.md },
  chip: {
    height: 38,
    paddingHorizontal: spacing.xxl,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { marginTop: spacing.xxxl },
  group: { gap: spacing.md },
  groupLabel: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
  },
  card: { paddingVertical: 6, gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.lg,
  },
  pressed: { opacity: 0.7 },
  thumb: {
    width: thumbSize,
    height: thumbSize,
    borderRadius: 15,
    overflow: 'hidden',
  },
  rowText: { flex: 1, gap: spacing.xxs },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
  },
  rowValue: { alignItems: 'flex-end', gap: 2 },
  distance: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 26,
    lineHeight: 30,
  },
  rowPace: { fontFamily: fontFamily.numberMedium, fontSize: 13 },
});
