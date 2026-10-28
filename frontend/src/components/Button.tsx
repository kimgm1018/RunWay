import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { palette, radius, size, spacing, typography, useTheme } from '../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'inverse'
  | 'danger'
  | 'text';
export type ButtonSize = 'large' | 'medium' | 'small';

const heights: Record<ButtonSize, number> = {
  large: size.buttonLarge,
  medium: size.buttonMedium,
  small: size.buttonSmall,
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size: buttonSize = 'large',
  icon,
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const look = {
    primary: {
      background: colors.accent,
      pressed: colors.accentPressed,
      text: colors.onAccent,
      border: 'transparent',
    },
    secondary: {
      background: colors.surfaceMuted,
      pressed: colors.border,
      text: colors.text,
      border: colors.borderStrong,
    },
    inverse: {
      background: palette.white,
      pressed: palette.paper,
      text: palette.ink,
      border: 'transparent',
    },
    danger: {
      background: colors.danger,
      pressed: palette.coralSoft,
      text: colors.onDanger,
      border: 'transparent',
    },
    text: {
      background: 'transparent',
      pressed: colors.surfaceMuted,
      text: colors.textSecondary,
      border: 'transparent',
    },
  }[variant];
  // A loading button keeps its colors at reduced opacity; a disabled one turns gray (1.2 로그인 중, 6.2f 정원 마감).
  const textColor = disabled ? colors.textDisabled : look.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height: heights[buttonSize],
          paddingHorizontal: buttonSize === 'small' ? spacing.md : spacing.xxl,
          backgroundColor: disabled
            ? colors.surfaceMuted
            : pressed
            ? look.pressed
            : look.background,
          borderColor: disabled ? colors.border : look.border,
        },
        variant === 'primary' && !disabled && styles.primaryShadow,
        loading && styles.loading,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : icon ? (
        <Icon name={icon} color={textColor} size={18} />
      ) : null}
      <AppText
        style={[
          buttonSize === 'small' ? typography.captionStrong : typography.button,
          { color: textColor },
        ]}
        numberOfLines={1}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  primaryShadow: {
    shadowColor: palette.mint,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  loading: { opacity: 0.6 },
});
