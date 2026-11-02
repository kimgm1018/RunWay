import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, IconButton, Screen } from '../../components';
import {
  errorCode,
  useRepositories,
  type PaceEntry,
  type SelfReportedLevel,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing, typography, useTheme } from '../../theme';
import {
  ErrorNotice,
  GoButton,
  OnboardingFooter,
  OnboardingHeader,
  PageDots,
  Segmented,
  SelectionCard,
  StepTitle,
} from './parts';
import {
  formatClock,
  formatPace,
  parseClock,
  parseDistanceKm,
} from './validation';

const levels: { value: SelfReportedLevel; title: string; detail: string }[] = [
  { value: 'BEGINNER', title: '초급', detail: '5km 미만\n주 1회 이하' },
  { value: 'INTERMEDIATE', title: '중급', detail: '5–10km\n주 2–3회' },
  { value: 'ADVANCED', title: '상급', detail: '하프 이상\n주 4회+' },
];

type PaceInput = 'duration' | 'pace';

const paceInputs: { value: PaceInput; label: string }[] = [
  { value: 'duration', label: '완주 시간' },
  { value: 'pace', label: '페이스' },
];

// Paces outside 2–20 min/km are almost certainly typos.
const isLikelyPace = (secondsPerKm: number) =>
  secondsPerKm >= 120 && secondsPerKm <= 1200;

// U07 inputType: distance plus finish time works out the pace (DISTANCE_TIME); the pace tab sends the pace alone (PACE).
function paceEntryFrom(
  input: PaceInput,
  distance: string,
  clock: string,
): PaceEntry | null {
  const seconds = parseClock(clock);
  if (!seconds) {
    return null;
  }
  if (input === 'pace') {
    return isLikelyPace(seconds)
      ? { inputType: 'PACE', usualPaceSecPerKm: seconds }
      : null;
  }
  const km = parseDistanceKm(distance);
  if (!km || !isLikelyPace(seconds / km)) {
    return null;
  }
  return {
    inputType: 'DISTANCE_TIME',
    baselineDistanceM: Math.round(km * 1000),
    baselineDurationSec: seconds,
    usualPaceSecPerKm: Math.round(seconds / km),
  };
}

function describeSaveError(error: unknown) {
  switch (errorCode(error)) {
    case 'INVALID_LEVEL':
      return {
        title: '러닝 수준을 확인하지 못했어요.',
        detail: '수준을 다시 골라 주세요.',
      };
    case 'INVALID_RUNNING_BASELINE':
    case 'VALIDATION_ERROR':
      return {
        title: '평소 페이스를 확인하지 못했어요.',
        detail: '입력한 값을 다시 확인해 주세요.',
      };
    case 'NETWORK_ERROR':
      return {
        title: '저장하지 못했어요.',
        detail: '네트워크 연결을 확인하고 다시 시도해 주세요.',
      };
    default:
      return {
        title: '저장하지 못했어요.',
        detail: '잠시 후 다시 시도해 주세요.',
      };
  }
}

