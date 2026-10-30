import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { radius, size, spacing, typography, useTheme } from '../theme';
import { AppText } from './AppText';

export type FieldStatus = 'default' | 'success' | 'error';

export function TextField({
  label,
  labelInside = false,
  helper,
  status = 'default',
  accessory,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & {
  label?: string;
  // 1.x fields (DESIGN.md 2-5): the label sits inside the pill, above the value.
  labelInside?: boolean;
  helper?: string;
  status?: FieldStatus;
  // Sits inside the right end of the field, like 1.3's 인증 완료 chip or 1.2q's timer.
  accessory?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // 1.2: a focused field gets a thicker text-colored border; 1.2s: a wrong code turns it coral.
  const borderColor =
    status === 'error'
      ? colors.danger
      : focused || status === 'success'
      ? colors.accent
      : labelInside
      ? colors.inputEdge
      : colors.inputBorder;
  const strong = status === 'error' || focused;
  const helperTone =
    status === 'error'
      ? 'danger'
      : status === 'success'
      ? 'accentText'
      : 'textTertiary';
  const field = (
    <TextInput
      ref={input}
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
      style={
        labelInside
          ? [styles.insideInput, inputFont, { color: colors.text }, style]
          : [
              styles.input,
              inputFont,
              {
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderColor,
              },
              strong && styles.strong,
              accessory ? styles.withAccessory : null,
              style,
            ]
      }
    />
  );
  return (
    <View style={styles.wrapper}>
      {labelInside ? (
        // The whole pill focuses the input, so a tap on the label works too.
        <Pressable
          accessible={false}
          onPress={() => input.current?.focus()}
          style={[
            styles.inside,
            { backgroundColor: colors.inputBackground, borderColor },
            strong && styles.strong,
          ]}
        >
          <View style={styles.flex}>
            <AppText
              style={[styles.insideLabel, { color: colors.textTertiary }]}
            >
              {label}
            </AppText>
            {field}
          </View>
          {accessory}
        </Pressable>
      ) : (
        <>
          {label ? (
            <AppText variant="caption" tone="textSecondary">
              {label}
            </AppText>
          ) : null}
          <View>
            {field}
            {accessory ? (
              <View style={styles.accessory}>{accessory}</View>
            ) : null}
          </View>
        </>
      )}
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
  flex: { flex: 1 },
  wrapper: { gap: spacing.sm },
  input: {
    height: size.input,
    paddingVertical: 0,
    textAlignVertical: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 20,
  },
  strong: { borderWidth: 1.5 },
  withAccessory: { paddingRight: 120 },
  accessory: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 18,
    paddingRight: spacing.lg,
    paddingVertical: 7,
  },
  insideLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
  },
  // Android adds font padding above and below Noto Sans KR; without turning it off
  // the text no longer fits this short line and sticks to the top.
  insideInput: {
    height: 28,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  helper: { paddingHorizontal: spacing.md },
});
