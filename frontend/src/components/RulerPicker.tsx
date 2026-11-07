import React, { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { fontFamily } from '../theme';
import { AppText } from './AppText';

const tickGap = 12;

// A ruler the user drags sideways (러닝 목표 설정, S15P31E105-517): the tick under the middle line is the value,
// shown big above it. It moves one step per tick and stops on a tick. Screen readers get one adjustable control.
export function RulerPicker({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  color,
  mutedColor,
  style,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  color: string;
  mutedColor: string;
  style?: StyleProp<ViewStyle>;
}) {
  const count = Math.round((max - min) / step) + 1;
  const indexOf = (next: number) =>
    Math.min(count - 1, Math.max(0, Math.round((next - min) / step)));
  const valueAt = (index: number) => Number((min + index * step).toFixed(4));
  const index = indexOf(value);
  const [width, setWidth] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const shown = useRef(index);
  const dragging = useRef(false);

  // A value set from outside (another ruler, a preset) moves the ruler there.
  useEffect(() => {
    if (!dragging.current && width > 0 && shown.current !== index) {
      shown.current = index;
      scroll.current?.scrollTo({ x: index * tickGap, animated: true });
    }
  }, [index, width]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.min(
      count - 1,
      Math.max(0, Math.round(event.nativeEvent.contentOffset.x / tickGap)),
    );
    if (next !== shown.current) {
      shown.current = next;
      onChange(valueAt(next));
    }
  };
  const step1 = (event: AccessibilityActionEvent) => {
    const next = Math.min(
      count - 1,
      Math.max(
        0,
        index + (event.nativeEvent.actionName === 'increment' ? 1 : -1),
      ),
    );
    onChange(valueAt(next));
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={step1}
      style={style}
    >
      <AppText style={[styles.value, { color }]} numberOfLines={1}>
        {format(value)}
      </AppText>
      <View
        style={styles.ruler}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <ScrollView
            ref={scroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={tickGap}
            decelerationRate="fast"
            contentOffset={{ x: index * tickGap, y: 0 }}
            contentContainerStyle={{
              paddingHorizontal: width / 2 - tickGap / 2,
            }}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              dragging.current = true;
            }}
            onMomentumScrollEnd={() => {
              dragging.current = false;
            }}
            onScrollEndDrag={() => {
              dragging.current = false;
            }}
            onScroll={onScroll}
          >
            {Array.from({ length: count }, (_, tick) => (
              <View key={tick} style={styles.slot}>
                <View
                  style={[
                    styles.tick,
                    tick % 5 === 0 ? styles.major : styles.minor,
                    { backgroundColor: tick === index ? color : mutedColor },
                  ]}
                />
              </View>
            ))}
          </ScrollView>
        ) : null}
        <View
          pointerEvents="none"
          style={[styles.needle, { backgroundColor: color }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  value: {
    textAlign: 'center',
    fontFamily: fontFamily.numberMedium,
    fontSize: 36,
    lineHeight: 44,
  },
  ruler: { height: 44, justifyContent: 'center' },
  slot: { width: tickGap, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 2, borderRadius: 1 },
  minor: { height: 12 },
  major: { height: 24 },
  needle: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1.5,
    width: 3,
    height: 36,
    borderRadius: 1.5,
  },
});
