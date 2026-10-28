import React from 'react';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';

// Stands in for the prototype's photos (1.1·1.2 runner, 2.1 profile photo) until a real image is set:
// the theme background with a soft mint glow near the top.
export function Backdrop() {
  const { colors } = useTheme();
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.surfaceRaised} />
          <Stop offset="0.55" stopColor={colors.background} />
          <Stop offset="1" stopColor={colors.background} />
        </LinearGradient>
        <RadialGradient id="glow" cx="0.7" cy="0.25" r="0.6">
          <Stop offset="0" stopColor={colors.accent} stopOpacity={0.16} />
          <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#fade)" />
      <Rect width="100%" height="100%" fill="url(#glow)" />
    </Svg>
  );
}
