import React, { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Icon } from '../../../components';
import { fontFamily } from '../../../theme';
import { liveLook, type LiveView } from './RunLiveFrame';

// running: 일시정지 + 지도/수치. pausing·resuming: the request waits for the server or watch, so the button
// says so and does not send it twice. paused: 재개 + 종료 (held 1 s) in the same place. finishing: the end
// is being saved.
export type ControlMode =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'finishing';

const holdMs = 1000;

export function RunControlBar({
  mode,
  view,
  onToggleView,
  onPause,
  onResume,
  onFinish,
  finishHint = '종료는 1초 길게 눌러야 동작해요',
}: {
  mode: ControlMode;
  view: LiveView;
  onToggleView: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  finishHint?: string;
}) {
  const toMap = view === 'numbers';
  return (
    <View style={styles.wrap}>
      {mode === 'paused' ? (
        <AppText style={styles.hint}>{finishHint}</AppText>
      ) : null}
      <View style={styles.row}>
        <View style={styles.main}>
          {mode === 'running' || mode === 'pausing' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="일시정지"
              accessibilityState={{ disabled: mode === 'pausing' }}
              disabled={mode === 'pausing'}
              onPress={onPause}
              style={({ pressed }) => [
                styles.button,
                styles.wide,
                styles.pause,
                (pressed || mode === 'pausing') && styles.dim,
              ]}
            >
              {mode === 'pausing' ? (
                <AppText style={styles.pauseText}>일시정지 확인 중</AppText>
              ) : (
                <>
                  <Icon name="pause" color={liveLook.ground} size={22} />
                  <AppText style={styles.pauseText}>일시정지</AppText>
                </>
              )}
            </Pressable>
          ) : mode === 'finishing' ? (
            <View
              style={[styles.button, styles.wide, styles.waiting]}
              accessibilityLabel="종료 안내"
            >
              <AppText style={styles.lightText}>종료 처리 중</AppText>
            </View>
          ) : (
            <View style={styles.split}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="재개"
                accessibilityState={{ disabled: mode === 'resuming' }}
                disabled={mode === 'resuming'}
                onPress={onResume}
                style={({ pressed }) => [
                  styles.button,
                  styles.half,
                  styles.resume,
                  (pressed || mode === 'resuming') && styles.dim,
                ]}
              >
                {mode === 'resuming' ? (
                  <AppText style={styles.pauseText}>재개 확인 중</AppText>
                ) : (
                  <>
                    <Icon name="play" color={liveLook.ground} size={20} solid />
                    <AppText style={styles.pauseText}>재개</AppText>
                  </>
                )}
              </Pressable>
              <HoldToFinish
                disabled={mode === 'resuming'}
                onFinish={onFinish}
              />
            </View>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toMap ? '지도 보기' : '수치 보기'}
          onPress={onToggleView}
          style={({ pressed }) => [
            styles.button,
            styles.round,
            pressed && styles.dim,
          ]}
        >
          <Icon
            name={toMap ? 'mapPin' : 'activity'}
            color={liveLook.text}
            size={22}
          />
        </Pressable>
      </View>
    </View>
  );
}

// 종료: held for a second, the coral fill grows across; letting go early does nothing.
function HoldToFinish({
  disabled,
  onFinish,
}: {
  disabled: boolean;
  onFinish: () => void;
}) {
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
      accessibilityState={{ disabled }}
      disabled={disabled}
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
        styles.button,
        styles.half,
        styles.finish,
        disabled && styles.dim,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.finishFill,
          !holding && styles.hidden,
          {
            width: fill.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
      <Icon name="stop" color={liveLook.text} size={18} solid />
      <AppText style={styles.lightText}>종료</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  hint: {
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  main: { flex: 1 },
  split: { flexDirection: 'row', gap: 10 },
  button: {
    height: 60,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  wide: { alignSelf: 'stretch' },
  half: { flex: 1 },
  pause: { backgroundColor: liveLook.text },
  resume: { backgroundColor: liveLook.text },
  finish: { backgroundColor: 'rgba(212, 74, 74, 0.35)' },
  finishFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: liveLook.paused,
  },
  hidden: { opacity: 0 },
  waiting: { backgroundColor: liveLook.button },
  round: { width: 60, backgroundColor: liveLook.button },
  dim: { opacity: 0.6 },
  pauseText: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    color: liveLook.ground,
  },
  lightText: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    color: liveLook.text,
  },
});
