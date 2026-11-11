import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components';
import type {
  GroupPaceInfo,
  GroupPaceMode,
  GroupRunParticipant,
} from '../../data';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { groupTone, NumText } from './look';

// S15P31E105-680 공동 페이스 카드 on 6.4: the AI recommendation and whose plan it comes from, the host's goal, the
// pace applied in the chosen mode (highlighted), 계산 중 while the server recalculates, and a short 방금 바뀜 line.

export const paceModeLabel: Record<GroupPaceMode, string> = {
  TOGETHER: '함께 완주',
  GOAL: '목표 페이스',
};

export type PaceChange = { from: number; to: number; label: string };

// What changed between two looks at the run, for the 방금 바뀜 line: who joined or left, else the mode or the goal.
export function changeLabel(
  before: { pace: GroupPaceInfo; participants: GroupRunParticipant[] },
  after: { pace: GroupPaceInfo; participants: GroupRunParticipant[] },
): string {
  const had = new Set(before.participants.map(member => member.userId));
  const has = new Set(after.participants.map(member => member.userId));
  const joined = after.participants.find(member => !had.has(member.userId));
  if (joined) {
    return `${joined.nickname} 참가`;
  }
  const left = before.participants.find(member => !has.has(member.userId));
  if (left) {
    return `${left.nickname} 나감`;
  }
  if (before.pace.mode !== after.pace.mode) {
    return `${paceModeLabel[after.pace.mode]}로 변경`;
  }
  if (before.pace.goalSecPerKm !== after.pace.goalSecPerKm) {
    return '목표 변경';
  }
  return '다시 계산';
}

function Row({
  label,
  value,
  sub,
  applied,
}: {
  label: string;
  value: string;
  sub?: string | null;
  applied: boolean;
}) {
  return (
    <View style={[styles.row, applied && styles.rowApplied]}>
      <AppText style={styles.rowLabel}>{label}</AppText>
      <View style={styles.rowBody}>
        <NumText style={styles.rowValue} text={value} />
        {sub ? <AppText style={styles.sub}>{sub}</AppText> : null}
      </View>
      {applied ? <AppText style={styles.badge}>적용</AppText> : null}
    </View>
  );
}

export function GroupPaceCard({
  pace,
  change,
  canChangeMode,
  busy,
  onChangeMode,
}: {
  pace: GroupPaceInfo;
  change: PaceChange | null;
  canChangeMode: boolean;
  busy: boolean;
  onChangeMode: (mode: GroupPaceMode) => void;
}) {
  const calculating = pace.calculating;
  // The applied pace comes from the AI line when it is a member's plan, otherwise from the goal.
  const aiApplied = !calculating && pace.basis === 'MEMBER';
  const goalApplied = !calculating && pace.basis === 'GOAL';
  const aiValue = calculating
    ? '계산 중…'
    : pace.aiSecPerKm != null
    ? formatPace(pace.aiSecPerKm)
    : '기록 부족 · 중앙값';
  const aiSub =
    !calculating && pace.aiSecPerKm != null && pace.basisNickname
      ? `${pace.basisNickname}님 기준`
      : null;
  const slower = pace.slowerThanGoalCount ?? 0;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <AppText style={styles.title}>공동 페이스</AppText>
        <AppText style={styles.mode}>{paceModeLabel[pace.mode]}</AppText>
      </View>
      <NumText
        style={styles.applied}
        text={
          calculating
            ? '계산 중…'
            : pace.appliedSecPerKm != null
            ? formatPace(pace.appliedSecPerKm)
            : '—'
        }
      />
      {change && !calculating ? (
        <NumText
          style={styles.change}
          text={`${formatPace(change.from)} → ${formatPace(change.to)} · ${
            change.label
          }`}
        />
      ) : null}
      <Row label="AI 추천" value={aiValue} sub={aiSub} applied={aiApplied} />
      <Row
        label="목표"
        value={
          pace.goalSecPerKm != null ? formatPace(pace.goalSecPerKm) : '목표 없음'
        }
        applied={goalApplied}
      />
      {pace.mode === 'GOAL' && !calculating && slower > 0 ? (
        <AppText style={styles.warning}>
          {`참가자 ${slower}명은 목표보다 느릴 수 있어요 · 위험할 때만 늦춰요`}
        </AppText>
      ) : null}
      {canChangeMode ? (
        <View style={styles.modes}>
          {(['TOGETHER', 'GOAL'] as const).map(mode => {
            const selected = pace.mode === mode;
            const disabled =
              busy || (mode === 'GOAL' && pace.goalSecPerKm == null);
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                disabled={disabled || selected}
                onPress={() => onChangeMode(mode)}
                style={[
                  styles.modeChip,
                  selected && styles.modeChipOn,
                  disabled && !selected && styles.modeChipOff,
                ]}
              >
                <AppText
                  style={[styles.modeText, selected && styles.modeTextOn]}
                >
                  {paceModeLabel[mode]}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {canChangeMode ? (
        <AppText style={styles.sub}>
          {pace.mode === 'GOAL'
            ? '목표 페이스를 지키고 심박이 위험할 때만 늦춰요'
            : '가장 느린 참가자에 맞춰 모두 함께 완주해요'}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: groupTone.inner,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  mode: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.onAccent,
    backgroundColor: groupTone.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  applied: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 32,
    color: groupTone.text,
  },
  change: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.accent,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  rowApplied: { backgroundColor: groupTone.accentSoft },
  rowLabel: {
    width: 56,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  rowBody: { flex: 1 },
  rowValue: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    color: groupTone.text,
  },
  badge: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.accent,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: groupTone.sub,
  },
  warning: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.danger,
  },
  modes: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: groupTone.quiet,
  },
  modeChipOn: { backgroundColor: groupTone.accent },
  modeChipOff: { opacity: 0.45 },
  modeText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
  modeTextOn: { color: groupTone.onAccent },
});
