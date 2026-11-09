import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

// Two faces of one card turned about its vertical axis, as 3.1b turns (S15P31E105-615 러닝 분석: 러닝 결과 ↔ 목표와
// 비교). Both faces stay laid out, one over the other, and the card takes the taller one's height, so turning neither
// cuts a face nor makes the card jump. The face away from the user takes no touch and is hidden from the screen
// reader. A turn asked for while one is under way is ignored, so quick taps cannot leave the faces half turned.
const turnMs = 450;

export function FlipCard({
  front,
  back,
}: {
  front: (turn: () => void) => React.ReactNode;
  back: (turn: () => void) => React.ReactNode;
}) {
  const [showBack, setShowBack] = useState(false);
  const busy = useRef(false);
  const angle = useRef(new Animated.Value(0)).current;
  const [heights, setHeights] = useState({ front: 0, back: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const turn = () => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    const next = !showBack;
    setShowBack(next);
    Animated.timing(angle, {
      toValue: next ? 1 : 0,
      duration: turnMs,
      useNativeDriver: true,
    }).start();
    // Free again once the turn has had its time, whether or not the animation reports back.
    timer.current = setTimeout(() => {
      busy.current = false;
    }, turnMs);
  };

  // Android does not always cull a face turned away (backfaceVisibility fails under a fading parent), so each face is
  // also see-through for the half of the turn it faces away.
  const face = (from: string, to: string) => ({
    opacity: angle.interpolate({
      inputRange: [0, 0.5, 0.5001, 1],
      outputRange: from === '0deg' ? [1, 1, 0, 0] : [0, 0, 1, 1],
    }),
    transform: [
      { perspective: 1200 },
      {
        rotateY: angle.interpolate({
          inputRange: [0, 1],
          outputRange: [from, to],
        }),
      },
    ],
  });
  const hidden = (isBack: boolean) => {
    const away = isBack !== showBack;
    return {
      pointerEvents: away ? ('none' as const) : ('auto' as const),
      accessibilityElementsHidden: away,
      importantForAccessibility: away
        ? ('no-hide-descendants' as const)
        : ('auto' as const),
    };
  };

  return (
    <View style={{ minHeight: Math.max(heights.front, heights.back) }}>
      <Animated.View
        {...hidden(false)}
        testID="flip-front"
        onLayout={event => {
          const height = event.nativeEvent.layout.height;
          setHeights(value => ({ ...value, front: height }));
        }}
        style={[styles.face, face('0deg', '180deg')]}
      >
        {front(turn)}
      </Animated.View>
      <Animated.View
        {...hidden(true)}
        testID="flip-back"
        onLayout={event => {
          const height = event.nativeEvent.layout.height;
          setHeights(value => ({ ...value, back: height }));
        }}
        style={[styles.face, face('180deg', '360deg')]}
      >
        {back(turn)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backfaceVisibility: 'hidden',
  },
});
