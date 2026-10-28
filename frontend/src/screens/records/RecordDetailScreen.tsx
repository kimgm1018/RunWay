import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  AppText,
  EmptyState,
  Icon,
  IconButton,
  Segmented,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordDetail,
} from '../../data';
import {
  formatDotDateWeekday,
  formatDuration,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { radius, size, spacing, typography, useTheme } from '../../theme';
import { MockMap } from '../run/MockMap';
import { SplitChart, type SplitMetric } from './SplitChart';

const mapHeight = 400;

// 19초 or 1분 50초.
export function formatGap(seconds: number) {
  const rounded = Math.round(Math.abs(seconds));
  return rounded >= 60
    ? `${Math.floor(rounded / 60)}분 ${rounded % 60}초`
    : `${rounded}초`;
}

const metrics: { value: SplitMetric; label: string }[] = [
  { value: 'pace', label: '페이스' },
  { value: 'heartRate', label: '심박' },
  { value: 'cadence', label: '케이던스' },
];

function average(values: (number | null)[]) {
  const known = values.filter((value): value is number => value !== null);
  return known.length
    ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length)
    : null;
}

function GoalPill({ record }: { record: RunRecordDetail }) {
  const { colors } = useTheme();
  if (record.targetDurationSec === null) {
    return null;
  }
  const gap = record.targetDurationSec - record.durationSec;
  const achieved = gap >= 0;
  return (
    <View
      style={[
        styles.goal,
        {
          backgroundColor: achieved ? colors.accent : colors.dangerSurface,
          borderColor: achieved ? colors.accent : colors.dangerBorder,
        },
      ]}
    >
      <AppText
        variant="captionStrong"
        style={{ color: achieved ? colors.onAccent : colors.danger }}
      >
        {achieved
          ? `목표 ${formatDuration(
              record.targetDurationSec,
            )} 달성 · ${formatGap(gap)} 단축`
          : `목표 ${formatDuration(
              record.targetDurationSec,
            )} 미달성 · ${formatGap(gap)} 늦음`}
      </AppText>
    </View>
  );
}

function Splits({ record }: { record: RunRecordDetail }) {
  const { colors } = useTheme();
  // 심박·케이던스 탭 appear only when the run measured them.
  const available = metrics.filter(
    metric =>
      metric.value === 'pace' ||
      record.splits.some(split =>
        metric.value === 'heartRate'
          ? split.averageHeartRate !== null
          : split.averageCadence !== null,
      ),
  );
  const [metric, setMetric] = useState<SplitMetric>('pace');
  const reference =
    metric === 'pace'
      ? record.targetPaceSecPerKm
        ? {
            value: record.targetPaceSecPerKm,
            label: `목표 ${formatPace(record.targetPaceSecPerKm)}`,
          }
        : null
      : (() => {
          const mean = average(
            record.splits.map(split =>
              metric === 'heartRate'
                ? split.averageHeartRate
                : split.averageCadence,
            ),
          );
          return mean === null ? null : { value: mean, label: `평균 ${mean}` };
        })();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {available.length > 1 ? (
        <Segmented options={available} value={metric} onChange={setMetric} />
      ) : null}
      <SplitChart
        key={metric}
        splits={record.splits}
        metric={metric}
        reference={reference}
        formatValue={value =>
          metric === 'pace' ? formatPace(value) : String(value)
        }
      />
    </View>
  );
}

function DetailButton({
  title,
  onPress,
  primary = false,
  selected = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : selected
          ? { borderColor: colors.accent }
          : { borderColor: colors.borderStrong },
        (pressed || disabled) && styles.dim,
      ]}
    >
      {selected ? (
        <Icon name="check" color={colors.accentText} size={14} />
      ) : null}
      <AppText
        variant="bodyStrong"
        style={{
          color: primary
            ? colors.onAccent
            : selected
            ? colors.accentText
            : colors.text,
        }}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

