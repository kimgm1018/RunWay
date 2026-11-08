import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { k1, radius, size, spacing, typography, useTheme } from '../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './Motion';

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
  // Kit buttons (DESIGN.md 4): solid, outline, light pill, coral fill, underlined text.
  const look = {
    primary: {
      background: colors.accent,
      pressed: colors.accentPressed,
      text: colors.onAccent,
      border: 'transparent',
    },
    secondary: {
      background: 'transparent',
      pressed: colors.surfaceMuted,
      text: colors.text,
      border: colors.borderStrong,
    },
    // Stays a light pill in either tone, like 1.x 시작하기 on the black lower part.
    inverse: {
      background: k1.ice,
      pressed: k1.top,
      text: k1.night,
      border: 'transparent',
    },
    danger: {
      background: colors.danger,
      pressed: colors.dangerBorder,
      text: colors.onDanger,
      border: 'transparent',
    },
    text: {
      background: 'transparent',
      pressed: colors.surfaceMuted,
      text: colors.text,
      border: 'transparent',
    },
  }[variant];
  // A loading button keeps its colors at reduced opacity; a disabled one turns gray (1.2 로그인 중, 6.2f 정원 마감).
  const textColor = disabled ? colors.textTertiary : look.text;
  return (
    <PressableScale
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
          borderColor: disabled ? 'transparent' : look.border,
        },
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
          buttonSize === 'small' ? typography.buttonSmall : typography.button,
          { color: textColor },
          variant === 'text' && styles.underline,
        ]}
        numberOfLines={1}
      >
        {title}
      </AppText>
    </PressableScale>
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
  loading: { opacity: 0.6 },
  underline: { textDecorationLine: 'underline' },
});
