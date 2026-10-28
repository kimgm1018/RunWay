import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { AppText } from '../../components';
import { radius, spacing, useTheme } from '../../theme';

// The rounded glass panels that stack on 2.1 홈 (러닝 분석, 과거 러닝 기록, 저장한 코스).
export function GlassCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Title on the left, small note on the right (러닝 분석 · 10월).
export function CardTitle({
  title,
  note,
  right,
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.titleRow}>
      <AppText variant="bodyStrong" style={styles.cardTitle}>
        {title}
      </AppText>
      {note ? (
        <AppText variant="label" tone="textTertiary">
          {note}
        </AppText>
      ) : null}
      {right}
    </View>
  );
}

// Full-width soft pill at the bottom of a card (분석 자세히 보기, 전체 기록 보기).
export function PillLink({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: pressed ? colors.border : colors.surfaceMuted },
      ]}
    >
      <AppText variant="captionStrong">{title}</AppText>
    </Pressable>
  );
}

// 42×42 tile with the run's shape, used by record and course rows.
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

// A tappable list row: thumbnail, title with a detail line, value on the right.
export function ListRow({
  title,
  detail,
  value,
  shape,
  onPress,
  trailing,
}: {
  title: string;
  detail: string;
  value?: string;
  shape: [number, number][];
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}${value ? `, ${value}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <RouteThumb shape={shape} />
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="label" tone="textTertiary">
          {detail}
        </AppText>
      </View>
      {value ? <AppText variant="metric">{value}</AppText> : null}
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl + 2,
    borderWidth: 1,
    padding: 18,
    gap: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardTitle: { fontSize: 15, flex: 1 },
  pill: {
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: 9,
  },
  rowText: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.7 },
});
