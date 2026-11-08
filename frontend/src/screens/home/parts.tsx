import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { radius, useTheme } from '../../theme';

// 42×42 tile with a course's shape, used by the group run course picker.
export function RouteThumb({ shape }: { shape: [number, number][] }) {
  const { colors } = useTheme();
  const points = shape.map(([x, y]) => `${4 + x * 22},${4 + y * 22}`).join(' ');
  return (
    <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
      <Svg width={30} height={30}>
        <Polyline
          points={points}
          fill="none"
          stroke={colors.textSecondary}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
