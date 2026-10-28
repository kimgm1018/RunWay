import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
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
  palette,
  radius,
  size,
  spacing,
  typography,
  useTheme,
} from '../../theme';

// Simplified marks for the two music services (2.0 음악 버튼, 2.8 음원 목록).
export function ServiceMark({
  service,
  size: diameter = 28,
}: {
  service: MusicService;
  size?: number;
}) {
  const color = service === 'MELON' ? palette.melon : palette.spotify;
  return (
    <Svg width={diameter} height={diameter} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill={color} />
      {service === 'MELON' ? (
        <Path
          d="M12 6.5c-3 0-5.2 2.4-5.2 5.4 0 3.1 2.3 5.6 5.2 5.6s5.2-2.5 5.2-5.6c0-3-2.2-5.4-5.2-5.4zm0 0c.2-1.3 1-2.3 2.2-2.8"
          stroke={palette.white}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <>
          <Path
            d="M6.5 9.3c3.8-1.1 7.6-.8 11 .9"
            stroke={palette.ink}
            strokeWidth={1.9}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M7.2 12.4c3.1-.9 6.2-.6 9 .8"
            stroke={palette.ink}
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M7.8 15.3c2.5-.7 4.9-.5 7.1.6"
            stroke={palette.ink}
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
  onPress,
  children,
}: {
  label: string;
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
        { backgroundColor: colors.surfaceMuted },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const countdownSeconds = 3;

// 2.0·2.0F 하단: settings, 러닝 시작 (3초 카운트다운 후 4.2), music.
// Day screens use a dark start button on the light card; night uses mint (2.0N).
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
          { backgroundColor: night ? colors.accent : palette.ink },
          (pressed || !config) && styles.pressed,
        ]}
      >
        <Icon
          name="play"
          color={night ? colors.onAccent : palette.white}
          size={16}
        />
        <AppText
          style={[
            typography.button,
            { color: night ? colors.onAccent : palette.white },
          ]}
        >
          러닝 시작
        </AppText>
      </Pressable>
      <RoundButton
        label="음악"
        onPress={() => navigateTo(navigation, 'MusicCard')}
      >
        {source === 'MELON' || source === 'SPOTIFY' ? (
          <ServiceMark service={source} size={30} />
        ) : (
          <Icon name="music" color={colors.text} size={20} />
        )}
      </RoundButton>
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
export function PlaceCard({ name, gps }: { name: string; gps: GpsQuality }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.place,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={[styles.placeDot, { backgroundColor: colors.accent }]} />
      <View style={styles.flex}>
        <AppText variant="label" tone="textTertiary">
          현재 위치
        </AppText>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {name}
        </AppText>
      </View>
      <View
        style={[
          styles.gps,
          {
            backgroundColor:
              gps === 'good' ? colors.accentSoft : colors.dangerSurface,
          },
        ]}
      >
        <AppText
          variant="labelStrong"
          tone={gps === 'good' ? 'text' : 'danger'}
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
    height: size.buttonLarge,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
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
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  placeDot: { width: 10, height: 10, borderRadius: 5 },
  gps: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
});
