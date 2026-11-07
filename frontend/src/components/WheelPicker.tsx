import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { fontFamily } from '../theme';

// Five rows show: the picked one in the middle, two fading rows above and below.
const visibleRows = 5;
const offsets = [-2, -1, 0, 1, 2];

// A drum the user rolls up and down (1.5b 생년월일, S15P31E105-520). The middle row is the value; it settles on a
// row when the roll stops, and a tapped row rolls to the middle. Screen readers get one adjustable control.
export function WheelPicker({
  label,
  options,
  value,
  format,
  onChange,
  color,
  itemHeight = 40,
  textStyle,
  style,
}: {
  label: string;
  options: number[];
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  color: string;
  itemHeight?: number;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const index = Math.max(0, options.indexOf(value));
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(index * itemHeight)).current;
  // The row the drum rests on, so a value from outside (a shorter month) can roll it.
  const settled = useRef(index);
  const dragEnd = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (settled.current !== index) {
      settled.current = index;
      scrollRef.current?.scrollTo({ y: index * itemHeight, animated: true });
    }
  }, [index, itemHeight]);

  useEffect(
    () => () => {
      if (dragEnd.current) {
        clearTimeout(dragEnd.current);
      }
    },
    [],
  );

  const pick = (next: number) => {
    const clamped = Math.min(options.length - 1, Math.max(0, next));
    settled.current = clamped;
    if (options[clamped] !== value) {
      onChange(options[clamped]);
    }
  };
  const settleAt = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    pick(Math.round(event.nativeEvent.contentOffset.y / itemHeight));
  const rollTo = (next: number) => {
    scrollRef.current?.scrollTo({ y: next * itemHeight, animated: true });
    pick(next);
  };

  // A slow release has no momentum, so the drag end settles it unless a momentum roll starts right after.
  const onScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    dragEnd.current = setTimeout(() => {
      dragEnd.current = null;
      pick(Math.round(y / itemHeight));
    }, 120);
  };
  const onMomentumScrollBegin = () => {
    if (dragEnd.current) {
      clearTimeout(dragEnd.current);
      dragEnd.current = null;
    }
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    rollTo(index + step);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAccessibilityAction}
      style={[{ height: itemHeight * visibleRows }, style]}
    >
      <Animated.ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: index * itemHeight }}
        contentContainerStyle={{
          paddingVertical: itemHeight * Math.floor(visibleRows / 2),
        }}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={settleAt}
      >
        {options.map((option, row) => {
          // How far this row sits from the middle, in rows, as the drum turns.
          const inputRange = offsets.map(
            offset => (row + offset) * itemHeight,
          );
          const opacity = scrollY.interpolate({
            inputRange,
            outputRange: [0.14, 0.36, 1, 0.36, 0.14],
            extrapolate: 'clamp',
          });
          const scale = scrollY.interpolate({
            inputRange,
            outputRange: [0.72, 0.84, 1, 0.84, 0.72],
            extrapolate: 'clamp',
          });
          const rotateX = scrollY.interpolate({
            inputRange,
            outputRange: ['56deg', '28deg', '0deg', '-28deg', '-56deg'],
            extrapolate: 'clamp',
          });
          return (
            <Pressable
              key={option}
              accessibilityLabel={`${label} ${format(option)}`}
              onPress={() => rollTo(row)}
              style={[styles.row, { height: itemHeight }]}
            >
              <Animated.Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={[
                  styles.text,
                  textStyle,
                  {
                    color,
                    opacity,
                    transform: [{ perspective: 400 }, { rotateX }, { scale }],
                  },
                ]}
              >
                {format(option)}
              </Animated.Text>
            </Pressable>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', justifyContent: 'center' },
  text: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 34,
    textAlign: 'center',
  },
});
