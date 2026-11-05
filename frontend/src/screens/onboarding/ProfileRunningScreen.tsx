import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Rect } from 'react-native-svg';
import { AppText, Icon, Screen } from '../../components';
import {
  errorCode,
  useRepositories,
  type PaceEntry,
  type SelfReportedLevel,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, typography, useTheme } from '../../theme';
import { StepFooter } from './ProfileBasicScreen';
import {
  ErrorNotice,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  RunnerArt,
  Segmented,
  SelectionCard,
  signUpSteps,
  StepTitle,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';
import {
  applyLevelPreset,
  switchPaceInput,
  type PaceForm,
  type PaceInput,
} from './runningPresets';
import {
  editClock,
  formatClock,
  formatClockDigits,
  formatPace,
  parseClock,
  parseDistanceKm,
} from './validation';

const levels: { value: SelfReportedLevel; title: string; detail: string }[] = [
  { value: 'BEGINNER', title: '초급', detail: '5km 미만\n주 1회 이하' },
  { value: 'INTERMEDIATE', title: '중급', detail: '5–10km\n주 2–3회' },
  { value: 'ADVANCED', title: '상급', detail: '하프 이상\n주 4회+' },
];

// The handoff's level icon: three rising bars, as many filled as the level.
function LevelBars({ filled }: { filled: number }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      {[
        { x: 4, y: 14, h: 6 },
        { x: 10, y: 10, h: 10 },
        { x: 16, y: 5, h: 15 },
      ].map((bar, index) => (
        <Rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={4}
          height={bar.h}
          rx={1}
          stroke={onboardingLook.ink}
          strokeWidth={1.8}
          fill={index < filled ? onboardingLook.ink : 'none'}
        />
      ))}
    </Svg>
  );
}

const paceInputs: { value: PaceInput; label: string }[] = [
  { value: 'duration', label: '완주 시간' },
  { value: 'pace', label: '페이스' },
];

// Time inputs take h:mm:ss for the finish time and mm:ss for the pace.
const clockDigits: Record<PaceInput, number> = { duration: 6, pace: 4 };

const emptyForm: PaceForm = {
  input: 'duration',
  distance: '',
  clock: '',
  auto: false,
};

// How long after a reformat the keyboard's own cursor report is still the stale one.
const STALE_SELECTION_MS = 300;

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
  maxClockDigits,
}: {
  label: string;
  unit?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType: 'decimal-pad' | 'number-pad';
  // Set for time inputs: digits only, with the colons put in as you type.
  maxClockDigits?: number;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  // The cursor is held only for the text it was worked out for; a value filled in from outside keeps the native cursor.
  const [cursor, setCursor] = useState<{ text: string; at: number } | null>(
    null,
  );
  const reformatted = useRef<{ at: number; until: number } | null>(null);
  const selection =
    maxClockDigits && cursor && cursor.text === value
      ? { start: cursor.at, end: cursor.at }
      : undefined;
  const change = (raw: string) => {
    if (!maxClockDigits) {
      onChangeText(raw);
      return;
    }
    const edit = editClock(value, raw, maxClockDigits);
    reformatted.current = {
      at: edit.cursor,
      until: Date.now() + STALE_SELECTION_MS,
    };
    setCursor({ text: edit.text, at: edit.cursor });
    onChangeText(edit.text);
  };
  const selectionChange = (at: number) => {
    // Android reports the cursor of the raw keystroke after the change; once a colon moved the digits it is stale.
    const pending = reformatted.current;
    reformatted.current = null;
    if (pending && pending.at !== at && Date.now() < pending.until) {
      return;
    }
    setCursor({ text: value, at });
  };
  // Pressing sinks the well a little; it springs back on release (담당자 결정).
  const input = useRef<TextInput>(null);
  const sink = useRef(new Animated.Value(1)).current;
  const press = (down: boolean) => {
    setPressed(down);
    Animated.spring(sink, {
      toValue: down ? 0.96 : 1,
      speed: 40,
      bounciness: down ? 0 : 6,
      useNativeDriver: true,
    }).start();
  };
  // A small label over a raised glass tile, so it reads as a field to type into (담당자 결정: no underline); pressing
  // or typing sinks it into the card and typing turns the rim ink.
  return (
    <View style={styles.metric}>
      <AppText style={styles.metricLabel}>{label}</AppText>
      {/* The whole well takes the touch, so pressing beside the number (or on km) still starts typing. */}
      <Pressable
        accessible={false}
        onPress={() => input.current?.focus()}
        onPressIn={() => press(true)}
        onPressOut={() => press(false)}
      >
        <Animated.View
          style={[
            styles.metricRow,
            focused || pressed ? styles.metricRowSunk : null,
            focused ? styles.metricRowFocused : null,
            { transform: [{ scale: sink }] },
          ]}
        >
          <TextInput
            ref={input}
            onPressIn={() => press(true)}
            onPressOut={() => press(false)}
            accessibilityLabel={label}
            value={value}
            onChangeText={change}
            selection={selection}
            onSelectionChange={
              maxClockDigits
                ? event => selectionChange(event.nativeEvent.selection.end)
                : undefined
            }
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            placeholderTextColor={colors.textDisabled}
            keyboardType={keyboardType}
            selectionColor={colors.accent}
            style={[
              typography.metricLarge,
              styles.metricInput,
              { color: colors.text },
            ]}
          />
          {unit ? (
            <AppText variant="caption" tone="textSecondary">
              {unit}
            </AppText>
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

// 1.6 초기 설정 — 러닝 수준 (runway-onboarding-handoff 1.6). The pace follows on 1.6b, which saves both (U07).
export function ProfileRunningScreen() {
  const navigation = useNavigation();
  const { profile } = useRepositories();
  const { draft, update } = useSignUpDraft();
  const level = draft.level;
  const form = draft.paceForm ?? emptyForm;

  // A profile saved earlier (U06) fills the level and the pace; both ways of entering the pace stay available.
  useEffect(() => {
    let active = true;
    profile.getRunningProfile().then(
      saved => {
        if (!active || !saved) {
          return;
        }
        // Saved values show as they are; picking a level replaces them with its recommendation.
        update({
          level: saved.selfReportedLevel,
          paceForm:
            saved.baselineDistanceM && saved.baselineDurationSec
              ? {
                  input: 'duration',
                  distance: String(saved.baselineDistanceM / 1000),
                  clock: formatClock(saved.baselineDurationSec),
                  auto: false,
                }
              : {
                  input: 'pace',
                  distance: '',
                  clock: formatClock(saved.usualPaceSecPerKm),
                  auto: false,
                },
        });
      },
      // Without the saved values the form simply starts empty.
      () => {},
    );
    return () => {
      active = false;
    };
  }, [profile, update]);

  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: 5, total: signUpSteps }}
        />
      }
      footer={
        <StepFooter
          title="다음"
          disabled={!level}
          onPress={() => navigateTo(navigation, 'ProfilePace')}
        />
      }
    >
      <RunnerArt />
      <StepTitle title="평소 어떻게 " muted="달리나요?" />
      <View accessibilityRole="radiogroup" style={styles.levels}>
        {levels.map((option, index) => (
          <SelectionCard
            key={option.value}
            selected={level === option.value}
            onPress={() =>
              update({
                level: option.value,
                paceForm: applyLevelPreset(form, option.value),
              })
            }
            accessibilityLabel={`${option.title}, ${option.detail.replace(
              '\n',
              ' ',
            )}`}
            style={styles.level}
          >
            <LevelBars filled={index + 1} />
            <View style={styles.flex}>
              <AppText style={styles.levelTitle}>{option.title}</AppText>
              <AppText style={styles.levelDetail}>
                {option.detail.replace('\n', ' · ')}
              </AppText>
            </View>
          </SelectionCard>
        ))}
      </View>
    </Screen>
  );
}

