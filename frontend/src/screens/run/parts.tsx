import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, {
  Circle,
  Defs,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { AppText, Icon } from '../../components';
import {
  useRepositories,
  type GpsQuality,
  type MusicSource,
  type MusicService,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { useRunActions, type RunConfig } from './RunSession';
import {
  fontFamily,
  k1,
  palette,
  spacing,
  typography,
  useTheme,
} from '../../theme';

// Round K1 badge brightening toward the bottom right (DESIGN.md 2-6): the music button with a
// service connected and the 2.0F 자유 러닝 icon.
export function K1Badge({
  diameter,
  children,
}: {
  diameter: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.badge,
        { width: diameter, height: diameter, borderRadius: diameter / 2 },
      ]}
    >
      <Svg style={StyleSheet.absoluteFill} width={diameter} height={diameter}>
        <Defs>
          <RadialGradient id="badge" cx={1} cy={1} fx={1} fy={1} r={1.2}>
            <Stop offset={0} stopColor={k1.mid} />
            <Stop offset={0.45} stopColor={k1.deep} />
            <Stop offset={1} stopColor={k1.night} />
          </RadialGradient>
        </Defs>
        <Rect width={diameter} height={diameter} fill="url(#badge)" />
      </Svg>
      {children}
    </View>
  );
}

// Simplified marks for the two music services (2.0 음악 버튼, 2.8 음원 목록).
// mono draws only the white mark, for a K1 badge.
export function ServiceMark({
  service,
  size: diameter = 28,
  mono = false,
}: {
  service: MusicService;
  size?: number;
  mono?: boolean;
}) {
  const color = service === 'MELON' ? palette.melon : palette.spotify;
  const line = mono || service === 'MELON' ? palette.white : palette.ink;
  return (
    <Svg width={diameter} height={diameter} viewBox="0 0 24 24">
      {mono ? null : <Circle cx="12" cy="12" r="12" fill={color} />}
      {service === 'MELON' ? (
        <Path
          d="M12 6.5c-3 0-5.2 2.4-5.2 5.4 0 3.1 2.3 5.6 5.2 5.6s5.2-2.5 5.2-5.6c0-3-2.2-5.4-5.2-5.4zm0 0c.2-1.3 1-2.3 2.2-2.8"
          stroke={line}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <>
          <Path
            d="M6.5 9.3c3.8-1.1 7.6-.8 11 .9"
            stroke={line}
            strokeWidth={1.9}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M7.2 12.4c3.1-.9 6.2-.6 9 .8"
            stroke={line}
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M7.8 15.3c2.5-.7 4.9-.5 7.1.6"
            stroke={line}
            strokeWidth={1.4}
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}

// Keeps the music button in sync with what was picked on 2.7·2.8, which sit on top of this screen.
export function useMusicSource() {
  const { music } = useRepositories();
  const [source, setSource] = useState<MusicSource | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      music.getState().then(
        state => active && setSource(state.source),
        () => undefined,
      );
      return () => {
        active = false;
      };
    }, [music]),
  );
  return source;
}

