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
  Backdrop,
  BottomSheet,
  Card,
  EmptyState,
  Icon,
  IconButton,
  Segmented,
  useToast,
} from '../../components';
import {
  DataError,
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordDetail,
} from '../../data';
import { recordsChanged } from '../../data/recordsChanged';
import {
  formatDotDateWeekday,
  formatDuration,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { FooterButton } from '../group/GroupRunDetailScreen';
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
    <Card variant="deep" style={styles.card}>
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
    </Card>
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
          : { borderColor: colors.borderStrong },
        (pressed || disabled) && styles.dim,
      ]}
    >
      {selected ? <Icon name="check" color={colors.text} size={14} /> : null}
      <AppText
        variant="bodyStrong"
        style={{ color: primary ? colors.onAccent : colors.text }}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

// The top of 5.2 on the K1 dark map (DESIGN.md 2-8 5.2 지도·거리), read in the dark tone.
function MapHead({ record }: { record: RunRecordDetail }) {
  const { colors } = useTheme();
  return (
    <View style={styles.map}>
      {record.route ? (
        <MockMap
          k1Style
          night
          route={record.route}
          // Between the header and the distance: about 95–245dp down the 430 map.
          routeArea={{ top: 288, bottom: 410 }}
        />
      ) : (
        <View style={[styles.noRoute, { backgroundColor: colors.background }]}>
          <Icon name="mapPin" color={colors.textSecondary} size={22} />
          <AppText variant="caption" tone="textSecondary">
            위치 없이 기록한 러닝이라 경로가 없어요
          </AppText>
        </View>
      )}
      {/* The map darkens under the status bar and melts into the K1 background at the bottom. */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="mapFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={k1.night} stopOpacity={0.6} />
            <Stop offset="0.2" stopColor={k1.night} stopOpacity={0} />
            <Stop offset="0.9" stopColor="#C3D1DD" stopOpacity={0} />
            <Stop offset="1" stopColor="#C3D1DD" stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#mapFade)" />
      </Svg>
      <View style={styles.headline}>
        <AppText style={styles.distance} accessibilityLabel="거리">
          {formatKm(record.distanceM)}
          <AppText style={styles.distanceUnit} tone="textSecondary">
            {' km'}
          </AppText>
        </AppText>
        <View style={styles.headlineSide}>
          <AppText style={styles.time}>
            {formatDuration(record.durationSec)}
          </AppText>
          <AppText style={styles.pace} tone="textSecondary">
            {`${formatPace(record.averagePaceSecPerKm)}/km`}
          </AppText>
        </View>
      </View>
    </View>
  );
}

// 5.2 기록 상세: one run's route, result against its goal, AI advice and split graphs.
// S09 failures stay on 5.2 with a toast (sessions.md S09 오류 응답).
function deleteFailure(error: unknown) {
  const code = error instanceof DataError ? error.code : null;
  const status = error instanceof DataError ? error.status : null;
  if (status === 403) {
    return '내 기록만 삭제할 수 있어요';
  }
  if (code === 'SESSION_NOT_FOUND' || status === 404) {
    return '이미 삭제된 기록이에요';
  }
  if (code === 'INVALID_STATE' || status === 409) {
    return '기록을 정리하는 중이라 지금은 삭제할 수 없어요. 잠시 후 다시 시도해 주세요';
  }
  return '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요';
}

// 5.2 기록 메뉴 and its 삭제 확인 (S15P31E105-394): the light sheet of 7.2b 게시물 메뉴, with S09's own wording.
function RecordMenu({
  visible,
  onClose,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  const remove = async () => {
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
      close();
    }
  };
  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={confirming ? '이 운동 기록을 삭제할까요?' : undefined}
      description={
        confirming ? '이 기록을 공유한 게시물도 함께 삭제됩니다.' : undefined
      }
    >
      {confirming ? (
        <View style={styles.sheetButtons}>
          <FooterButton title="취소" onPress={close} />
          <FooterButton title="삭제" danger disabled={busy} onPress={remove} />
        </View>
      ) : (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="기록 삭제"
            onPress={() => setConfirming(true)}
            style={styles.menuRow}
          >
            <Icon name="trash" color={k1.coral} size={20} />
            <AppText variant="body" style={{ color: k1.coralText }}>
              기록 삭제
            </AppText>
          </Pressable>
          <View style={styles.sheetButtons}>
            <FooterButton title="닫기" onPress={close} />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

export function RecordDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'RecordDetail'>>();
  const recordId = route.params?.recordId;
  const { colors } = useTheme();
  const { courses, records } = useRepositories();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
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

  // On success 5.1 and 2.1 read again without this run, and 5.2 closes.
  const deleteRecord = async () => {
    if (!record) {
      return;
    }
    try {
      await records.remove(record.id);
      recordsChanged();
      toast('기록을 삭제했어요');
      close();
    } catch (error) {
      toast(deleteFailure(error));
    }
  };

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
      <StatusBar barStyle="light-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <ThemeProvider tone="dark">
          <MapHead record={record} />
        </ThemeProvider>
        <View style={styles.body}>
          <GoalPill record={record} />
          {record.aiAdvice ? (
            <Card variant="deep" style={styles.card}>
              <AppText style={styles.advice}>
                <AppText style={styles.advice} variant="bodyStrong">
                  {'AI 조언 '}
                </AppText>
                {record.aiAdvice}
              </AppText>
            </Card>
          ) : null}
          <Splits record={record} />
        </View>
      </ScrollView>
      <ThemeProvider tone="dark">
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
              onPress={() =>
                navigation.navigate('PostWrite', { recordId: record.id })
              }
            />
            <IconButton
              icon="moreVertical"
              accessibilityLabel="기록 메뉴"
              onPress={() => setMenu(true)}
            />
          </View>
        </SafeAreaView>
        {/* The three buttons sit on the black lower part (DESIGN.md 2-8 5.2 버튼, 1.4 : 1 : 1). */}
        <SafeAreaView edges={['bottom']} style={styles.buttons}>
          <View style={styles.wide}>
            <DetailButton
              title={myCourseId ? '내 코스에 저장됨' : '내 코스에 저장'}
              selected={myCourseId !== null}
              // A run without location has no path to save as a course.
              disabled={busy || (!record.route && !myCourseId)}
              onPress={toggleSaved}
            />
          </View>
          <View style={styles.narrow}>
            <DetailButton
              title="기록 공유"
              onPress={() =>
                navigation.navigate('PostWrite', { recordId: record.id })
              }
            />
          </View>
          <View style={styles.narrow}>
            <DetailButton title="닫기" primary onPress={close} />
          </View>
        </SafeAreaView>
      </ThemeProvider>
      <RecordMenu
        visible={menu}
        onClose={() => setMenu(false)}
        onDelete={deleteRecord}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
  },
  sheetButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
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
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  // Big numbers stay Barlow Regular at the sheet's 96.
  distance: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 96,
    lineHeight: 100,
  },
  distanceUnit: { fontFamily: fontFamily.numberRegular, fontSize: 20 },
  headlineSide: { alignItems: 'flex-end', paddingBottom: spacing.lg },
  time: { fontFamily: fontFamily.numberRegular, fontSize: 24, lineHeight: 30 },
  pace: { fontFamily: fontFamily.numberRegular, fontSize: 18, lineHeight: 24 },
  body: {
    paddingHorizontal: 14,
    gap: spacing.lg,
    marginTop: -spacing.xl,
  },
  goal: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
  },
  card: { gap: spacing.xl },
  advice: { fontSize: 13.5, lineHeight: 21 },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  wide: { flex: 1.4 },
  narrow: { flex: 1 },
  // Each button fills the box that sets its share of the row.
  button: {
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dim: { opacity: 0.55 },
});
