import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { logoPath, logoViewBox, symbolPath, symbolViewBox } from './logoPath';

// The RUNWAY wordmark in the text color: white on dark screens, ink on light ones.
// `symbol` draws the course loop mark alone, as in the middle of the 1.x and 2.x headers.
export function Logo({
  width,
  symbol = false,
}: {
  width: number;
  symbol?: boolean;
}) {
  const { colors } = useTheme();
  const { width: w, height: h } = symbol ? symbolViewBox : logoViewBox;
  return (
    <Svg
      width={width}
      height={(width * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      accessibilityRole="image"
      accessibilityLabel="RUNWAY"
    >
      <Path
        d={symbol ? symbolPath : logoPath}
        fill={colors.text}
        fillRule="evenodd"
      />
    </Svg>
  );
}
