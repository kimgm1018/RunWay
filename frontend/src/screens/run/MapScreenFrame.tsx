import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { k1, size, spacing, useTheme } from '../../theme';

// Layout shared by 2.0 and 2.0F: a full-screen map, a card pinned to the top and a white sheet that
// sits just above the floating tab bar (DESIGN.md 2-6 흰 카드).
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
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      {map}
      <SafeAreaView edges={['top']} style={styles.top}>
        {top}
      </SafeAreaView>
      {/* After sunset the sheet matches the dark map, so a faint rim keeps it apart. */}
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.surfaceRaised },
          name === 'dark' && [styles.rim, { borderColor: colors.border }],
        ]}
      >
        {bottom}
      </View>
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
  sheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: size.tabBar + size.tabBarInset * 2,
    padding: 18,
    gap: spacing.xl,
    borderRadius: 32,
    shadowColor: k1.night,
    shadowOpacity: 0.18,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  rim: { borderWidth: 1 },
});
