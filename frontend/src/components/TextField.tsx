import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import {
  fontFamily,
  radius,
  size,
  spacing,
  typography,
  useTheme,
} from '../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type FieldStatus = 'default' | 'success' | 'error';

export function TextField({
  label,
  labelInside = false,
  helper,
  status = 'default',
  accessory,
  icon,
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
  // 1.x glass fields (runway-onboarding-handoff): the line icon before the label.
  icon?: IconName;
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
          ? [inputFont, styles.insideInput, { color: colors.text }, style]
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
            accessory ? styles.insideWithAccessory : null,
            // Focused: an ink rim; a wrong value (1.2s): coral.
            focused && { borderColor: glassInk },
            status === 'error' && { borderColor: colors.danger },
            strong && styles.strong,
          ]}
        >
          {icon ? <Icon name={icon} color={glassInk} size={20} /> : null}
          <View style={styles.flex}>
            <AppText style={styles.insideLabel}>{label}</AppText>
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

const glassInk = '#02050E';

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
  // The 1.x glass field (runway-onboarding-handoff): 58 high, 18 round, a white rim and a soft shadow.
  inside: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.5)',
    boxShadow:
      '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
    paddingLeft: 18,
    paddingRight: 18,
    paddingVertical: 8,
  },
  insideWithAccessory: { paddingRight: 8 },
  insideLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: '#3A5A6C',
  },
  // Android adds font padding above and below Noto Sans KR; without turning it off
  // the text no longer fits this short line and sticks to the top.
  insideInput: {
    height: 24,
    fontFamily: fontFamily.medium,
    fontSize: 15.5,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  helper: { paddingHorizontal: spacing.md },
});
