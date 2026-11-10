import React, { useCallback, useState } from 'react';
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
  Defs,
  LinearGradient,
  Polygon,
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
} from '../../components';
import { formatDuration, formatKm, formatPace } from '../../format';
import type { LngLat } from '../../geo';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { comparisonResult, useFinalComparison } from './recordComparison';
import { useRunControlState, useRunSession } from './RunSession';

// A course counts as 완주 once almost all of it is run; GPS rarely lands on the exact finish.
const finishShare = 0.98;
// The drawing grows into whatever height the screen leaves above the numbers.
const outlineInset = 16;
const outlineMinHeight = 90;

// The 시안's colours on the running gradient (S15P31E105-594 담당자 결정: 배경은 시그니처 러닝 그라데이션): white type,
// the app's mint for the pace, the route and the slashes, the group screens' red for a missed goal or a failed save,
// and light tiles for the buttons on the gradient's pale foot.
const resultLook = {
  page: '#1A2E39',
  text: '#FFFFFF',
  sub: 'rgba(255,255,255,0.78)',
  line: 'rgba(255,255,255,0.22)',
  headLine: 'rgba(255,255,255,0.55)',
  mint: '#4DFFD2',
  danger: '#F15066',
  ink: '#02050E',
  tile: '#F7F9FA',
  tileLine: '#A9B8C2',
} as const;

// The run's path as a mint line without the map (S15P31E105-594 담당자 시안), fitted into the box with the
// latitude squeezed so the shape keeps its real proportions.
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
  return (
    <Svg width={width} height={height} accessibilityLabel="달린 경로">
      <Polyline
        points={points}
        stroke={resultLook.mint}
        strokeWidth={3.5}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

// One row of the record table (S15P31E105-594 담당자 시안 RUN RECORD): the name on the left, the figure in Rajdhani
// right-aligned in the value column, its unit in the last column. The pace row is the mint one; a goal pace sits
// under its name.
function RecordRow({
  label,
  value,
  unit,
  note,
  accent = false,
  valueLabel,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string | null;
  accent?: boolean;
  valueLabel?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowName}>
        <AppText style={styles.rowLabel}>{label}</AppText>
        {note ? <AppText style={styles.rowNote}>{note}</AppText> : null}
      </View>
      <AppText
        style={[styles.rowValue, accent && styles.rowValueAccent]}
        accessibilityLabel={valueLabel}
      >
        {value}
      </AppText>
      <AppText style={styles.rowUnit}>{unit ?? ''}</AppText>
    </View>
  );
}

