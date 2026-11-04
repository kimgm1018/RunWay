import React from 'react';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { mistGradient, useTheme } from '../theme';

// The screen background: the mist tone (S15P31E105-427), soft grey-white at the top fading to steel
// blue-grey at the bottom. It replaced the K1 blue tone that faded from white to black (DESIGN.md 1-1).
// The dark tone (maps, dark parts) draws nothing, so the plain dark background underneath shows.
// tail keeps the light part down to about 80% for screens whose plain text runs the full height
// (7.1 피드, 7.2 댓글), so only the tab bar or the comment bar sits on the dark end.
// Each stop moves down along these points (where it sits → where tail puts it), whatever the stop count.
const tailPoints: [number, number][] = [
  [0, 0],
  [0.5, 0.6],
  [0.7, 0.8],
  [0.8, 0.88],
  [0.9, 0.95],
  [1, 1],
];

function tailOf(location: number) {
  const next = tailPoints.findIndex(([from]) => from >= location);
  if (next <= 0) {
    return tailPoints[0][1];
  }
  const [x0, y0] = tailPoints[next - 1];
  const [x1, y1] = tailPoints[next];
  return y0 + ((location - x0) / (x1 - x0)) * (y1 - y0);
}

export function Backdrop({ tail = false }: { tail?: boolean }) {
  const { name } = useTheme();
  if (name === 'dark') {
    return null;
  }
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
          {mistGradient.colors.map((color, index) => (
            <Stop
              key={index}
              offset={
                tail
                  ? tailOf(mistGradient.locations[index])
                  : mistGradient.locations[index]
              }
              stopColor={color}
            />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#mist)" />
    </Svg>
  );
}
