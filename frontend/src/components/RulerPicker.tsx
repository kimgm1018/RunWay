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

// One tick. Memoized, so moving a step redraws only the tick it leaves and the one it reaches, not all of them
// (S15P31E105-696: the drag stuttered with every tick redrawn).
const Tick = React.memo(function RulerTick({
  major,
  color,
}: {
  major: boolean;
  color: string;
}) {
  return (
    <View style={styles.slot}>
      <View
        style={[
          styles.tick,
          major ? styles.major : styles.minor,
          { backgroundColor: color },
        ]}
      />
    </View>
  );
});

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
  compact = false,
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
  // A smaller value over the ruler, for a form with other fields around it (6.8 그룹런 만들기, S15P31E105-696).
  compact?: boolean;
}) {
  // A max that is not a whole number of steps from min (21.1km, a half marathon) gets its own last tick.
  const whole = Math.floor((max - min) / step + 1e-9);
  const extra = min + whole * step < max - 1e-9;
  const count = whole + 1 + (extra ? 1 : 0);
  const lastWhole = min + whole * step;
  // A value between the last whole tick and max (21.09 restored from a search) goes to the nearer of the two.
  const indexOf = (next: number) =>
    extra && next >= (lastWhole + max) / 2
      ? count - 1
      : Math.min(whole, Math.max(0, Math.round((next - min) / step)));
  const valueAt = (index: number) =>
    extra && index === count - 1 ? max : Number((min + index * step).toFixed(4));
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
      <AppText
        style={[styles.value, compact && styles.valueCompact, { color }]}
        numberOfLines={1}
      >
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
              <Tick
                key={tick}
                major={tick % 5 === 0}
                color={tick === index ? color : mutedColor}
              />
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
  valueCompact: { fontSize: 22, lineHeight: 28 },
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
