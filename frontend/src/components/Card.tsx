import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { radius, spacing, useTheme } from '../theme';

export type CardVariant = 'glass' | 'solid' | 'muted' | 'outline';

export function Card({
  children,
  variant = 'glass',
  onPress,
  accessibilityLabel,
  style,
}: {
  children: React.ReactNode;
  variant?: CardVariant;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const look = {
    glass: { backgroundColor: colors.surface, borderColor: colors.border },
    solid: {
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
    },
    muted: { backgroundColor: colors.surfaceMuted, borderColor: 'transparent' },
    // 6.0: the group run that starts soon is pinned with a mint outline.
    outline: { backgroundColor: colors.surface, borderColor: colors.accent },
  }[variant];
  if (!onPress) {
    return <View style={[styles.card, look, style]}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        look,
        pressed && styles.pressed,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: spacing.xxl,
    gap: spacing.xl,
  },
  pressed: { opacity: 0.8 },
});
