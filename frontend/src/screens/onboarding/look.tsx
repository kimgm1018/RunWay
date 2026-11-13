import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Keyboard,
  type LayoutChangeEvent,
  StyleSheet,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import LottieView from 'lottie-react-native';

// runway-onboarding-handoff (S15P31E105-447): the look the 1.2~1.7 screens share. The layout is the handoff's
// 390×844 frame: back 19,36 · progress bar top 54 · runner top 86 (196 high) · title top 310 · cards 23 under
// the title block, 12 apart, 24 from the sides · the main button 42 from the bottom, 58 high.
export const onboardingLook = {
  ink: '#02050E',
  label: '#3A5A6C',
  sub: '#56646C',
  muted: '#8A8A8A',
  // Field and card glass: white 62% → 38% at 160°, a white rim and a soft shadow.
  glass: 'rgba(255,255,255,0.5)',
  glassRim: 'rgba(255,255,255,0.6)',
  glassShadow:
    '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
  // A picked card is solid white with an ink rim.
  picked: '#FFFFFF',
  track: 'rgba(24,46,61,0.12)',
  sidePadding: 24,
  cardGap: 12,
} as const;

// 1.3 · 1.4 · 1.5 · 1.5b · 1.6 · 1.6b · 1.6w: the sign-up steps the header's progress bar counts.
export const signUpSteps = 7;

// The 1.x background: a cool grey-blue fading down, light at the top, a soft glow behind the runner and a
// faint teal at the foot (the handoff's five layered gradients).
export function OnboardingBackdrop() {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  // The five full-screen gradients are drawn by react-native-svg on the CPU. Without a layer of their own they were
  // drawn again on every frame of the runner's loops above them (about 150 ms a frame on the emulator), so the
  // 1.x screens answered touches slowly (TEAM QA T07, S15P31E105-802). Kept as a GPU texture they draw once.
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={measure}
      renderToHardwareTextureAndroid
      collapsable={false}
    >
      {box ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <LinearGradient id="obBase" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#E9EEF1" />
              <Stop offset="0.45" stopColor="#D7E1E7" />
              <Stop offset="0.75" stopColor="#C7D6DE" />
              <Stop offset="1" stopColor="#B4C8D3" />
            </LinearGradient>
            <LinearGradient id="obFoot" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.58" stopColor="#182E3D" stopOpacity={0} />
              <Stop offset="1" stopColor="#182E3D" stopOpacity={0.36} />
            </LinearGradient>
            <RadialGradient id="obMist" cx="0.45" cy="0.58" rx="0.75" ry="0.42">
              <Stop offset="0" stopColor="#A4BDC9" stopOpacity={0.38} />
              <Stop offset="0.55" stopColor="#A4BDC9" stopOpacity={0.18} />
              <Stop offset="1" stopColor="#A4BDC9" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="obGlow" cx="0.5" cy="0.3" rx="0.55" ry="0.22">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.28} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id="obTop" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.72} />
              <Stop offset="0.3" stopColor="#FFFFFF" stopOpacity={0.22} />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width={box.width} height={box.height} fill="url(#obBase)" />
          <Rect width={box.width} height={box.height} fill="url(#obFoot)" />
          <Rect width={box.width} height={box.height} fill="url(#obMist)" />
          <Rect width={box.width} height={box.height} fill="url(#obGlow)" />
          <Rect width={box.width} height={box.height} fill="url(#obTop)" />
        </Svg>
      ) : null}
    </View>
  );
}

// The runner is a Lottie run cycle (30 fps, 1 s loop) in place of the handoff's 8-frame WebP, whose 10 fps
// looked choppy (담당자 결정). Source: "Runner Jogger Athlete" by Christian on LottieFiles, Lottie Simple
// License (https://lottiefiles.com/free-animation/runner-jogger-athlete-IgPgKBrBuZ), recoloured from grey to
// the handoff runner's navy. It plays natively, so the JS thread stays free for the 1.3 code countdown.
const runnerAnimation = require('../../../assets/images/onboarding/runner.json');

// The ground's dashes and puffs move one dash period every 0.38 s; the speed lines every 0.76 s.
const stepMs = 380;

// The runner's loops redraw the 1.x screen on every frame, which held back taps and typing (TEAM QA T07,
// S15P31E105-802). It rests while the user touches the screen or types, and runs again about 1 s after.
export const RUNNER_REST_MS = 1000;
const touches = new Set<() => void>();

// Called by the 1.x screens' wrapper (onboarding/index.tsx) on every touch.
export function noteOnboardingTouch() {
  touches.forEach(listener => listener());
}

