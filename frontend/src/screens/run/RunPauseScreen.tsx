import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Icon } from '../../components';
import { formatDuration, formatKm, formatPace } from '../../format';
import { spacing, typography, useTheme } from '../../theme';
import { MockMap } from './MockMap';
import { useRunSession } from './RunSession';

const holdMs = 1000;
const buttonSize = 88;

// 종료 needs a one-second hold instead of a confirm dialog (4.3 설계 메모).
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
      style={[styles.round, styles.stop, { borderColor: colors.borderStrong }]}
    >
      <Animated.View
        style={[
          styles.holdFill,
          {
            backgroundColor: colors.dangerSurface,
            opacity: holding ? 1 : 0,
            transform: [{ scale: fill }],
          },
        ]}
      />
      <Icon name="stop" color={colors.text} size={26} />
    </Pressable>
  );
}

// 4.3 일시정지: the run so far over a dimmed map, with 재개 and a hold-to-finish 종료.
export function RunPauseScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { run, finish } = useRunSession();

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
  const { sample, trail, config } = run;
  const average =
    sample.distanceM > 0 ? sample.elapsedSec / (sample.distanceM / 1000) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <MockMap
        night
        route={config.plan?.route}
        trail={trail.length > 0 ? trail : undefined}
        routeArea={{ top: 200, bottom: 520 }}
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        <View style={styles.center}>
          <AppText variant="heading" tone="accentText">
            일시정지
          </AppText>
          <AppText style={styles.time} accessibilityLabel="경과 시간">
            {formatDuration(sample.elapsedSec)}
          </AppText>
          <AppText variant="body" tone="textSecondary">
            {`${formatKm(sample.distanceM)}km · 평균 ${
              average === null ? '– –' : formatPace(average)
            }/km`}
          </AppText>
        </View>
        <View style={styles.actions}>
          <View style={styles.buttons}>
            <View style={styles.action}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="재개"
                // Going back to 4.2 resumes tracking there.
                onPress={() => navigation.goBack()}
                style={({ pressed }) => [
                  styles.round,
                  { backgroundColor: colors.accent },
                  pressed && styles.pressed,
                ]}
              >
                <Icon name="play" color={colors.onAccent} size={30} />
              </Pressable>
              <AppText variant="captionStrong">재개</AppText>
            </View>
            <View style={styles.action}>
              <StopButton
                onFinish={() => {
                  finish();
                  // 결과 replaces the run screens, so back from 4.5 cannot reopen a finished run.
                  navigation.dispatch(
                    CommonActions.reset({
                      index: 1,
                      routes: [{ name: 'MainTabs' }, { name: 'RunResult' }],
                    }),
                  );
                }}
              />
              <AppText variant="captionStrong">종료</AppText>
            </View>
          </View>
          <AppText variant="caption" tone="textTertiary">
            종료는 1초 길게 눌러야 동작해요
          </AppText>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layout: { flex: 1, justifyContent: 'space-between' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  time: { ...typography.metricHero, fontSize: 80, lineHeight: 88 },
  actions: {
    alignItems: 'center',
    gap: spacing.xxxl,
    paddingBottom: spacing.xxxl * 2,
  },
  buttons: { flexDirection: 'row', gap: spacing.xxxl * 2 },
  action: { alignItems: 'center', gap: spacing.lg },
  round: {
    width: buttonSize,
    height: buttonSize,
    borderRadius: buttonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stop: { borderWidth: 1.5 },
  holdFill: {
    position: 'absolute',
    width: buttonSize,
    height: buttonSize,
    borderRadius: buttonSize / 2,
  },
  pressed: { opacity: 0.8 },
});
