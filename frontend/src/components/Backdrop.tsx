import React from 'react';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { k1Gradient, useTheme } from '../theme';

// The K1 screen background (DESIGN.md 1-1): light blue-grey at the top fading to black at the bottom.
// The dark tone (maps, dark parts) draws nothing, so the plain dark background underneath shows.
// tail keeps the light part down to about 80% for screens whose plain text runs the full height
// (7.1 피드, 7.2 댓글), so only the tab bar or the comment bar sits on the dark end.
const tailLocations = [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.7, 0.8, 0.88, 0.95, 1];

export function Backdrop({ tail = false }: { tail?: boolean }) {
  const { name } = useTheme();
  if (name === 'dark') {
    return null;
  }
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id="k1" x1="0" y1="0" x2="0" y2="1">
          {k1Gradient.colors.map((color, index) => (
            <Stop
              key={index}
              offset={(tail ? tailLocations : k1Gradient.locations)[index]}
              stopColor={color}
            />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#k1)" />
    </Svg>
  );
}
