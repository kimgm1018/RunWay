import React from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useTheme } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  title,
  description,
  icon = 'inbox',
  actionLabel,
  onAction,
  dashed = false,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  dashed?: boolean;
}) {
  const { colors } = useTheme();
  // dashed follows 2.P′ 신규 사용자 빈 카드; the plain form follows 2.9b 알림 없음.
  return (
    <View
      style={[
        styles.container,
        dashed && [styles.dashed, { borderColor: colors.borderStrong }],
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.surfaceMuted }]}>
        <Icon
          name={icon}
          color={colors.textSecondary}
          size={22}
          strokeWidth={1.7}
        />
      </View>
      <AppText variant="heading" style={styles.center}>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" tone="textSecondary" style={styles.center}>
          {description}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant="secondary"
          size="medium"
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: 32,
  },
  dashed: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.card,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  center: { textAlign: 'center' },
  action: { marginTop: spacing.md, alignSelf: 'stretch' },
});
