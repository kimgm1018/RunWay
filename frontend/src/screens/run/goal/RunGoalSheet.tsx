import React, { useEffect, useRef, useState } from 'react';
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
  maxGoalDistanceM,
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

// A finish time or a pace on a course: each makes the other from the course's length.
function finishAndPace(
  goal: RunGoal,
  course: { distanceM: number },
): { durationSec: number; paceSecPerKm: number } {
  const km = course.distanceM / 1000;
  if (goal.kind === 'PACE') {
    return {
      durationSec: Math.round(km * goal.paceSecPerKm),
      paceSecPerKm: goal.paceSecPerKm,
    };
  }
  const durationSec =
    goal.kind === 'TIME' ? goal.durationSec : goalDefaults.durationSec;
  return { durationSec, paceSecPerKm: durationSec / km };
}

const titles: Record<GoalKind, string> = {
  NONE: '목표 없음',
  PLAN: '추천 전략',
  DISTANCE: '거리',
  TIME: '시간',
  PACER: '페이서',
  PACE: '페이스',
  DISTANCE_PACE: '거리 · 페이스',
  TIME_PACE: '시간 · 페이스',
};

// 자유 러닝은 거리·시간 체크를 한 화면에서 조합한다. 코스 러닝은 거리가 정해져 있어 시간·페이스(계획이 있으면 추천
// 전략) 중 하나를 고르고, 고르지 않으면 목표 없이 달린다. 두 시트 모두 목표만 정하고, 시작은 지도의 러닝 시작으로 한다
// (S15P31E105-683).
export function RunGoalSheet(props: {
  visible: boolean;
  onClose: () => void;
  mode: 'FREE' | 'COURSE';
  goal: RunGoal;
  course?: { distanceM: number; plannedPace: number | null };
  onSet: (goal: RunGoal) => void;
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
}: {
  visible: boolean;
  onClose: () => void;
  mode: 'FREE' | 'COURSE';
  goal: RunGoal;
  course?: { distanceM: number; plannedPace: number | null };
  onSet: (goal: RunGoal) => void;
}) {
  const [detail, setDetail] = useState<RunGoal | null>(null);
  // Without 추천 전략 the finish time is the only goal a course takes, so 목표 설정 opens its rulers at once
  // (S15P31E105-683, 담당자 요청).
  const only = !course?.plannedPace;
  useEffect(() => {
    if (!visible) {
      setDetail(null);
    } else if (only) {
      setDetail(
        goal.kind === 'TIME' || goal.kind === 'PACE'
          ? goal
          : draftOf('TIME', goal),
      );
    }
    // The goal it opens with is read when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, only]);

  // 추천 전략 only when the course carries a pace plan; without one it would run with no goal at all.
  // 완주 시간 and 페이스 are one goal on a course of fixed length (S15P31E105-683, 담당자 요청): one card, whose two
  // rulers move each other.
  const kinds: GoalKind[] = course?.plannedPace ? ['PLAN', 'TIME'] : ['TIME'];
  const finishOf = (current: RunGoal): RunGoal =>
    current.kind === 'TIME' || current.kind === 'PACE'
      ? current
      : draftOf('TIME', current);
  const rowOf = (kind: GoalKind): Row => {
    if (kind === 'TIME' && course) {
      const { durationSec, paceSecPerKm } = finishAndPace(
        finishOf(goal),
        course,
      );
      return {
        kind,
        kicker: '완주 시간 · 페이스',
        value: formatDuration(durationSec),
        note: `페이스 ${formatPace(paceSecPerKm)}/km`,
        icon: 'clock',
      };
    }
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
      case 'DISTANCE_PACE':
      case 'TIME_PACE':
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
        title={
          detail
            ? course && (detail.kind === 'TIME' || detail.kind === 'PACE')
              ? '목표 완주 시간'
              : titles[detail.kind]
            : '운동 목표'
        }
        background={k1.night}
      >
        {detail ? (
          <GoalDetail
            draft={detail}
            course={course}
            onChange={setDetail}
            onBack={only ? undefined : () => setDetail(null)}
            onSet={() => onSet(detail)}
            onClear={
              only && goal.kind !== 'NONE'
                ? () => onSet({ kind: 'NONE' })
                : undefined
            }
          />
        ) : (
          <ThemeProvider tone="light">
            <View style={styles.list}>
              <ThemeProvider tone="dark">
                <AppText
                  variant="label"
                  tone="textSecondary"
                  style={styles.center}
                >
                  선택하지 않으면 목표 없이 달려요
                </AppText>
              </ThemeProvider>
              {kinds.map(kind => {
                const row = rowOf(kind);
                const selected =
                  goal.kind === kind ||
                  (kind === 'TIME' && goal.kind === 'PACE');
                const simple = kind === 'PLAN';
                return (
                  <View
                    key={kind}
                    style={[styles.card, selected && styles.cardSelected]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        kind === 'TIME'
                          ? '완주 시간 목표'
                          : `${titles[kind]} 목표`
                      }
                      accessibilityState={{ selected }}
                      onPress={() =>
                        simple
                          ? // 추천 전략 again takes it off.
                            onSet(selected ? { kind: 'NONE' } : { kind })
                          : setDetail(finishOf(goal))
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
                  </View>
                );
              })}
              {goal.kind !== 'NONE' ? (
                <ThemeProvider tone="dark">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="목표 없이 달리기"
                    onPress={() => onSet({ kind: 'NONE' })}
                    hitSlop={8}
                    style={styles.center}
                  >
                    <AppText variant="captionStrong" tone="textSecondary">
                      목표 없이 달리기
                    </AppText>
                  </Pressable>
                </ThemeProvider>
              ) : null}
            </View>
          </ThemeProvider>
        )}
      </BottomSheet>
    </ThemeProvider>
  );
}

type Measure = 'distance' | 'time' | 'pace';

// The free goal's three measures as one record, whichever of them the goal holds.
function measuresOf(goal: RunGoal) {
  const has = (measure: Measure) =>
    measure === 'distance'
      ? goal.kind === 'DISTANCE' ||
        goal.kind === 'PACER' ||
        goal.kind === 'DISTANCE_PACE'
      : measure === 'time'
      ? goal.kind === 'TIME' ||
        goal.kind === 'PACER' ||
        goal.kind === 'TIME_PACE'
      : goal.kind === 'PACE' ||
        goal.kind === 'DISTANCE_PACE' ||
        goal.kind === 'TIME_PACE';
  return {
    distanceM: 'distanceM' in goal ? goal.distanceM : goalDefaults.distanceM,
    durationSec:
      'durationSec' in goal ? goal.durationSec : goalDefaults.durationSec,
    paceSecPerKm:
      'paceSecPerKm' in goal ? goal.paceSecPerKm : goalDefaults.paceSecPerKm,
    checked: (['distance', 'time', 'pace'] as Measure[]).filter(has),
  };
}

// 자유 러닝 목표 (S15P31E105-683): 거리 · 시간 · 페이스, any one or two of them. With two, the third is worked out and
// shown, its box closed: the server takes at most two.
function FreeGoalSheet({
  visible,
  onClose,
  goal,
  onSet,
}: {
  visible: boolean;
  onClose: () => void;
  goal: RunGoal;
  onSet: (goal: RunGoal) => void;
}) {
  const { height } = useWindowDimensions();
  const [distanceM, setDistanceM] = useState(measuresOf(goal).distanceM);
  const [durationSec, setDurationSec] = useState(measuresOf(goal).durationSec);
  const [paceSecPerKm, setPaceSecPerKm] = useState(
    measuresOf(goal).paceSecPerKm,
  );
  const [checked, setChecked] = useState<Measure[]>(measuresOf(goal).checked);
  useEffect(() => {
    if (visible) {
      const opened = measuresOf(goal);
      setDistanceM(opened.distanceM);
      setDurationSec(opened.durationSec);
      setPaceSecPerKm(opened.paceSecPerKm);
      setChecked(opened.checked);
    }
  }, [visible, goal]);
  const on = (measure: Measure) => checked.includes(measure);
  const full = checked.length >= 2;
  const toggle = (measure: Measure) =>
    setChecked(current =>
      current.includes(measure)
        ? current.filter(item => item !== measure)
        : current.length < 2
        ? [...current, measure]
        : current,
    );
  const km = distanceM / 1000;
  // The one left out of two: worked out from the two chosen.
  const worked: Measure | null = full
    ? (['distance', 'time', 'pace'] as Measure[]).find(item => !on(item)) ??
      null
    : null;
  const shownPace = worked === 'pace' ? durationSec / km : paceSecPerKm;
  const shownDuration =
    worked === 'time' ? Math.round(km * paceSecPerKm) : durationSec;
  const shownDistance =
    worked === 'distance'
      ? Math.round((durationSec / paceSecPerKm) * 1000)
      : distanceM;
  const selected: RunGoal =
    on('distance') && on('time')
      ? { kind: 'PACER', distanceM, durationSec }
      : on('distance') && on('pace')
      ? { kind: 'DISTANCE_PACE', distanceM, paceSecPerKm }
      : on('time') && on('pace')
      ? { kind: 'TIME_PACE', durationSec, paceSecPerKm }
      : on('distance')
      ? { kind: 'DISTANCE', distanceM }
      : on('time')
      ? { kind: 'TIME', durationSec }
      : on('pace')
      ? { kind: 'PACE', paceSecPerKm }
      : { kind: 'NONE' };
  // A worked-out value no run keeps is not sent: a pace outside 3′00″~15′00″/km, a distance past 45km or a time past
  // 5 hours (the server turns such a goal down, sessions.md 422 INVALID_GOAL).
  const unrealistic =
    (worked === 'pace' &&
      (shownPace < goalLimits.paceSec.min ||
        shownPace > goalLimits.paceSec.max)) ||
    (worked === 'distance' && shownDistance > maxGoalDistanceM) ||
    (worked === 'time' && shownDuration > goalLimits.durationMin.max * 60);
  const rows: {
    measure: Measure;
    title: string;
    icon: IconName;
    value: string;
    ruler: React.ReactNode;
  }[] = [
    {
      measure: 'distance',
      title: '거리',
      icon: 'mapPin',
      value: formatGoalDistance(shownDistance),
      ruler: (
        <RulerPicker
          label="목표 거리"
          value={distanceM / 1000}
          {...goalLimits.distanceKm}
          format={value => formatGoalDistance(value * 1000)}
          onChange={value => setDistanceM(Math.round(value * 1000))}
          {...whiteRuler}
        />
      ),
    },
    {
      measure: 'time',
      title: '시간',
      icon: 'clock',
      value:
        worked === 'time'
          ? formatDuration(shownDuration)
          : formatGoalDuration(shownDuration),
      ruler: (
        <RulerPicker
          label="목표 시간"
          value={durationSec / 60}
          {...goalLimits.durationMin}
          format={value => formatGoalDuration(value * 60)}
          onChange={value => setDurationSec(Math.round(value * 60))}
          {...whiteRuler}
        />
      ),
    },
    {
      measure: 'pace',
      title: '페이스',
      icon: 'pulse',
      value: `${formatPace(shownPace)}/km`,
      ruler: (
        <RulerPicker
          label="목표 페이스"
          value={paceSecPerKm}
          {...goalLimits.paceSec}
          format={value => `${formatPace(value)}/km`}
          onChange={setPaceSecPerKm}
          {...whiteRuler}
        />
      ),
    },
  ];
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
              {full
                ? '두 가지를 고르면 나머지는 계산돼요'
                : '두 가지까지 고를 수 있어요 · 선택하지 않으면 목표 없이 달려요'}
            </AppText>
            {rows.map(row => {
              const isOn = on(row.measure);
              const isWorked = worked === row.measure;
              return (
                <WhiteBox
                  key={row.measure}
                  style={[
                    styles.field,
                    isOn && styles.freeSelected,
                    isWorked && styles.freeWorked,
                  ]}
                >
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${row.title} 목표 선택`}
                    accessibilityHint={
                      isWorked ? `계산한 ${row.title} ${row.value}` : undefined
                    }
                    accessibilityState={{ checked: isOn, disabled: isWorked }}
                    disabled={isWorked}
                    onPress={() => toggle(row.measure)}
                    style={styles.freeChoice}
                  >
                    <Icon name={row.icon} color={k1.night} size={20} />
                    <AppText variant="label">
                      {isWorked ? `${row.title} · 계산` : row.title}
                    </AppText>
                    <AppText style={styles.freeValue}>{row.value}</AppText>
                    <View
                      style={[
                        styles.freeCheckbox,
                        isOn && styles.freeCheckboxSelected,
                        isWorked && styles.freeCheckboxClosed,
                      ]}
                    >
                      {isOn ? (
                        <Icon name="check" color="#FFFFFF" size={16} />
                      ) : null}
                    </View>
                  </Pressable>
                  {isOn ? row.ruler : null}
                </WhiteBox>
              );
            })}
            {unrealistic ? (
              <AppText
                variant="captionStrong"
                tone="danger"
                style={styles.center}
                accessibilityLiveRegion="polite"
              >
                {worked === 'pace'
                  ? `페이스가 ${formatPace(
                      goalLimits.paceSec.min,
                    )}~${formatPace(
                      goalLimits.paceSec.max,
                    )}/km 사이가 되도록 거리나 시간을 바꿔 주세요`
                  : worked === 'distance'
                  ? `거리가 ${formatGoalDistance(
                      maxGoalDistanceM,
                    )}를 넘지 않도록 시간이나 페이스를 바꿔 주세요`
                  : `시간이 ${formatGoalDuration(
                      goalLimits.durationMin.max * 60,
                    )}을 넘지 않도록 거리나 페이스를 바꿔 주세요`}
              </AppText>
            ) : null}
            {/* The sheet sets the goal; 러닝 시작 stays on the map under it (S15P31E105-683, 담당자 요청). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="목표 설정 완료"
              accessibilityState={{ disabled: unrealistic }}
              disabled={unrealistic}
              onPress={() => onSet(selected)}
              style={[
                styles.start,
                styles.white,
                unrealistic && styles.pressed,
              ]}
            >
              <AppText style={[styles.startText, { color: k1.night }]}>
                목표 설정 완료
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
  onClear,
}: {
  draft: RunGoal;
  course?: { distanceM: number; plannedPace: number | null };
  onChange: (goal: RunGoal) => void;
  // Left out when the detail is the only choice: there is no list to go back to.
  onBack?: () => void;
  onSet: () => void;
  // 목표 없이 달리기, under 목표 설정 완료 when the detail opens on its own.
  onClear?: () => void;
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
  // On a course the finish time and the pace are one goal: two rulers, each moving the other (S15P31E105-683). The
  // ruler moved from outside glides there and reports the ticks it passes, so only the one in the hand counts.
  const held = useRef<'time' | 'pace' | null>(null);
  const letGo = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (letGo.current) {
        clearTimeout(letGo.current);
      }
    },
    [],
  );
  const hold = (which: 'time' | 'pace') => {
    held.current = which;
    if (letGo.current) {
      clearTimeout(letGo.current);
    }
  };
  const from = (which: 'time' | 'pace', apply: () => void) => {
    if (held.current && held.current !== which) {
      return;
    }
    apply();
    if (letGo.current) {
      clearTimeout(letGo.current);
    }
    letGo.current = setTimeout(() => {
      held.current = null;
    }, 700);
  };
  const finish =
    course && (draft.kind === 'TIME' || draft.kind === 'PACE')
      ? finishAndPace(draft, course)
      : null;
  // The pace the distance and the time make; on a course the pace ruler shows it.
  const derived =
    draft.kind === 'PACER'
      ? pacerPace(draft.distanceM, draft.durationSec)
      : finish
      ? finish.paceSecPerKm
      : null;
  // A distance and a time that make a pace no runner keeps (faster than 3′00″ or slower than 15′00″ per km) are
  // not sent: the server turns such a goal down (sessions.md 422 INVALID_GOAL).
  const unrealistic =
    derived !== null &&
    (derived < goalLimits.paceSec.min || derived > goalLimits.paceSec.max);
  return (
    <View style={styles.detail}>
      {onBack ? (
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
      ) : null}
      {draft.kind === 'DISTANCE'
        ? distanceRuler(draft.distanceM, distanceM =>
            onChange({ ...draft, distanceM }),
          )
        : null}
      {finish ? (
        <>
          <View onTouchStart={() => hold('time')}>
            <WhiteBox style={styles.field}>
              <AppText variant="label" tone="textSecondary">
                완주 시간
              </AppText>
              <RulerPicker
                label="목표 완주 시간"
                value={finish.durationSec / 60}
                {...goalLimits.durationMin}
                format={value => formatDuration(value * 60)}
                onChange={value =>
                  from('time', () =>
                    onChange({
                      kind: 'TIME',
                      durationSec: Math.round(value * 60),
                    }),
                  )
                }
                {...ruler}
              />
            </WhiteBox>
          </View>
          <View onTouchStart={() => hold('pace')}>
            <WhiteBox style={styles.field}>
              <AppText variant="label" tone="textSecondary">
                페이스
              </AppText>
              <RulerPicker
                label="목표 페이스"
                value={finish.paceSecPerKm}
                {...goalLimits.paceSec}
                format={value => `${formatPace(value)}/km`}
                onChange={paceSecPerKm =>
                  from('pace', () => onChange({ kind: 'PACE', paceSecPerKm }))
                }
                {...ruler}
              />
            </WhiteBox>
          </View>
        </>
      ) : draft.kind === 'TIME' ? (
        durationRuler(draft.durationSec, durationSec =>
          onChange({ ...draft, durationSec }),
        )
      ) : null}
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
      {draft.kind === 'PACE' && !finish ? (
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
      {derived !== null && !finish ? (
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
      {finish && course ? (
        <AppText variant="label" tone="textSecondary" style={styles.center}>
          {`코스 ${formatGoalDistance(course.distanceM)} 기준`}
        </AppText>
      ) : null}
      {/* The sheet sets the goal; 러닝 시작 stays on the map under it (S15P31E105-683, 담당자 요청). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="목표 설정 완료"
        accessibilityState={{ disabled: unrealistic }}
        disabled={unrealistic}
        onPress={onSet}
        style={({ pressed }) => [
          styles.start,
          styles.white,
          (pressed || unrealistic) && styles.pressed,
        ]}
      >
        <AppText style={[styles.startText, { color: k1.night }]}>
          목표 설정 완료
        </AppText>
      </Pressable>
      {onClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="목표 없이 달리기"
          onPress={onClear}
          hitSlop={8}
          style={styles.center}
        >
          <AppText variant="captionStrong" tone="textSecondary">
            목표 없이 달리기
          </AppText>
        </Pressable>
      ) : null}
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
  // The worked-out measure: its box closed and the row a little faded.
  freeCheckboxClosed: { opacity: 0.35 },
  freeWorked: { opacity: 0.75 },
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
