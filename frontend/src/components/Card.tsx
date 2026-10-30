import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { k1, radius, spacing, ThemeProvider, useTheme } from '../theme';

// Kit boxes (DESIGN.md 2-7). glass: white see-through card, solid: plain card, muted: chip-colored box,
// outline: pinned card (6.0 곧 출발), deep: dark glass, vignette: dark center brightening to the edge,
// course: the course card behind a white course line (3.1c 저장한 코스, 3.1b 추천 코스, 4.5 경로).
export type CardVariant =
  | 'glass'
  | 'solid'
  | 'muted'
  | 'outline'
  | 'deep'
  | 'vignette'
  | 'course';

type DarkVariant = Extract<CardVariant, 'deep' | 'vignette' | 'course'>;

// The dark boxes are drawn with SVG, since React Native views have no gradient fill.
// The fill measures its box and redraws when the card grows: an Svg sized in percent keeps its
// first size on Android, so a card that gains a line would show an unfilled band.
function DarkFill({ variant }: { variant: DarkVariant }) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <View style={StyleSheet.absoluteFill} onLayout={measure}>
      {box ? <DarkFillSvg variant={variant} {...box} /> : null}
    </View>
  );
}

function DarkFillSvg({
  variant,
  width,
  height,
}: {
  variant: DarkVariant;
  width: number;
  height: number;
}) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        {variant === 'deep' ? (
          <LinearGradient id="fill" x1="0.4" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={k1.mid} stopOpacity={0.66} />
            <Stop offset="1" stopColor={k1.night} stopOpacity={0.9} />
          </LinearGradient>
        ) : variant === 'course' ? (
          <RadialGradient id="fill" cx="0.5" cy="0.45" r="0.75">
            <Stop offset="0.4" stopColor={k1.night} />
            <Stop offset="0.8" stopColor={k1.deep} />
            <Stop offset="1" stopColor={k1.mid} />
          </RadialGradient>
        ) : (
          <RadialGradient id="fill" cx="0.5" cy="0.55" r="0.62">
            <Stop offset="0.32" stopColor={k1.black} stopOpacity={0.96} />
            <Stop offset="0.58" stopColor={k1.night} stopOpacity={0.92} />
            <Stop offset="0.86" stopColor={k1.deep} stopOpacity={0.82} />
            <Stop offset="1" stopColor={k1.mid} stopOpacity={0.7} />
          </RadialGradient>
        )}
      </Defs>
      <Rect width={width} height={height} fill="url(#fill)" />
    </Svg>
  );
}

export function Card({
  children,
  variant = 'glass',
  onPress,
  accessibilityLabel,
  style,
}: {
  children: React.ReactNode;
  variant?: CardVariant;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const look = {
    glass: { backgroundColor: colors.surface, borderColor: 'transparent' },
    solid: {
      backgroundColor: colors.surfaceRaised,
      borderColor: 'transparent',
    },
    muted: { backgroundColor: colors.surfaceMuted, borderColor: 'transparent' },
    outline: { backgroundColor: colors.surface, borderColor: colors.accent },
    deep: { backgroundColor: 'transparent', borderColor: darkEdge },
    vignette: { backgroundColor: 'transparent', borderColor: darkEdge },
    course: { backgroundColor: 'transparent', borderColor: darkEdge },
  }[variant];
  const dark =
    variant === 'deep' || variant === 'vignette' || variant === 'course';
  // Content in a dark box reads the dark tone, so its text and buttons turn light by themselves.
  const content = dark ? (
    <>
      <DarkFill variant={variant} />
      <ThemeProvider tone="dark">{children}</ThemeProvider>
    </>
  ) : (
    children
  );
  if (!onPress) {
    return (
      <View style={[styles.card, look, dark && styles.clip, style]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        look,
        dark && styles.clip,
        pressed && styles.pressed,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

// A faint light edge keeps a dark box from melting into the black lower part.
const darkEdge = 'rgba(255,255,255,0.14)';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: spacing.xl,
  },
  // The gradient is a square layer; clipping keeps it inside the rounded corners.
  clip: { overflow: 'hidden' },
  // DESIGN.md 2-1: a pressed box shrinks to 96%.
  pressed: { transform: [{ scale: 0.96 }] },
});
