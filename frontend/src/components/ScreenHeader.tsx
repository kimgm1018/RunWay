import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fontFamily, size, spacing } from '../theme';
import { AppText } from './AppText';
import { BackButton } from './BackButton';
import { Logo } from './Logo';

export function ScreenHeader({
  title,
  onBack,
  backLabel = '뒤로',
  right,
  symbol = false,
}: {
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  right?: React.ReactNode;
  // 2.x screens (DESIGN.md 2-6): the black loop symbol in the middle and a large light title below.
  symbol?: boolean;
}) {
  const back = (
    <View style={styles.side}>
      {onBack ? (
        <BackButton accessibilityLabel={backLabel} onPress={onBack} />
      ) : null}
    </View>
  );
  const end = <View style={[styles.side, styles.right]}>{right}</View>;
  if (symbol) {
    return (
      <View>
        <View style={styles.header}>
          <View style={styles.symbol} pointerEvents="none">
            <Logo width={34} symbol />
          </View>
          {back}
          <View style={styles.fill} />
          {end}
        </View>
        {title ? (
          <AppText accessibilityRole="header" style={styles.bigTitle}>
            {title}
          </AppText>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.header}>
      {back}
      <AppText
        variant="heading"
        accessibilityRole="header"
        numberOfLines={1}
        style={styles.title}
      >
        {title}
      </AppText>
      {end}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  side: {
    minWidth: size.iconButton,
    flexDirection: 'row',
    gap: spacing.md,
  },
  right: { justifyContent: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
  symbol: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { flex: 1 },
  bigTitle: {
    fontFamily: fontFamily.regular,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.8,
    textAlign: 'center',
    paddingTop: spacing.lg,
  },
});
