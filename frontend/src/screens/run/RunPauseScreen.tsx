import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  CommonActions,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { AppText, Backdrop, Icon } from '../../components';
import { formatDuration, formatKm, formatPace } from '../../format';
import { fontFamily, useTheme } from '../../theme';
import { useRunControlState, useRunSession } from './RunSession';
import { controlNotice } from './controlNotice';

const holdMs = 1000;
const buttonSize = 88;
// The hold arc runs on a ring just outside the stop button.
const ringSize = buttonSize + 14;
const ringRadius = (ringSize - 4) / 2;
const ringLength = 2 * Math.PI * ringRadius;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// 종료 needs a one-second hold instead of a confirm dialog (4.3 설계 메모).
// An outlined circle on a white 55% fill; while held, an arc fills the ring around it (runway-running-handoff 4.3).
export function StopButton({ onFinish }: { onFinish: () => void }) {
  const { colors } = useTheme();
  const fill = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);

  const release = () => {
    setHolding(false);
    fill.stopAnimation();
    fill.setValue(0);
  };

  return (
    <View style={styles.ring}>
      <Svg width={ringSize} height={ringSize} style={StyleSheet.absoluteFill}>
        {/* The track shows only while held: at rest 종료 is the bare circle of the mockup. */}
        <Circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={ringRadius}
          stroke={colors.border}
          strokeWidth={3}
          fill="none"
          opacity={holding ? 1 : 0}
        />
        <AnimatedCircle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={ringRadius}
          stroke={colors.text}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
          opacity={holding ? 1 : 0}
          strokeDasharray={`${ringLength} ${ringLength}`}
          strokeDashoffset={fill.interpolate({
            inputRange: [0, 1],
            outputRange: [ringLength, 0],
          })}
          // Start the arc at the top.
          rotation={-90}
          origin={`${ringSize / 2}, ${ringSize / 2}`}
        />
      </Svg>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="종료"
        accessibilityHint="1초 길게 눌러 러닝을 끝내요"
        delayLongPress={holdMs}
        onPressIn={() => {
          setHolding(true);
          Animated.timing(fill, {
            toValue: 1,
            duration: holdMs,
            easing: Easing.linear,
            useNativeDriver: false,
          }).start();
        }}
        onPressOut={release}
        onLongPress={onFinish}
        style={[
          styles.round,
          styles.stop,
          { borderColor: colors.text },
          holding && styles.held,
        ]}
      >
        <View style={[styles.stopMark, { backgroundColor: colors.text }]} />
      </Pressable>
    </View>
  );
}

// 재개: the navy circle with a light ▶ and a soft shadow. It takes the same box as the stop ring so both
// labels line up.
export function ResumeButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.ring}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="재개"
        onPress={onPress}
        style={({ pressed }) => [
          styles.round,
          styles.resume,
          { backgroundColor: colors.accent },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="play" color={colors.onAccent} size={30} solid />
      </Pressable>
    </View>
  );
}