// 5 seconds a tap on 1.6b's − / +.
const paceStep = 5;

// The 페이스 tab (runway-onboarding-handoff 1.6b): the pace as a big number between − and +, typed straight in
// when tapped.
function PaceStepper({
  clock,
  onChange,
}: {
  clock: string;
  onChange: (clock: string) => void;
}) {
  const seconds = parseClock(clock);
  const nudge = (by: number) => {
    const next = Math.min(1200, Math.max(120, (seconds ?? 360) + by));
    onChange(formatClock(next));
  };
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="페이스 5초 빠르게"
        onPress={() => nudge(-paceStep)}
        style={({ pressed }) => [styles.round, pressed && styles.pressed]}
      >
        <Icon name="minus" color={onboardingLook.ink} size={16} />
      </Pressable>
      <View style={styles.paceValue}>
        <TextInput
          accessibilityLabel="페이스 (분:초/km)"
          value={clock}
          onChangeText={text => onChange(formatClockDigits(text, 4))}
          placeholder="6:00"
          placeholderTextColor={onboardingLook.muted}
          keyboardType="number-pad"
          selectionColor={onboardingLook.ink}
          style={styles.paceInput}
        />
        <AppText style={styles.paceUnit}>/km</AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="페이스 5초 느리게"
        onPress={() => nudge(paceStep)}
        style={({ pressed }) => [styles.round, pressed && styles.pressed]}
      >
        <Icon name="plus" color={onboardingLook.ink} size={16} />
      </Pressable>
    </View>
  );
}

