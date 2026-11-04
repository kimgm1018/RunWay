import React, { createContext, useContext, useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { AppText, Button } from '../../components';
import { radius, spacing, useTheme } from '../../theme';

// 2.1 pull to refresh: pull counts the pulls, and track keeps the spinner up until each section's load settles.
type HomeRefresh = { pull: number; track: (load: Promise<void>) => void };

const HomeRefreshContext = createContext<HomeRefresh>({
  pull: 0,
  track: () => {},
});

export const HomeRefreshProvider = HomeRefreshContext.Provider;

// Loads a section again on each pull. A section that appears mid-refresh has just loaded, so it waits for the next pull.
export function useHomeRefresh(refresh: () => Promise<void>) {
  const { pull, track } = useContext(HomeRefreshContext);
  const seen = useRef(pull);
  useEffect(() => {
    if (pull !== seen.current) {
      seen.current = pull;
      track(refresh());
    }
  }, [pull, refresh, track]);
}

// What did not load, with a retry, in place of the card it stands for.
export function RetryNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.notice}>
      <AppText variant="caption" tone="textSecondary">
        {message}
      </AppText>
      <Button
        title="다시 시도"
        variant="secondary"
        size="small"
        onPress={onRetry}
      />
    </View>
  );
}

// The rounded glass panel for the 2.1 홈 load error.
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
  notice: { alignItems: 'flex-start', gap: spacing.md },
  card: {
    borderRadius: radius.xl + 2,
    borderWidth: 1,
    padding: 18,
    gap: spacing.lg,
  },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
