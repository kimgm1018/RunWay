import React from 'react';
import { Polyline } from 'react-native-svg';
import { routeStrokeLayers } from './mapRoute';

// A measured route only: callers split gaps before drawing so none of the outline layers bridge a pause.
export function RouteStroke({
  points,
  scale = 1,
}: {
  points: string;
  scale?: number;
}) {
  return (
    <>
      {routeStrokeLayers.map(layer => (
        <Polyline
          key={layer.color}
          points={points}
          fill="none"
          stroke={layer.color}
          strokeWidth={layer.width * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}
