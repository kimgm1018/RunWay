import React from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { size, spacing, useTheme } from '../theme';
import { Backdrop } from './Backdrop';
import { KeyboardLift } from './KeyboardLift';

export function Screen({
  children,
  header,
  footer,
  background,
  scroll = true,
  withTabBar = false,
  contentStyle,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  // Bottom actions that stay in place while the content scrolls (1.3 다음, 1.5 이전·다음).
  footer?: React.ReactNode;
  // Drawn behind everything. Defaults to the K1 backdrop.
  background?: React.ReactNode;
  scroll?: boolean;
  withTabBar?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  // Tab screens leave room so the floating tab bar never covers the last item.
  const bottomRoom = withTabBar
    ? size.tabBar + size.tabBarInset * 2
    : footer
    ? spacing.xxl
    : spacing.xxxl;
  const content = [styles.content, { paddingBottom: bottomRoom }, contentStyle];
  return (
    <SafeAreaView
      edges={withTabBar ? ['top'] : ['top', 'bottom']}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {background ?? <Backdrop />}
      </View>
      {header}
      {/* Lifts the footer above the keyboard (see KeyboardLift). */}
      <KeyboardLift style={styles.fill}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[content, styles.grow]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, content]}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardLift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    gap: spacing.xl,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xxl,
  },
});