function RoundButton({
  label,
  night,
  onPress,
  children,
}: {
  label: string;
  night: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: night ? colors.surfaceMuted : k1.field },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const countdownSeconds = 3;

// 2.0·2.0F 하단: settings, 러닝 시작 (3초 카운트다운 후 4.2), music.
// Day screens use the black pill with a dot in a ring (DESIGN.md 2-6 러닝 시작); night uses the accent.
export function RunStartBar({
  night,
  config,
}: {
  night: boolean;
  // What the run starts with; the button stays disabled until it is known.
  config: RunConfig | null;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const source = useMusicSource();
  const { start: startRun } = useRunActions();
  // The countdown effect reads these through a ref so a re-render never restarts its timer.
  const latest = useRef({ config, navigation, start: startRun });
  latest.current = { config, navigation, start: startRun };
  const [count, setCount] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (count === null) {
      return;
    }
    if (count === 0) {
      setCount(null);
      const { config: chosen, navigation: nav, start } = latest.current;
      if (chosen) {
        start(chosen);
      }
      navigateTo(nav, 'RunProgress');
      return;
    }
    timer.current = setTimeout(() => setCount(count - 1), 1000);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [count]);
  return (
    <View style={styles.bar}>
      <RoundButton
        label="설정"
        night={night}
        onPress={() => navigateTo(navigation, 'Settings')}
      >
        <Icon name="settings" color={colors.text} size={20} />
      </RoundButton>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="러닝 시작"
        accessibilityState={{ disabled: !config }}
        disabled={!config}
        onPress={() => setCount(countdownSeconds)}
        style={({ pressed }) => [
          styles.start,
          { backgroundColor: night ? colors.accent : k1.night },
          (pressed || !config) && styles.pressed,
        ]}
      >
        <AppText
          style={[
            typography.button,
            { color: night ? colors.onAccent : k1.ice },
          ]}
        >
          러닝 시작
        </AppText>
        <View
          style={[
            styles.ring,
            { borderColor: night ? colors.onAccent : k1.ice },
          ]}
        >
          <View
            style={[
              styles.ringDot,
              { backgroundColor: night ? colors.onAccent : k1.ice },
            ]}
          />
        </View>
      </Pressable>
      {source === 'MELON' || source === 'SPOTIFY' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="음악"
          onPress={() => navigateTo(navigation, 'MusicCard')}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <K1Badge diameter={52}>
            <ServiceMark service={source} size={30} mono />
          </K1Badge>
        </Pressable>
      ) : (
        <RoundButton
          label="음악"
          night={night}
          onPress={() => navigateTo(navigation, 'MusicCard')}
        >
          <Icon name="music" color={colors.text} size={20} />
        </RoundButton>
      )}
      <Modal
        visible={count !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setCount(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="카운트다운 취소"
          onPress={() => setCount(null)}
          style={[styles.countdown, { backgroundColor: colors.scrim }]}
        >
          <AppText style={styles.countText}>{count}</AppText>
          <AppText variant="caption" style={styles.countHint}>
            화면을 누르면 취소돼요
          </AppText>
        </Pressable>
      </Modal>
    </View>
  );
}

const gpsLabels: Record<GpsQuality, string> = {
  good: 'GPS 양호',
  weak: 'GPS 약함',
  none: 'GPS 없음',
};

// The floating card at the top of the map: 현재 위치 · 민락수변공원 입구 · GPS 양호.
// A white card with a navy dot and a black GPS chip (DESIGN.md 2-6 지도 위). After sunset the card
// is dark, so the dot turns white and the chip light.
export function PlaceCard({ name, gps }: { name: string; gps: GpsQuality }) {
  const theme = useTheme();
  const { colors } = theme;
  const night = theme.name === 'dark';
  return (
    <View style={[styles.place, { backgroundColor: colors.surfaceRaised }]}>
      <View style={[styles.placeHalo, night && styles.placeHaloNight]}>
        <View style={[styles.placeDot, night && styles.placeDotNight]} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" tone="textSecondary" style={styles.regular}>
          현재 위치
        </AppText>
        <AppText style={styles.placeName} numberOfLines={1}>
          {name}
        </AppText>
      </View>
      <View
        style={[
          styles.gps,
          {
            backgroundColor:
              gps === 'good' ? colors.accent : colors.dangerSurface,
          },
        ]}
      >
        <AppText
          variant="labelStrong"
          style={gps === 'good' ? { color: colors.onAccent } : undefined}
          tone={gps === 'good' ? undefined : 'danger'}
        >
          {gpsLabels[gps]}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  start: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 10,
  },
  ring: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    opacity: 0.7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringDot: { width: 4, height: 4, borderRadius: 2 },
  badge: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdown: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  countText: {
    ...typography.metricHero,
    fontSize: 120,
    lineHeight: 130,
    color: palette.white,
  },
  countHint: { color: palette.pale },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: 24,
    shadowColor: k1.night,
    shadowOpacity: 0.12,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  // Navy dot inside a 5px halo of the same color at 22%.
  placeHalo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(37,54,73,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: k1.deep,
  },
  placeHaloNight: { backgroundColor: 'rgba(232,238,244,0.22)' },
  placeDotNight: { backgroundColor: k1.ice },
  regular: { fontFamily: fontFamily.regular },
  placeName: { ...typography.bodyStrong, fontFamily: fontFamily.medium },
  gps: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
});
