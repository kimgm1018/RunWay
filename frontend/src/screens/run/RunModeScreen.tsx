import React from 'react';
import {
  Image,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  Logo,
  MistFill,
  PressableScale,
  Screen,
} from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { fontFamily } from '../../theme';

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
    // 코스 러닝 opens on the map first (2.0C); 코스 설정 there leads to 3.1 코스 추천 and then 2.0 (담당자 요청).
    route: 'CourseStart',
    title: '코스 러닝',
    note: '추천 코스 따라 달리기',
    flipped: true,
    image: require('../../../assets/images/run-mode-track.png'),
    imageWidth: 104,
    imageAspect: 224 / 300,
    rise: 0.66,
  },
];

const cardHeight = 272;
const gutter = 8;
const gap = 12;

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
  const imageHeight = mode.imageWidth * mode.imageAspect;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={mode.title}
      onPress={onPress}
      style={[
        styles.card,
        mode.flipped ? styles.cardLight : styles.cardDark,
        { width },
      ]}
    >
      <MistFill id={`mode${mode.route}`} flipped={mode.flipped} />
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
    </PressableScale>
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
          <Logo width={120} />
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
