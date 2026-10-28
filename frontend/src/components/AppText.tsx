import React from 'react';
import { Text, type TextProps } from 'react-native';
import {
  typography,
  useTheme,
  type ThemeColors,
  type TypographyVariant,
} from '../theme';

type TextTone = Extract<
  keyof ThemeColors,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'textDisabled'
  | 'accentText'
  | 'danger'
  | 'onAccent'
>;

export function AppText({
  variant = 'body',
  tone = 'text',
  style,
  ...props
}: TextProps & { variant?: TypographyVariant; tone?: TextTone }) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[typography[variant], { color: colors[tone] }, style]}
    />
  );
}
