import React, { useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardLift, LightGlass } from '../../components';
import type { RunMapLogo } from '../../components/RunMap';
import { k1, size, spacing, useTheme } from '../../theme';

// Layout shared by 2.0 and 2.0F: a full-screen map, a bar pinned to the top and a sheet that sits just
// above the floating tab bar. The map is the K1 day map at any hour (S15P31E105-527). By day the sheet is
// light glass (runway-course-handoff); after sunset it stays the dark sheet of DESIGN.md 2-6. The map gets where the NAVER logo goes: just over the sheet, as
// measured, since the sheet's height changes with day, night and what it holds (S15P31E105-429).
export function MapScreenFrame({
  renderMap,
  top,
  bottom,
}: {
  renderMap: (logo: RunMapLogo | undefined) => React.ReactNode;
  top: React.ReactNode;
  bottom: React.ReactNode;
}) {
  const { name, colors } = useTheme();
  const night = name === 'dark';
  const [screen, setScreen] = useState(0);
  const [sheet, setSheet] = useState(0);
  // The sheet ends above the tab bar, so it covers its own height and the tab bar's room under it.
  const logo =
    screen && sheet
      ? { above: (sheet + size.tabBar + size.tabBarInset * 2) / screen }
      : undefined;
  const measureSheet = (event: LayoutChangeEvent) =>
    setSheet(event.nativeEvent.layout.height);
  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
      onLayout={event => setScreen(event.nativeEvent.layout.height)}
    >
      {/* The map behind the status bar is the K1 day map after sunset too (S15P31E105-527), so dark icons. */}
      <StatusBar barStyle="dark-content" />
      {renderMap(logo)}
      <SafeAreaView
        edges={['top']}
        style={[styles.top, !night && styles.topDay]}
      >
        {top}
      </SafeAreaView>
      {/* The sheet's box ends above the tab bar, so the keyboard lifts the sheet by what it covers (S15P31E105-473). */}
      <KeyboardLift style={styles.lift} pointerEvents="box-none">
        {night ? (
          // After sunset the sheet stays dark, with a faint rim.
          <View
            onLayout={measureSheet}
            style={[
              styles.sheet,
              styles.sheetNight,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            {bottom}
          </View>
        ) : (
          <LightGlass
            radius={34}
            onLayout={measureSheet}
            style={[styles.sheet, styles.sheetDay]}
          >
            {bottom}
          </LightGlass>
        )}
      </KeyboardLift>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  // The 358-wide bars sit 16 from the edges, the legend 8 under them.
  topDay: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  lift: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: size.tabBar + size.tabBarInset * 2,
  },
  sheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 0,
    padding: 18,
  },
  sheetNight: {
    gap: spacing.xl,
    borderRadius: 32,
    borderWidth: 1,
    shadowColor: k1.night,
    shadowOpacity: 0.18,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  sheetDay: { left: 8, right: 8, gap: 12 },
});
