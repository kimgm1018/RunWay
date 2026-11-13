import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { wordmarkPath, wordmarkRatio, wordmarkViewBox } from './logoPath';

// The RUN'WAY" wordmark in the text color: white on dark screens, ink on light ones. The app shows the
// letters only, without the course loop (S15P31E105-744).
export function Logo({ width }: { width: number }) {
  const { colors } = useTheme();
  return (
    <Svg
      width={width}
      height={width * wordmarkRatio}
      viewBox={wordmarkViewBox}
      accessibilityRole="image"
      accessibilityLabel="RUNWAY"
    >
      <Path d={wordmarkPath} fill={colors.text} fillRule="evenodd" />
    </Svg>
  );
}
