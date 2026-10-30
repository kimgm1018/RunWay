import React, { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Polyline, Text } from 'react-native-svg';
import { AppText, Backdrop, Card, Icon, useToast } from '../../components';
import { useRepositories } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import type { LngLat } from '../../geo';
import { navigateTo } from '../../navigation/navigateTo';
import {
  fontFamily,
  k1,
  palette,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { useRunSession } from './RunSession';

// A course counts as 완주 once almost all of it is run; GPS rarely lands on the exact finish.
const finishShare = 0.98;
// The drawing grows into whatever height the screen leaves above the numbers.
const outlineInset = 16;
const outlineMinHeight = 170;

// The run's path as a white line with a faint halo on the course card, without the map
// (4.5 상단 그림, DESIGN.md 2-7 코스 카드).
function RouteOutline({
  route,
  width,
  height,
}: {
  route: LngLat[];
  width: number;
  height: number;
}) {
  const lngs = route.map(point => point[0]);
  const lats = route.map(point => point[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const squeeze = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max(
    (Math.max(...lngs) - Math.min(...lngs)) * squeeze,
    1e-5,
  );
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 1e-5);
  const scale = Math.min(
    (width - outlineInset * 2) / spanX,
    (height - outlineInset * 2) / spanY,
  );
  const project = ([lng, lat]: LngLat) => ({
    x:
      width / 2 +
      (lng - (Math.min(...lngs) + Math.max(...lngs)) / 2) * squeeze * scale,
    y: height / 2 - (lat - midLat) * scale,
  });
  const points = route
    .map(point => {
      const { x, y } = project(point);
      return `${x},${y}`;
    })
    .join(' ');
  const start = project(route[0]);
  return (
    <Svg width={width} height={height} accessibilityLabel="달린 경로">
      <Polyline
        points={points}
        stroke={palette.white}
        strokeOpacity={0.18}
        strokeWidth={14}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Polyline
        points={points}
        stroke={palette.white}
        strokeWidth={4}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <G>
        <Circle cx={start.x} cy={start.y} r={8} fill={k1.ice} />
        <Text
          x={start.x + 12}
          y={start.y + 4}
          fontSize={11}
          fontWeight="700"
          fill={k1.ice}
        >
          S·F
        </Text>
      </G>
    </Svg>
  );
}

function Metric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.metric}>
      <AppText style={styles.metricValue}>
        {value}
        {unit ? (
          <AppText variant="label" tone="textSecondary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

// 시간 · 거리 · 평균 심박 · 평균 케이던스 in a 2 × 2 grid split by 14% lines (DESIGN.md 2-7 4.5 지표).
function MetricGrid({ children }: { children: React.ReactNode[] }) {
  const { colors } = useTheme();
  const [a, b, c, d] = children;
  const line = { borderColor: colors.border };
  return (
    <View>
      <View style={[styles.metricRow, styles.rowLine, line]}>
        <View style={[styles.cell, styles.cellLine, line]}>{a}</View>
        <View style={styles.cell}>{b}</View>
      </View>
      <View style={styles.metricRow}>
        <View style={[styles.cell, styles.cellLine, line]}>{c}</View>
        <View style={styles.cell}>{d}</View>
      </View>
    </View>
  );
}

function ResultButton({
  title,
  onPress,
  look,
  icon,
  disabled = false,
  selected,
}: {
  title: string;
  onPress: () => void;
  look: 'primary' | 'secondary' | 'outline';
  icon?: 'bookmark' | 'check';
  disabled?: boolean;
  selected?: boolean;
}) {
  const { colors } = useTheme();
  // On the black lower part (DESIGN.md 2-7 보조 버튼): the main button is the light pill, the rest
  // are outlined; a button that cannot be used sits on the chip fill with dim text.
  const fill = disabled
    ? { backgroundColor: colors.surfaceMuted, borderColor: 'transparent' }
    : {
        primary: { backgroundColor: colors.accent, borderColor: colors.accent },
        secondary: {
          backgroundColor: 'transparent',
          borderColor: colors.borderStrong,
        },
        outline: { backgroundColor: 'transparent', borderColor: colors.text },
      }[look];
  const textColor = disabled
    ? colors.textTertiary
    : look === 'primary'
    ? colors.onAccent
    : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, fill, pressed && styles.dim]}
    >
      {icon ? <Icon name={icon} color={textColor} size={16} /> : null}
      <AppText variant="button" style={{ color: textColor }}>
        {title}
      </AppText>
    </Pressable>
  );
}

