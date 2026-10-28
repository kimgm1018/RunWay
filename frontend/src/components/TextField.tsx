import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { radius, size, spacing, typography, useTheme } from '../theme';
import { AppText } from './AppText';

export type FieldStatus = 'default' | 'success' | 'error';

export function TextField({
  label,
  helper,
  status = 'default',
  accessory,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & {
  label?: string;
  helper?: string;
  status?: FieldStatus;
  // Sits inside the right end of the field, like 1.3's 인증 완료 chip or 1.2q's timer.
  accessory?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  // 1.2: a focused field gets a mint border; 1.2s: a wrong code turns the border coral.
  const borderColor =
    status === 'error'
      ? colors.danger
      : focused || status === 'success'
      ? colors.accent
      : colors.inputBorder;
  const helperTone =
    status === 'error'
      ? 'danger'
      : status === 'success'
      ? 'accentText'
      : 'textTertiary';
  return (
    <View style={styles.wrapper}>
      {label ? (
        <AppText variant="captionStrong" tone="textSecondary">
          {label}
        </AppText>
      ) : null}
      <View>
        <TextInput
          accessibilityLabel={props.accessibilityLabel ?? label}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          {...props}
          onFocus={event => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={event => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            inputFont,
            {
              color: colors.text,
              backgroundColor: colors.inputBackground,
              borderColor,
            },
            accessory ? styles.withAccessory : null,
            style,
          ]}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
      {helper ? (
        <AppText variant="caption" tone={helperTone} style={styles.helper}>
          {status === 'success' ? `✓ ${helper}` : helper}
        </AppText>
      ) : null}
    </View>
  );
}

// Android pushes the placeholder up when a single-line input has a lineHeight, so only the font is applied.
const inputFont = {
  fontFamily: typography.input.fontFamily,
  fontSize: typography.input.fontSize,
};

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  input: {
    height: size.input,
    paddingVertical: 0,
    textAlignVertical: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 20,
  },
  withAccessory: { paddingRight: 120 },
  accessory: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  helper: { paddingHorizontal: spacing.md },
});
