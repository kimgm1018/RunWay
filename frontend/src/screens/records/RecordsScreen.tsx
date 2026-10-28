import React, { useCallback, useRef, useState } from 'react';
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
import Svg, { Polyline } from 'react-native-svg';
import { AppText, Backdrop, EmptyState, IconButton } from '../../components';
import {
  useRepositories,
  useResource,
  type RecordFilter,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import {
  formatDotDateWeekday,
  formatDuration,
  formatHours,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { radius, size, spacing, useTheme } from '../../theme';
import { MonthStepper, kstMonth, shiftMonth, weekGroups } from './parts';

const filters: { value: RecordFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'SOLO', label: '개인' },
  { value: 'GROUP', label: '그룹런' },
];

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
      <AppText variant="metricLarge">
        {value}
        {unit ? (
          <AppText variant="caption" tone="textSecondary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
    </View>
  );
}

// The run's outline; coral when the run missed its goal (5.1).
function Thumb({
  shape,
  missed,
}: {
  shape: [number, number][];
  missed: boolean;
}) {
  const { colors } = useTheme();
  const points = shape.map(([x, y]) => `${4 + x * 26},${4 + y * 26}`).join(' ');
  return (
    <View style={[styles.thumb, { backgroundColor: colors.surfaceMuted }]}>
      <Svg width={34} height={34}>
        <Polyline
          points={points}
          fill="none"
          stroke={missed ? colors.danger : colors.accentText}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function RecordRow({
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
      <Thumb shape={record.shape} missed={missed} />
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <AppText variant="bodyStrong" style={styles.flex}>
            {record.title}
          </AppText>
          {record.runType === 'GROUP' ? (
            <View style={[styles.badge, { borderColor: colors.category }]}>
              <AppText variant="labelStrong" style={{ color: colors.category }}>
                그룹런
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" tone="textTertiary">
          {detail}
        </AppText>
      </View>
      <View style={styles.rowValue}>
        <AppText variant="metric">
          {formatKm(record.distanceM)}
          <AppText variant="label" tone="textTertiary">
            km
          </AppText>
        </AppText>
        <AppText
          variant="metricSmall"
          style={{ color: missed ? colors.danger : colors.textSecondary }}
        >
          {formatPace(record.averagePaceSecPerKm)}
        </AppText>
      </View>
    </Pressable>
  );
}

// 5.1 전체 기록: a month's totals over the profile photo, then its runs by week.
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
                    : {
                        backgroundColor: colors.surface,
                        borderColor: colors.borderStrong,
                      },
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
              <AppText
                variant="captionStrong"
                tone="textSecondary"
                style={styles.groupLabel}
              >
                {group.label}
              </AppText>
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                {group.records.map((record, index) => (
                  <View key={record.id}>
                    {index > 0 ? (
                      <View
                        style={[
                          styles.divider,
                          { backgroundColor: colors.border },
                        ]}
                      />
                    ) : null}
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
              </View>
            </View>
          ))
        )}
      </Animated.ScrollView>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        {/* As soon as the list moves under it, the header gets a solid background. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.headerFill,
            {
              backgroundColor: colors.background,
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
        <AppText variant="title" accessibilityRole="header">
          내 기록
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.screen, gap: spacing.xl },
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
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.xxs,
  },
  filters: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  chip: {
    height: 38,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { marginTop: spacing.xxxl },
  group: { gap: spacing.md },
  groupLabel: { marginLeft: spacing.xs, marginTop: spacing.md },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  divider: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
  },
  pressed: { opacity: 0.7 },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: spacing.xxs },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  rowValue: { alignItems: 'flex-end', gap: spacing.xxs },
});
