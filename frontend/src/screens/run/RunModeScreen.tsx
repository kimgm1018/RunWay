import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  Icon,
  Screen,
  ScreenHeader,
  type IconName,
} from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { fontFamily, k1, spacing, ThemeProvider, useTheme } from '../../theme';

type Mode = {
  route: RouteName;
  icon: IconName;
  title: string;
  description: string;
  // 자유 러닝 is the K1 glow card, 코스 러닝 the white card (DESIGN.md 2-6).
  glow: boolean;
};

const modes: Mode[] = [
  {
    route: 'FreeRun',
    icon: 'compass',
    title: '자유 러닝',
    description: '코스 없이 원하는 길로 달려요. 거리·시간·페이스만 기록해요.',
    glow: true,
  },
  {
    // 코스 러닝 goes through 3.1 코스 추천 before 2.0.
    route: 'TodayRun',
    icon: 'route',
    title: '코스 러닝',
    description:
      '조건에 맞는 코스를 추천받아 따라 달려요. 길 안내와 페이스 코칭을 받아요.',
    glow: false,
  },
];

// K1 brightening toward the bottom right corner (120% × 95% ellipse there).
// It takes the card's measured size: an Svg sized in percent falls back to 300×150 on Android.
function Glow({ width, height }: { width: number; height: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <RadialGradient
          id="glow"
          cx={1}
          cy={1}
          fx={1}
          fy={1}
          rx={1.2}
          ry={0.95}
        >
          <Stop offset={0} stopColor="#C2D0DC" />
          <Stop offset={0.16} stopColor={k1.light} />
          <Stop offset={0.34} stopColor={k1.mid} />
          <Stop offset={0.6} stopColor={k1.deep} />
          <Stop offset={0.84} stopColor={k1.night} />
          <Stop offset={1} stopColor={k1.black} />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#glow)" />
    </Svg>
  );
}

function ModeCardContent({ mode }: { mode: Mode }) {
  const { colors } = useTheme();
  return (
    <>
      <AppText style={styles.cardTitle}>{mode.title}</AppText>
      <AppText variant="caption" tone="textSecondary" style={styles.cardText}>
        {mode.description}
      </AppText>
      <View
        style={[
          styles.icon,
          mode.glow ? styles.iconOnGlow : styles.iconOnWhite,
        ]}
      >
        <Icon name={mode.icon} color={colors.text} size={20} />
      </View>
      <View style={[styles.go, { backgroundColor: colors.accent }]}>
        <Icon name="arrowUpRight" color={colors.onAccent} size={20} />
      </View>
    </>
  );
}

function ModeCard({ mode, onPress }: { mode: Mode; onPress: () => void }) {
  const { colors } = useTheme();
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mode.title}
      onPress={onPress}
      onLayout={mode.glow ? measure : undefined}
      style={({ pressed }) => [
        styles.card,
        !mode.glow && { backgroundColor: colors.surfaceRaised },
        pressed && styles.pressed,
      ]}
    >
      {mode.glow ? (
        <>
          {box ? <Glow width={box.width} height={box.height} /> : null}
          <ThemeProvider tone="dark">
            <ModeCardContent mode={mode} />
          </ThemeProvider>
        </>
      ) : (
        <ModeCardContent mode={mode} />
      )}
    </Pressable>
  );
}

// 2.0M 러닝 방식 선택: the first screen of the 러닝 tab.
export function RunModeScreen() {
  const navigation = useNavigation();
  return (
    <Screen
      withTabBar
      header={<ScreenHeader symbol title={'오늘은 어떻게\n달릴까요?'} />}
    >
      <AppText variant="caption" tone="textSecondary" style={styles.lead}>
        카드를 누르면 바로 다음 화면으로 넘어가요.
      </AppText>
      {modes.map(mode => (
        <ModeCard
          key={mode.route}
          mode={mode}
          onPress={() => navigateTo(navigation, mode.route)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { textAlign: 'center', marginBottom: spacing.md },
  card: {
    minHeight: 172,
    padding: 22,
    borderRadius: 30,
    overflow: 'hidden',
  },
  pressed: { transform: [{ scale: 0.96 }] },
  cardTitle: {
    fontFamily: fontFamily.regular,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  cardText: { maxWidth: 240, fontSize: 12.5, lineHeight: 20, marginTop: 4 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginTop: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOnGlow: { backgroundColor: 'rgba(255,255,255,0.14)' },
  iconOnWhite: { backgroundColor: k1.ice },
  go: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
