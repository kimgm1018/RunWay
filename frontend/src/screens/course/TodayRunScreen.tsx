import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  AppText,
  Backdrop,
  BottomSheet,
  Button,
  Card,
  Icon,
  Segmented,
  type IconName,
} from '../../components';
import {
  useRepositories,
  useResource,
  type EnvironmentType,
  type Place,
  type Repositories,
} from '../../data';
import { formatDuration, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, spacing, useTheme } from '../../theme';
import { parseClock } from '../onboarding/validation';
import { ErrorNotice } from '../onboarding/parts';
import { MockMap } from '../run/MockMap';
import { CourseTabs } from './CourseTabs';
import { useCourseSearch } from './CourseSearch';
import { RangeSlider } from './RangeSlider';

type GoalInput = 'TIME' | 'PACE';

const goalInputs: { value: GoalInput; label: string }[] = [
  { value: 'TIME', label: '완주 시간' },
  { value: 'PACE', label: '페이스' },
];

const environments: { value: EnvironmentType; label: string }[] = [
  { value: 'PARK', label: '공원' },
  { value: 'RIVERSIDE', label: '하천변' },
  { value: 'URBAN', label: '도심' },
  { value: 'BEACH', label: '해변' },
  { value: 'TRACK', label: '트랙' },
];

const loadOptions = (repositories: Repositories) =>
  Promise.all([
    repositories.courses.getOrigins(),
    repositories.home.getTodayCondition(),
  ]);

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : { borderColor: colors.border },
      ]}
    >
      <AppText
        variant="captionStrong"
        style={{ color: selected ? colors.onAccent : colors.text }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

// 코스 추천 받기 and 6.5 준비 완료: a navy pill with a white glow on the left and a white round icon
// on the right (DESIGN.md 2-7 주 버튼). Its size is fixed, so the glow is drawn at numbers.
const glowWidth = 360;
const glowHeight = 58;

export function GlowButton({
  title,
  loading = false,
  disabled = false,
  icon = 'plus',
  onPress,
}: {
  title: string;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glow,
        (disabled || loading) && styles.dim,
        pressed && styles.pressed,
      ]}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        width={glowWidth}
        height={glowHeight}
      >
        <Defs>
          <RadialGradient
            id="glow"
            cx={0.22}
            cy={0.5}
            fx={0.22}
            fy={0.5}
            rx={0.4}
            ry={1.1}
          >
            <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.28} />
            <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={glowWidth} height={glowHeight} fill="url(#glow)" />
      </Svg>
      <AppText style={styles.glowLabel}>{title}</AppText>
      <View style={styles.glowRound}>
        {loading ? (
          <ActivityIndicator color={k1.night} />
        ) : (
          <Icon name={icon} color={k1.night} size={18} />
        )}
      </View>
    </Pressable>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

