import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, Screen } from '../../components';
import { useRepositories, type SelfReportedLevel } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { radius, spacing, typography, useTheme } from '../../theme';
import {
  ErrorNotice,
  OnboardingHeader,
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

// Distance plus either the finish time or the pace; the other one is worked out (U09).
function baselineFrom(input: PaceInput, distance: string, clock: string) {
  const km = parseDistanceKm(distance);
  const seconds = parseClock(clock);
  if (!km || !seconds) {
    return null;
  }
  const paceSec = input === 'duration' ? seconds / km : seconds;
  // Paces outside 2–20 min/km are almost certainly typos.
  if (paceSec < 120 || paceSec > 1200) {
    return null;
  }
  return {
    baselineDistanceM: Math.round(km * 1000),
    baselineDurationSec: Math.round(input === 'duration' ? seconds : seconds * km),
    usualPaceSecPerKm: Math.round(paceSec),
  };
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
  return (
    <View
      style={[
        styles.metric,
        {
          backgroundColor: colors.inputBackground,
          borderColor: focused ? colors.accent : colors.border,
        },
      ]}
    >
      <AppText variant="label" tone="textTertiary">
        {label}
      </AppText>
      <View style={styles.metricRow}>
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
  const [failed, setFailed] = useState(false);
  const baseline = baselineFrom(input, distance, clock);
  const typed = distance !== '' && clock !== '';

  const save = async () => {
    if (!level || !baseline) {
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await profile.setRunningLevel(level);
      await profile.setRunningBaseline(baseline);
      setSaving(false);
      navigateTo(navigation, 'WatchChoice');
    } catch {
      setSaving(false);
      setFailed(true);
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
        <>
          <Button
            title="이전"
            variant="secondary"
            style={styles.flex}
            onPress={navigation.goBack}
          />
          <Button
            title="저장"
            variant="inverse"
            disabled={!level || !baseline}
            loading={saving}
            style={styles.flex}
            onPress={save}
          />
        </>
      }
    >
      <StepTitle
        title={'평소 어떻게\n달리나요?'}
        description="거리와 횟수가 둘 다 맞지 않아도 괜찮아요 · 더 가까운 쪽을 골라 주세요"
      />
      {failed ? (
        <ErrorNotice
          title="저장하지 못했어요."
          detail="잠시 후 다시 시도해 주세요."
        />
      ) : null}
      <View accessibilityRole="radiogroup" style={styles.levels}>
        {levels.map(option => (
          <SelectionCard
            key={option.value}
            selected={level === option.value}
            onPress={() => setLevel(option.value)}
            accessibilityLabel={`${option.title}, ${option.detail.replace('\n', ' ')}`}
            style={styles.flex}
          >
            <AppText
              variant="heading"
              tone={level === option.value ? 'accentText' : 'text'}
            >
              {option.title}
            </AppText>
            <AppText variant="label" tone="textTertiary">
              {option.detail}
            </AppText>
          </SelectionCard>
        ))}
      </View>
      <Card style={styles.pace}>
        <View style={styles.paceHeader}>
          <AppText variant="bodyStrong">평소 페이스</AppText>
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
        <View style={styles.inputs}>
          <MetricInput
            label="거리"
            unit="km"
            value={distance}
            onChangeText={setDistance}
            placeholder="5"
            keyboardType="decimal-pad"
          />
          <MetricInput
            label={input === 'duration' ? '완주 시간' : '페이스 (분:초/km)'}
            value={clock}
            onChangeText={setClock}
            placeholder={input === 'duration' ? '30:00' : '6:00'}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={[styles.auto, { backgroundColor: colors.surfaceMuted }]}>
          <AppText variant="captionStrong" tone="accentText">
            자동 계산
          </AppText>
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            {input === 'duration' ? '페이스' : '완주 시간'}
          </AppText>
          <AppText variant="metric">
            {baseline
              ? input === 'duration'
                ? formatPace(baseline.usualPaceSecPerKm)
                : formatClock(baseline.baselineDurationSec)
              : '– –'}
          </AppText>
        </View>
        {typed && !baseline ? (
          <AppText variant="caption" tone="danger">
            {input === 'duration'
              ? '거리는 km, 완주 시간은 30:00처럼 입력해 주세요'
              : '거리는 km, 페이스는 6:00처럼 입력해 주세요'}
          </AppText>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  levels: { flexDirection: 'row', gap: spacing.md },
  pace: { gap: spacing.xl },
  paceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputs: { flexDirection: 'row', gap: spacing.md },
  metric: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  metricRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  metricInput: { flex: 1, padding: 0 },
  auto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 40,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
});
