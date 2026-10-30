import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, spacing, useTheme } from '../theme';
import { AppText } from './AppText';

// Pill switch: 1.5 성별, 1.6 완주 시간 · 페이스, 2.1 최신순 · 거리순 · 페이스순 (compact).
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.segmented,
        compact && styles.segmentedCompact,
        { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              compact && styles.segmentCompact,
              selected && { backgroundColor: colors.accent },
            ]}
          >
            <AppText
              variant={compact ? 'buttonSmall' : 'bodyMedium'}
              style={{
                color: selected ? colors.onAccent : colors.textSecondary,
              }}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radius.pill,
  },
  segmentedCompact: { padding: spacing.xxs },
  segment: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentCompact: { flex: 0, height: 28, paddingHorizontal: spacing.lg },
});
