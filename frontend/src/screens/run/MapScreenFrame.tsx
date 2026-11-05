import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardLift, LightGlass } from '../../components';
import { k1, size, spacing, useTheme } from '../../theme';

// Layout shared by 2.0 and 2.0F: a full-screen map, a bar pinned to the top and a sheet that sits just
// above the floating tab bar. By day the sheet is light glass (runway-course-handoff); after sunset it
// stays the dark sheet of DESIGN.md 2-6.
export function MapScreenFrame({
  map,
  top,
  bottom,
}: {
  map: React.ReactNode;
  top: React.ReactNode;
  bottom: React.ReactNode;
}) {
  const { name, colors } = useTheme();
  const night = name === 'dark';
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      {map}
      <SafeAreaView
        edges={['top']}
        style={[styles.top, !night && styles.topDay]}
      >
        {top}
      </SafeAreaView>
      {/* The sheet's box ends above the tab bar, so the keyboard lifts the sheet by what it covers (S15P31E105-473). */}
      <KeyboardLift style={styles.lift} pointerEvents="box-none">
        {night ? (
          // After sunset the sheet matches the dark map, so a faint rim keeps it apart.
          <View
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
          <LightGlass radius={34} style={[styles.sheet, styles.sheetDay]}>
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
