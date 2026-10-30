import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText } from '../../components';
import { fontFamily, k1, spacing, ThemeProvider, useTheme } from '../../theme';

// Album art stand-ins in K1 tones (DESIGN.md 2-6 음악 카드).
const artColors: [string, string][] = [
  [k1.mid, k1.deep],
  [k1.top, k1.mid],
  [k1.mid, k1.night],
];

// Without a size the art fills its container as a square (2.7 재생목록 grid).
export function AlbumArt({ index, size }: { index: number; size?: number }) {
  const [from, to] = artColors[index % artColors.length];
  const id = `art${index % artColors.length}`;
  return (
    <View style={size ? { width: size, height: size } : styles.square}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect
          width={100}
          height={100}
          rx={size && size < 60 ? 22 : 14}
          fill={`url(#${id})`}
        />
      </Svg>
    </View>
  );
}

// K1 with the light part kept longer so the lists stay on light; only the footer sits on black.
// `dark` is the share of the card at the bottom that turns dark: the footer's height, or 12% without one.
// It takes the card's measured size: an Svg sized in percent falls back to 300×150 on Android.
function CardFill({
  width,
  height,
  dark,
}: {
  width: number;
  height: number;
  dark: number;
}) {
  const edge = 1 - dark;
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <LinearGradient id="musicCard" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={k1.top} />
          <Stop offset={edge * 0.5} stopColor="#C3D1DD" />
          <Stop offset={edge * 0.8} stopColor="#C2D0DC" />
          <Stop offset={edge * 0.92} stopColor={k1.light} />
          <Stop offset={edge} stopColor={k1.mid} />
          <Stop offset={edge + dark * 0.4} stopColor={k1.deep} />
          <Stop offset={edge + dark * 0.75} stopColor={k1.night} />
          <Stop offset="1" stopColor={k1.black} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#musicCard)" />
    </Svg>
  );
}

// 2.7·2.8 float over the run screen: tapping outside the card closes it.
// 2.8 opens on top of 2.7: it covers the same card and keeps 2.7's dimming instead of adding its own.
export function MusicSheet({
  children,
  footer,
  stacked = false,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  stacked?: boolean;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [footerHeight, setFooterHeight] = useState(0);
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  const measureFooter = (event: LayoutChangeEvent) =>
    setFooterHeight(event.nativeEvent.layout.height);
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={navigation.goBack}
        style={[
          StyleSheet.absoluteFill,
          !stacked && { backgroundColor: colors.scrim },
        ]}
      />
      <SafeAreaView
        edges={['top']}
        style={styles.safe}
        pointerEvents="box-none"
      >
        <View style={styles.card} onLayout={measure}>
          {box ? (
            <CardFill
              width={box.width}
              height={box.height}
              dark={footer && footerHeight ? footerHeight / box.height : 0.12}
            />
          ) : null}
          {children}
          {footer ? (
            <ThemeProvider tone="dark">
              <View style={styles.footer} onLayout={measureFooter}>
                {footer}
              </View>
            </ThemeProvider>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

export function SectionTitle({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="bodyStrong" style={styles.medium}>
        {title}
      </AppText>
      {note ? (
        <AppText variant="label" tone="textSecondary">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  square: { width: '100%', aspectRatio: 1 },
  safe: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  // Both cards share one height so 2.8 sits exactly over 2.7.
  card: {
    height: '78%',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  footer: { padding: spacing.xl, paddingTop: spacing.md, alignItems: 'center' },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  medium: { fontFamily: fontFamily.medium },
});
