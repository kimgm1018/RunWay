import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

// On/off switch (6.2m 정원 제한, 7.3 코스도 함께 공유): an accent track with the knob on the right
// when on, so it is dark on the light background and ice inside dark cards.
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[
        styles.track,
        { backgroundColor: value ? colors.accent : colors.borderStrong },
      ]}
    >
      <View
        style={[
          styles.knob,
          value ? styles.on : styles.off,
          { backgroundColor: value ? colors.onAccent : colors.surfaceRaised },
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
  knob: { width: 24, height: 24, borderRadius: 12 },
  on: { alignSelf: 'flex-end' },
  off: { alignSelf: 'flex-start' },
});
