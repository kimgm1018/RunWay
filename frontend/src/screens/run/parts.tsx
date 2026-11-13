import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
} from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText, Icon, LightGlass } from '../../components';
import {
  useRepositories,
  type GpsQuality,
  type MusicSource,
  type MusicService,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import {
  useRunActions,
  useRunControlState,
  type RunConfig,
} from './RunSession';
import type { ControlProblem } from './runControl';
import type { SessionStatus } from '../../data/types';
import {
  fontFamily,
  k1,
  palette,
  spacing,
  typography,
  useTheme,
} from '../../theme';
import { GlassIconButton } from '../../components/GlassIconButton';
import { useRunForeground } from './useRunForeground';

// Simplified marks for the two music services (2.0 음악 버튼, 2.8 음원 목록).
// mono draws only the white mark, for a K1 badge.
export function ServiceMark({
  service,
  size: diameter = 28,
  mono = false,
}: {
  service: MusicService;
  size?: number;
  mono?: boolean;
}) {
  const color = service === 'MELON' ? palette.melon : palette.spotify;
  const line = mono || service === 'MELON' ? palette.white : palette.ink;
  return (
    <Svg width={diameter} height={diameter} viewBox="0 0 24 24">
      {mono ? null : <Circle cx="12" cy="12" r="12" fill={color} />}
      {service === 'MELON' ? (
        <Path
          d="M12 6.5c-3 0-5.2 2.4-5.2 5.4 0 3.1 2.3 5.6 5.2 5.6s5.2-2.5 5.2-5.6c0-3-2.2-5.4-5.2-5.4zm0 0c.2-1.3 1-2.3 2.2-2.8"
          stroke={line}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <>
          <Path
            d="M6.5 9.3c3.8-1.1 7.6-.8 11 .9"
            stroke={line}
            strokeWidth={1.9}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M7.2 12.4c3.1-.9 6.2-.6 9 .8"
            stroke={line}
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M7.8 15.3c2.5-.7 4.9-.5 7.1.6"
            stroke={line}
            strokeWidth={1.4}
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}

// Keeps the music button in sync with what was picked on 2.7·2.8, which sit on top of this screen.
export function useMusicSource() {
  const { music } = useRepositories();
  const [source, setSource] = useState<MusicSource | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      music.getState().then(
        state => active && setSource(state.source),
        () => undefined,
      );
      return () => {
        active = false;
      };
    }, [music]),
  );
  return source;
}

const countdownSeconds = 3;
// 목표가 바뀐 뒤 미리 준비를 시작하기까지 기다리는 시간(연속 변경은 마지막 목표만 준비한다, S15P31E105-533).
const prepareDelayMs = 500;

// The picked course's chip (S15P31E105-683): navy, its ✕ a softer white.
const pickedInk = '#02050E';
const pickedSoft = 'rgba(255,255,255,0.7)';

// 2.0·2.0F 하단 (S15P31E105-517, the reference's start row made RunWay's): the goal and course chips, then 설정 ·
// 러닝 시작 (3초 카운트다운 후 4.2) · 음악 (S15P31E105-683: 설정 in place of the 자유 ↔ 코스 switch).
// By day a glass circle, the black pill with a dot in a grey ring and the dark music badge
// (runway-course-handoff, the same on 2.0 and 2.0F); night uses the accent.
export function RunStartBar({
  night,
  config,
  goal,
  course,
  startSignal = 0,
}: {
  night: boolean;
  // What the run starts with; the button stays disabled until it is known.
  config: RunConfig | null;
  // The goal chip above the row: what the run aims at, opening the goal sheet.
  // title names the chip for screen readers: 목표 설정, or 코스 설정 on 2.0C.
  goal?: { label: string; title?: string; onPress: () => void } | null;
  // The course chip right of the goal (S15P31E105-683): 코스 설정 until a course is picked, then the course in navy
  // with an ✕ that drops it, so the run is free again. No course means a free run.
  course?: {
    label: string;
    picked: boolean;
    onPress: () => void;
    onClear?: () => void;
  } | null;
  // Raised by the goal sheet's start buttons: starts the same countdown as 러닝 시작.
  startSignal?: number;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const {
    start: startRun,
    recheck,
    abortStart,
    cancel,
    prepare,
    releasePrepared,
  } = useRunActions();
  const { ensureRunLogin, signedIn } = useSession();
  const control = useRunControlState();
  const focused = useIsFocused();
  const foreground = useRunForeground();
  const pendingGroupScreen = useRef(false);
  const pendingRunScreen = useRef(false);
  // The countdown effect reads these through a ref so a re-render never restarts its timer.
  const latest = useRef({ config, navigation, start: startRun, prepare, foreground });
  latest.current = { config, navigation, start: startRun, prepare, foreground };
  // 미리 준비(S15P31E105-533): 목표가 정해진 채 이 화면에 있으면 세션 생성·AI 계획·워치 준비를 미리 끝내 둔다.
  // 3초 카운트다운은 그대로이고, 카운트다운 뒤에는 시작 승인·워치 실행·저장 확인만 남는다. 목표를 바꾸는 동안에는
  // 잠시 기다렸다가 마지막 목표로 준비한다. 이 화면이 준비한 세션은 시작하지 않고 떠나면 취소한다.
  const prepareKey =
    config && config.mode !== 'GROUP'
      ? JSON.stringify([
          config.mode,
          config.plan?.courseId ?? null,
          config.comparisonSessionId ?? null,
          config.goalDistanceM,
          config.goalDurationSec ?? null,
          config.goalPaceSecPerKm,
        ])
      : null;
  const preparedHere = useRef(false);
  useEffect(() => {
    if (!focused || !signedIn || prepareKey === null) {
      return;
    }
    const wait = setTimeout(() => {
      const chosen = latest.current.config;
      if (chosen) {
        preparedHere.current = true;
        latest.current.prepare(chosen);
      }
    }, prepareDelayMs);
    return () => clearTimeout(wait);
  }, [focused, signedIn, prepareKey]);
  const release = useRef(releasePrepared);
  release.current = releasePrepared;
  useEffect(() => {
    if (!focused && preparedHere.current) {
      preparedHere.current = false;
      release.current();
    }
  }, [focused]);
  useEffect(
    () => () => {
      if (preparedHere.current) {
        release.current();
      }
    },
    [],
  );
  const [count, setCount] = useState<number | null>(null);
  // 이 화면에서 시작을 요청했고 아직 확정되지 않았다. 워치가 실제로 시작해 서버가 확정해야 4.2로 넘어간다.
  const [requested, setRequested] = useState(false);
  // 시작이 확정되면(재확인 성공·늦은 결과·워치에서 시작 포함) 이 화면에 있을 때 4.2로 넘어간다.
  // previousStatus는 항상 null로 시작한다: 응답 유실·앱 재시작으로 이미 RUNNING/PAUSED인 세션에
  // 막 붙은 경우도(S01 409) "처음 관찰한 활성 상태"로 다뤄 바로 4.2로 넘어가야 한다. control?.status를
  // 초기값으로 쓰면 그 경우 전이가 감지되지 않아 이 화면에 멈춰 있었다(S15P31E105-777).
  const previousStatus = useRef<SessionStatus | null>(null);
  useEffect(() => {
    const status = control?.status ?? null;
    if (
      focused &&
      (status === 'RUNNING' || status === 'PAUSED') &&
      previousStatus.current !== status
    ) {
      pendingRunScreen.current = true;
    }
    previousStatus.current = status;
    if (status === 'COMPLETED') {
      pendingGroupScreen.current = false;
    }
    if (!focused || status === 'CANCELLED' || status === 'INTERRUPTED') {
      pendingRunScreen.current = false;
      pendingGroupScreen.current = false;
    }
    if (!foreground) {
      return;
    }
    if (
      focused &&
      ((pendingRunScreen.current && (status === 'RUNNING' || status === 'PAUSED' || status === 'COMPLETED')) ||
        (pendingGroupScreen.current && status !== 'COMPLETED'))
    ) {
      pendingRunScreen.current = false;
      pendingGroupScreen.current = false;
      setRequested(false);
      navigateTo(navigation, status === 'COMPLETED' ? 'RunResult' : 'RunProgress');
    }
    // 문제 표시, 또는 시작하려다 이미 진행·일시정지 중인 본인 세션에 붙어 그 화면으로 돌아간 경우(S01 409).
    if (control?.problem || (status !== null && status !== 'READY')) {
      setRequested(false);
    }
  }, [control, focused, navigation, foreground]);
  const confirming =
    requested || (control?.pending?.action === 'START' && !control.problem);
  const notice =
    control?.status !== 'RUNNING'
      ? startNotice(control?.problem ?? null)
      : null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalled = useRef(startSignal);
  useEffect(() => {
    if (startSignal === signalled.current) {
      return;
    }
    signalled.current = startSignal;
    if (ensureRunLogin()) {
      setCount(countdownSeconds);
    }
  }, [ensureRunLogin, startSignal]);
  useEffect(() => {
    if (count === null) {
      return;
    }
    if (count === 0) {
      setCount(null);
      if (!ensureRunLogin()) {
        return;
      }
      const { config: chosen, navigation: nav, start } = latest.current;
      if (chosen?.mode === 'GROUP') {
        start(chosen);
        if (latest.current.foreground) {
          navigateTo(nav, 'RunProgress');
        } else {
          pendingGroupScreen.current = true;
        }
      } else if (chosen) {
        setRequested(true);
        start(chosen);
      }
      return;
    }
    timer.current = setTimeout(() => setCount(count - 1), 1000);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [count, ensureRunLogin]);
  const chipBack = night ? colors.surfaceRaised : '#FFFFFF';
  return (
    <View style={styles.startArea}>
      {goal || course ? (
        <View style={styles.chipRow}>
          {goal ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={goal.title ?? '목표 설정'}
              accessibilityHint={goal.label}
              onPress={goal.onPress}
              style={({ pressed }) => [
                styles.goalChip,
                { backgroundColor: chipBack },
                pressed && styles.pressed,
              ]}
            >
              <Icon name="target" color={colors.text} size={16} />
              <AppText variant="captionStrong" numberOfLines={1}>
                {goal.label}
              </AppText>
            </Pressable>
          ) : null}
          {course ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={course.picked ? '코스 변경' : '코스 설정'}
              accessibilityHint={course.label}
              onPress={course.onPress}
              style={({ pressed }) => [
                styles.goalChip,
                { backgroundColor: course.picked ? pickedInk : chipBack },
                pressed && styles.pressed,
              ]}
            >
              <Icon
                name="route"
                color={course.picked ? palette.white : colors.text}
                size={16}
              />
              <AppText
                variant="captionStrong"
                numberOfLines={1}
                style={[styles.chipLabel, course.picked && styles.onPicked]}
              >
                {course.label}
              </AppText>
              {course.picked && course.onClear ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="코스 해제"
                  onPress={course.onClear}
                  hitSlop={10}
                >
                  <Icon name="close" color={pickedSoft} size={14} />
                </Pressable>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {/* 설정 · 러닝 시작 · 음악, the two round buttons the same glass with no captions so the row sits evenly
          (담당자 요청). */}
      <View style={[styles.bar, !night && styles.barDay]}>
        <GlassIconButton
          icon="settings"
          tone={night ? 'dark' : 'light'}
          diameter={52}
          accessibilityLabel="설정"
          onPress={() => navigateTo(navigation, 'Settings')}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="러닝 시작"
          accessibilityState={{ disabled: !config || confirming }}
          disabled={!config || confirming}
          onPress={() => {
            if (ensureRunLogin()) {
              setCount(countdownSeconds);
            }
          }}
          style={({ pressed }) => [
            styles.start,
            night ? { backgroundColor: colors.accent } : styles.startDay,
            (pressed || !config || confirming) && styles.pressed,
          ]}
        >
          <AppText
            style={
              night
                ? [typography.button, { color: colors.onAccent }]
                : styles.startText
            }
          >
            {confirming ? '시작 확인 중' : '러닝 시작'}
          </AppText>
          <View
            style={[
              styles.ring,
              night
                ? { borderColor: colors.onAccent }
                : [styles.ringDay, { borderColor: startRing }],
            ]}
          >
            <View
              style={[
                styles.ringDot,
                { backgroundColor: night ? colors.onAccent : startRing },
              ]}
            />
          </View>
        </Pressable>
        <GlassIconButton
          icon="music"
          tone={night ? 'dark' : 'light'}
          diameter={52}
          accessibilityLabel="음악"
          onPress={() => navigateTo(navigation, 'MusicCard')}
        />
      </View>
      <Modal
        visible={count !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setCount(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="카운트다운 취소"
          onPress={() => setCount(null)}
          style={styles.countdown}
        >
          <AppText style={styles.countText}>{count}</AppText>
          <AppText variant="caption" style={styles.countHint}>
            화면을 누르면 취소돼요
          </AppText>
        </Pressable>
      </Modal>
      {notice ? (
        <View style={styles.notice}>
          <AppText variant="captionStrong" accessibilityLabel="시작 안내">
            {notice.text}
          </AppText>
          <View style={styles.noticeActions}>
            {notice.recheck ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="다시 확인"
                onPress={recheck}
              >
                <AppText variant="captionStrong" tone="accentText">
                  다시 확인
                </AppText>
              </Pressable>
            ) : null}
            {notice.abort ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="이번 운동 중단"
                onPress={abortStart}
              >
                <AppText variant="captionStrong" tone="accentText">
                  이번 운동 중단
                </AppText>
              </Pressable>
            ) : null}
            {notice.restart && control?.status === 'READY' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="취소"
                onPress={cancel}
              >
                <AppText variant="captionStrong" tone="accentText">
                  취소
                </AppText>
              </Pressable>
            ) : null}
            {notice.restart ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="다시 시작"
                disabled={!config}
                onPress={() => setCount(countdownSeconds)}
              >
                <AppText variant="captionStrong" tone="accentText">
                  다시 시작
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// 시작 확정 전 문제 안내. 실행 미확인은 성공·실패로 단정하지 않고 재확인·중단을 고르게 한다(sessions.md S03 시작 결과 미확인).
function startNotice(problem: ControlProblem | null): {
  text: string;
  recheck?: boolean;
  abort?: boolean;
  restart?: boolean;
} | null {
  if (!problem) {
    return null;
  }
  switch (problem.kind) {
    case 'locationRequired':
      return { text: '휴대폰 위치 권한과 GPS를 켠 뒤 다시 시작해 주세요.', restart: true };
    case 'watchRequired':
      return { text: '워치를 연결해 주세요' };
    case 'watchUnregistered':
      return {
        text: '워치가 계정에 등록되지 않아 폰으로 기록해요. 워치로 기록하려면 설정 > 기기에서 워치를 등록해 주세요. 폰으로 하려면 다시 시작해 주세요.',
        restart: true,
      };
    case 'watchNotReady':
      return { text: '워치가 준비되지 않았어요', restart: true };
    case 'rejected':
      return { text: '워치가 시작하지 못했어요', restart: true };
    case 'unconfirmed':
      return {
        text: '시작 여부를 확인할 수 없습니다',
        recheck: true,
        abort: true,
      };
    // 종료 저장 미확인과 폰 인계는 실제 시작 뒤(RUNNING/PAUSED)에만 있어 시작 화면에는 나오지 않는다.
    case 'saveUnconfirmed':
    case 'takeoverHeld':
    case 'takeoverUnconfirmed':
    case 'takeoverFailed':
      return null;
    case 'error':
      return { text: '러닝을 시작하지 못했어요', restart: true };
  }
}

export const gpsLabels: Record<GpsQuality, string> = {
  good: 'GPS 양호',
  weak: 'GPS 약함',
  none: 'GPS 없음',
};

// The floating bar at the top of the map: 현재 위치 · 민락수변공원 입구 · GPS 양호. By day a light glass pill
// with a navy dot in a white ring and a black GPS chip (runway-course-handoff LocationBar). After sunset the
// card is dark, so the dot turns white and the chip light.
export function PlaceCard({ name, gps }: { name: string; gps: GpsQuality }) {
  const theme = useTheme();
  const { colors } = theme;
  const night = theme.name === 'dark';
  const good = gps === 'good';
  return (
    <LightGlass
      radius={night ? 24 : 31}
      solid={night ? colors.surfaceRaised : undefined}
      style={night ? styles.place : styles.placeDay}
    >
      <View
        style={[
          styles.placeHalo,
          night ? styles.placeHaloNight : styles.placeHaloDay,
        ]}
      >
        <View style={[styles.placeDot, night && styles.placeDotNight]} />
      </View>
      <View style={styles.flex}>
        <AppText
          variant="label"
          tone="textSecondary"
          style={night ? styles.regular : styles.placeLabelDay}
        >
          현재 위치
        </AppText>
        <AppText
          style={night ? styles.placeName : styles.placeNameDay}
          numberOfLines={1}
        >
          {name}
        </AppText>
      </View>
      <View
        style={[
          styles.gps,
          {
            backgroundColor: good
              ? night
                ? colors.accent
                : startInk
              : colors.dangerSurface,
          },
        ]}
      >
        <AppText
          variant="labelStrong"
          style={good ? { color: night ? colors.onAccent : k1.ice } : undefined}
          tone={good ? undefined : 'danger'}
        >
          {gpsLabels[gps]}
        </AppText>
      </View>
    </LightGlass>
  );
}

// The day GPS chip's ink, and the 러닝 시작 pill and its ring: white with navy writing since S15P31E105-683
// (담당자 요청), edged and lifted so it stands off the light card.
const startInk = '#02050E';
const startFill = '#FFFFFF';
const startRing = '#A3A8AF';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.lg,
  },
  barDay: { gap: 10 },
  startArea: { gap: 12 },
  chipLabel: { flexShrink: 1 },
  onPicked: { color: palette.white },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  goalChip: {
    flexShrink: 1,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  notice: { width: '100%', alignItems: 'center', gap: spacing.xs },
  noticeActions: { flexDirection: 'row', gap: spacing.lg },

  start: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 10,
  },
  ring: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    opacity: 0.7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringDot: { width: 4, height: 4, borderRadius: 2 },
  ringDay: { opacity: 1 },
  startDay: {
    backgroundColor: startFill,
    borderWidth: 1,
    borderColor: 'rgba(2,5,14,0.08)',
    boxShadow: '0 6px 16px rgba(9,17,26,0.14)',
  },
  startText: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: startInk,
  },
  // 3·2·1 on a solid dark screen, the same ground as the run screen that follows (S15P31E105-517).
  countdown: {
    flex: 1,
    backgroundColor: k1.night,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  countText: {
    ...typography.metricHero,
    fontSize: 120,
    lineHeight: 130,
    color: palette.white,
  },
  countHint: { color: palette.pale },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: 24,
    shadowColor: k1.night,
    shadowOpacity: 0.12,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  // Navy dot inside a 5px halo of the same color at 22%.
  placeHalo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(37,54,73,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: k1.deep,
  },
  placeDay: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 26,
    paddingLeft: 16,
    paddingRight: 14,
  },
  placeHaloDay: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  placeLabelDay: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: '#67696E',
  },
  placeNameDay: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: startInk,
  },
  placeHaloNight: { backgroundColor: 'rgba(232,238,244,0.22)' },
  placeDotNight: { backgroundColor: k1.ice },
  regular: { fontFamily: fontFamily.regular },
  placeName: { ...typography.bodyStrong, fontFamily: fontFamily.medium },
  gps: {
    height: 26,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 13,
  },
});
