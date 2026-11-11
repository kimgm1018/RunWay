import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {
  AppText,
  BottomSheet,
  Icon,
  RulerPicker,
  type IconName,
} from '../../../components';
import { formatDuration, formatPace } from '../../../format';
import { fontFamily, k1, ThemeProvider, useTheme } from '../../../theme';
import {
  formatGoalDistance,
  formatGoalDuration,
  goalDefaults,
  goalLimits,
  pacerPace,
  type GoalKind,
  type RunGoal,
} from './runGoal';

type Row = {
  kind: GoalKind;
  kicker: string;
  value: string;
  note?: string;
  icon: IconName;
};

// The goal each kind opens with: the current one when it is that kind, else the defaults.
function draftOf(kind: GoalKind, current: RunGoal): RunGoal {
  if (current.kind === kind) {
    return current;
  }
  switch (kind) {
    case 'DISTANCE':
      return { kind, distanceM: goalDefaults.distanceM };
    case 'TIME':
      return { kind, durationSec: goalDefaults.durationSec };
    case 'PACER':
      return {
        kind,
        distanceM: goalDefaults.distanceM,
        durationSec: goalDefaults.durationSec,
      };
    case 'PACE':
      return { kind, paceSecPerKm: goalDefaults.paceSecPerKm };
    default:
      return { kind } as RunGoal;
  }
}

const titles: Record<GoalKind, string> = {
  NONE: '목표 없음',
  PLAN: '추천 전략',
  DISTANCE: '거리',
  TIME: '시간',
  PACER: '페이서',
  PACE: '페이스',
};

// 자유 러닝은 거리·시간 체크를 한 화면에서 조합한다. 코스 러닝은 기존 추천 전략·시간·페이스 화면을 유지한다.
export function RunGoalSheet(props: {
  visible: boolean;
  onClose: () => void;
  mode: 'FREE' | 'COURSE';
  goal: RunGoal;
  course?: { distanceM: number; plannedPace: number | null };
  onSet: (goal: RunGoal) => void;
  onStart: (goal: RunGoal) => void;
}) {
  return props.mode === 'FREE' ? (
    <FreeGoalSheet {...props} />
  ) : (
    <CourseGoalSheet {...props} />
  );
}

