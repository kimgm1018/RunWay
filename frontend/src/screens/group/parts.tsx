import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  AppText,
  DefaultAvatar,
  defaultAvatarColors,
  Icon,
  type IconName,
} from '../../components';
import {
  groupRunLateStartMs,
  isStaleGroupRun,
  type GroupRunSummary,
  type MeetingPlace,
} from '../../data';
import { formatClockTime, formatDotDateWeekday } from '../../format';
import {
  fontFamily,
  k1,
  mistGradient,
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

// D-4, or 오늘 on the day. A run whose day has passed reads 지남, not 오늘 (S15P31E105-823); one under way says so
// whatever its date.
export function dDay(
  scheduledAt: string,
  now: Date,
  status?: GroupRunSummary['status'],
) {
  if (status === 'RUNNING') {
    return '진행 중';
  }
  const days = Math.round(
    (kstMidnight(scheduledAt) - kstMidnight(now)) / dayMs,
  );
  if (days < 0) {
    return '지남';
  }
  return days === 0 ? '오늘' : `D-${days}`;
}

// 15분 뒤 출발. Past the start it stays 곧 출발 while the host may still begin late, then says the time has
// passed (S15P31E105-823).
export function startsIn(scheduledAt: string, now: Date) {
  const minutes = Math.round(
    (Date.parse(scheduledAt) - now.getTime()) / minuteMs,
  );
  if (minutes <= 0) {
    return -minutes * minuteMs <= groupRunLateStartMs
      ? '곧 출발'
      : '출발 시각 지남';
  }
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 뒤 출발`
    : `${minutes}분 뒤 출발`;
}

// The waiting room opens 30 minutes before the start for members who joined (6.4·6.5).
export const roomOpensMs = 30 * minuteMs;
// A past run nobody began (S15P31E105-891) opens no room.
export function canEnterRoom(run: GroupRunSummary, now: Date) {
  return (
    run.joined &&
    run.status === 'SCHEDULED' &&
    !isStaleGroupRun(run, now.getTime()) &&
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

// A photo filling a circle of `size` (S15P31E105-636). Until there is a photo, or when it fails to load,
// `fallback` (the default profile picture) stays, like the community Avatar. `inside` fills the parent circle inside
// its border instead (6.4's white ring around overlapping members stays visible).
export function PhotoOr({
  photo,
  size,
  fallback,
  inside = false,
  testID = 'member-photo',
}: {
  photo?: string | null;
  size: number;
  fallback: React.ReactNode;
  inside?: boolean;
  testID?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = photo && photo !== failed ? photo : null;
  if (!shown) {
    return <>{fallback}</>;
  }
  return (
    <Image
      testID={testID}
      source={{ uri: shown }}
      style={
        inside
          ? [styles.photoInside, { borderRadius: size / 2 }]
          : { width: size, height: size, borderRadius: size / 2 }
      }
      onError={() => setFailed(shown)}
      accessibilityIgnoresInvertColors
    />
  );
}

// The crew photo as a circle left of the crew name (6.0·6.1 cards 40, 6.2 head 64; S15P31E105-636).
// Nothing is drawn without a photo or when it fails, so those crews look as before.
export function CrewPhoto({
  photo,
  size,
}: {
  photo?: string | null;
  size: number;
}) {
  return (
    <PhotoOr photo={photo} size={size} fallback={null} testID="crew-photo" />
  );
}

// A member shown by their photo, or the default profile picture without one (S15P31E105-775). `color` is
// the person's own colour (그룹런 시안 memberColors, S15P31E105-673): it fills the circle behind the figure so
// the member still matches their colour bar. `name`, `index` and `mint` stay so callers pass the same person.
export function Initial({
  size = 32,
  color,
  photo,
  style,
}: {
  name: string;
  index?: number;
  size?: number;
  mint?: boolean;
  color?: string;
  photo?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.initial,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <PhotoOr
        photo={photo}
        size={size}
        inside
        fallback={
          <DefaultAvatar
            size={size}
            background={color ?? defaultAvatarColors.background}
            color={color ? memberFigure : defaultAvatarColors.figure}
          />
        }
      />
    </View>
  );
}

// The figure on a member's own colour: the ink, a little faded, reads on every member colour.
const memberFigure = 'rgba(2,5,14,0.55)';

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
// mist fades into the mist's steel blue foot, white into the white page of 6.4c · 6.5 · 6.8 (S15P31E105-563),
// instead of night.
export function BottomFade({
  mist = false,
  white = false,
}: {
  mist?: boolean;
  white?: boolean;
}) {
  const [top, end] = white
    ? ['#FFFFFF', '#FFFFFF']
    : mist
    ? [mistGradient.colors[19], mistGradient.colors[20]]
    : [k1.night, k1.black];
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
              <Stop offset="0" stopColor={top} stopOpacity={0} />
              <Stop offset="0.45" stopColor={top} stopOpacity={0.96} />
              <Stop offset="1" stopColor={end} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width={box.width} height={box.height} fill="url(#bottomFade)" />
        </Svg>
      ) : null}
    </View>
  );
}

// A course 3.1b picked for 6.8 (S15P31E105-696): the stored course, and the finish time and start the search asked
// with, which become the run's goal and meeting place.
export type RecommendedPick = {
  course: {
    id: string;
    name: string;
    distanceM: number;
    // [longitude, latitude] points; 6.8 draws its outline.
    route: [number, number][];
  };
  minutes: number;
  place: MeetingPlace & { note: string | null };
};

// 6.8 그룹런 만들기 draft, shared with 6.9 만남 장소 선택 which fills the meeting place, and with 3.1 · 3.1b when 6.8
// asks for a recommended course (pickingCourse) and gets one back (picked).
// version goes up whenever a screen changes a group run, so 6.0 (in the tab under them) reloads.
type Draft = {
  place: (MeetingPlace & { note: string | null }) | null;
  pickingCourse: boolean;
  picked: RecommendedPick | null;
};
const DraftContext = createContext<{
  draft: Draft;
  setPlace: (place: Draft['place']) => void;
  setPickingCourse: (picking: boolean) => void;
  setPicked: (picked: RecommendedPick | null) => void;
  version: number;
  changed: () => void;
} | null>(null);

export function GroupRunDraftProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>({
    place: null,
    pickingCourse: false,
    picked: null,
  });
  const [version, setVersion] = useState(0);
  // The setters keep one identity, and setting the same value changes nothing, so a screen may call them from
  // an effect or on focus without rendering again (S15P31E105-696).
  const setters = useMemo(() => {
    const set =
      <K extends keyof Draft>(key: K) =>
      (next: Draft[K]) =>
        setDraft(current =>
          current[key] === next ? current : { ...current, [key]: next },
        );
    return {
      setPlace: set('place'),
      setPickingCourse: set('pickingCourse'),
      setPicked: set('picked'),
      changed: () => setVersion(current => current + 1),
    };
  }, []);
  const value = useMemo(
    () => ({ draft, version, ...setters }),
    [draft, version, setters],
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

// For a screen that also runs outside the group run flow (3.1b on its own): null without the provider.
export function useOptionalGroupRunDraft() {
  return useContext(DraftContext);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Starts 40 above the buttons' box so the list fades out before it reaches them.
  fade: { position: 'absolute', top: -40, left: 0, right: 0, bottom: 0 },
  initial: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Fills the circle inside its border (an absolute child sits within the border, S15P31E105-636).
  photoInside: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
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
