import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

// On/off switch (6.2m 정원 제한, 7.3 코스도 함께 공유): an accent track with the knob on the right
// when on, so it is dark on the light background and ice inside dark cards. onColors paints the on state
// differently (6.2's navy knob on a white track with a faint rim, S15P31E105-563).
export function Toggle({
  label,
  value,
  onChange,
  onColors,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  onColors?: { track: string; knob: string; rim?: string };
}) {
  const { colors } = useTheme();
  const custom = value ? onColors : undefined;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[
        styles.track,
        {
          backgroundColor: value
            ? custom?.track ?? colors.accent
            : colors.borderStrong,
        },
        custom?.rim ? [styles.rimmed, { borderColor: custom.rim }] : null,
      ]}
    >
      <View
        style={[
          styles.knob,
          value ? styles.on : styles.off,
          {
            backgroundColor: value
              ? custom?.knob ?? colors.onAccent
              : colors.surfaceRaised,
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 52,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  // The rim takes 1.5 of the 3 padding, so the knob keeps its size.
  rimmed: { borderWidth: 1.5, padding: 1.5 },
  knob: { width: 24, height: 24, borderRadius: 12 },
  on: { alignSelf: 'flex-end' },
  off: { alignSelf: 'flex-start' },
});