function MetricInput({
  label,
  unit,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  unit?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType: 'decimal-pad' | 'numbers-and-punctuation';
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  // A small label over an underlined number; the line darkens while typing.
  return (
    <View style={styles.metric}>
      <AppText variant="label" tone="textTertiary">
        {label}
      </AppText>
      <View
        style={[
          styles.metricRow,
          { borderBottomColor: focused ? colors.text : colors.border },
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.textDisabled}
          keyboardType={keyboardType}
          selectionColor={colors.accent}
          style={[typography.metricLarge, styles.metricInput, { color: colors.text }]}
        />
        {unit ? (
          <AppText variant="caption" tone="textSecondary">
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

// 1.6 초기 설정 2/2 — 러닝 프로필
export function ProfileRunningScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { profile } = useRepositories();
  const [level, setLevel] = useState<SelfReportedLevel | null>(null);
  const [input, setInput] = useState<PaceInput>('duration');
  const [distance, setDistance] = useState('');
  const [clock, setClock] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const entry = paceEntryFrom(input, distance, clock);
  const typed = clock !== '' && (input === 'pace' || distance !== '');

  // A profile saved earlier (U06) fills the form; both ways of entering the pace stay available.
  useEffect(() => {
    let active = true;
    profile.getRunningProfile().then(
      saved => {
        if (!active || !saved) {
          return;
        }
        setLevel(saved.selfReportedLevel);
        if (saved.baselineDistanceM && saved.baselineDurationSec) {
          setInput('duration');
          setDistance(String(saved.baselineDistanceM / 1000));
          setClock(formatClock(saved.baselineDurationSec));
        } else {
          setInput('pace');
          setClock(formatClock(saved.usualPaceSecPerKm));
        }
      },
      // Without the saved values the form simply starts empty.
      () => {},
    );
    return () => {
      active = false;
    };
  }, [profile]);

  const save = async () => {
    if (!level || !entry) {
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      // One U07 call saves the level and the pace together.
      await profile.saveRunningProfile({
        selfReportedLevel: level,
        pace: entry,
      });
      setSaving(false);
      navigateTo(navigation, 'WatchChoice');
    } catch (error) {
      setSaving(false);
      setFailure(describeSaveError(error));
    }
  };

  return (
    <Screen
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          step={{ current: 2, total: 2 }}
        />
      }
      footer={
        <OnboardingFooter>
          <View style={styles.cta}>
            <IconButton
              icon="back"
              accessibilityLabel="이전"
              diameter={54}
              onPress={navigation.goBack}
            />
            <GoButton
              title="저장"
              disabled={!level || !entry || saving}
              onPress={save}
            />
          </View>
          <PageDots count={2} current={1} />
        </OnboardingFooter>
      }
    >
      <StepTitle
        title="평소 어떻게 "
        muted="달리나요?"
        description="거리와 횟수가 둘 다 맞지 않아도 괜찮아요 · 더 가까운 쪽을 골라 주세요"
      />
      {failure ? (
        <ErrorNotice title={failure.title} detail={failure.detail} />
      ) : null}
      <View accessibilityRole="radiogroup" style={styles.levels}>
        {levels.map(option => (
          <SelectionCard
            key={option.value}
            selected={level === option.value}
            onPress={() => setLevel(option.value)}
            accessibilityLabel={`${option.title}, ${option.detail.replace('\n', ' ')}`}
            style={styles.level}
          >
            <AppText variant="bodyMedium">{option.title}</AppText>
            <AppText variant="label" tone="textSecondary">
              {option.detail}
            </AppText>
          </SelectionCard>
        ))}
      </View>
      <View
        style={[
          styles.pace,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputEdge,
          },
        ]}
      >
        <View style={styles.paceHeader}>
          <AppText variant="bodyMedium">평소 페이스</AppText>
          <Segmented
            compact
            options={paceInputs}
            value={input}
            onChange={value => {
              setInput(value);
              setClock('');
            }}
          />
        </View>
        {/* The pace tab takes the pace alone (U07 PACE), so distance and the worked-out line only show for 완주 시간. */}
        <View style={styles.inputs}>
          {input === 'duration' ? (
            <MetricInput
              label="거리"
              unit="km"
              value={distance}
              onChangeText={setDistance}
              placeholder="5"
              keyboardType="decimal-pad"
            />
          ) : null}
          <MetricInput
            label={input === 'duration' ? '완주 시간' : '페이스 (분:초/km)'}
            value={clock}
            onChangeText={setClock}
            placeholder={input === 'duration' ? '30:00' : '6:00'}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        {input === 'duration' ? (
          <View style={[styles.auto, { borderTopColor: colors.border }]}>
            <AppText variant="caption" tone="textSecondary" style={styles.flex}>
              자동 계산 · 페이스
            </AppText>
            <AppText variant="metric">
              {entry ? formatPace(entry.usualPaceSecPerKm) : '– –'}
            </AppText>
          </View>
        ) : null}
        {typed && !entry ? (
          <AppText variant="caption" tone="danger">
            {input === 'duration'
              ? '거리는 km, 완주 시간은 30:00처럼 입력해 주세요'
              : '페이스는 6:00처럼 입력해 주세요'}
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  levels: { flexDirection: 'row', gap: spacing.md },
  // Level cards keep the title at the top and the distance·frequency at the bottom.
  level: {
    flex: 1,
    minHeight: 104,
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  // 평소 페이스 sits on the same light card as the 1.x fields (DESIGN.md 2-5).
  pace: {
    gap: spacing.lg,
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.xxl,
  },
  paceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputs: { flexDirection: 'row', gap: spacing.xl },
  metric: { flex: 1, gap: spacing.xxs },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    borderBottomWidth: 1,
  },
  metricInput: { flex: 1, padding: 0 },
  auto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
  },
  cta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
});
