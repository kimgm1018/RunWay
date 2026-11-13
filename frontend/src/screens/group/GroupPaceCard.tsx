import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components';
import type {
  GroupPaceInfo,
  GroupPaceMode,
  GroupRunParticipant,
  GroupRunSummary,
} from '../../data';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { groupTone, NumText } from './look';

// S15P31E105-680 공동 페이스 카드 on 6.4: the AI recommendation and whose plan it comes from, the host's goal, the
// pace applied in the chosen mode (highlighted), 계산 중 while the server recalculates, and a short 방금 바뀜 line.

// The buttons carry the names of the rows they apply: AI 추천 (TOGETHER) and 목표 페이스 (GOAL). S15P31E105-702.
export const paceModeLabel: Record<GroupPaceMode, string> = {
  TOGETHER: 'AI 추천',
  GOAL: '목표 페이스',
};

const modeDescription: Record<GroupPaceMode, string> = {
  TOGETHER: '모두가 끝까지 함께 달릴 수 있는 페이스로 달려요',
  GOAL: '목표 페이스로 달리고, 심박이 위험할 때만 AI가 늦춰요',
};

// The detail's course row while the card shows: only what kind of run it is; the goal is in the card.
export function runKind(run: Pick<GroupRunSummary, 'courseName'>) {
  return run.courseName ?? '자유 러닝';
}

// The card's 목표 row: the whole goal, e.g. 30분 · 6′00″ or 5km · 30분 · 6′00″. A course run's distance is the
// course's, named on the course row above, so it is not repeated here.
export function goalSummary(
  run: Pick<
    GroupRunSummary,
    'courseName' | 'targetDistanceM' | 'targetDurationSec'
  >,
  goalSecPerKm: number | null,
) {
  const parts: string[] = [];
  if (!run.courseName && run.targetDistanceM) {
    const km = run.targetDistanceM / 1000;
    parts.push(`${Number.isInteger(km) ? km : km.toFixed(1)}km`);
  }
  if (run.targetDurationSec) {
    parts.push(`${Math.round(run.targetDurationSec / 60)}분`);
  }
  if (goalSecPerKm != null) {
    parts.push(formatPace(goalSecPerKm));
  }
  return parts.length ? parts.join(' · ') : '목표 없음';
}

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
  onEdit,
}: {
  label: string;
  value: string;
  sub?: string | null;
  applied: boolean;
  // S15P31E105-702: the host's 목표 row opens the goal sheet.
  onEdit?: () => void;
}) {
  const body = (
    <>
      <AppText style={styles.rowLabel}>{label}</AppText>
      <View style={styles.rowBody}>
        <NumText
          style={styles.rowValue}
          numberStyle={styles.rowValueNumber}
          text={value}
        />
        {sub ? <NumText style={styles.sub} text={sub} /> : null}
      </View>
      {applied ? <AppText style={styles.badge}>적용</AppText> : null}
      {onEdit ? <AppText style={styles.edit}>변경</AppText> : null}
    </>
  );
  return onEdit ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} 변경`}
      onPress={onEdit}
      style={[styles.row, applied && styles.rowApplied]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={[styles.row, applied && styles.rowApplied]}>{body}</View>
  );
}

// The goal the card compares against (S15P31E105-741): the run's distance when it has one, and its time when the goal
// was set by time. A course run's distance is the course's, named on the course row above, so it is not repeated.
export type CardGoal = {
  distanceM: number | null;
  durationSec: number | null;
  showDistance: boolean;
};

export function cardGoal(
  run: Pick<
    GroupRunSummary,
    'courseName' | 'targetDistanceM' | 'targetDurationSec'
  >,
): CardGoal {
  return {
    distanceM: run.targetDistanceM,
    durationSec: run.targetDurationSec,
    showDistance: !run.courseName && !!run.targetDistanceM,
  };
}

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
const kmText = (distanceM: number) => {
  const km = distanceM / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)}km`;
};