// 1.6b 초기 설정 — 평소 페이스 (runway-onboarding-handoff 1.6b). Both ways of entering it stay (담당자 결정): 완주 시간
// (distance and time) or the pace itself, now a − / + number.
export function ProfilePaceScreen() {
  const navigation = useNavigation();
  const { profile } = useRepositories();
  const { draft, update } = useSignUpDraft();
  const level = draft.level;
  const form = draft.paceForm ?? emptyForm;
  const { input, distance, clock } = form;
  const setForm = (change: (current: PaceForm) => PaceForm) =>
    update({ paceForm: change(form) });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  // The card body's height in both tabs: the 완주 시간 body (label 16 + 6 + field 54 + 10 + pace line 24), or more
  // once it is laid out bigger (large text).
  const [bodyHeight, setBodyHeight] = useState(110);
  const entry = paceEntryFrom(input, distance, clock);
  const typed = clock !== '' && (input === 'pace' || distance !== '');

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
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: 6, total: signUpSteps }}
        />
      }
      footer={
        <StepFooter
          title="저장"
          disabled={!level || !entry || saving}
          onPress={save}
        />
      }
    >
      <RunnerArt />
      <StepTitle title="평소 페이스는 " muted="어느 정도예요?" />
      {failure ? (
        <ErrorNotice title={failure.title} detail={failure.detail} />
      ) : null}
      <View style={styles.pace}>
        <View style={styles.paceHeader}>
          <AppText style={styles.paceTitle}>평소 페이스</AppText>
          <Segmented
            compact
            // Both tabs are the same width, whatever their labels (담당자 결정).
            segmentWidth={76}
            options={paceInputs}
            value={input}
            onChange={value =>
              setForm(current => switchPaceInput(current, value, level))
            }
          />
        </View>
        {input === 'pace' ? (
          <View style={[styles.paceBody, { minHeight: bodyHeight }]}>
            <PaceStepper
              clock={clock}
              onChange={text =>
                setForm(current => ({ ...current, clock: text, auto: false }))
              }
            />
          </View>
        ) : (
          // The 완주 시간 tab takes distance and time (U07 DISTANCE_TIME) and shows the pace it works out. Its height
          // is the card's for both tabs, measured so larger text still matches.
          <View
            style={[
              styles.paceBody,
              styles.durationBody,
              { minHeight: bodyHeight },
            ]}
            onLayout={event => {
              const height = event.nativeEvent.layout.height;
              if (height > bodyHeight) {
                setBodyHeight(height);
              }
            }}
          >
            <View style={styles.inputs}>
              <MetricInput
                label="거리"
                unit="km"
                value={distance}
                onChangeText={text =>
                  setForm(current => ({
                    ...current,
                    distance: text,
                    auto: false,
                  }))
                }
                placeholder="5"
                keyboardType="decimal-pad"
              />
              <MetricInput
                label="완주 시간"
                value={clock}
                onChangeText={text =>
                  setForm(current => ({ ...current, clock: text, auto: false }))
                }
                placeholder="30:00"
                keyboardType="number-pad"
                maxClockDigits={clockDigits.duration}
              />
            </View>
            <View style={styles.auto}>
              <AppText
                variant="caption"
                tone="textSecondary"
                style={styles.flex}
              >
                자동 계산 · 페이스
              </AppText>
              <AppText variant="metric">
                {entry ? formatPace(entry.usualPaceSecPerKm) : '– –'}
              </AppText>
            </View>
          </View>
        )}
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
  pressed: { opacity: 0.6 },
  levels: { gap: 12 },
  level: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  levelTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  levelDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: onboardingLook.sub,
  },
  // 평소 페이스 sits on a glass card like the 1.x fields.
  pace: {
    gap: spacing.lg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: onboardingLook.glassRim,
    backgroundColor: onboardingLook.glass,
    boxShadow: onboardingLook.glassShadow,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  // Both tabs' bodies share one height (담당자 결정), so switching tabs never resizes the card. The pace stepper
  // sits in the middle of it.
  paceBody: { justifyContent: 'center' },
  durationBody: { gap: spacing.lg },
  paceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paceTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  // The handoff's pace: − and + in white circles either side of a big number.
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    boxShadow: '0 4px 12px rgba(9,17,26,0.1)',
  },
  paceValue: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  // No lineHeight: on Android it clips the top of a single-line input.
  paceInput: {
    minWidth: 120,
    padding: 0,
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 48,
    includeFontPadding: false,
    color: onboardingLook.ink,
  },
  paceUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.label,
  },
  inputs: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1, gap: 6 },
  metricLabel: {
    paddingHorizontal: 4,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: onboardingLook.label,
  },
  metricRow: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: 14,
    // At rest each field is a raised glass tile on the card (a lit top edge and a soft drop shadow) with a thin
    // navy rim in the runner's navy (담당자 결정).
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#182F3F',
    backgroundColor: 'rgba(255,255,255,0.62)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.9), 0 4px 12px rgba(9,17,26,0.12)',
  },
  // Pressed or typing, it sinks into the card: a shade inside the top edge, a light line inside the bottom one,
  // and a lit lip under it (담당자 결정: 누르면 들어가게).
  metricRowSunk: {
    backgroundColor: 'rgba(255,255,255,0.48)',
    boxShadow:
      'inset 0 5px 10px rgba(9,17,26,0.26), inset 0 -1px 0 rgba(255,255,255,0.7), 0 1px 0 rgba(255,255,255,0.95)',
  },
  // While typing the rim also thickens to ink; the inner padding drops by the same 0.5 so nothing moves.
  metricRowFocused: {
    borderWidth: 1.5,
    borderColor: onboardingLook.ink,
    paddingHorizontal: 13.5,
  },
  metricInput: { flex: 1, padding: 0 },
  auto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 4,
  },
});