// 4.3 일시정지 (runway-running-handoff): the elapsed time on the K1 background, then 재개 and a hold-to-finish
// 종료 straight on the background, without a card.
export function RunPauseScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { run, finish, resume, recheck } = useRunSession();
  const control = useRunControlState();
  const problem = control?.problem ?? null;
  const ending = problem === null && control?.pending?.action === 'END';
  const resuming = problem === null && control?.pending?.action === 'RESUME';
  const notice = controlNotice(problem, ['RESUME', 'END']);
  // 개인 러닝은 재개를 요청하고 실제로 재개가 확정되면 4.2로 돌아간다. 그룹 러닝은 기존처럼 돌아가서 재개한다.
  const personal = control !== null && run?.config.mode !== 'GROUP';
  const onResume = useCallback(() => {
    if (personal) {
      resume();
    } else {
      navigation.goBack();
    }
  }, [navigation, personal, resume]);
  const previous = useRef(run?.status);
  useEffect(() => {
    if (
      personal &&
      previous.current === 'paused' &&
      run?.status === 'running'
    ) {
      navigation.goBack();
    }
    previous.current = run?.status;
  }, [navigation, personal, run?.status]);
  // 뒤로 가기도 재개 요청이다(확정 전에는 4.3에 머문다).
  useFocusEffect(
    useCallback(() => {
      if (!personal) {
        return undefined;
      }
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        onResume();
        return true;
      });
      return () => back.remove();
    }, [onResume, personal]),
  );

  // 종료는 요청만 한다. 서버가 종료를 확정해야(finished) 결과로 넘어간다.
  // 결과 replaces the run screens, so back from 4.5 cannot reopen a finished run.
  useEffect(() => {
    if (run?.status === 'finished') {
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [{ name: 'MainTabs' }, { name: 'RunResult' }],
        }),
      );
    }
  }, [navigation, run?.status]);

  // Reached without a run (for example a stale deep link): nothing to pause.
  useEffect(() => {
    if (!run && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation, run]);

  if (!run) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]} />
    );
  }
  const { sample } = run;
  const average =
    sample.distanceM > 0 ? sample.elapsedSec / (sample.distanceM / 1000) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        <View style={styles.center}>
          <AppText style={styles.label}>일시정지</AppText>
          <AppText style={styles.time} accessibilityLabel="경과 시간">
            {formatDuration(sample.elapsedSec)}
          </AppText>
          <AppText style={styles.summary}>
            {`${formatKm(sample.distanceM)}km · 평균 ${
              average === null ? '– –' : formatPace(average)
            }/km`}
          </AppText>
        </View>
        <View style={styles.actions}>
          <View style={styles.buttons}>
            <View style={styles.action}>
              {/* Going back to 4.2 resumes tracking there. */}
              <ResumeButton onPress={onResume} />
              <AppText style={styles.actionLabel}>재개</AppText>
            </View>
            <View style={styles.action}>
              <StopButton onFinish={finish} />
              <AppText style={styles.actionLabel}>종료</AppText>
            </View>
          </View>
          <AppText style={styles.hint}>종료는 1초 길게 눌러야 동작해요</AppText>
          {ending ? (
            <AppText variant="captionStrong" accessibilityLabel="종료 안내">
              종료 처리 중
            </AppText>
          ) : null}
          {resuming ? (
            <AppText variant="captionStrong" accessibilityLabel="종료 안내">
              재개 확인 중
            </AppText>
          ) : null}
          {notice ? (
            <>
              <AppText variant="captionStrong" accessibilityLabel="종료 안내">
                {notice.text}
              </AppText>
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
            </>
          ) : null}
        </View>
        <View style={styles.spacer} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layout: { flex: 1, paddingHorizontal: 14 },
  // The summary sits around a fifth down, the buttons 52 under it (390×844 mockup: 160 and 387).
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: '#4E5560',
  },
  // Big numbers stay Barlow Regular, here at the mockup's 100.
  time: {
    marginTop: 12,
    fontFamily: fontFamily.numberRegular,
    fontSize: 100,
    lineHeight: 104,
    letterSpacing: 2,
  },
  summary: {
    marginTop: 11,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 22,
    color: '#4E5560',
  },
  actions: { alignItems: 'center', gap: 10, paddingTop: 84 },
  buttons: { flexDirection: 'row', gap: 26 },
  action: { width: 102, alignItems: 'center', gap: 8 },
  actionLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
  },
  hint: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 19,
    color: '#67696E',
  },
  round: {
    width: buttonSize,
    height: buttonSize,
    borderRadius: buttonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: ringSize,
    height: ringSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: { borderWidth: 1.5, backgroundColor: 'rgba(255,255,255,0.55)' },
  resume: { boxShadow: '0 10px 24px rgba(2,5,14,0.25)' },
  held: { opacity: 0.85 },
  stopMark: { width: 26, height: 26, borderRadius: 7 },
  spacer: { flex: 1.15 },
  pressed: { opacity: 0.8 },
});
