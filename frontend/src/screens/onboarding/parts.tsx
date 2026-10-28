import React, { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  AppText,
  BottomSheet,
  Icon,
  IconButton,
  type IconName,
} from '../../components';
import { radius, size, spacing, typography, useTheme } from '../../theme';

// 1.1·1.2 sit on a blurred runner photo in the prototype; the shared backdrop stands in for it
// until the design draft (S15P31E105-89) settles the photo.
export { Backdrop as HeroBackground, Logo, Segmented } from '../../components';

// Back button with the 1/2 progress bar of 1.5·1.6, or a title as on 1.2q.
export function OnboardingHeader({
  onBack,
  step,
  title,
}: {
  onBack?: () => void;
  step?: { current: number; total: number };
  title?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      {onBack ? (
        <IconButton icon="back" accessibilityLabel="뒤로" onPress={onBack} />
      ) : null}
      {step ? (
        <>
          <View
            style={[styles.track, { backgroundColor: colors.borderStrong }]}
          >
            <View
              style={[
                styles.progress,
                {
                  backgroundColor: colors.accent,
                  width: `${(step.current / step.total) * 100}%`,
                },
              ]}
            />
          </View>
          <AppText variant="captionStrong" tone="textSecondary">
            {step.current} / {step.total}
          </AppText>
        </>
      ) : null}
      {title ? (
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
    </View>
  );
}

export function StepTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <View style={styles.stepTitle}>
      <AppText variant="display" accessibilityRole="header">
        {title}
      </AppText>
      {description ? (
        <AppText variant="caption" tone="textSecondary">
          {description}
        </AppText>
      ) : null}
    </View>
  );
}

// Small pill inside a field: 인증번호 받기 (mint), 다시 받기 · 인증 완료 (muted).
export function FieldChip({
  title,
  onPress,
  tone = 'muted',
  disabled = false,
}: {
  title: string;
  onPress?: () => void;
  tone?: 'accent' | 'muted';
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const accent = tone === 'accent' && !disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: accent ? colors.accent : colors.surfaceMuted,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <AppText
        variant="captionStrong"
        style={{
          color: accent
            ? colors.onAccent
            : disabled && onPress
            ? colors.textDisabled
            : colors.text,
        }}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

// Plain text link such as 1.2's 비밀번호를 잊으셨나요?
export function TextLink({
  title,
  onPress,
  strong = false,
  style,
}: {
  title: string;
  onPress: () => void;
  strong?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <AppText
        variant={strong ? 'captionStrong' : 'caption'}
        tone={strong ? 'text' : 'textSecondary'}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

// Coral line with an alert dot under a field (1.2r, 1.2s).
export function InlineError({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.inlineError} accessibilityLiveRegion="polite">
      <Icon name="alert" color={colors.danger} size={14} strokeWidth={2} />
      <AppText variant="caption" tone="danger" style={styles.flex}>
        {children}
      </AppText>
    </View>
  );
}

// The boxed error above the login fields (1.2 로그인 오류).
export function ErrorNotice({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        {
          backgroundColor: colors.dangerSurface,
          borderColor: colors.dangerBorder,
        },
      ]}
    >
      <View style={[styles.noticeIcon, { backgroundColor: colors.danger }]}>
        <AppText variant="labelStrong" style={{ color: colors.onDanger }}>
          !
        </AppText>
      </View>
      <View style={styles.flex}>
        <AppText variant="captionStrong">{title}</AppText>
        {detail ? (
          <AppText variant="caption" tone="textSecondary">
            {detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export function CheckCircle({
  checked,
  size: diameter = 22,
}: {
  checked: boolean;
  size?: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderColor: checked ? colors.accent : colors.borderStrong,
        },
        checked && { backgroundColor: colors.accent },
        styles.checkCircle,
      ]}
    >
      {checked ? (
        <Icon
          name="check"
          color={colors.onAccent}
          size={diameter * 0.6}
          strokeWidth={3}
        />
      ) : null}
    </View>
  );
}

// Numbered step badge of 1.2p·1.2q; done steps turn mint.
export function StepBadge({
  index,
  state,
}: {
  index: number;
  state: 'active' | 'done' | 'locked';
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.badge,
        state === 'done'
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : {
              borderColor:
                state === 'active' ? colors.text : colors.borderStrong,
            },
      ]}
    >
      <AppText
        variant="labelStrong"
        style={{
          color:
            state === 'done'
              ? colors.onAccent
              : state === 'active'
              ? colors.text
              : colors.textDisabled,
        }}
      >
        {index}
      </AppText>
    </View>
  );
}

// A choice drawn as a card with a mint border when selected (1.6 수준, 1.6w 워치 사용 여부).
export function SelectionCard({
  selected,
  onPress,
  accessibilityLabel,
  children,
  style,
}: {
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selection,
        {
          backgroundColor: selected ? colors.surfaceMuted : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

// React Native has no <select>, so 1.5 생년월일 opens a sheet of options instead.
export function SelectField<T extends number>({
  label,
  placeholder,
  value,
  options,
  format,
  onChange,
  style,
}: {
  label: string;
  placeholder: string;
  value: T | null;
  options: T[];
  format: (value: T) => string;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${
          value === null ? placeholder : format(value)
        }`}
        onPress={() => setOpen(true)}
        style={[
          styles.select,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
          },
          style,
        ]}
      >
        <AppText
          style={[
            typography.input,
            { color: value === null ? colors.textTertiary : colors.text },
          ]}
        >
          {value === null ? placeholder : format(value)}
        </AppText>
        <Icon name="chevronDown" color={colors.textSecondary} size={16} />
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <FlatList
          data={options}
          keyExtractor={item => String(item)}
          style={styles.options}
          // At most 61 short rows, so render them all at once.
          initialNumToRender={options.length}
          initialScrollIndex={
            value === null ? undefined : Math.max(options.indexOf(value), 0)
          }
          getItemLayout={(_, index) => ({
            length: optionHeight,
            offset: optionHeight * index,
            index,
          })}
          renderItem={({ item }) => {
            const selected = item === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={format(item)}
                accessibilityState={{ selected }}
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                }}
                style={[
                  styles.option,
                  selected && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <AppText
                  variant={selected ? 'bodyStrong' : 'body'}
                  tone={selected ? 'accentText' : 'text'}
                >
                  {format(item)}
                </AppText>
              </Pressable>
            );
          }}
        />
      </BottomSheet>
    </>
  );
}

// Round icon used on 1.2p (lock) and 1.6w (watch, phone).
export function IconBadge({
  icon,
  tone = 'muted',
}: {
  icon: IconName;
  tone?: 'muted' | 'accent';
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.iconBadge,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: tone === 'accent' ? colors.accent : colors.border,
        },
      ]}
    >
      <Icon
        name={icon}
        color={tone === 'accent' ? colors.accentText : colors.text}
        size={20}
      />
    </View>
  );
}

const optionHeight = 48;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  track: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  progress: { height: 3, borderRadius: 2 },
  stepTitle: { gap: spacing.md, paddingTop: spacing.lg },
  chip: {
    height: 38,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xxs,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  noticeIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkCircle: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selection: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.xl,
  },
  select: {
    height: size.input,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  options: { maxHeight: 320 },
  option: {
    height: optionHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