// 5.2 기록 상세: one run's route, result against its goal, AI advice and split graphs.
export function RecordDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'RecordDetail'>>();
  const recordId = route.params?.recordId;
  const { colors, name } = useTheme();
  const { courses } = useRepositories();
  const toast = useToast();
  const detail = useResource(
    useCallback(
      async (repositories: Repositories) => {
        // Opened without a run (an old link): show the newest one.
        const id =
          recordId ??
          (await repositories.records.getRecent('recent', 1))[0]?.id;
        return repositories.records.getDetail(id);
      },
      [recordId],
    ),
  );
  const [myCourseId, setMyCourseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const record = detail.status === 'ready' ? detail.data : null;
  useEffect(() => {
    setMyCourseId(record?.myCourseId ?? null);
  }, [record]);

  const close = () =>
    navigation.canGoBack()
      ? navigation.goBack()
      : navigateTo(navigation, 'Records');

  const toggleSaved = async () => {
    if (!record) {
      return;
    }
    setBusy(true);
    try {
      if (myCourseId) {
        await courses.unsave(myCourseId);
        setMyCourseId(null);
        toast('내 코스에서 뺐어요');
      } else {
        const saved = record.courseId
          ? (await courses.save(record.courseId), record.courseId)
          : (
              await courses.saveFromRun({
                recordId: record.id,
                route: record.route ?? [],
                distanceM: record.distanceM,
                durationSec: record.durationSec,
              })
            ).courseId;
        setMyCourseId(saved);
        toast('내 코스에 저장했어요');
      }
    } catch {
      toast('내 코스를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };

  if (!record) {
    return (
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.headerRow}>
          <IconButton icon="back" accessibilityLabel="뒤로" onPress={close} />
        </View>
        {detail.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="기록을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={detail.reload}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <View style={styles.map}>
          {record.route ? (
            <MockMap
              night={name === 'dark'}
              route={record.route}
              routeArea={{ top: 300, bottom: 480 }}
            />
          ) : (
            <View
              style={[styles.noRoute, { backgroundColor: colors.surfaceMuted }]}
            >
              <Icon name="mapPin" color={colors.textTertiary} size={22} />
              <AppText variant="caption" tone="textTertiary">
                위치 없이 기록한 러닝이라 경로가 없어요
              </AppText>
            </View>
          )}
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            pointerEvents="none"
          >
            <Defs>
              <LinearGradient id="mapFade" x1="0" y1="0" x2="0" y2="1">
                <Stop
                  offset="0"
                  stopColor={colors.background}
                  stopOpacity={0.6}
                />
                <Stop
                  offset="0.25"
                  stopColor={colors.background}
                  stopOpacity={0}
                />
                <Stop
                  offset="0.6"
                  stopColor={colors.background}
                  stopOpacity={0}
                />
                <Stop
                  offset="1"
                  stopColor={colors.background}
                  stopOpacity={1}
                />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#mapFade)" />
          </Svg>
          <View style={styles.headline}>
            <AppText style={styles.distance} accessibilityLabel="거리">
              {formatKm(record.distanceM)}
              <AppText variant="heading" tone="textSecondary">
                {' km'}
              </AppText>
            </AppText>
            <View style={styles.headlineSide}>
              <AppText variant="metric">
                {formatDuration(record.durationSec)}
              </AppText>
              <AppText variant="metric" tone="textSecondary">
                {`${formatPace(record.averagePaceSecPerKm)}/km`}
              </AppText>
            </View>
          </View>
        </View>
        <View style={styles.body}>
          <GoalPill record={record} />
          {record.aiAdvice ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <AppText variant="body">
                <AppText variant="bodyStrong" tone="accentText">
                  {'AI 조언 '}
                </AppText>
                {record.aiAdvice}
              </AppText>
            </View>
          ) : null}
          <Splits record={record} />
        </View>
      </ScrollView>
      <SafeAreaView
        edges={['top']}
        style={styles.header}
        pointerEvents="box-none"
      >
        <View style={styles.headerRow}>
          <IconButton icon="back" accessibilityLabel="뒤로" onPress={close} />
          <AppText
            variant="heading"
            accessibilityRole="header"
            style={styles.title}
          >
            {`${formatDotDateWeekday(record.startedAt)} 러닝`}
          </AppText>
          <IconButton
            icon="share"
            accessibilityLabel="공유"
            onPress={() => navigateTo(navigation, 'PostWrite')}
          />
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.buttons}>
        <DetailButton
          title={myCourseId ? '내 코스에 저장됨' : '내 코스에 저장'}
          selected={myCourseId !== null}
          // A run without location has no path to save as a course.
          disabled={busy || (!record.route && !myCourseId)}
          onPress={toggleSaved}
        />
        <DetailButton
          title="기록 공유"
          onPress={() => navigateTo(navigation, 'PostWrite')}
        />
        <DetailButton title="닫기" primary onPress={close} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  scroll: { paddingBottom: spacing.xxl },
  map: { height: mapHeight, overflow: 'hidden' },
  noRoute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  title: { flex: 1 },
  headline: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  distance: { ...typography.metricHero, fontSize: 72, lineHeight: 76 },
  headlineSide: { alignItems: 'flex-end', paddingBottom: spacing.md },
  body: {
    paddingHorizontal: spacing.screen,
    gap: spacing.xl,
    paddingTop: spacing.md,
  },
  goal: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  button: {
    flex: 1,
    height: size.buttonLarge,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dim: { opacity: 0.55 },
});
