import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { size, useTheme } from '../theme';
import { Icon, type IconName } from './Icon';

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  badge = false,
  diameter = size.iconButton,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  badge?: boolean;
  // 1.5·1.6's 이전 next to the main button is larger (54).
  diameter?: number;
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
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: colors.glass,
          borderColor: colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} color={colors.text} size={18} strokeWidth={1.7} />
      {badge ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: colors.danger, borderColor: colors.background },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
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
  },
});
