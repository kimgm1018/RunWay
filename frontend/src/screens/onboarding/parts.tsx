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
  Logo,
  type IconName,
} from '../../components';
import {
  fontFamily,
  radius,
  size,
  spacing,
  ThemeProvider,
  typography,
  useTheme,
} from '../../theme';

export { Logo, Segmented } from '../../components';

// The 1.x header (DESIGN.md 2-5): back button, the loop symbol in the middle, and 1 / 2 on the right for 1.5·1.6.
export function OnboardingHeader({
  onBack,
  step,
}: {
  onBack?: () => void;
  step?: { current: number; total: number };
}) {
  return (
    <View style={styles.header}>
      <View style={styles.symbol} pointerEvents="none">
        <Logo width={34} symbol />
      </View>
      {onBack ? (
        <IconButton icon="back" accessibilityLabel="뒤로" onPress={onBack} />
      ) : null}
      {step ? (
        <AppText variant="label" tone="textSecondary" style={styles.stepText}>
          {step.current} / {step.total}
        </AppText>
      ) : null}
    </View>
  );
}

// Centered light title. `muted` is the dimmed tail, such as 1.2p's 잊으셨나요?
// The caller ends `title` with the line break or space that comes before it.
export function StepTitle({
  title,
  muted,
  description,
  small = false,
}: {
  title: string;
  muted?: string;
  description?: string;
  // 1.2q's 전화번호로 찾기 is a step smaller.
  small?: boolean;
}) {
  // AppText sets its own size, so the nested muted part repeats the title style.
  const titleStyle = [styles.titleText, small && styles.titleSmall];
  return (
    <View style={styles.stepTitle}>
      <AppText accessibilityRole="header" style={titleStyle}>
        {title}
        {muted ? (
          <AppText tone="textTertiary" style={titleStyle}>
            {muted}
          </AppText>
        ) : null}
      </AppText>
      {description ? (
        <AppText variant="caption" tone="textSecondary" style={styles.center}>
          {description}
        </AppText>
      ) : null}
    </View>
  );
}

// Small pill inside a field: 인증번호 받기 (filled), 다시 받기 · 인증 완료 (muted).
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
      hitSlop={8}
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
        variant="label"
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

// The 1.x main button (DESIGN.md 2-5): a short pill with a ring and dot at its right end.
// It sits on the black lower part, so it is used inside a dark tone and turns into a light pill there.
export function GoButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const ink = disabled ? colors.textTertiary : colors.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.go,
        { backgroundColor: disabled ? colors.surfaceMuted : colors.accent },
        pressed && styles.goPressed,
      ]}
    >
      <AppText style={[typography.buttonSmall, styles.goLabel, { color: ink }]}>
        {title}
      </AppText>
      <View style={styles.goRing}>
        <View style={[styles.goRingLine, { borderColor: ink }]} />
        <View style={[styles.goDot, { backgroundColor: ink }]} />
      </View>
    </Pressable>
  );
}

// Page dots under the 1.x main button: a light pill with the current page dark.
export function PageDots({
  count,
  current,
}: {
  count: number;
  current: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={[styles.dots, { backgroundColor: colors.accent }]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            { backgroundColor: colors.onAccent },
            index !== current && styles.dotOff,
          ]}
        />
      ))}
    </View>
  );
}

// The lower part of a 1.x screen: the main button and links, centered. The mist background stays light
// down to the bottom (S15P31E105-427), so they use the light tone: dark text and a dark filled button.
export function OnboardingFooter({ children }: { children: React.ReactNode }) {
  return <View style={styles.footer}>{children}</View>;
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
  const round = { borderRadius: diameter / 2 };
  return (
    <View
      style={[
        styles.checkCircle,
        round,
        {
          width: diameter,
          height: diameter,
          borderColor: checked ? colors.accent : colors.borderStrong,
        },
      ]}
    >
      {/* Android drops the corner radius of a View that gains a background later,
          so the filled circle is its own View mounted only when checked. */}
      {checked ? (
        <View
          style={[styles.checkFill, round, { backgroundColor: colors.accent }]}
        >
          <Icon
            name="check"
            color={colors.onAccent}
            size={diameter * 0.55}
            strokeWidth={2.5}
          />
        </View>
      ) : null}
    </View>
  );
}

// Numbered step badge of 1.2q: filled for the current and done steps, a check once done.
export function StepBadge({
  index,
  state,
}: {
  index: number;
  state: 'active' | 'done' | 'locked';
}) {
  const { colors } = useTheme();
  const reached = state !== 'locked';
  const ink = reached ? colors.onAccent : colors.textTertiary;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: reached ? colors.accent : colors.surfaceMuted },
      ]}
    >
      {state === 'done' ? (
        <Icon name="check" color={ink} size={12} strokeWidth={2.5} />
      ) : (
        <AppText variant="labelStrong" style={{ color: ink }}>
          {index}
        </AppText>
      )}
    </View>
  );
}

// A choice drawn as a light card that turns ink when selected (1.5 성별, 1.6 수준, 1.6w 워치 사용 여부).
// The inside of a selected card is in the dark tone, so its text and icons turn light by themselves.
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
          backgroundColor: selected ? colors.accent : colors.inputBackground,
          borderColor: selected ? colors.accent : colors.inputEdge,
        },
        pressed && styles.selectionPressed,
        style,
      ]}
    >
      {selected ? (
        <ThemeProvider tone="dark">{children}</ThemeProvider>
      ) : (
        children
      )}
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
            borderColor: colors.inputEdge,
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

// Round glass icon used on 1.2p (lock, larger) and 1.6w (watch, phone).
export function IconBadge({
  icon,
  diameter = 44,
}: {
  icon: IconName;
  diameter?: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.iconBadge,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: colors.glass,
          borderColor: colors.borderStrong,
        },
      ]}
    >
      <Icon name={icon} color={colors.text} size={20} />
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
    paddingHorizontal: spacing.screen,
  },
  symbol: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { marginLeft: 'auto', letterSpacing: 1.5 },
  stepTitle: { gap: spacing.lg, paddingTop: spacing.xxl },
  titleText: {
    fontFamily: fontFamily.regular,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  titleSmall: { fontSize: 24, lineHeight: 32 },
  center: { textAlign: 'center' },
  chip: {
    height: 28,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { flex: 1, alignItems: 'center', gap: spacing.xl },
  go: {
    height: 54,
    minWidth: 206,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 26,
    paddingRight: 10,
  },
  goPressed: { transform: [{ scale: 0.96 }] },
  goLabel: { letterSpacing: 0.5, marginRight: 22 },
  goRing: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goRingLine: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 17,
    borderWidth: 1,
    opacity: 0.6,
  },
  goDot: { width: 4, height: 4, borderRadius: 2 },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotOff: { opacity: 0.3 },
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
  checkCircle: { borderWidth: 1 },
  checkFill: {
    position: 'absolute',
    top: -1,
    right: -1,
    bottom: -1,
    left: -1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selection: {
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.xl,
  },
  selectionPressed: { transform: [{ scale: 0.96 }] },
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
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
