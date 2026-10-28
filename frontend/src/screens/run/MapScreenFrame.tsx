import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, size, spacing, useTheme } from '../../theme';

// Layout shared by 2.0 and 2.0F: a full-screen map, a card pinned to the top and a card that
// sits just above the floating tab bar.
export function MapScreenFrame({
  map,
  top,
  bottom,
}: {
  map: React.ReactNode;
  top: React.ReactNode;
  bottom: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      {map}
      <SafeAreaView edges={['top']} style={styles.top}>
        {top}
      </SafeAreaView>
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, borderColor: colors.border },
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
    padding: spacing.xxl,
    gap: spacing.xl,
    borderRadius: radius.sheet,
    borderWidth: 1,
  },
});
