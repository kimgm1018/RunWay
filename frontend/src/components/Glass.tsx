import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// The 라이트 글라스 of runway-course-handoff (지도 위 바·시트 공통) and its helpers inside it.
// React Native cannot blur what lies behind a view, so the glass is the gradient alone.
export const glass = {
  rim: 'rgba(255,255,255,0.55)',
  // 원·배지 inside the glass, with a brighter rim.
  circle: 'rgba(255,255,255,0.55)',
  circleRim: 'rgba(255,255,255,0.7)',
  panel: 'rgba(255,255,255,0.4)',
  tile: 'rgba(255,255,255,0.72)',
};

let nextId = 0;

// A light glass surface: 160° from near white to pale blue grey behind a white rim, with a soft shadow.
// `solid` swaps the glass for a plain fill (the night screens keep their dark sheets).
export function LightGlass({
  radius,
  solid,
  style,
  children,
  ...rest
}: ViewProps & {
  radius: number;
  solid?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [id] = useState(() => `lightGlass${(nextId += 1)}`);
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) => {
    setBox(event.nativeEvent.layout);
    rest.onLayout?.(event);
  };
  return (
    <View
      {...rest}
      onLayout={measure}
      style={[
        solid ? { backgroundColor: solid } : styles.glass,
        { borderRadius: radius },
        style,
      ]}
    >
      {!solid && box ? (
        // Inside the rim, so the gradient stops where the border starts.
        <View
          style={[styles.fill, { borderRadius: radius - 1 }]}
          pointerEvents="none"
        >
          <Svg width={box.width} height={box.height}>
            <Defs>
              <LinearGradient id={id} x1="0.33" y1="0.03" x2="0.67" y2="0.97">
                <Stop offset={0} stopColor="#F0F4F8" stopOpacity={0.72} />
                <Stop offset={0.55} stopColor="#D6E0E9" stopOpacity={0.5} />
                <Stop offset={1} stopColor="#C4D0DC" stopOpacity={0.42} />
              </LinearGradient>
            </Defs>
            <Rect width={box.width} height={box.height} fill={`url(#${id})`} />
          </Svg>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderWidth: 1,
    borderColor: glass.rim,
    boxShadow: '0 12px 40px rgba(30,45,60,0.14)',
  },
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
});
