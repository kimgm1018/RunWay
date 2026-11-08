import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// 앱 움직임 기준 (S15P31E105-478, DESIGN.md 5. 움직임). Only React Native's Animated and LayoutAnimation: no new
// native library. Every motion here is off while the phone's 동작 줄이기 (reduce motion) is on, and the screen
// shows its final state at once.
export const motion = {
  // 누름: one spring for every pressable box and button, down to 96% and back with a small bounce.
  press: { scale: 0.96, speed: 40, bounciness: 8 },
  duration: {
    // A state that swaps (기간 전환, 펼치기·접기).
    quick: 220,
    // Something drawn in (차트 선·막대).
    draw: 600,
    // A number counting up (준비도, 4.5 기록).
    count: 900,
  },
  // Each bar of a chart starts this much after the one before it.
  stagger: 50,
  easing: Easing.out(Easing.cubic),
} as const;

// 동작 줄이기, read once and kept current for every screen by one listener.
let reduced = false;
let started = false;
const listeners = new Set<() => void>();

function startWatching() {
  if (started) {
    return;
  }
  started = true;
  const set = (value: boolean) => {
    if (value !== reduced) {
      reduced = value;
      listeners.forEach(listener => listener());
    }
  };
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then(set)
    .catch(() => undefined);
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', set);
}

function subscribe(listener: () => void) {
  startWatching();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Sets 동작 줄이기 by hand and stops following the phone's setting. Tests start with it on so screens render their
// final state at once (jest.setup.js), and turn it off to check a motion.
export function setReduceMotion(value: boolean) {
  started = true;
  if (value !== reduced) {
    reduced = value;
    listeners.forEach(listener => listener());
  }
}

// Whether the phone asks for less motion; for event handlers outside a component.
export function isReduceMotion() {
  startWatching();
  return reduced;
}

export function useReduceMotion() {
  return useSyncExternalStore(subscribe, () => reduced);
}

// A layout change (펼치기·접기, 기간 전환) that eases into place instead of jumping, unless 동작 줄이기 is on.
// Call it right before the state change.
export function animateNextLayout() {
  if (isReduceMotion()) {
    return;
  }
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      motion.duration.quick,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ),
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
};

// A Pressable that sinks to 96% with the common spring while pressed (DESIGN.md 2-1 누름). Its own style may change
// colours when pressed but leaves the scale to this.
export function PressableScale({
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const springTo = (toValue: number) => {
    if (reduce) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, {
      toValue,
      speed: motion.press.speed,
      bounciness: motion.press.bounciness,
      useNativeDriver: true,
    }).start();
  };
  const resolved =
    typeof style === 'function'
      ? style({ pressed } as PressableStateCallbackType)
      : style;
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event: GestureResponderEvent) => {
        setPressed(true);
        springTo(motion.press.scale);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        setPressed(false);
        springTo(1);
        onPressOut?.(event);
      }}
      style={[resolved, { transform: [{ scale }] }]}
    />
  );
}

// 0 → 1 once each time key changes (a chart drawing in when its data changes), or 1 at once with 동작 줄이기.
// delay staggers several of them.
export function useAppear(
  key: unknown,
  {
    delay = 0,
    duration = motion.duration.draw,
  }: { delay?: number; duration?: number } = {},
) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: motion.easing,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, duration, key, progress, reduce]);
  return progress;
}

// A number that counts up to target once each time target changes (준비도, 4.5 기록), or shows it at once with
// 동작 줄이기. The value is a float; the caller formats it.
export function useCountUp(
  target: number,
  duration: number = motion.duration.count,
) {
  const reduce = useReduceMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) {
      setValue(target);
      from.current = target;
      return;
    }
    const progress = new Animated.Value(0);
    const start = from.current;
    const id = progress.addListener(({ value: share }) =>
      setValue(start + (target - start) * share),
    );
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: motion.easing,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) {
        setValue(target);
      }
    });
    from.current = target;
    return () => {
      animation.stop();
      progress.removeListener(id);
    };
  }, [duration, reduce, target]);
  return value;
}

// Fades and lifts its children in once when key changes (기간 전환의 새 내용), or shows them at once.
export function FadeIn({
  appearKey,
  style,
  children,
}: {
  appearKey: unknown;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const progress = useAppear(appearKey, { duration: motion.duration.quick });
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// A graph drawn in from the left once each time appearKey changes: its line and fill are uncovered left to right
// (차트 선 그리기). The children are drawn at the full width underneath.
export function RevealX({
  appearKey,
  width,
  height,
  delay = 0,
  children,
}: {
  appearKey: unknown;
  width: number;
  height: number;
  delay?: number;
  children: React.ReactNode;
}) {
  const progress = useAppear(appearKey, { delay });
  return (
    <Animated.View
      style={[
        styles.clip,
        {
          width: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, width],
          }),
          height,
        },
      ]}
    >
      <Animated.View style={{ width, height }}>{children}</Animated.View>
    </Animated.View>
  );
}

// One bar of a bar chart rising from the baseline once each time appearKey changes; index staggers the bars so they
// come up one after another (차트 막대 차례로 올라오기).
export function GrowBar({
  appearKey,
  index,
  left,
  width,
  height,
  radius,
  color,
}: {
  appearKey: unknown;
  index: number;
  left: number;
  width: number;
  height: number;
  radius: number;
  color: string;
}) {
  const progress = useAppear(appearKey, { delay: index * motion.stagger });
  return (
    <Animated.View
      style={[
        styles.bar,
        {
          left,
          width,
          height: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, height],
          }),
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          borderBottomLeftRadius: radius,
          borderBottomRightRadius: radius,
          backgroundColor: color,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  bar: { position: 'absolute', bottom: 0 },
});

// Pops its children in once with a small overshoot when active turns true (4.5 목표 달성 하이라이트), or shows them
// at once with 동작 줄이기.
export function Pop({
  active,
  style,
  children,
}: {
  active: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(active && !reduce ? 0.6 : 1)).current;
  useEffect(() => {
    if (!active || reduce) {
      scale.setValue(1);
      return;
    }
    scale.setValue(0.6);
    const animation = Animated.spring(scale, {
      toValue: 1,
      speed: 12,
      bounciness: 14,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reduce, scale]);
  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}
