import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { AppText } from '../../components';
import { fontFamily, spacing, useTheme } from '../../theme';

// A white 26 knob inside a 6 wide chip-colored ring (DESIGN.md 2-7 슬라이더).
const knob = 38;

// 3.1 목표 거리: drag along the track in steps; screen readers adjust it one step at a time.
export function RangeSlider({
  value,
  min,
  max,
  step,
  ticks,
  onChange,
  accessibilityLabel,
  formatValue,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  ticks: number[];
  onChange: (value: number) => void;
  accessibilityLabel: string;
  formatValue: (value: number) => string;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const usable = Math.max(width - knob, 1);
  const ratio = (value - min) / (max - min);
  const latest = useRef({ usable, onChange, value });
  latest.current = { usable, onChange, value };
  const startX = useRef(0);

  const snap = (x: number) => {
    const raw =
      min +
      (Math.min(Math.max(x, 0), latest.current.usable) /
        latest.current.usable) *
        (max - min);
    return Math.min(max, Math.max(min, Math.round(raw / step) * step));
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => {
          startX.current = event.nativeEvent.locationX - knob / 2;
          latest.current.onChange(snap(startX.current));
        },
        onPanResponderMove: (_, gesture) =>
          latest.current.onChange(snap(startX.current + gesture.dx)),
        onPanResponderTerminationRequest: () => false,
      }),
    // snap reads min/max/step, which stay fixed for a slider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View>
      <View
        {...responder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: value, text: formatValue(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event =>
          onChange(
            Math.min(
              max,
              Math.max(
                min,
                value +
                  (event.nativeEvent.actionName === 'increment' ? step : -step),
              ),
            ),
          )
        }
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        style={styles.touch}
      >
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.fill,
              {
                width: knob / 2 + ratio * usable,
                backgroundColor: colors.accent,
              },
            ]}
          />
        </View>
        <View
          style={[
            styles.knob,
            { left: ratio * usable, backgroundColor: colors.surfaceMuted },
          ]}
        >
          <View style={[styles.knobCore, { backgroundColor: colors.accent }]} />
        </View>
      </View>
      <View style={styles.ticks}>
        {ticks.map(tick => (
          <AppText
            key={tick}
            variant="label"
            tone="textSecondary"
            style={[
              styles.tick,
              tick === max
                ? styles.lastTick
                : {
                    left: knob / 2 + ((tick - min) / (max - min)) * usable - 12,
                  },
            ]}
          >
            {tick === max ? `${tick}km` : tick}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { height: knob, justifyContent: 'center' },
  // The track runs the full width; the fill ends under the knob's center.
  track: { height: 4, borderRadius: 2 },
  fill: { height: 4, borderRadius: 2 },
  knob: {
    position: 'absolute',
    width: knob,
    height: knob,
    borderRadius: knob / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobCore: { width: 26, height: 26, borderRadius: 13 },
  ticks: { height: 16, marginTop: spacing.xxs },
  tick: {
    position: 'absolute',
    width: 24,
    textAlign: 'center',
    fontFamily: fontFamily.numberMedium,
  },
  lastTick: { right: 0, width: 40, textAlign: 'right' },
});