// 3.1 오늘의 러닝 and 3.1p (the same screen with 페이스 picked): set the conditions for course recommendations.
export function TodayRunScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { courses } = useRepositories();
  const { search, setSearch } = useCourseSearch();
  const options = useResource(useCallback(loadOptions, []));
  const [origins, today] = options.status === 'ready' ? options.data : [];
  const [origin, setOrigin] = useState<Place | null>(search?.origin ?? null);
  const [picking, setPicking] = useState(false);
  const [distanceKm, setDistanceKm] = useState(
    search ? search.targetDistanceM / 1000 : 5,
  );
  const [goal, setGoal] = useState<GoalInput>(search?.goalInputType ?? 'TIME');
  const [goalText, setGoalText] = useState(
    search?.goalInputType === 'PACE' && search.targetPaceSecPerKm
      ? formatDuration(search.targetPaceSecPerKm)
      : search?.targetDurationSec
      ? formatDuration(search.targetDurationSec)
      : '30:00',
  );
  const [picked, setPicked] = useState<EnvironmentType[]>(
    search?.environmentTypes ?? ['PARK', 'RIVERSIDE'],
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{
    title: string;
    detail: string;
  } | null>(null);

  const place = origin ?? origins?.[0] ?? null;
  const seconds = parseClock(goalText);
  // The other half of the goal is worked out from the distance (6′00″ ↔ 30:00 at 5km).
  const derived = seconds
    ? goal === 'TIME'
      ? formatPace(seconds / distanceKm)
      : formatDuration(seconds * distanceKm)
    : '– –';
  const readinessApplied = today?.readinessState === 'ready';

  const switchGoal = (next: GoalInput) => {
    if (next === goal) {
      return;
    }
    if (seconds) {
      setGoalText(
        formatDuration(
          next === 'PACE' ? seconds / distanceKm : seconds * distanceKm,
        ),
      );
    }
    setGoal(next);
  };

  const recommend = async () => {
    if (!place || !seconds) {
      return;
    }
    const next = {
      origin: place,
      targetDistanceM: Math.round(distanceKm * 1000),
      goalInputType: goal,
      targetDurationSec: goal === 'TIME' ? seconds : null,
      targetPaceSecPerKm: goal === 'PACE' ? seconds : null,
      environmentTypes: picked,
    };
    setLoading(true);
    setNotice(null);
    try {
      const found = await courses.recommend(next);
      setLoading(false);
      if (found.length === 0) {
        setNotice({
          title: '조건에 맞는 코스를 찾지 못했어요.',
          detail: '거리나 환경을 바꿔 다시 추천받아 보세요.',
        });
        return;
      }
      setSearch(next, found);
      navigateTo(navigation, 'RecommendedCourses');
    } catch {
      setLoading(false);
      setNotice({
        title: '코스를 추천받지 못했어요.',
        detail: '입력한 조건은 그대로 두었어요. 잠시 후 다시 시도해 주세요.',
      });
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top']} style={styles.flex}>
        {/* The dark map card with the back button and tabs on it (DESIGN.md 2-7 지도). */}
        <View style={styles.mapCard}>
          {/* The 118-high card shows the middle of the map, around y 380. */}
          <MockMap k1Style night position={place?.position} positionY={380} />
          <CourseTabs current="TodayRun" onDark />
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <AppText style={styles.title} accessibilityRole="header">
            어디서, 얼마나 달릴까요?
          </AppText>
          {options.status === 'error' ? (
            // Without the origins 코스 추천 받기 stays off, so the screen says why and offers a retry.
            // It sits above the panel, on the light part of the K1 background where the button reads.
            <View style={styles.optionsError}>
              <ErrorNotice
                title="기준 위치를 불러오지 못했어요"
                detail="기준 위치가 있어야 코스를 추천받을 수 있어요."
              />
              <Button
                title="다시 시도"
                variant="secondary"
                size="small"
                onPress={options.reload}
              />
            </View>
          ) : null}
          <Card variant="deep" style={styles.panel}>
            <PanelContent
              place={place}
              placeFailed={options.status === 'error'}
              onPickOrigin={() => setPicking(true)}
              distanceKm={distanceKm}
              setDistanceKm={setDistanceKm}
              goal={goal}
              switchGoal={switchGoal}
              goalText={goalText}
              setGoalText={setGoalText}
              seconds={seconds}
              derived={derived}
              picked={picked}
              setPicked={setPicked}
              readiness={
                // Readiness counts only when today's score exists (2.1 평가 가능).
                readinessApplied && today?.readinessScore !== null
                  ? `준비도 ${today?.readinessScore}`
                  : null
              }
            />
          </Card>
          {notice ? (
            <ErrorNotice title={notice.title} detail={notice.detail} />
          ) : null}
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <GlowButton
            title="코스 추천 받기"
            loading={loading}
            disabled={!place || !seconds}
            onPress={recommend}
          />
        </SafeAreaView>
      </SafeAreaView>
      <BottomSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="기준 위치"
      >
        {(origins ?? []).map(item => (
          <Button
            key={item.name}
            title={item.name}
            variant={item.name === place?.name ? 'primary' : 'secondary'}
            size="medium"
            onPress={() => {
              setOrigin(item);
              setPicking(false);
            }}
          />
        ))}
      </BottomSheet>
    </View>
  );
}

// Everything inside the dark glass panel, read in the dark tone: 기준 위치, 목표 거리, 목표, 환경, 함께 반영.
function PanelContent({
  place,
  onPickOrigin,
  distanceKm,
  setDistanceKm,
  goal,
  switchGoal,
  goalText,
  setGoalText,
  seconds,
  derived,
  picked,
  setPicked,
  readiness,
  placeFailed,
}: {
  place: Place | null;
  // The origins did not load, so the row stops saying it is still looking.
  placeFailed: boolean;
  onPickOrigin: () => void;
  distanceKm: number;
  setDistanceKm: (value: number) => void;
  goal: GoalInput;
  switchGoal: (next: GoalInput) => void;
  goalText: string;
  setGoalText: (text: string) => void;
  seconds: number | null;
  derived: string;
  picked: EnvironmentType[];
  setPicked: React.Dispatch<React.SetStateAction<EnvironmentType[]>>;
  readiness: string | null;
}) {
  const { colors } = useTheme();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`기준 위치 ${place?.name ?? ''}`}
        onPress={onPickOrigin}
        style={styles.origin}
      >
        <View
          style={[styles.originIcon, { backgroundColor: colors.surfaceMuted }]}
        >
          <Icon name="mapPin" color={colors.text} size={18} />
        </View>
        <View style={styles.flex}>
          <AppText variant="label" tone="textSecondary">
            기준 위치
          </AppText>
          <AppText style={styles.originName} numberOfLines={1}>
            {place?.name ??
              (placeFailed ? '불러오지 못했어요' : '위치를 찾는 중이에요')}
          </AppText>
        </View>
        <Icon name="forward" color={colors.textSecondary} size={16} />
      </Pressable>
      <Divider />

      <View style={styles.section}>
        <View style={styles.between}>
          <AppText variant="caption" tone="textSecondary">
            목표 거리
          </AppText>
          <AppText style={styles.number}>
            {distanceKm.toFixed(1)}
            <AppText variant="label" tone="textSecondary">
              {' km'}
            </AppText>
          </AppText>
        </View>
        <RangeSlider
          value={distanceKm}
          min={1}
          max={21}
          step={0.5}
          ticks={[1, 5, 10, 15, 21]}
          onChange={setDistanceKm}
          accessibilityLabel="목표 거리"
          formatValue={value => `${value.toFixed(1)}km`}
        />
      </View>
      <Divider />

      <View style={styles.section}>
        <View style={styles.between}>
          <AppText variant="caption" tone="textSecondary">
            {goal === 'TIME' ? '목표 완주 시간' : '목표 페이스'}
          </AppText>
          <Segmented
            compact
            options={goalInputs}
            value={goal}
            onChange={switchGoal}
          />
        </View>
        <View style={styles.goalRow}>
          {/* The field being typed in has the 1.5px white rim; the worked-out one only the faint rim. */}
          <View
            style={[
              styles.goalBox,
              styles.goalInputBox,
              {
                borderColor: seconds ? colors.text : colors.danger,
                backgroundColor: colors.inputBackground,
              },
            ]}
          >
            <AppText variant="label" tone="textSecondary">
              {goal === 'TIME' ? '완주 시간 · 입력' : '페이스 · 입력'}
            </AppText>
            <View style={styles.goalInputRow}>
              <TextInput
                accessibilityLabel={
                  goal === 'TIME' ? '목표 완주 시간' : '목표 페이스'
                }
                value={goalText}
                onChangeText={setGoalText}
                keyboardType="numbers-and-punctuation"
                selectionColor={colors.accent}
                style={[
                  styles.number,
                  styles.goalInput,
                  { color: colors.text },
                ]}
              />
              {goal === 'PACE' ? (
                <AppText variant="label" tone="textSecondary">
                  /km
                </AppText>
              ) : null}
            </View>
          </View>
          <View
            style={[
              styles.goalBox,
              {
                borderColor: colors.inputBorder,
                backgroundColor: colors.inputBackground,
              },
            ]}
          >
            <AppText variant="label" tone="textSecondary">
              {goal === 'TIME' ? '자동 계산 · 페이스' : '자동 계산 · 완주 시간'}
            </AppText>
            <AppText style={styles.number}>
              {derived}
              {goal === 'TIME' && seconds ? (
                <AppText variant="label" tone="textSecondary">
                  /km
                </AppText>
              ) : null}
            </AppText>
          </View>
        </View>
      </View>
      <Divider />

      <View style={styles.section}>
        <AppText variant="caption" tone="textSecondary">
          환경 · 여러 개 선택
        </AppText>
        <View style={styles.chips}>
          {environments.map(env => (
            <Chip
              key={env.value}
              label={env.label}
              selected={picked.includes(env.value)}
              onPress={() =>
                setPicked(current =>
                  current.includes(env.value)
                    ? current.filter(item => item !== env.value)
                    : [...current, env.value],
                )
              }
            />
          ))}
        </View>
      </View>

      <View style={styles.reflect}>
        <AppText variant="label" tone="textSecondary">
          함께 반영
        </AppText>
        {['수준·목표', '운동 강도', readiness ?? '준비도 미반영'].map(label => (
          <View
            key={label}
            style={[
              styles.reflectChip,
              { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <AppText
              variant="labelStrong"
              tone={label === '준비도 미반영' ? 'textTertiary' : 'text'}
            >
              {label}
            </AppText>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  optionsError: { gap: spacing.md, alignItems: 'flex-start' },
  root: { flex: 1 },
  flex: { flex: 1 },
  // 2-7: the map card at the top, rounded like the other boxes.
  mapCard: {
    height: 118,
    marginHorizontal: 14,
    marginTop: spacing.xs,
    borderRadius: 28,
    overflow: 'hidden',
  },
  content: { padding: 14, paddingTop: spacing.xl, gap: spacing.xl },
  title: {
    fontFamily: fontFamily.regular,
    fontSize: 23,
    lineHeight: 31,
    letterSpacing: -0.5,
    paddingHorizontal: spacing.xs,
  },
  panel: { gap: spacing.lg },
  divider: { height: 1 },
  origin: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  originIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  originName: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 22 },
  section: { gap: spacing.md },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Big numbers: Barlow (the light weights are not bundled yet).
  number: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 36,
  },
  goalRow: { flexDirection: 'row', gap: spacing.md },
  goalBox: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  goalInputBox: { borderWidth: 1.5 },
  goalInputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  goalInput: { flex: 1, padding: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
  },
  reflect: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  reflectChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  footer: { paddingHorizontal: 14, paddingBottom: spacing.xl },
  glow: {
    height: glowHeight,
    borderRadius: glowHeight / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(37,54,73,0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 26,
    paddingRight: 9,
  },
  glowLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: k1.ice,
  },
  glowRound: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.96 }] },
});
