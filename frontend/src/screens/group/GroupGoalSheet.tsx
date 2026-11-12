import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, BottomSheet } from '../../components';
import { RulerPicker } from '../../components/RulerPicker';
import type { GroupGoalUpdate } from '../../data';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { formatGoalDuration, goalLimits } from '../run/goal/runGoal';
import { groupTone, NumText } from './look';

// S15P31E105-702 목표 변경 on 6.4, for the host before the run. The same rule as the run goal pickers
// (S15P31E105-517): a distance and one of 완주 시간 or 페이스, so at most two are set and the third is worked
// out. Distances are 1–21.1km like C01 courses; a course run keeps its course's distance.

export const goalDistanceKm = { min: 1, max: 21.1, step: 0.5 } as const;

type Input = 'TIME' | 'PACE';

const inputs: { value: Input; label: string }[] = [
  { value: 'TIME', label: '완주 시간' },
  { value: 'PACE', label: '페이스' },
];

export type GoalDraft = { distanceKm: number; input: Input; value: number };

// The goal the sheet saves: the distance with the one picked goal (value is minutes for TIME, sec/km for PACE).
export function goalOfDraft(draft: GoalDraft): GroupGoalUpdate {
  const distanceM = Math.round(draft.distanceKm * 1000);
  return draft.input === 'TIME'
    ? { distanceM, input: 'TIME', durationSec: Math.round(draft.value * 60) }
    : { distanceM, input: 'PACE', paceSecPerKm: Math.round(draft.value) };
}

// The third value, worked out and shown but never sent.
export function derivedOf(draft: GoalDraft) {
  return draft.input === 'TIME'
    ? `${formatPace((draft.value * 60) / draft.distanceKm)}/km`
    : formatGoalDuration(draft.value * draft.distanceKm);
}

