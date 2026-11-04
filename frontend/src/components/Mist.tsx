import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// The 2.0M 미스트 카드 그라데이션 (runway-run-music-handoff, runway-course-handoff 공통): white at the top
// through steel blue to near black, every 5%.
export const mistColors = [
  '#F9F9F9',
  '#F8F8F8',
  '#F3F5F6',
  '#E2EAEE',
  '#C4D4DC',
  '#A4BDC9',
  '#8DACBA',
  '#81A3B3',
  '#7DA0B2',
  '#7DA0B2',
  '#7DA0B2',
  '#7599AB',
  '#5D8194',
  '#3A5A6C',
  '#182E3D',
  '#091019',
  '#060709',
  '#060606',
  '#06080B',
  '#0D171F',
  '#1A2E39',
];

// A mist card's fill: the gradient (upside down when flipped), behind the card's content. The mockups'
// grain is left out (담당자 결정).
// It measures itself: an Svg sized in percent falls back to 300×150 on Android.
export function MistFill({
  id,
  flipped = false,
  colors = mistColors,
  offsets,
  style,
}: {
  // Unique per screen: Svg gradient ids are global on Android.
  id: string;
  flipped?: boolean;
  colors?: string[];
  // Where each color sits, 0–1; evenly spaced when left out.
  offsets?: number[];
  style?: StyleProp<ViewStyle>;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  const stops = flipped ? [...colors].reverse() : colors;
  return (
    <View style={[styles.fill, style]} onLayout={measure} pointerEvents="none">
      {box ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              {stops.map((color, index) => (
                <Stop
                  key={index}
                  offset={offsets?.[index] ?? index / (stops.length - 1)}
                  stopColor={color}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width={box.width} height={box.height} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
