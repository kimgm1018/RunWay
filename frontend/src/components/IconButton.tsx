import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { palette, size, useTheme } from '../theme';
import { Icon, type IconName } from './Icon';

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  badge = false,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  badge?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderStrong,
        },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} color={colors.text} size={18} strokeWidth={1.7} />
      {badge ? (
        <View style={[styles.badge, { borderColor: colors.background }]} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: size.iconButton / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  badge: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    backgroundColor: palette.coral,
  },
});