// 4.5 러닝 결과 (코스) and 4.5F 자유 러닝 결과.
export function RunResultScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { courses } = useRepositories();
  const toast = useToast();
  const { run, retrySave } = useRunSession();
  // The saved course this result is bookmarked as: the planned course, or one made from a free run.
  const [savedCourseId, setSavedCourseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState<{ width: number; height: number } | null>(
    null,
  );
  const plan = run?.config.plan ?? null;

  useEffect(() => {
    if (!plan) {
      return;
    }
    let active = true;
    courses.getSaved().then(
      saved => {
        if (active && saved.some(item => item.id === plan.courseId)) {
          setSavedCourseId(plan.courseId);
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [courses, plan]);

  // A finished run has nothing to go back to; back means 완료.
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        navigateTo(navigation, 'Home');
        return true;
      });
      return () => back.remove();
    }, [navigation]),
  );

  if (!run?.summary) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]} />
    );
  }
  const { summary, config, trail, saveState, recordId } = run;
  const finished = plan
    ? summary.distanceM >= plan.distanceM * finishShare
    : false;
  const shape = plan ? plan.route : trail;
  const rivalDiff =
    plan?.rival && finished
      ? plan.rival.durationSec - summary.durationSec
      : null;

  const toggleSaved = async () => {
    setBusy(true);
    try {
      if (savedCourseId) {
        await courses.unsave(savedCourseId);
        setSavedCourseId(null);
        toast('내 코스에서 뺐어요');
      } else if (plan) {
        await courses.save(plan.courseId);
        setSavedCourseId(plan.courseId);
        toast('내 코스에 저장했어요');
      } else if (recordId) {
        const { courseId } = await courses.saveFromRun({
          recordId,
          route: trail,
          distanceM: summary.distanceM,
          durationSec: summary.durationSec,
        });
        setSavedCourseId(courseId);
        toast('내 코스에 저장했어요');
      }
    } catch {
      toast('내 코스를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Status chip: dark pill, coral dot (DESIGN.md 2-7 상태 칩). */}
          <View style={styles.chip}>
            <View style={styles.dot} />
            <AppText variant="captionStrong" style={styles.chipText}>
              {plan
                ? `${plan.name} ${formatKm(plan.distanceM, 1)}km · ${
                    finished ? '완주' : '종료'
                  }`
                : '자유 러닝 · 종료'}
            </AppText>
          </View>
          <Card variant="course" style={styles.outlineCard}>
            <View
              style={styles.outline}
              onLayout={event => {
                const { width, height } = event.nativeEvent.layout;
                setArea({ width, height });
              }}
            >
              {/* Drawn over the measured box so the drawing never makes the box grow. */}
              {shape.length > 1 && area ? (
                <View style={StyleSheet.absoluteFill}>
                  <RouteOutline
                    route={shape}
                    width={area.width}
                    height={area.height}
                  />
                </View>
              ) : null}
            </View>
          </Card>
          <View style={styles.hero}>
            <AppText variant="caption" tone="textSecondary">
              평균 페이스
            </AppText>
            <AppText style={styles.pace} accessibilityLabel="평균 페이스">
              {summary.averagePaceSecPerKm === null
                ? '– –'
                : formatPace(summary.averagePaceSecPerKm)}
            </AppText>
            <AppText variant="caption" tone="textSecondary">
              {config.goalPaceSecPerKm
                ? `/km · 목표 ${formatPace(config.goalPaceSecPerKm)}`
                : '/km'}
            </AppText>
          </View>
          <Card variant="deep" style={styles.metrics}>
            <MetricGrid>
              <Metric
                label="시간"
                value={formatDuration(summary.durationSec)}
              />
              <Metric
                label="거리"
                value={formatKm(summary.distanceM)}
                unit="km"
              />
              <Metric
                label="평균 심박"
                value={
                  summary.averageHeartRate === null
                    ? '– –'
                    : String(summary.averageHeartRate)
                }
                unit="bpm"
              />
              <Metric
                label="평균 케이던스"
                value={
                  summary.averageCadence === null
                    ? '– –'
                    : String(summary.averageCadence)
                }
                unit="spm"
              />
            </MetricGrid>
          </Card>
          {/* These rows sit just above the black part, so they read the dark tone. */}
          <ThemeProvider tone="dark">
            <View style={styles.notes}>
              {plan && finished ? (
                <AppText variant="bodyStrong" style={styles.center}>
                  {`목표 ${formatDuration(plan.expectedDurationSec)} `}
                  {/* Only 미달성 turns coral (DESIGN.md 2-7 미달성). */}
                  {summary.durationSec <= plan.expectedDurationSec ? (
                    '달성'
                  ) : (
                    <AppText variant="bodyStrong" tone="danger">
                      미달성
                    </AppText>
                  )}
                  {rivalDiff !== null && plan.rival ? (
                    <AppText variant="body" tone="textSecondary">
                      {` · ${Number(
                        plan.rival.startedAt.slice(5, 7),
                      )}.${plan.rival.startedAt.slice(
                        8,
                        10,
                      )} 기록보다 ${Math.abs(rivalDiff)}초 ${
                        rivalDiff >= 0 ? '빨랐어요' : '느렸어요'
                      }`}
                    </AppText>
                  ) : null}
                </AppText>
              ) : null}
              <View style={styles.saveRow}>
                {saveState === 'failed' ? (
                  <>
                    <Icon name="alert" color={colors.danger} size={14} />
                    <AppText variant="caption" tone="danger">
                      기록을 저장하지 못했어요
                    </AppText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="다시 저장"
                      onPress={retrySave}
                      hitSlop={8}
                    >
                      <AppText variant="captionStrong" tone="accentText">
                        다시 저장
                      </AppText>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Icon
                      name={saveState === 'saved' ? 'check' : 'refresh'}
                      color={
                        saveState === 'saved'
                          ? colors.accentText
                          : colors.textTertiary
                      }
                      size={14}
                    />
                    <AppText variant="caption" tone="textTertiary">
                      {saveState === 'saved'
                        ? '기록 저장됨 · 동기화 완료'
                        : '기록 저장 중…'}
                    </AppText>
                  </>
                )}
              </View>
            </View>
          </ThemeProvider>
        </ScrollView>
        <ThemeProvider tone="dark">
          <View style={styles.buttons}>
            <View style={styles.buttonRow}>
              <ResultButton
                title="기록 보기"
                look="secondary"
                disabled={saveState !== 'saved'}
                onPress={() =>
                  recordId
                    ? navigation.navigate('RecordDetail', { recordId })
                    : undefined
                }
              />
              <ResultButton
                title="기록 공유"
                look="primary"
                disabled={saveState !== 'saved'}
                onPress={() => navigateTo(navigation, 'PostWrite')}
              />
            </View>
            <View style={styles.buttonRow}>
              <ResultButton
                title={savedCourseId ? '내 코스에 저장됨' : '내 코스에 저장'}
                look={savedCourseId ? 'outline' : 'secondary'}
                icon={savedCourseId ? 'check' : 'bookmark'}
                selected={savedCourseId !== null}
                disabled={busy || (!plan && !recordId)}
                onPress={toggleSaved}
              />
              <ResultButton
                title="완료"
                look="secondary"
                onPress={() => navigateTo(navigation, 'Home')}
              />
            </View>
          </View>
        </ThemeProvider>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  chip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(2,5,14,0.72)',
  },
  chipText: { color: k1.ice },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: k1.coral },
  outlineCard: { flex: 1, minHeight: outlineMinHeight, padding: 0 },
  outline: { flex: 1 },
  hero: { alignItems: 'center', gap: spacing.xxs },
  // Big numbers stay Barlow Regular at the sheet's 84.
  pace: { fontFamily: fontFamily.numberRegular, fontSize: 84, lineHeight: 92 },
  metrics: { paddingVertical: 6, paddingHorizontal: 8 },
  metricRow: { flexDirection: 'row' },
  rowLine: { borderBottomWidth: 1 },
  cell: { flex: 1 },
  cellLine: { borderRightWidth: 1 },
  metric: { alignItems: 'center', paddingVertical: spacing.lg, gap: 2 },
  metricValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 36,
  },
  center: { textAlign: 'center' },
  notes: { gap: spacing.md },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttons: {
    paddingHorizontal: 14,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dim: { opacity: 0.6 },
});
