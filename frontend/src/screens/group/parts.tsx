import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Icon, type IconName } from '../../components';
import type { GroupRunSummary, MeetingPlace } from '../../data';
import { formatClockTime, formatDotDateWeekday } from '../../format';
import {
  fontFamily,
  k1,
  palette,
  radius,
  spacing,
  useTheme,
} from '../../theme';

const minuteMs = 60 * 1000;
const dayMs = 24 * 60 * minuteMs;
const kstOffsetMs = 9 * 60 * minuteMs;

// 10.25 토 07:00
export const formatSchedule = (iso: string) =>
  `${formatDotDateWeekday(iso)} ${formatClockTime(iso)}`;

const kstMidnight = (value: string | Date) => {
  const shifted = new Date(new Date(value).getTime() + kstOffsetMs);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
};

// D-4, or 오늘 on the day.
export function dDay(scheduledAt: string, now: Date) {
  const days = Math.round(
    (kstMidnight(scheduledAt) - kstMidnight(now)) / dayMs,
  );
  return days <= 0 ? '오늘' : `D-${days}`;
}

// 15분 뒤 출발
export function startsIn(scheduledAt: string, now: Date) {
  const minutes = Math.round(
    (Date.parse(scheduledAt) - now.getTime()) / minuteMs,
  );
  if (minutes <= 0) {
    return '곧 출발';
  }
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 뒤 출발`
    : `${minutes}분 뒤 출발`;
}

// The waiting room opens 30 minutes before the start for members who joined (6.4·6.5).
export const roomOpensMs = 30 * minuteMs;
export function canEnterRoom(run: GroupRunSummary, now: Date) {
  return (
    run.joined &&
    run.status === 'SCHEDULED' &&
    now.getTime() >= Date.parse(run.scheduledAt) - roomOpensMs
  );
}

// 코스 러닝 · 민락수변공원 출발 5.0km, or 자유 러닝 · 40분.
export function goalLine(run: GroupRunSummary, prefix = true) {
  if (run.courseName) {
    return prefix ? `코스 러닝 · ${run.courseName}` : run.courseName;
  }
  const minutes = run.targetDurationSec
    ? ` · ${Math.round(run.targetDurationSec / 60)}분`
    : '';
  return `자유 러닝${minutes}`;
}

// Member initials sit on K1 tones (DESIGN.md 2-10).
const avatarTones = [k1.top, '#C3D1DD', k1.light, '#A5B6C8', '#D5DEE7'];

// A member shown by the first letter of their nickname (no photos).
export function Initial({
  name,
  index = 0,
  size = 32,
  style,
}: {
  name: string;
  index?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.initial,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarTones[index % avatarTones.length],
        },
        style,
      ]}
    >
      <AppText
        variant="captionStrong"
        style={{ color: palette.ink, fontSize: size * 0.4 }}
      >
        {name.slice(0, 1)}
      </AppText>
    </View>
  );
}

// With a label (6.4 정보 카드) the icon sits in a 40 circle over a small label and a 14.5 value
// (DESIGN.md 2-10); without one it is the compact line of the 6.0 cards.
export function InfoLine({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label?: string;
  value: string;
}) {
  const { colors } = useTheme();
  if (!label) {
    return (
      <View style={styles.infoLine}>
        <Icon name={icon} color={colors.textSecondary} size={13} />
        <AppText
          variant="caption"
          tone="textSecondary"
          numberOfLines={2}
          style={styles.flex}
        >
          {value}
        </AppText>
      </View>
    );
  }
  return (
    <View style={styles.infoLineLarge}>
      <View style={[styles.infoIcon, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name={icon} color={colors.text} size={18} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" tone="textSecondary">
          {label}
        </AppText>
        <AppText style={styles.infoValue} numberOfLines={2}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

// Small rounded tag: D-4, 오늘, 취소됨, 승인 대기 …
export function Tag({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'accent' | 'muted' | 'danger' | 'outline';
}) {
  const { colors } = useTheme();
  const look = {
    accent: {
      backgroundColor: colors.accent,
      color: colors.onAccent,
      borderColor: colors.accent,
    },
    muted: {
      backgroundColor: colors.surfaceMuted,
      color: colors.text,
      borderColor: colors.border,
    },
    danger: {
      backgroundColor: colors.danger,
      color: colors.onDanger,
      borderColor: colors.danger,
    },
    outline: {
      backgroundColor: 'transparent',
      color: colors.textSecondary,
      borderColor: colors.borderStrong,
    },
  }[tone];
  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: look.backgroundColor,
          borderColor: look.borderColor,
        },
      ]}
    >
      <AppText variant="labelStrong" style={{ color: look.color }}>
        {label}
      </AppText>
    </View>
  );
}

// Behind the bottom buttons of a scrolling screen: clear at the top and black from the middle down,
// so the list slides under the buttons instead of showing through them. It takes its measured size:
// an Svg sized in percent falls back to 300×150 on Android.
export function BottomFade() {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <View style={styles.fade} pointerEvents="none" onLayout={measure}>
      {box ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <LinearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={k1.night} stopOpacity={0} />
              <Stop offset="0.45" stopColor={k1.night} stopOpacity={0.96} />
              <Stop offset="1" stopColor={k1.black} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width={box.width} height={box.height} fill="url(#bottomFade)" />
        </Svg>
      ) : null}
    </View>
  );
}

// 6.8 그룹런 만들기 draft, shared with 6.9 만남 장소 선택 which fills the meeting place.
// version goes up whenever a screen changes a group run, so 6.0 (in the tab under them) reloads.
type Draft = {
  place: (MeetingPlace & { note: string | null }) | null;
};
const DraftContext = createContext<{
  draft: Draft;
  setPlace: (place: Draft['place']) => void;
  version: number;
  changed: () => void;
} | null>(null);

export function GroupRunDraftProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>({ place: null });
  const [version, setVersion] = useState(0);
  const value = useMemo(
    () => ({
      draft,
      setPlace: (place: Draft['place']) =>
        setDraft(current => ({ ...current, place })),
      version,
      changed: () => setVersion(current => current + 1),
    }),
    [draft, version],
  );
  return (
    <DraftContext.Provider value={value}>{children}</DraftContext.Provider>
  );
}

export function useGroupRunDraft() {
  const value = useContext(DraftContext);
  if (!value) {
    throw new Error(
      'useGroupRunDraft must be used inside GroupRunDraftProvider',
    );
  }
  return value;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Starts 40 above the buttons' box so the list fades out before it reaches them.
  fade: { position: 'absolute', top: -40, left: 0, right: 0, bottom: 0 },
  initial: { alignItems: 'center', justifyContent: 'center' },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  infoLineLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoValue: { fontFamily: fontFamily.medium, fontSize: 14.5, lineHeight: 21 },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
