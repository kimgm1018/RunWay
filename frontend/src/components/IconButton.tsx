import React from 'react';
import { useTheme } from '../theme';
import type { IconName } from './Icon';
import { GlassIconButton } from './GlassIconButton';

// The shared round glass button, toned by the surrounding ThemeProvider (dark parts get the dark glass).
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
  const { name } = useTheme();
  return (
    <GlassIconButton
      icon={icon}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      tone={name === 'dark' ? 'dark' : 'light'}
      dot={badge}
    />
  );
}
