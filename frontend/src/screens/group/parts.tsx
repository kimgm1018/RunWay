import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText, Icon, type IconName } from '../../components';
import type { GroupRunSummary, MeetingPlace } from '../../data';
import { formatClockTime, formatDotDateWeekday } from '../../format';
import { palette, radius, spacing, useTheme } from '../../theme';

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

const avatarTones = [
  palette.mint,
  palette.lavender,
  palette.coralSoft,
  palette.periwinkle,
  palette.pale,
];

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
  return (
    <View style={styles.infoLine}>
      <Icon name={icon} color={colors.textSecondary} size={label ? 16 : 13} />
      <View style={styles.flex}>
        {label ? (
          <AppText variant="label" tone="textTertiary">
            {label}
          </AppText>
        ) : null}
        <AppText
          variant={label ? 'bodyStrong' : 'caption'}
          tone={label ? 'text' : 'textSecondary'}
          numberOfLines={2}
        >
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
  initial: { alignItems: 'center', justifyContent: 'center' },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
