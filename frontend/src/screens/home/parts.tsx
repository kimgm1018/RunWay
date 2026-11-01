import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { radius, spacing, useTheme } from '../../theme';

// The rounded glass panel for the 2.1 홈 load error.
export function GlassCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// 42×42 tile with a course's shape, used by the group run course picker.
export function RouteThumb({ shape }: { shape: [number, number][] }) {
  const { colors } = useTheme();
  const points = shape.map(([x, y]) => `${4 + x * 22},${4 + y * 22}`).join(' ');
  return (
    <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
      <Svg width={30} height={30}>
        <Polyline
          points={points}
          fill="none"
          stroke={colors.textSecondary}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl + 2,
    borderWidth: 1,
    padding: 18,
    gap: spacing.lg,
  },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