function CourseGoalSheet({
  visible,
  onClose,
  goal,
  course,
  onSet,
  onStart,
}: {
  visible: boolean;
  onClose: () => void;
  mode: 'FREE' | 'COURSE';
  goal: RunGoal;
  course?: { distanceM: number; plannedPace: number | null };
  onSet: (goal: RunGoal) => void;
  onStart: (goal: RunGoal) => void;
}) {
  const { colors } = useTheme();
  const [detail, setDetail] = useState<RunGoal | null>(null);
  useEffect(() => {
    if (!visible) {
      setDetail(null);
    }
  }, [visible]);

  const kinds: GoalKind[] = ['PLAN', 'TIME', 'PACE'];
  const rowOf = (kind: GoalKind): Row => {
    const draft = draftOf(kind, goal);
    switch (draft.kind) {
      case 'NONE':
        return {
          kind,
          kicker: '자유롭게',
          value: '목표 없음',
          icon: 'compass',
        };
      case 'PLAN':
        return {
          kind,
          kicker: '추천 전략',
          value: course?.plannedPace
            ? `${formatPace(course.plannedPace)}/km`
            : '추천 전략',
          note: '오늘 컨디션과 코스 경사에 맞춘 구간 페이스',
          icon: 'route',
        };
      case 'DISTANCE':
        return {
          kind,
          kicker: '거리',
          value: formatGoalDistance(draft.distanceM),
          icon: 'mapPin',
        };
      case 'TIME':
        return {
          kind,
          kicker: '시간',
          value: formatGoalDuration(draft.durationSec),
          note: course
            ? `페이스 ${formatPace(
                pacerPace(course.distanceM, draft.durationSec),
              )}/km`
            : undefined,
          icon: 'clock',
        };
      case 'PACER':
        return {
          kind,
          kicker: '페이서',
          value: formatGoalDistance(draft.distanceM),
          note: `${formatGoalDuration(draft.durationSec)} · ${formatPace(
            pacerPace(draft.distanceM, draft.durationSec),
          )}/km`,
          icon: 'trend',
        };
      case 'PACE':
        return {
          kind,
          kicker: '페이스',
          value: `${formatPace(draft.paceSecPerKm)}/km`,
          note: course
            ? `예상 ${formatDuration(
                Math.round((course.distanceM / 1000) * draft.paceSecPerKm),
              )}`
            : undefined,
          icon: 'pulse',
        };
    }
  };
  const close = () => {
    setDetail(null);
    onClose();
  };

  // Like 3.1 코스 조건 (담당자 요청): a deep navy sheet read in the dark tone, its goal cards white.
  return (
    <ThemeProvider tone="dark">
      <BottomSheet
        visible={visible}
        onClose={close}
        title={detail ? titles[detail.kind] : '운동 목표'}
        background={k1.night}
      >
        {detail ? (
          <GoalDetail
            draft={detail}
            course={course}
            onChange={setDetail}
            onBack={() => setDetail(null)}
            onSet={() => onSet(detail)}
            onStart={() => onStart(detail)}
          />
        ) : (
          <ThemeProvider tone="light">
            <View style={styles.list}>
              {kinds.map(kind => {
                const row = rowOf(kind);
                const selected = goal.kind === kind;
                const simple = kind === 'NONE' || kind === 'PLAN';
                return (
                  <View
                    key={kind}
                    style={[styles.card, selected && styles.cardSelected]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${titles[kind]} 목표`}
                      accessibilityState={{ selected }}
                      onPress={() =>
                        simple
                          ? onSet(draftOf(kind, goal))
                          : setDetail(draftOf(kind, goal))
                      }
                      style={styles.cardBody}
                    >
                      <View style={styles.badge}>
                        <Icon name={row.icon} color={k1.ice} size={18} />
                        {selected ? (
                          <View style={styles.check}>
                            <Icon name="check" color="#FFFFFF" size={10} />
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="label" tone="textTertiary">
                          {row.kicker}
                        </AppText>
                        <AppText style={styles.cardValue} numberOfLines={1}>
                          {row.value}
                        </AppText>
                        {row.note ? (
                          <AppText variant="label" tone="textSecondary">
                            {row.note}
                          </AppText>
                        ) : null}
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${titles[kind]} 목표로 바로 시작`}
                      onPress={() => onStart(draftOf(kind, goal))}
                      hitSlop={6}
                      style={[styles.play, { backgroundColor: colors.accent }]}
                    >
                      <Icon
                        name="play"
                        color={colors.onAccent}
                        size={18}
                        solid
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </ThemeProvider>
        )}
      </BottomSheet>
    </ThemeProvider>
  );
}

function FreeGoalSheet({
  visible,
  onClose,
  goal,
  onSet,
  onStart,
}: {
  visible: boolean;
  onClose: () => void;
  goal: RunGoal;
  onSet: (goal: RunGoal) => void;
  onStart: (goal: RunGoal) => void;
}) {
  const { height } = useWindowDimensions();
  const [distanceM, setDistanceM] = useState(
    goal.kind === 'DISTANCE' || goal.kind === 'PACER'
      ? goal.distanceM
      : goalDefaults.distanceM,
  );
  const [durationSec, setDurationSec] = useState(
    goal.kind === 'TIME' || goal.kind === 'PACER'
      ? goal.durationSec
      : goalDefaults.durationSec,
  );
  const [distanceChecked, setDistanceChecked] = useState(
    goal.kind === 'DISTANCE' || goal.kind === 'PACER',
  );
  const [timeChecked, setTimeChecked] = useState(
    goal.kind === 'TIME' || goal.kind === 'PACER',
  );
  useEffect(() => {
    if (visible) {
      setDistanceM(
        goal.kind === 'DISTANCE' || goal.kind === 'PACER'
          ? goal.distanceM
          : goalDefaults.distanceM,
      );
      setDurationSec(
        goal.kind === 'TIME' || goal.kind === 'PACER'
          ? goal.durationSec
          : goalDefaults.durationSec,
      );
      setDistanceChecked(goal.kind === 'DISTANCE' || goal.kind === 'PACER');
      setTimeChecked(goal.kind === 'TIME' || goal.kind === 'PACER');
    }
  }, [visible, goal]);
  const selected: RunGoal =
    distanceChecked && timeChecked
      ? { kind: 'PACER', distanceM, durationSec }
      : distanceChecked
      ? { kind: 'DISTANCE', distanceM }
      : timeChecked
      ? { kind: 'TIME', durationSec }
      : { kind: 'NONE' };
  const pace =
    distanceChecked && timeChecked ? pacerPace(distanceM, durationSec) : null;
  const unrealistic =
    pace !== null &&
    (pace < goalLimits.paceSec.min || pace > goalLimits.paceSec.max);
  return (
    <ThemeProvider tone="dark">
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title="운동 목표"
        background={k1.night}
      >
        <ThemeProvider tone="light">
          <ScrollView
            style={{ maxHeight: height * 0.72 }}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          >
            <AppText variant="label" tone="textSecondary" style={styles.center}>
              선택하지 않으면 목표 없이 달려요
            </AppText>
            <WhiteBox
              style={[styles.field, distanceChecked && styles.freeSelected]}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="거리 목표 선택"
                accessibilityState={{ checked: distanceChecked }}
                onPress={() => setDistanceChecked(value => !value)}
                style={styles.freeChoice}
              >
                <Icon name="mapPin" color={k1.night} size={20} />
                <AppText variant="label">거리</AppText>
                <AppText style={styles.freeValue}>
                  {formatGoalDistance(distanceM)}
                </AppText>
                <View
                  style={[
                    styles.freeCheckbox,
                    distanceChecked && styles.freeCheckboxSelected,
                  ]}
                >
                  {distanceChecked ? (
                    <Icon name="check" color="#FFFFFF" size={16} />
                  ) : null}
                </View>
              </Pressable>
              {distanceChecked ? (
                <RulerPicker
                  label="목표 거리"
                  value={distanceM / 1000}
                  {...goalLimits.distanceKm}
                  format={value => formatGoalDistance(value * 1000)}
                  onChange={value => setDistanceM(Math.round(value * 1000))}
                  {...whiteRuler}
                />
              ) : null}
            </WhiteBox>
            <WhiteBox
              style={[styles.field, timeChecked && styles.freeSelected]}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="시간 목표 선택"
                accessibilityState={{ checked: timeChecked }}
                onPress={() => setTimeChecked(value => !value)}
                style={styles.freeChoice}
              >
                <Icon name="clock" color={k1.night} size={20} />
                <AppText variant="label">시간</AppText>
                <AppText style={styles.freeValue}>
                  {formatGoalDuration(durationSec)}
                </AppText>
                <View
                  style={[
                    styles.freeCheckbox,
                    timeChecked && styles.freeCheckboxSelected,
                  ]}
                >
                  {timeChecked ? (
                    <Icon name="check" color="#FFFFFF" size={16} />
                  ) : null}
                </View>
              </Pressable>
              {timeChecked ? (
                <RulerPicker
                  label="목표 시간"
                  value={durationSec / 60}
                  {...goalLimits.durationMin}
                  format={value => formatGoalDuration(value * 60)}
                  onChange={value => setDurationSec(Math.round(value * 60))}
                  {...whiteRuler}
                />
              ) : null}
            </WhiteBox>
            {pace !== null ? (
              <WhiteBox
                style={styles.derived}
                accessibilityLabel="계산한 페이스"
              >
                <AppText style={styles.derivedValue}>{`${formatPace(
                  pace,
                )}/km`}</AppText>
                <AppText variant="label" tone="textSecondary">
                  거리와 시간으로 계산한 페이스
                </AppText>
              </WhiteBox>
            ) : null}
            {unrealistic ? (
              <AppText
                variant="captionStrong"
                tone="danger"
                style={styles.center}
                accessibilityLiveRegion="polite"
              >{`페이스가 ${formatPace(goalLimits.paceSec.min)}~${formatPace(
                goalLimits.paceSec.max,
              )}/km 사이가 되도록 거리나 시간을 바꿔 주세요`}</AppText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="이 목표로 러닝 시작"
              accessibilityState={{ disabled: unrealistic }}
              disabled={unrealistic}
              onPress={() => onStart(selected)}
              style={[
                styles.start,
                styles.white,
                unrealistic && styles.pressed,
              ]}
            >
              <AppText style={[styles.startText, { color: k1.night }]}>
                러닝 시작
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="목표만 설정"
              accessibilityState={{ disabled: unrealistic }}
              disabled={unrealistic}
              onPress={() => onSet(selected)}
              style={styles.center}
            >
              <AppText variant="captionStrong" tone="textSecondary">
                목표만 설정
              </AppText>
            </Pressable>
          </ScrollView>
        </ThemeProvider>
      </BottomSheet>
    </ThemeProvider>
  );
}

// A white box on the navy sheet read in the light tone, so its labels and ruler are navy (담당자 요청).
function WhiteBox({
  style,
  children,
  ...rest
}: ViewProps & { style: StyleProp<ViewStyle> }) {
  return (
    <ThemeProvider tone="light">
      <View {...rest} style={[style, styles.white]}>
        {children}
      </View>
    </ThemeProvider>
  );
}

function GoalDetail({
  draft,
  course,
  onChange,
  onBack,
  onSet,
  onStart,
}: {
  draft: RunGoal;
  course?: { distanceM: number; plannedPace: number | null };
  onChange: (goal: RunGoal) => void;
  onBack: () => void;
  onSet: () => void;
  onStart: () => void;
}) {
  const { colors } = useTheme();
  const ruler = whiteRuler;
  const distanceRuler = (distanceM: number, set: (metres: number) => void) => (
    <WhiteBox style={styles.field}>
      <AppText variant="label" tone="textSecondary">
        거리
      </AppText>
      <RulerPicker
        label="목표 거리"
        value={distanceM / 1000}
        {...goalLimits.distanceKm}
        format={value => formatGoalDistance(value * 1000)}
        onChange={value => set(Math.round(value * 1000))}
        {...ruler}
      />
    </WhiteBox>
  );
  const durationRuler = (
    durationSec: number,
    set: (seconds: number) => void,
  ) => (
    <WhiteBox style={styles.field}>
      <AppText variant="label" tone="textSecondary">
        시간
      </AppText>
      <RulerPicker
        label="목표 시간"
        value={durationSec / 60}
        {...goalLimits.durationMin}
        format={value => formatGoalDuration(value * 60)}
        onChange={value => set(Math.round(value * 60))}
        {...ruler}
      />
    </WhiteBox>
  );
  // The pace the distance and the time make, or the course distance and the time.
  const derived =
    draft.kind === 'PACER'
      ? pacerPace(draft.distanceM, draft.durationSec)
      : draft.kind === 'TIME' && course
      ? pacerPace(course.distanceM, draft.durationSec)
      : null;
  // A distance and a time that make a pace no runner keeps (faster than 3′00″ or slower than 15′00″ per km) are
  // not sent: the server turns such a goal down (sessions.md 422 INVALID_GOAL).
  const unrealistic =
    derived !== null &&
    (derived < goalLimits.paceSec.min || derived > goalLimits.paceSec.max);
  return (
    <View style={styles.detail}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="목표 목록으로"
        onPress={onBack}
        hitSlop={8}
        style={styles.back}
      >
        <Icon name="back" color={colors.textSecondary} size={16} />
        <AppText variant="captionStrong" tone="textSecondary">
          목표 목록
        </AppText>
      </Pressable>
      {draft.kind === 'DISTANCE'
        ? distanceRuler(draft.distanceM, distanceM =>
            onChange({ ...draft, distanceM }),
          )
        : null}
      {draft.kind === 'TIME'
        ? durationRuler(draft.durationSec, durationSec =>
            onChange({ ...draft, durationSec }),
          )
        : null}
      {draft.kind === 'PACER' ? (
        <>
          {distanceRuler(draft.distanceM, distanceM =>
            onChange({ ...draft, distanceM }),
          )}
          {durationRuler(draft.durationSec, durationSec =>
            onChange({ ...draft, durationSec }),
          )}
        </>
      ) : null}
      {draft.kind === 'PACE' ? (
        <WhiteBox style={styles.field}>
          <AppText variant="label" tone="textSecondary">
            페이스
          </AppText>
          <RulerPicker
            label="목표 페이스"
            value={draft.paceSecPerKm}
            {...goalLimits.paceSec}
            format={value => `${formatPace(value)}/km`}
            onChange={paceSecPerKm => onChange({ ...draft, paceSecPerKm })}
            {...ruler}
          />
        </WhiteBox>
      ) : null}
      {derived !== null ? (
        <WhiteBox style={styles.derived} accessibilityLabel="계산한 페이스">
          <AppText style={styles.derivedValue}>{`${formatPace(
            derived,
          )}/km`}</AppText>
          <AppText variant="label" tone="textSecondary">
            {course
              ? '코스 거리로 계산한 페이스'
              : '거리와 시간으로 계산한 페이스'}
          </AppText>
        </WhiteBox>
      ) : null}
      {unrealistic ? (
        <AppText
          variant="captionStrong"
          tone="danger"
          style={styles.center}
          accessibilityLiveRegion="polite"
        >
          {`페이스가 ${formatPace(goalLimits.paceSec.min)}~${formatPace(
            goalLimits.paceSec.max,
          )}/km 사이가 되도록 거리나 시간을 바꿔 주세요`}
        </AppText>
      ) : null}
      {draft.kind === 'PACE' && course ? (
        <AppText variant="label" tone="textSecondary" style={styles.center}>
          {`예상 완주 ${formatDuration(
            Math.round((course.distanceM / 1000) * draft.paceSecPerKm),
          )}`}
        </AppText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="이 목표로 러닝 시작"
        accessibilityState={{ disabled: unrealistic }}
        disabled={unrealistic}
        onPress={onStart}
        style={({ pressed }) => [
          styles.start,
          styles.white,
          (pressed || unrealistic) && styles.pressed,
        ]}
      >
        <AppText style={[styles.startText, { color: k1.night }]}>
          러닝 시작
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="목표만 설정"
        accessibilityState={{ disabled: unrealistic }}
        disabled={unrealistic}
        onPress={onSet}
        hitSlop={8}
        style={styles.center}
      >
        <AppText variant="captionStrong" tone="textSecondary">
          목표만 설정
        </AppText>
      </Pressable>
    </View>
  );
}

// Navy value and ticks on the white boxes.
const whiteRuler = { color: k1.night, mutedColor: 'rgba(2,5,14,0.32)' };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  white: { backgroundColor: '#FFFFFF' },
  list: { gap: 10 },
  freeChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
  },
  freeValue: {
    marginLeft: 'auto',
    fontFamily: fontFamily.numberBold,
    fontSize: 20,
  },
  freeSelected: { borderWidth: 2, borderColor: k1.mid },
  freeCheckbox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: k1.mid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeCheckboxSelected: { backgroundColor: k1.night, borderColor: k1.night },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
  },
  // The chosen goal: a blue-grey rim that shows on the white card and the navy sheet.
  cardSelected: { borderColor: k1.mid },
  cardBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: k1.night,
  },
  check: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: k1.mid,
  },
  cardValue: {
    fontFamily: fontFamily.numberBold,
    fontSize: 24,
    lineHeight: 30,
  },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detail: { gap: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  field: { padding: 14, borderRadius: 20, gap: 4 },
  derived: { alignItems: 'center', padding: 12, borderRadius: 20 },
  derivedValue: {
    fontFamily: fontFamily.numberBold,
    fontSize: 26,
    lineHeight: 32,
  },
  center: { alignSelf: 'center', textAlign: 'center' },
  start: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22 },
  pressed: { opacity: 0.7 },
});