// The mint slashes under the table (시안): a run of slanted bars as wide as the screen allows.
function Stripes() {
  const [width, setWidth] = useState(0);
  const bar = 7;
  const gap = 7;
  const lean = 6;
  const height = 18;
  const count = width > 0 ? Math.floor((width - lean) / (bar + gap)) : 0;
  return (
    <View
      style={styles.stripes}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {count > 0 ? (
        <Svg width={width} height={height}>
          {Array.from({ length: count }, (_, index) => {
            const x = index * (bar + gap);
            return (
              <Polygon
                key={index}
                points={`${x + lean},0 ${x + lean + bar},0 ${
                  x + bar
                },${height} ${x},${height}`}
                fill={resultLook.mint}
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

// 오후 러닝 · 2026.11.10 (시안): when the run began, in KST like the rest of the app.
function runDateLine(startedAt: string) {
  const shifted = new Date(new Date(startedAt).getTime() + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const part = shifted.getUTCHours() < 12 ? '오전 러닝' : '오후 러닝';
  return `${part} · ${shifted.getUTCFullYear()}.${pad(
    shifted.getUTCMonth() + 1,
  )}.${pad(shifted.getUTCDate())}`;
}

// 코스 러닝 그라데이션 (runway-running-handoff 공통): the 2.0M mist upside down, dark at the top. Its stops are eased
// toward the foot so the record table stays on the dark and mid blue and the pale end lies under the buttons.
const resultGradient = [...mistColors].reverse().map((color, index, all) => ({
  color,
  offset: Math.pow(index / (all.length - 1), 0.6),
}));

// 1분 단축 · 30초 단축 · 1분 20초 단축: how much sooner than the course's planned time.
function savedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) {
    return `${rest}초 단축`;
  }
  return rest === 0 ? `${minutes}분 단축` : `${minutes}분 ${rest}초 단축`;
}

// The 4.5 buttons as the 시안: a light outlined tile and the mint 완료. A pressed tile darkens a little; a button that
// cannot be used yet is faded.
function ResultButton({
  title,
  onPress,
  primary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonPlain,
        pressed && (primary ? styles.primaryPressed : styles.plainPressed),
        disabled && styles.dim,
      ]}
    >
      <AppText style={styles.buttonText}>{title}</AppText>
    </Pressable>
  );
}

// 4.5 러닝 결과 (코스) and 4.5F 자유 러닝 결과 as the 담당자 시안 (S15P31E105-594, 배경은 진한 네이비 단색): the RunWay mark,
// RUN RECORD with the day, the route drawn as a mint line without the map, the record table, the goal line and the
// mint slashes, with 기록 공유 and 완료 at the foot (담당자 요청: 기록 보기 · 내 코스에 저장 삭제).
export function RunResultScreen() {
  const navigation = useNavigation();
  const { run, retrySave } = useRunSession();
  const control = useRunControlState();
  const finalComparison = useFinalComparison(
    control?.sessionId ?? null,
    control?.comparison ?? null,
  );
  const [area, setArea] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const plan = run?.config.plan ?? null;

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
  const { summary, config, trail, saveState, recordId, goalAchieved } = run;
  const finished = plan
    ? summary.distanceM >= plan.distanceM * finishShare
    : false;
  const shape = plan ? plan.route : trail;
  // 4.5 비교 결과: 서버가 계산한 같은 지점 도달 시간 차이(S15P31E105-422).
  const rivalResult = comparisonResult(finalComparison);
  // 목표 달성: prefer H02 goalAchieved after save; else the course finished within its planned time
  // (S15P31E105-638, 완료 하이라이트 S15P31E105-478).
  const localAchieved =
    plan !== null &&
    finished &&
    summary.durationSec <= plan.expectedDurationSec;
  const achieved = goalAchieved !== null ? goalAchieved : localAchieved;
  const showGoal =
    goalAchieved !== null ? plan !== null : plan !== null && finished;

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
              {resultGradient.map(stop => (
                <Stop
                  key={stop.offset}
                  offset={stop.offset}
                  stopColor={stop.color}
                />
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
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* The RunWay logo in white (담당자 요청: Runway 로고), RUN RECORD and the day (시안). */}
          <ThemeProvider tone="dark">
            <View style={styles.logo} accessibilityRole="header">
              <Logo width={190} />
            </View>
          </ThemeProvider>
          <AppText style={styles.recordTitle}>RUN RECORD</AppText>
          <AppText style={styles.recordDate}>
            {runDateLine(run.startedAt)}
          </AppText>
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
          <View style={styles.table}>
            <View style={[styles.row, styles.headRow]}>
              <AppText style={[styles.head, styles.rowName]}>METRIC</AppText>
              <AppText style={[styles.head, styles.headValue]}>VALUE</AppText>
              <AppText style={[styles.head, styles.headUnit]}>UNIT</AppText>
            </View>
            <RecordRow
              accent
              label="평균 페이스"
              valueLabel="평균 페이스"
              note={
                config.goalPaceSecPerKm
                  ? `목표 ${formatPace(config.goalPaceSecPerKm)}`
                  : null
              }
              value={
                summary.averagePaceSecPerKm === null
                  ? '– –'
                  : formatPace(summary.averagePaceSecPerKm)
              }
              unit="/km"
            />
            <RecordRow
              label="거리"
              value={formatKm(achieved ? countedDistance : summary.distanceM)}
              unit="km"
            />
            <RecordRow
              label="시간"
              value={formatDuration(summary.durationSec)}
            />
            <RecordRow
              label="평균 심박"
              value={
                summary.averageHeartRate === null
                  ? '– –'
                  : String(summary.averageHeartRate)
              }
              unit="bpm"
            />
            <RecordRow
              label="평균 케이던스"
              value={
                summary.averageCadence === null
                  ? '– –'
                  : String(summary.averageCadence)
              }
              unit="spm"
            />
          </View>
          {/* 목표 32:00 달성 · 1분 단축 (시안), with the same-point comparison under it when there is one. */}
          {showGoal && plan ? (
            <Pop active={achieved}>
              <View style={styles.goalRow}>
                <AppText style={styles.goalNote}>
                  {`목표 ${formatDuration(plan.expectedDurationSec)} `}
                  {achieved ? (
                    '달성'
                  ) : (
                    <AppText style={styles.missed}>미달성</AppText>
                  )}
                </AppText>
                {/* The server may call it achieved on its own terms; a gain is shown only when there is one. */}
                {achieved && summary.durationSec < plan.expectedDurationSec ? (
                  <AppText style={styles.goalGain}>
                    {savedTime(plan.expectedDurationSec - summary.durationSec)}
                  </AppText>
                ) : null}
              </View>
            </Pop>
          ) : null}
          {rivalResult ? (
            <AppText style={styles.rival}>{rivalResult}</AppText>
          ) : null}
          {/* Only a failed or unconfirmed save is shown (README 알려진 문제); saving and saved stay quiet. With the
              server the run is already stored, so a record not read back yet is 확인 못 함, not 저장 못 함. */}
          {saveState === 'failed' || saveState === 'unconfirmed' ? (
            <View style={styles.saveRow}>
              <Icon name="alert" color={resultLook.danger} size={14} />
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
          <Stripes />
        </ScrollView>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.buttons}>
        <View style={styles.buttonRow}>
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
          <ResultButton
            primary
            title="완료"
            onPress={() => navigateTo(navigation, 'Home')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: resultLook.page },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingTop: 36,
    paddingBottom: 24,
    paddingHorizontal: 28,
  },
  logo: { alignItems: 'center', justifyContent: 'center' },
  recordTitle: {
    marginTop: 18,
    textAlign: 'center',
    fontFamily: fontFamily.rajdhaniBold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.5,
    color: resultLook.text,
  },
  recordDate: {
    marginTop: 4,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: resultLook.sub,
  },
  // The route takes what the screen leaves, at least outlineMinHeight.
  outline: {
    alignSelf: 'center',
    width: '60%',
    flex: 1,
    minHeight: outlineMinHeight,
    marginTop: 18,
  },
  table: { marginTop: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    borderBottomWidth: 1,
    borderBottomColor: resultLook.line,
  },
  headRow: { minHeight: 32, borderBottomColor: resultLook.headLine },
  head: {
    fontFamily: fontFamily.rajdhaniSemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    color: resultLook.sub,
  },
  headValue: { width: 128, textAlign: 'right' },
  headUnit: { width: 64, textAlign: 'right' },
  rowName: { flex: 1 },
  rowLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: resultLook.text,
  },
  rowNote: {
    marginTop: 2,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: resultLook.sub,
  },
  rowValue: {
    width: 128,
    textAlign: 'right',
    fontFamily: fontFamily.rajdhaniSemiBold,
    fontSize: 34,
    lineHeight: 40,
    color: resultLook.text,
  },
  rowValueAccent: { color: resultLook.mint },
  rowUnit: {
    width: 64,
    alignSelf: 'flex-end',
    paddingBottom: 10,
    textAlign: 'right',
    fontFamily: fontFamily.rajdhaniSemiBold,
    fontSize: 14,
    lineHeight: 18,
    color: resultLook.sub,
  },
  goalRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalNote: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 20,
    color: resultLook.text,
  },
  goalGain: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 20,
    color: resultLook.mint,
  },
  missed: { color: resultLook.danger },
  rival: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: resultLook.sub,
  },
  saveRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  saveFailed: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    color: resultLook.danger,
  },
  retry: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    color: resultLook.text,
    textDecorationLine: 'underline',
  },
  stripes: { marginTop: 22, height: 18 },
  // The four buttons on the gradient's pale foot (시안).
  buttons: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
  },
  buttonRow: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonPlain: {
    backgroundColor: resultLook.tile,
    borderColor: resultLook.tileLine,
  },
  buttonPrimary: {
    backgroundColor: resultLook.mint,
    borderColor: resultLook.mint,
  },
  plainPressed: { backgroundColor: '#E4EAEE' },
  primaryPressed: { backgroundColor: '#3DE6BC', borderColor: '#3DE6BC' },
  buttonText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: resultLook.ink,
  },
  dim: { opacity: 0.45 },
});
