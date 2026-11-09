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
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Polyline,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  AppText,
  Icon,
  Logo,
  mistColors,
  Pop,
  useCountUp,
  useToast,
} from '../../components';
import { errorCode, useRepositories } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import type { LngLat } from '../../geo';
import { navigateTo, openRecord } from '../../navigation/navigateTo';
import { fontFamily, k1, palette, spacing, ThemeProvider } from '../../theme';
import { comparisonResult, useFinalComparison } from './recordComparison';
import { useRunControlState, useRunSession } from './RunSession';

// A course counts as 완주 once almost all of it is run; GPS rarely lands on the exact finish.
const finishShare = 0.98;
// The drawing grows into whatever height the screen leaves above the numbers.
const outlineInset = 16;
const outlineMinHeight = 90;

// The run's path as a bare 2.2 white line without the map: a white start dot and a white end ring with an
// ink rim (runway-running-handoff 4.5 달린 경로).
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
  const end = project(route[route.length - 1]);
  return (
    <Svg width={width} height={height} accessibilityLabel="달린 경로">
      <Polyline
        points={points}
        stroke={palette.white}
        strokeWidth={2.2}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={start.x} cy={start.y} r={3.5} fill={palette.white} />
      <Circle
        cx={end.x}
        cy={end.y}
        r={5}
        fill={palette.white}
        stroke={k1.night}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

// One figure, centered: the number, its unit and a label under it. On the dark top half it is white
// (distance, time); on the light foot it is ink (heart rate, cadence).
function Metric({
  label,
  value,
  unit,
  ink = false,
}: {
  label: string;
  value: string;
  unit?: string;
  ink?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <AppText style={[styles.metricValue, ink && styles.inkValue]}>
        {value}
        {unit ? (
          <AppText style={[styles.metricUnit, ink && styles.inkSoft]}>
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
      <AppText style={[styles.metricLabel, ink && styles.inkSoft]}>
        {label}
      </AppText>
    </View>
  );
}

const glassStops = [
  { offset: 0, color: '#FFFFFF', opacity: 0.62 },
  { offset: 0.55, color: '#FFFFFF', opacity: 0.28 },
  { offset: 1, color: '#FFFFFF', opacity: 0.16 },
];
const navyStops = [
  { offset: 0, color: '#1A2E39', opacity: 0.92 },
  { offset: 0.6, color: '#02050E', opacity: 0.88 },
  { offset: 1, color: '#02050E', opacity: 0.82 },
];

// The 4.5 buttons: a white liquid glass, turning navy with white text while pressed (runway-running-handoff
// ActionButtons). A button that cannot be used yet is faded; a saved course stays navy.
function ResultButton({
  title,
  onPress,
  icon,
  disabled = false,
  selected,
}: {
  title: string;
  onPress: () => void;
  icon?: 'bookmark' | 'check';
  disabled?: boolean;
  selected?: boolean;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      onLayout={event => setBox(event.nativeEvent.layout)}
      style={[styles.button, disabled && styles.dim]}
    >
      {({ pressed }) => {
        const navy = pressed || Boolean(selected);
        const text = navy ? '#FFFFFF' : k1.night;
        return (
          <>
            {box ? (
              <Svg
                style={StyleSheet.absoluteFill}
                width={box.width}
                height={box.height}
              >
                <Defs>
                  <LinearGradient
                    id={navy ? 'resultNavy' : 'resultGlass'}
                    x1="0.33"
                    y1="0"
                    x2="0.67"
                    y2="1"
                  >
                    {(navy ? navyStops : glassStops).map(stop => (
                      <Stop
                        key={stop.offset}
                        offset={stop.offset}
                        stopColor={stop.color}
                        stopOpacity={stop.opacity}
                      />
                    ))}
                  </LinearGradient>
                </Defs>
                <Rect
                  width={box.width}
                  height={box.height}
                  fill={`url(#${navy ? 'resultNavy' : 'resultGlass'})`}
                />
              </Svg>
            ) : null}
            {icon ? <Icon name={icon} color={text} size={16} /> : null}
            <AppText style={[styles.buttonText, { color: text }]}>
              {title}
            </AppText>
          </>
        );
      }}
    </Pressable>
  );
}

// 코스 러닝 그라데이션 (runway-running-handoff 공통): the 2.0M mist upside down, dark at the top.
const resultGradient = [...mistColors].reverse();

// 4.5 러닝 결과 (코스) and 4.5F 자유 러닝 결과 (runway-running-handoff): the whole screen reads as one share card on
// the dark-to-light gradient, with the four glass buttons at the foot.
export function RunResultScreen() {
  const navigation = useNavigation();
  const { courses } = useRepositories();
  const toast = useToast();
  const { run, retrySave } = useRunSession();
  const control = useRunControlState();
  const finalComparison = useFinalComparison(
    control?.sessionId ?? null,
    control?.comparison ?? null,
  );
  // The saved course this result is bookmarked as: the planned course, or one made from a free run.
  const [savedCourseId, setSavedCourseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [box, setBox] = useState<{ width: number; height: number } | null>(
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

  // Hooks come before the early return below; the count is used only for an achieved goal.
  const countedDistance = useCountUp(run?.summary?.distanceM ?? 0);

  if (!run?.summary) {
    return <View style={styles.root} />;
  }
  const { summary, config, trail, saveState, recordId } = run;
  const finished = plan
    ? summary.distanceM >= plan.distanceM * finishShare
    : false;
  const shape = plan ? plan.route : trail;
  // 4.5 비교 결과: 서버가 계산한 같은 지점 도달 시간 차이(S15P31E105-422).
  const rivalResult = comparisonResult(finalComparison);
  // 목표 달성: the course finished within its planned time. Then the distance counts up and 달성 pops in, once
  // (완료 하이라이트, S15P31E105-478).
  const achieved =
    plan !== null &&
    finished &&
    summary.durationSec <= plan.expectedDurationSec;

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
    } catch (error) {
      toast(
        errorCode(error) === 'NOT_AVAILABLE'
          ? '자유 러닝 코스 저장은 준비 중이에요'
          : '내 코스를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={styles.root}
      onLayout={event => setBox(event.nativeEvent.layout)}
    >
      <StatusBar barStyle="light-content" />
      {box ? (
        <Svg
          style={StyleSheet.absoluteFill}
          width={box.width}
          height={box.height}
        >
          <Defs>
            <LinearGradient id="resultBackdrop" x1="0" y1="0" x2="0" y2="1">
              {resultGradient.map((color, index) => (
                <Stop key={index} offset={index / 20} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect
            width={box.width}
            height={box.height}
            fill="url(#resultBackdrop)"
          />
        </Svg>
      ) : null}
      <SafeAreaView edges={['top', 'bottom']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemeProvider tone="dark">
            <View style={styles.logo}>
              <Logo width={150} />
            </View>
          </ThemeProvider>
          <View style={styles.hero}>
            <AppText style={styles.pace} accessibilityLabel="평균 페이스">
              {summary.averagePaceSecPerKm === null
                ? '– –'
                : formatPace(summary.averagePaceSecPerKm)}
            </AppText>
            <AppText style={styles.paceLabel}>
              {config.goalPaceSecPerKm
                ? `평균 페이스 /km · 목표 ${formatPace(
                    config.goalPaceSecPerKm,
                  )}`
                : '평균 페이스 /km'}
            </AppText>
          </View>
          <Metric
            label="거리"
            value={formatKm(achieved ? countedDistance : summary.distanceM)}
            unit="km"
          />
          <Metric label="시간" value={formatDuration(summary.durationSec)} />
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
          <View style={styles.footMetrics}>
            <Metric
              ink
              label="평균 심박"
              value={
                summary.averageHeartRate === null
                  ? '– –'
                  : String(summary.averageHeartRate)
              }
              unit="bpm"
            />
            <Metric
              ink
              label="평균 케이던스"
              value={
                summary.averageCadence === null
                  ? '– –'
                  : String(summary.averageCadence)
              }
              unit="spm"
            />
          </View>
          {plan && finished ? (
            <Pop active={achieved}>
              <AppText style={styles.goalNote}>
                {`목표 ${formatDuration(plan.expectedDurationSec)} `}
                {achieved ? (
                  '달성'
                ) : (
                  <AppText style={styles.missed}>미달성</AppText>
                )}
                {rivalResult ? ` · ${rivalResult}` : ''}
              </AppText>
            </Pop>
          ) : null}
          {/* Only a failed or unconfirmed save is shown (README 알려진 문제); saving and saved stay quiet. With the
              server the run is already stored, so a record not read back yet is 확인 못 함, not 저장 못 함. */}
          {saveState === 'failed' || saveState === 'unconfirmed' ? (
            <View style={styles.saveRow}>
              <Icon name="alert" color={k1.coralText} size={14} />
              <AppText style={styles.saveFailed}>
                {saveState === 'failed'
                  ? '기록을 저장하지 못했어요'
                  : '기록 저장을 확인하지 못했어요'}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  saveState === 'failed' ? '다시 저장' : '다시 확인'
                }
                onPress={retrySave}
                hitSlop={8}
              >
                <AppText style={styles.retry}>
                  {saveState === 'failed' ? '다시 저장' : '다시 확인'}
                </AppText>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.buttons}>
          <View style={styles.buttonRow}>
            <ResultButton
              title="기록 보기"
              disabled={saveState !== 'saved'}
              onPress={() =>
                recordId ? openRecord(navigation, recordId) : undefined
              }
            />
            <ResultButton
              title="기록 공유"
              disabled={saveState !== 'saved' || !recordId}
              // 7.3 shares this run's record, not just the newest one.
              onPress={() =>
                recordId
                  ? navigation.navigate('PostWrite', { recordId })
                  : undefined
              }
            />
          </View>
          <View style={styles.buttonRow}>
            <ResultButton
              title={savedCourseId ? '내 코스에 저장됨' : '내 코스에 저장'}
              icon={savedCourseId ? 'check' : 'bookmark'}
              selected={savedCourseId !== null}
              disabled={busy || (!plan && !recordId)}
              onPress={toggleSaved}
            />
            <ResultButton
              title="완료"
              onPress={() => navigateTo(navigation, 'Home')}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A2E39' },
  flex: { flex: 1 },
  // Top 50, then 46 between the groups (runway-running-handoff 세로 간격); the route takes what is left.
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingTop: 46,
    paddingBottom: 18,
    paddingHorizontal: 14,
  },
  logo: { height: 22, justifyContent: 'center' },
  hero: { alignItems: 'center', marginTop: 46 },
  // Big numbers stay Barlow Regular, here at the mockup's 96.
  pace: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 96,
    lineHeight: 100,
    letterSpacing: -2,
    color: '#F9F9F9',
  },
  paceLabel: {
    marginTop: 6,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.85)',
  },
  metric: { alignItems: 'center', marginTop: 46 },
  metricValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.3,
    color: '#F9F9F9',
  },
  metricUnit: { fontFamily: fontFamily.medium, fontSize: 14, color: '#F9F9F9' },
  metricLabel: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.8)',
  },
  inkValue: { fontSize: 26, lineHeight: 30, color: k1.night },
  inkSoft: { color: '#3A4A57' },
  outline: {
    alignSelf: 'stretch',
    flex: 1,
    minHeight: outlineMinHeight,
    marginTop: 46,
    marginHorizontal: 24,
  },
  footMetrics: { flexDirection: 'row', gap: 44 },
  goalNote: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 20,
    color: k1.night,
  },
  missed: { color: k1.coralText },
  saveRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  saveFailed: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    color: k1.coralText,
  },
  retry: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    color: k1.night,
    textDecorationLine: 'underline',
  },
  buttons: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    boxShadow:
      'inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -2px 6px rgba(255,255,255,0.35), 0 10px 26px rgba(30,45,60,0.14)',
  },
  buttonText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
  },
  dim: { opacity: 0.45 },
});
