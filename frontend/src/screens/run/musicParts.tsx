import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText } from '../../components';
import { palette, radius, spacing, useTheme } from '../../theme';

// Album art stand-ins: the prototype's soft mint, lavender and coral squares.
const artColors: [string, string][] = [
  [palette.mint, '#7FD8CB'],
  [palette.periwinkle, '#9C95E8'],
  [palette.coralSoft, palette.coral],
  [palette.slate, '#55596A'],
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
          rx={size && size < 60 ? 18 : 14}
          fill={`url(#${id})`}
        />
      </Svg>
    </View>
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
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
        >
          {children}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
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
      <AppText variant="bodyStrong">{title}</AppText>
      {note ? (
        <AppText variant="label" tone="textTertiary">
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
    borderRadius: radius.sheet,
    borderWidth: 1,
    overflow: 'hidden',
  },
  footer: { padding: spacing.xl, paddingTop: spacing.md },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
});
