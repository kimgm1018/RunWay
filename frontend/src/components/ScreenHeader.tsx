import React from 'react';
import { StyleSheet, View } from 'react-native';
import { size, spacing } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

export function ScreenHeader({
  title,
  onBack,
  backLabel = '뒤로',
  right,
}: {
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {onBack ? (
          <IconButton
            icon="back"
            accessibilityLabel={backLabel}
            onPress={onBack}
          />
        ) : null}
      </View>
      <AppText
        variant="heading"
        accessibilityRole="header"
        numberOfLines={1}
        style={styles.title}
      >
        {title}
      </AppText>
      <View style={[styles.side, styles.right]}>{right}</View>
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
});
