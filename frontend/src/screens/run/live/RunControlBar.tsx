import React, { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Icon } from '../../../components';
import { fontFamily } from '../../../theme';
import { liveLook, type LiveView } from './RunLiveFrame';

// 그룹런 시안 (S15P31E105-673): on a group run the buttons are 50 high, 일시정지 · 재개 in mint, 종료 a red outline
// and the map button a glass circle. Personal runs keep their look.
const groupLook = {
  mint: '#4DFFD2',
  onMint: '#02050E',
  danger: '#D44A4A',
  glass: 'rgba(255,255,255,0.12)',
  glassLine: 'rgba(255,255,255,0.22)',
} as const;

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
  group = false,
}: {
  mode: ControlMode;
  view: LiveView;
  onToggleView: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  finishHint?: string;
  group?: boolean;
}) {
  const toMap = view === 'numbers';
  const g = group ? groupStyles : null;
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
                g?.button,
                g?.mint,
                (pressed || mode === 'pausing') && styles.dim,
              ]}
            >
              {mode === 'pausing' ? (
                <AppText style={[styles.pauseText, g?.text]}>
                  일시정지 확인 중
                </AppText>
              ) : (
                <>
                  <Icon
                    name="pause"
                    color={group ? groupLook.onMint : liveLook.ground}
                    size={group ? 18 : 22}
                  />
                  <AppText style={[styles.pauseText, g?.text]}>
                    일시정지
                  </AppText>
                </>
              )}
            </Pressable>
          ) : mode === 'finishing' ? (
            <View
              style={[styles.button, styles.wide, styles.waiting, g?.button]}
              accessibilityLabel="종료 안내"
            >
              <AppText style={[styles.lightText, g?.lightText]}>
                종료 처리 중
              </AppText>
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
                  g?.button,
                  g?.mint,
                  (pressed || mode === 'resuming') && styles.dim,
                ]}
              >
                {mode === 'resuming' ? (
                  <AppText style={[styles.pauseText, g?.text]}>
                    재개 확인 중
                  </AppText>
                ) : (
                  <>
                    <Icon
                      name="play"
                      color={group ? groupLook.onMint : liveLook.ground}
                      size={group ? 16 : 20}
                      solid
                    />
                    <AppText style={[styles.pauseText, g?.text]}>재개</AppText>
                  </>
                )}
              </Pressable>
              <HoldToFinish
                disabled={mode === 'resuming'}
                onFinish={onFinish}
                group={group}
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
            g?.button,
            g?.round,
            pressed && styles.dim,
          ]}
        >
          <Icon
            name={toMap ? 'mapPin' : 'activity'}
            color={liveLook.text}
            size={group ? 20 : 22}
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
  group = false,
}: {
  disabled: boolean;
  onFinish: () => void;
  group?: boolean;
}) {
  const g = group ? groupStyles : null;
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
        g?.button,
        g?.finish,
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
      <Icon name="stop" color={liveLook.text} size={group ? 14 : 18} solid />
      <AppText style={[styles.lightText, g?.lightText]}>종료</AppText>
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

const groupStyles = StyleSheet.create({
  button: { height: 50, borderRadius: 25 },
  mint: { backgroundColor: groupLook.mint },
  finish: {
    backgroundColor: 'rgba(212, 74, 74, 0.16)',
    borderWidth: 1.5,
    borderColor: groupLook.danger,
  },
  round: {
    width: 50,
    borderWidth: 1,
    borderColor: groupLook.glassLine,
    backgroundColor: groupLook.glass,
  },
  text: {
    fontFamily: fontFamily.black,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.onMint,
  },
  lightText: { fontFamily: fontFamily.black, fontSize: 16, lineHeight: 21 },
});