// The pickers' ranges: 페이스 3′00″–15′00″/km (goalLimits) and 완주 시간 5–180분 (review F-1).
export const goalDurationMin = { min: goalLimits.durationMin.min, max: 180 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Why the goal cannot be saved, or null. The worked-out half must stay in range too: 21.1km in 30분 would
// be 1′25″/km, which the server would take (it only checks > 0).
export function goalProblem(draft: GoalDraft): string | null {
  const pace =
    draft.input === 'PACE' ? draft.value : (draft.value * 60) / draft.distanceKm;
  const minutes =
    draft.input === 'TIME' ? draft.value : (draft.value * draft.distanceKm) / 60;
  if (pace < goalLimits.paceSec.min || pace > goalLimits.paceSec.max) {
    return `페이스는 ${formatPace(goalLimits.paceSec.min)}~${formatPace(
      goalLimits.paceSec.max,
    )}/km 안이어야 해요`;
  }
  if (minutes < goalDurationMin.min || minutes > goalDurationMin.max) {
    return `완주 시간은 ${goalDurationMin.min}분~${goalDurationMin.max / 60}시간 안이어야 해요`;
  }
  return null;
}

// 완주 시간 ↔ 페이스 keeps the same run through the distance, rounded to the picker's step and kept in range.
export function switchDraft(draft: GoalDraft, input: Input): GoalDraft {
  if (draft.input === input) {
    return draft;
  }
  return input === 'PACE'
    ? {
        ...draft,
        input,
        value: clamp(
          Math.round((draft.value * 60) / draft.distanceKm / 5) * 5,
          goalLimits.paceSec.min,
          goalLimits.paceSec.max,
        ),
      }
    : {
        ...draft,
        input,
        value: clamp(
          Math.round((draft.value * draft.distanceKm) / 60),
          goalDurationMin.min,
          goalDurationMin.max,
        ),
      };
}

// Where the sheet opens: the saved goal, else 5km in 30 minutes.
export function initialDraft(
  distanceM: number | null,
  durationSec: number | null,
): GoalDraft {
  const km = distanceM ? distanceM / 1000 : 5;
  return {
    distanceKm: km,
    input: 'TIME',
    value: durationSec ? Math.round(durationSec / 60) : Math.round(km * 6),
  };
}

export function GroupGoalSheet({
  visible,
  distanceM,
  durationSec,
  courseLocked,
  busy,
  onClose,
  onSave,
}: {
  visible: boolean;
  distanceM: number | null;
  durationSec: number | null;
  // A course run's distance is the course's.
  courseLocked: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (goal: GroupGoalUpdate) => void;
}) {
  const [draft, setDraft] = useState(() =>
    initialDraft(distanceM, durationSec),
  );
  useEffect(() => {
    if (visible) {
      setDraft(initialDraft(distanceM, durationSec));
    }
  }, [visible, distanceM, durationSec]);

  // Opening and saving at once would round the saved goal to whole minutes, so 저장 waits for a change (F-4).
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (visible) {
      setDirty(false);
    }
  }, [visible]);
  const change = (next: (current: GoalDraft) => GoalDraft) => {
    setDraft(next);
    setDirty(true);
  };
  const switchInput = (input: Input) =>
    change(current => switchDraft(current, input));
  const problem = goalProblem(draft);
  const blocked = busy || !dirty || problem !== null;
  const ruler = { color: groupTone.text, mutedColor: groupTone.muted };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      background={groupTone.sheet}
    >
      <View style={styles.sheet}>
        <AppText style={styles.title}>목표 변경</AppText>
        <AppText style={styles.muted}>
          저장하면 공동 페이스를 다시 계산해요
        </AppText>
        <AppText style={styles.label}>
          {courseLocked ? '거리 · 코스 거리' : '목표 거리'}
        </AppText>
        {courseLocked ? (
          <NumText
            style={styles.fixed}
            text={`${draft.distanceKm.toFixed(1)}km`}
          />
        ) : (
          <RulerPicker
            label="목표 거리"
            value={draft.distanceKm}
            {...goalDistanceKm}
            format={value => `${value.toFixed(1)}km`}
            onChange={value =>
              change(current => ({ ...current, distanceKm: value }))
            }
            {...ruler}
          />
        )}
        <View accessibilityRole="radiogroup" style={styles.switch}>
          {inputs.map(option => {
            const on = option.value === draft.input;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: on, checked: on }}
                onPress={() => switchInput(option.value)}
                style={[styles.switchItem, on && styles.switchOn]}
              >
                <AppText style={[styles.switchText, on && styles.switchTextOn]}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {draft.input === 'TIME' ? (
          <RulerPicker
            label="목표 완주 시간"
            value={draft.value}
            min={goalDurationMin.min}
            max={goalDurationMin.max}
            step={1}
            format={value => formatGoalDuration(value * 60)}
            onChange={value => change(current => ({ ...current, value }))}
            {...ruler}
          />
        ) : (
          <RulerPicker
            label="목표 페이스"
            value={draft.value}
            {...goalLimits.paceSec}
            format={value => `${formatPace(value)}/km`}
            onChange={value => change(current => ({ ...current, value }))}
            {...ruler}
          />
        )}
        <View style={styles.derived}>
          <NumText style={styles.derivedValue} text={derivedOf(draft)} />
          <AppText style={styles.muted}>
            {draft.input === 'TIME' ? '자동 계산 · 페이스' : '자동 계산 · 완주 시간'}
          </AppText>
        </View>
        {problem ? <AppText style={styles.problem}>{problem}</AppText> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="목표 저장"
          accessibilityState={{ disabled: blocked }}
          disabled={blocked}
          onPress={() => onSave(goalOfDraft(draft))}
          style={[styles.save, blocked && styles.saveOff]}
        >
          <AppText style={styles.saveText}>저장</AppText>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 12, padding: 20 },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    color: groupTone.text,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: groupTone.sub,
  },
  fixed: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    color: groupTone.text,
  },
  switch: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 999,
    backgroundColor: groupTone.quiet,
  },
  switchItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 999,
  },
  switchOn: { backgroundColor: groupTone.button },
  switchText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
  switchTextOn: { color: groupTone.onButton },
  derived: {
    alignItems: 'center',
    gap: 2,
    padding: 12,
    borderRadius: 14,
    backgroundColor: groupTone.inner,
  },
  derivedValue: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    color: groupTone.text,
  },
  save: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: groupTone.button,
  },
  saveOff: { opacity: 0.5 },
  problem: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.danger,
  },
  saveText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 22,
    color: groupTone.onButton,
  },
});