// Whether the runner should move: the screen is in front, the app is open, no keyboard is up and nobody has
// touched the screen for RUNNER_REST_MS.
export function useRunnerMoving(focused: boolean): boolean {
  const [touched, setTouched] = useState(false);
  const [keyboard, setKeyboard] = useState(() => Keyboard.isVisible());
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const touch = () => {
      setTouched(true);
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => setTouched(false), RUNNER_REST_MS);
    };
    touches.add(touch);
    const shown = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboard(true),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboard(false);
      touch();
    });
    const app = AppState.addEventListener('change', state =>
      setActive(state === 'active'),
    );
    return () => {
      touches.delete(touch);
      if (timer) {
        clearTimeout(timer);
      }
      shown.remove();
      hidden.remove();
      app.remove();
    };
  }, []);
  return focused && active && !keyboard && !touched;
}

// The navy runner over speed lines and a moving dashed ground (196 high, 390 wide in the handoff).
export function RunnerArt() {
  const step = useRef(new Animated.Value(0)).current;
  const lines = useRef(new Animated.Value(0)).current;
  const lottie = useRef<LottieView>(null);
  const moving = useRunnerMoving(useIsFocused());
  useEffect(() => {
    if (!moving) {
      lottie.current?.pause?.();
      return;
    }
    lottie.current?.resume?.();
    const ground = Animated.loop(
      Animated.timing(step, {
        toValue: 1,
        duration: stepMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const speed = Animated.loop(
      Animated.timing(lines, {
        toValue: 1,
        duration: stepMs * 2,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    ground.start();
    speed.start();
    return () => {
      ground.stop();
      speed.stop();
    };
  }, [lines, step, moving]);
  // The dashes slide left by one period (20 + 14) so the ground seems to run under the feet.
  const groundShift = step.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -34],
  });
  return (
    <View
      style={styles.art}
      accessibilityRole="image"
      accessibilityLabel="달리는 러너 일러스트"
    >
      {speedLines.map((line, index) => (
        <SpeedLine
          key={line.y}
          progress={lines}
          offset={index / 3}
          // The handoff draws them in a 56×100 box squeezed to 76 high at 74,30.
          top={30 + line.y * 0.76 - 1.5}
          left={74 + line.x}
          width={line.length}
        />
      ))}
      <View style={styles.ground}>
        <Animated.View
          style={[
            styles.groundDashes,
            { transform: [{ translateX: groundShift }] },
          ]}
        >
          <Svg width={236} height={12}>
            <Line
              x1={0}
              y1={6}
              x2={236}
              y2={6}
              stroke="#8DACBA"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray="20 14"
              opacity={0.7}
            />
          </Svg>
        </Animated.View>
      </View>
      <Puff progress={step} left={94 + 57} />
      <Puff progress={step} left={94 + 145} />
      <LottieView
        ref={lottie}
        source={runnerAnimation}
        autoPlay
        loop
        resizeMode="contain"
        style={styles.runner}
      />
    </View>
  );
}

const speedLines = [
  { x: 20, y: 18, length: 32 },
  { x: 6, y: 46, length: 40 },
  { x: 18, y: 74, length: 32 },
];

// One speed line behind the runner: it slides left and fades, a third of the way behind the one before.
function SpeedLine({
  progress,
  offset,
  top,
  left,
  width,
}: {
  progress: Animated.Value;
  offset: number;
  top: number;
  left: number;
  width: number;
}) {
  const phase = Animated.modulo(Animated.add(progress, offset), 1);
  return (
    <Animated.View
      style={[
        styles.speedLine,
        {
          top,
          left,
          width,
          opacity: phase.interpolate({
            inputRange: [0, 0.25, 1],
            outputRange: [0, 1, 0],
          }),
          transform: [
            {
              translateX: phase.interpolate({
                inputRange: [0, 1],
                outputRange: [14, -26],
              }),
            },
          ],
        },
      ]}
    />
  );
}

// A puff of dust kicked up from the ground, drifting back as it fades.
function Puff({ progress, left }: { progress: Animated.Value; left: number }) {
  return (
    <Animated.View
      style={[
        styles.puff,
        {
          left: left - 4,
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.8, 0],
          }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -18],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -6],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.4, 1.2],
              }),
            },
          ],
        },
      ]}
    >
      <Svg width={8} height={8}>
        <Circle cx={4} cy={4} r={4} fill="#A4BDC9" />
      </Svg>
    </Animated.View>
  );
}

// The thin bar at the top of a step screen: the share of the steps done in ink over a pale track.
export function ProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: current }}
    >
      <View
        style={[styles.fillBar, { width: `${(current / total) * 100}%` }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  art: { height: 196, width: 390, alignSelf: 'center' },
  // The Lottie is 400×500 and the runner fills it; the feet land where the handoff runner's did (y 179).
  runner: { position: 'absolute', left: 129, top: 14, width: 132, height: 165 },
  speedLine: {
    position: 'absolute',
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#7DA0B2',
  },
  ground: {
    position: 'absolute',
    left: 94,
    top: 177,
    width: 202,
    height: 12,
    overflow: 'hidden',
  },
  groundDashes: { position: 'absolute', left: 0, top: 0 },
  puff: { position: 'absolute', top: 177 - 2, width: 8, height: 8 },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: onboardingLook.track,
  },
  fillBar: { height: 4, borderRadius: 2, backgroundColor: onboardingLook.ink },
});
