import React from 'react';
import {
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  symbolPath,
  symbolViewBox,
  wordmarkPath,
  wordmarkRatio,
  wordmarkViewBox,
} from '../../components/logoPath';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';

// 1.1 시작 (S15P31E105-425, runway-splash-mockup): a dark runner on its own soft blue-grey background, the white
// loop and RUNWAY letters over the runner, and one full-width 시작하기 button that opens 1.2 로그인 (1.3 회원가입
// is reached from there). The mockup is drawn on a 412×915 phone; sizes follow the width and the letters sit at
// 50.7% of the height.

const mockWidth = 412;

// The runner, already darkened to the mockup's brightness(.32) since images take no CSS filter here. The mockup
// stretches it to 365.9×510.6, a little taller than the photo.
const runner = require('../../../assets/images/start-runner.webp');

// The background of this screen only: slightly different from the mist background of the other screens. The
// mockup's CSS layers, from the bottom up.
function StartBackground() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="startBase" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#D5D9DD" />
          <Stop offset="0.45" stopColor="#C7D1D7" />
          <Stop offset="0.75" stopColor="#BECCD4" />
          <Stop offset="1" stopColor="#B2C3CC" />
        </LinearGradient>
        <LinearGradient id="startFoot" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.6" stopColor="#09111A" stopOpacity={0} />
          <Stop offset="1" stopColor="#09111A" stopOpacity={0.28} />
        </LinearGradient>
        <RadialGradient id="startHaze" cx="45%" cy="58%" rx="150%" ry="85%">
          <Stop offset="0" stopColor="#A6BECA" stopOpacity={0.4} />
          <Stop offset="0.55" stopColor="#A6BECA" stopOpacity={0.2} />
          <Stop offset="1" stopColor="#A6BECA" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="startShadow" cx="50%" cy="79%" rx="58%" ry="34%">
          <Stop offset="0" stopColor="#09111A" stopOpacity={0.14} />
          <Stop offset="0.7" stopColor="#09111A" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="startGlow" cx="50%" cy="30%" rx="110%" ry="45%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id="startTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.65} />
          <Stop offset="0.3" stopColor="#FFFFFF" stopOpacity={0.18} />
          <Stop offset="0.48" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#startBase)" />
      <Rect width="100%" height="100%" fill="url(#startFoot)" />
      <Rect width="100%" height="100%" fill="url(#startHaze)" />
      <Rect width="100%" height="100%" fill="url(#startShadow)" />
      <Rect width="100%" height="100%" fill="url(#startGlow)" />
      <Rect width="100%" height="100%" fill="url(#startTop)" />
    </Svg>
  );
}

// The 1.1 background with its runner, hung where the RUNWAY letters start. 5.1 · 5.2 · 5.3 use the same
// (S15P31E105-485, runway-records: 1.1 시작 화면 배경).
export function StartBackdrop({ blur = 0 }: { blur?: number }) {
  const { width, height } = useWindowDimensions();
  const scale = width / mockWidth;
  const runnerTop = height * 0.507 - 264.1 * scale;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <StartBackground />
      <Image
        source={runner}
        resizeMode="stretch"
        blurRadius={blur}
        accessibilityIgnoresInvertColors
        style={[
          styles.absolute,
          {
            top: runnerTop,
            left: 6.1 * scale,
            width: 365.9 * scale,
            height: 510.6 * scale,
          },
        ]}
      />
    </View>
  );
}

// Everything on 1.1 but the button: the background, the runner and the logo. The launch splash
// (screens/SplashScreen) draws the same while the saved tokens load, so opening the app runs straight into 1.1.
export function StartArt() {
  const { width, height } = useWindowDimensions();

  // RUNWAY: 16 in from both edges, its top at 50.7% of the height; the loop 30 above it, 16% of the width.
  const wordmarkWidth = width - 32;
  const wordmarkHeight = wordmarkWidth * wordmarkRatio;
  const wordmarkTop = height * 0.507;
  const symbolWidth = width * 0.16;
  const symbolHeight =
    (symbolWidth * symbolViewBox.height) / symbolViewBox.width;

  return (
    <View style={StyleSheet.absoluteFill}>
      <StatusBar barStyle="dark-content" />
      {/* The runner hangs from the letters: its top 264 (on the 412 phone) above them. */}
      <StartBackdrop />
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel="RUNWAY"
        style={StyleSheet.absoluteFill}
      >
        <Svg
          width={symbolWidth}
          height={symbolHeight}
          viewBox={`0 0 ${symbolViewBox.width} ${symbolViewBox.height}`}
          style={[
            styles.absolute,
            {
              top: wordmarkTop - 30 - symbolHeight,
              left: (width - symbolWidth) / 2,
            },
          ]}
        >
          <Path d={symbolPath} fill="#FFFFFF" fillRule="evenodd" />
        </Svg>
        <Svg
          width={wordmarkWidth}
          height={wordmarkHeight}
          viewBox={wordmarkViewBox}
          style={[styles.wordmark, { top: wordmarkTop }]}
        >
          <Path d={wordmarkPath} fill="#FFFFFF" fillRule="evenodd" />
        </Svg>
      </View>
    </View>
  );
}

export function StartScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <View style={styles.root}>
      <StartArt />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="시작하기"
        onPress={() => navigateTo(navigation, 'Login')}
        style={({ pressed }) => [
          styles.start,
          { bottom: Math.max(height * 0.05, insets.bottom + 16) },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.startText}>시작하기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#D5D9DD' },
  absolute: { position: 'absolute' },
  wordmark: { position: 'absolute', left: 16 },
  // 시작하기: a full-width black pill, 24 in from the edges.
  start: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#02050D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.98 }] },
  startText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    letterSpacing: 0.32,
    color: '#FFFFFF',
    includeFontPadding: false,
  },
});
