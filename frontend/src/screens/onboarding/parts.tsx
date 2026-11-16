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
  type IconName,
  PressableScale,
} from '../../components';
import {
  fontFamily,
  radius,
  size,
  spacing,
  typography,
  useTheme,
} from '../../theme';
import { OnboardingBackdrop, onboardingLook, ProgressBar } from './look';
import { BackButton } from '../../components/BackButton';
import { useTapLock } from '../useTapLock';

export { Logo, Segmented } from '../../components';
export {
  OnboardingBackdrop,
  onboardingLook,
  RunnerArt,
  signUpSteps,
} from './look';

// The 1.x header (runway-onboarding-handoff): a glass round back button and, on the sign-up steps, a thin
// progress bar beside it.
export function OnboardingHeader({
  onBack,
  progress,
}: {
  onBack?: () => void;
  progress?: { current: number; total: number };
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <BackButton onPress={onBack} />
      ) : (
        <View style={styles.backSpace} />
      )}
      {progress ? (
        <ProgressBar current={progress.current} total={progress.total} />
      ) : null}
    </View>
  );
}

// Shared by every 1.2~1.7 screen: the handoff background and its 24 sides, 12 between cards.
export const onboardingScreen = {
  background: <OnboardingBackdrop />,
  contentStyle: { paddingHorizontal: 24, paddingTop: 0, gap: 12 },
} as const;

// Left-aligned bold ink title. `muted` is the rest of the sentence, such as 1.2q's 잊으셨나요?; it is the same
// ink now (the handoff has one colour), kept apart so the line breaks stay where they were.
// The caller ends `title` with the line break or space that comes before it.
export function StepTitle({
  title,
  muted,
  description,
}: {
  title: string;
  muted?: string;
  description?: string;
}) {
  return (
    <View style={styles.stepTitle}>
      <AppText accessibilityRole="header" style={styles.titleText}>
        {title}
        {muted ? <AppText style={styles.titleText}>{muted}</AppText> : null}
      </AppText>
      {description ? (
        <AppText style={styles.description}>{description}</AppText>
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
        accent ? styles.chipAccent : styles.chipMuted,
        pressed && styles.chipPressed,
      ]}
    >
      <AppText
        style={[
          styles.chipText,
          accent && styles.chipTextAccent,
          disabled && !!onPress && styles.chipTextOff,
        ]}
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

// The 1.x main button (runway-onboarding-handoff): a full-width ink pill, 58 high, white bold label.
export function GoButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => unknown;
  disabled?: boolean;
}) {
  // S15P31E105-796: the first tap locks at once; fast repeat taps no longer send the request or open the screen again.
  const once = useTapLock();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={once(onPress)}
      style={[styles.go, disabled && styles.goDisabled]}
    >
      <AppText style={styles.goLabel}>{title}</AppText>
    </PressableScale>
  );
}

// The lower part of a 1.x screen: the main button and the links under it, the same place on every step
// (S15P31E105-387): 24 from the sides and 42 from the bottom of the frame.
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

// A choice drawn as a glass card that turns solid white with an ink rim when picked (1.4 동의 rows, 1.5 성별,
// 1.6 수준, 1.6w 워치 사용 여부).
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
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.selection, selected && styles.selectionPicked, style]}
    >
      {children}
    </PressableScale>
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
  glass = false,
}: {
  label: string;
  placeholder: string;
  value: T | null;
  options: T[];
  format: (value: T) => string;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  // 1.5b's glass card (runway-onboarding-handoff); 8.2 keeps the pill.
  glass?: boolean;
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
          glass
            ? styles.selectGlass
            : {
                backgroundColor: colors.inputBackground,
                borderColor: colors.inputEdge,
              },
          style,
        ]}
      >
        <AppText
          style={[
            styles.selectValue,
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

// The ink line icon at the start of a card (1.6w 워치 · 휴대폰). The handoff has no circle behind it.
export function IconBadge({ icon }: { icon: IconName; diameter?: number }) {
  return <Icon name={icon} color={onboardingLook.ink} size={20} />;
}

const optionHeight = 48;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    paddingLeft: 19,
    paddingRight: 28,
  },

  backSpace: { width: 44, height: 44 },
  // 28 under the runner, as the handoff's title sits at 310 below the 86 + 196 runner.
  stepTitle: { gap: 8, paddingTop: 28, paddingBottom: 11 },
  titleText: {
    fontFamily: fontFamily.bold,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: onboardingLook.ink,
  },
  description: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 20,
    color: onboardingLook.sub,
  },
  chip: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAccent: { backgroundColor: onboardingLook.ink },
  chipMuted: { backgroundColor: 'rgba(2,5,14,0.08)' },
  chipPressed: { opacity: 0.7 },
  chipText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: onboardingLook.ink,
  },
  chipTextAccent: { color: '#FFFFFF' },
  chipTextOff: { color: onboardingLook.muted },
  footer: {
    flex: 1,
    alignItems: 'stretch',
    gap: 14,
    paddingHorizontal: 8,
    paddingBottom: 18,
  },
  go: {
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: onboardingLook.ink,
  },
  goDisabled: { backgroundColor: 'rgba(2,5,14,0.28)' },
  goLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    letterSpacing: 0.3,
    color: '#FFFFFF',
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: onboardingLook.glassRim,
    backgroundColor: onboardingLook.glass,
    boxShadow: onboardingLook.glassShadow,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  selectionPicked: {
    backgroundColor: onboardingLook.picked,
    borderColor: onboardingLook.ink,
    borderWidth: 1.5,
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
  // 연도·월·일처럼 숫자(Archivo)와 한글 접미사(Noto Sans KR)가 한 줄에 섞이면 안드로이드 기본 font
  // padding이 폰트마다 달라 칸 안에서 글자 높이가 어긋나 보인다(857). TextField.tsx의 insideInput과
  // 같은 방식으로 줄 높이를 없애고 세로 중앙 정렬만 남긴다.
  selectValue: {
    fontFamily: typography.input.fontFamily,
    fontSize: typography.input.fontSize,
    height: 20,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  selectGlass: {
    height: 58,
    borderRadius: 18,
    borderColor: onboardingLook.glassRim,
    backgroundColor: onboardingLook.glass,
    boxShadow: onboardingLook.glassShadow,
    paddingHorizontal: 18,
  },
  options: { maxHeight: 320 },
  option: {
    height: optionHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
  },
});