// The AI row's small line: what the pace is for, and about how long the distance takes at it.
export function aiSubLine(goal: CardGoal, aiSecPerKm: number) {
  return goal.distanceM
    ? `모두가 뛸 수 있는 페이스 · 약 ${minutes(
        (goal.distanceM / 1000) * aiSecPerKm,
      )}분`
    : '모두가 뛸 수 있는 페이스';
}

// The 목표 row's small line: the time the goal was set by (N분 완주), or the time its pace makes of the distance
// (예상 N분); nothing when there is neither.
export function goalSubLine(goal: CardGoal, goalSecPerKm: number | null) {
  const distance = goal.showDistance && goal.distanceM ? kmText(goal.distanceM) : null;
  const time = goal.durationSec
    ? `${minutes(goal.durationSec)}분 완주`
    : goal.distanceM && goalSecPerKm != null
    ? `예상 ${minutes((goal.distanceM / 1000) * goalSecPerKm)}분`
    : null;
  return [distance, time].filter(Boolean).join(' · ') || null;
}

export function GroupPaceCard({
  pace,
  change,
  canChangeMode,
  busy,
  onChangeMode,
  onEditGoal,
  goal = { distanceM: null, durationSec: null, showDistance: false },
}: {
  pace: GroupPaceInfo;
  // The run's distance and time goal, for the rows' small lines (cardGoal).
  goal?: CardGoal;
  change: PaceChange | null;
  canChangeMode: boolean;
  busy: boolean;
  onChangeMode: (mode: GroupPaceMode) => void;
  // Only for the host before the run (S15P31E105-702); members just read the goal.
  onEditGoal?: () => void;
}) {
  const calculating = pace.calculating;
  // The applied pace comes from the AI line when it is a member's plan, otherwise from the goal.
  const aiApplied = !calculating && pace.basis === 'MEMBER';
  const goalApplied = !calculating && pace.basis === 'GOAL';
  // Both rows lead with a pace, large, so the two read side by side; the time is the small line under each
  // (S15P31E105-741). The applied row is lit and marked 적용, so the pace is not repeated under the title — only
  // when neither row holds it (계산 중, or the median when no one has records) does it stand there.
  const aiValue = calculating
    ? '계산 중…'
    : pace.aiSecPerKm != null
    ? formatPace(pace.aiSecPerKm)
    : '기록 부족';
  // Who the recommendation is based on stays off the screen (it would say who is slowest).
  const aiSub =
    !calculating && pace.aiSecPerKm != null
      ? aiSubLine(goal, pace.aiSecPerKm)
      : null;
  const headValue = calculating
    ? '계산 중…'
    : !aiApplied && !goalApplied && pace.appliedSecPerKm != null
    ? `${formatPace(pace.appliedSecPerKm)} · 중앙값`
    : null;
  const slower = pace.slowerThanGoalCount ?? 0;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <AppText style={styles.title}>공동 페이스</AppText>
        {headValue ? (
          <NumText
            style={styles.applied}
            numberStyle={styles.appliedNumber}
            text={headValue}
          />
        ) : null}
      </View>
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
        sub={goalSubLine(goal, pace.goalSecPerKm)}
        applied={goalApplied}
        onEdit={onEditGoal}
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
      <AppText style={styles.sub}>{modeDescription[pace.mode]}</AppText>
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
    fontSize: 16,
    lineHeight: 22,
    color: groupTone.text,
  },
  applied: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    color: groupTone.text,
  },
  // The digits in the weight of the line they sit in (NumText draws them SemiBold on its own).
  appliedNumber: { fontFamily: fontFamily.numberBold },
  change: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
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
    width: 60,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
  },
  rowBody: { flex: 1, gap: 2 },
  rowValueNumber: { fontFamily: fontFamily.numberBold },
  rowValue: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    color: groupTone.text,
  },
  edit: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
    textDecorationLine: 'underline',
  },
  badge: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.accent,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  warning: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
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
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  modeTextOn: { color: groupTone.onAccent },
});
