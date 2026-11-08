import React from 'react';
import type { ViewStyle } from 'react-native';
import { GlassIconButton } from './GlassIconButton';

// The one 뒤로 of the app: the shared round glass button with a chevron, at the top left.
export function BackButton({
  onPress,
  tone = 'light',
  accessibilityLabel = '뒤로',
  style,
}: {
  onPress: () => void;
  tone?: 'light' | 'dark';
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  return (
    <GlassIconButton
      icon="back"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      tone={tone}
      style={style}
    />
  );
}
