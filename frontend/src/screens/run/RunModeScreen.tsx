import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { AppText, Logo, Screen } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { fontFamily } from '../../theme';

// 2.0M 핸드오프 (S15P31E105-374): white at the top through blue grey to near black, every 5%.
const mist = [
  '#F9F9F9',
  '#F8F8F8',
  '#F3F5F6',
  '#E2EAEE',
  '#C4D4DC',
  '#A4BDC9',
  '#8DACBA',
  '#81A3B3',
  '#7DA0B2',
  '#7DA0B2',
  '#7DA0B2',
  '#7599AB',
  '#5D8194',
  '#3A5A6C',
  '#182E3D',
  '#091019',
  '#060709',
  '#060606',
  '#06080B',
  '#0D171F',
  '#1A2E39',
];

type Mode = {
  route: RouteName;
  title: string;
  note: string;
  // 자유 러닝 runs the mist down to black; 코스 러닝 turns it upside down.
  flipped: boolean;
  image: ImageSourcePropType;
  // The illustration's width, its aspect and how far it rises from the middle (the mockup's translate).
  imageWidth: number;
  imageAspect: number;
  rise: number;
};

const modes: Mode[] = [
  {
    route: 'FreeRun',
    title: '자유 러닝',
    note: '코스 없이 자유롭게',
    flipped: false,
    image: require('../../../assets/images/run-mode-runner.png'),
    imageWidth: 108,
    imageAspect: 288 / 300,
    rise: 0.62,
  },
  {
    // 코스 러닝 goes through 3.1 코스 추천 before 2.0.
    route: 'TodayRun',
    title: '코스 러닝',
    note: '추천 코스 따라 달리기',
    flipped: true,
    image: require('../../../assets/images/run-mode-track.png'),
    imageWidth: 104,
    imageAspect: 224 / 300,
    rise: 0.66,
  },
];

const noise = require('../../../assets/images/card-noise.png');
const cardHeight = 272;
const gutter = 8;
const gap = 12;

// The card's mist. It takes the measured size: an Svg sized in percent falls back to 300×150 on Android.
function Mist({
  id,
  flipped,
  width,
  height,
}: {
  id: string;
  flipped: boolean;
  width: number;
  height: number;
}) {
  const colors = flipped ? [...mist].reverse() : mist;
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {colors.map((color, index) => (
            <Stop key={index} offset={index / 20} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

// A whole card is the button: the mist, a coarse grain over it, the picture and the title at the bottom left.
function ModeCard({
  mode,
  width,
  onPress,
}: {
  mode: Mode;
  width: number;
  onPress: () => void;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  const imageHeight = mode.imageWidth * mode.imageAspect;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mode.title}
      onPress={onPress}
      onLayout={measure}
      style={({ pressed }) => [
        styles.card,
        mode.flipped ? styles.cardLight : styles.cardDark,
        { width },
        pressed && styles.pressed,
      ]}
    >
      {box ? <Mist id={mode.route} flipped={mode.flipped} {...box} /> : null}
      {/* The mockup's feTurbulence grain (22% overlay), as tiled white and black specks at 10%: a blended layer
          spills past the round corners on Android. */}
      <View style={styles.grain} pointerEvents="none">
        <Image source={noise} resizeMode="repeat" style={styles.fill} />
      </View>
      <Image
        source={mode.image}
        accessibilityIgnoresInvertColors
        style={[
          styles.picture,
          {
            width: mode.imageWidth,
            height: imageHeight,
            marginLeft: -mode.imageWidth / 2,
            top: cardHeight / 2 - imageHeight * mode.rise,
          },
        ]}
      />
      <View style={styles.text}>
        <AppText
          style={[styles.title, mode.flipped ? styles.ink : styles.white]}
        >
          {mode.title}
        </AppText>
        <AppText
          style={[
            styles.note,
            mode.flipped ? styles.noteInk : styles.noteWhite,
          ]}
        >
          {mode.note}
        </AppText>
      </View>
    </Pressable>
  );
}

// 2.0M 러닝 방식 선택: the first screen of the 러닝 tab, two cards side by side in the middle of the screen.
export function RunModeScreen() {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const cardWidth = (width - gutter * 2 - gap) / 2;
  return (
    <Screen withTabBar scroll={false} contentStyle={styles.content}>
      <View style={styles.center}>
        <View style={styles.header}>
          <Logo width={34} symbol />
        </View>
        <AppText
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={styles.heading}
        >
          오늘은 어떻게 달릴까요?
        </AppText>
        <View style={styles.row}>
          {modes.map(mode => (
            <ModeCard
              key={mode.route}
              mode={mode}
              width={cardWidth}
              onPress={() => navigateTo(navigation, mode.route)}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter, paddingTop: 0 },
  center: { flex: 1, justifyContent: 'center' },
  header: { height: 56, alignItems: 'center', justifyContent: 'center' },
  // 29 Medium on one line, 5 under the logo and 25 above the cards.
  heading: {
    marginTop: 5,
    marginBottom: 25,
    paddingHorizontal: 8,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 29,
    lineHeight: 36.5,
    letterSpacing: -0.6,
    color: '#02050E',
  },
  row: { flexDirection: 'row', gap },
  card: { height: cardHeight, borderRadius: 26, overflow: 'hidden' },
  cardDark: {
    boxShadow:
      'inset 0 0 0 1px rgba(255,255,255,0.06), 0 12px 30px rgba(0,0,0,0.2)',
  },
  cardLight: { boxShadow: '0 12px 30px rgba(0,0,0,0.12)' },
  pressed: { transform: [{ scale: 0.98 }] },
  fill: { width: '100%', height: '100%' },
  grain: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.1,
  },
  picture: { position: 'absolute', left: '50%' },
  text: { position: 'absolute', left: 16, right: 16, bottom: 18 },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.6,
  },
  white: { color: '#FFFFFF' },
  ink: { color: '#111111' },
  note: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 16,
  },
  noteWhite: { color: 'rgba(255,255,255,0.55)' },
  noteInk: { color: '#67696E' },
});
