import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { AppText } from '../../components';
import { RouteStroke } from '../../components/RouteStroke';
import { distanceM, type LngLat } from '../../geo';
import { fontFamily } from '../../theme';

// 4.5 러닝 결과 시안 G3 · 경로 톤온톤 민트 (S15P31E105-661), shared with 6.7 그룹런 결과 in the same tone: one navy
// page, mint for the labels and the main button, the route a deeper mint with white km squares.
export const resultLook = {
  page: '#0B1020',
  text: '#FFFFFF',
  sub: '#B9C0CA',
  mint: '#4DFFD2',
  route: '#1FB89A',
  divider: 'rgba(255,255,255,0.4)',
  line: 'rgba(255,255,255,0.12)',
  outline: 'rgba(255,255,255,0.75)',
  watermark: 'rgba(255,255,255,0.08)',
  danger: '#D44A4A',
  ink: '#02050E',
} as const;

// Figures and Latin as the 시안: Archivo at width 125. The handwriting (Nanum Brush Script) is only for the result
// screens (담당자 결정), so it lives here and not in the shared typography.
export const resultType = StyleSheet.create({
  caps: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 3,
    // Letter spacing also follows the last letter; the same space before the first keeps the name centred.
    paddingLeft: 3,
    color: resultLook.text,
  },
  big: {
    fontFamily: fontFamily.resultBlack,
    fontSize: 38,
    lineHeight: 48,
    letterSpacing: -1,
    color: resultLook.text,
  },
  figure: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 18,
    lineHeight: 24,
    color: resultLook.text,
  },
  unit: { fontSize: 11, color: resultLook.text },
  script: {
    fontFamily: fontFamily.resultScript,
    fontSize: 38,
    lineHeight: 38,
    color: resultLook.mint,
  },
  label: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 21,
    color: resultLook.mint,
  },
});

// 1분 단축, 3.8km에서 중단 as the 시안: each run of figures in Archivo, the words around it in Noto Sans KR.
const numberRun = /(\d[\d:.,/′″'"+-]*)/;

export function MixedFigure({
  text,
  danger = false,
  style,
  numberStyle,
}: {
  text: string;
  danger?: boolean;
  style?: StyleProp<TextStyle>;
  numberStyle?: StyleProp<TextStyle>;
}) {
  return (
    <AppText style={[styles.mixed, style, danger && styles.danger]}>
      {text.split(numberRun).map((part, index) =>
        index % 2 === 1 ? (
          <AppText
            key={index}
            style={[styles.mixedNumber, numberStyle, danger && styles.danger]}
          >
            {part}
          </AppText>
        ) : (
          part
        ),
      )}
    </AppText>
  );
}

// One block of 시안 G3: the caps name, the big figure and its handwritten name on the left, a line, and the
// smaller figures on the right.
export function StatBlock({
  caps,
  value,
  valueLabel,
  script,
  scriptSize,
  children,
}: {
  caps: string;
  value: string;
  valueLabel?: string;
  script: string;
  // The handwriting smaller than the 시안's 38 (6.7's English Average · Completed, S15P31E105-701).
  scriptSize?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.block}>
      <View style={styles.blockMain}>
        <AppText style={resultType.caps}>{caps}</AppText>
        <AppText
          style={[resultType.big, styles.bigValue]}
          accessibilityLabel={valueLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </AppText>
        <AppText
          style={[
            resultType.script,
            styles.script,
            scriptSize
              ? { fontSize: scriptSize, lineHeight: scriptSize }
              : null,
          ]}
        >
          {script}
        </AppText>
      </View>
      <View style={styles.divider} />
      <View style={styles.blockSide}>{children}</View>
    </View>
  );
}

// A name in mint over its figure, the unit smaller after it (시안 오른쪽 칸).
export function SideFigure({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.side}>
      <AppText style={resultType.label} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </AppText>
      <AppText style={resultType.figure} numberOfLines={1}>
        {value}
        {unit ? <AppText style={resultType.unit}>{` ${unit}`}</AppText> : null}
      </AppText>
    </View>
  );
}

// RUN YOUR WAY · RUNWAY · 2026 standing faint up the left edge (시안), read from the bottom.
export function ResultWatermark({
  height,
  year,
}: {
  height: number;
  year: number;
}) {
  return (
    <View
      style={styles.watermarkSlot}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.watermarkTurn,
          {
            width: height,
            left: (watermarkWidth - height) / 2,
            top: (height - watermarkWidth) / 2,
          },
        ]}
      >
        <AppText
          style={styles.watermark}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {`RUN YOUR WAY · RUNWAY · ${year}`}
        </AppText>
      </View>
    </View>
  );
}

const watermarkWidth = 50;

// 기록 공유 · 완료: the tab bar's rounded square, a white outline and the mint one with ink text. Pressed, a tile dims; one
// that cannot be used yet is faded.
export function ResultButton({
  title,
  onPress,
  primary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonPlain,
        pressed && styles.pressed,
        disabled && styles.dim,
      ]}
    >
      <AppText
        style={[styles.buttonText, primary && styles.buttonTextPrimary]}
        numberOfLines={1}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

// Where the white squares go: the start, every full kilometre and the finish. A kilometre mark right by the finish
// is left out so the two squares do not sit on each other.
function kmMarks(route: LngLat[]) {
  const marks: LngLat[] = [route[0]];
  let walked = 0;
  let next = 1000;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const step = distanceM(from, to);
    while (step > 0 && walked + step >= next) {
      const share = (next - walked) / step;
      marks.push([
        from[0] + (to[0] - from[0]) * share,
        from[1] + (to[1] - from[1]) * share,
      ]);
      next += 1000;
    }
    walked += step;
  }
  const end = route[route.length - 1];
  const last = marks[marks.length - 1];
  if (marks.length > 1 && distanceM(last, end) < 150) {
    marks.pop();
  }
  marks.push(end);
  return marks;
}

const traceInset = 12;
const markSize = 12;

// The run's path without a map: the shared layered community stroke, fitted with real shape proportions,
// and the result screen's white squares every kilometre.
export function RouteTrace({
  route,
  width,
  height,
}: {
  route: LngLat[];
  width: number;
  height: number;
}) {
  const lngs = route.map(point => point[0]);
  const lats = route.map(point => point[1]);
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const squeeze = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max(
    (Math.max(...lngs) - Math.min(...lngs)) * squeeze,
    1e-5,
  );
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 1e-5);
  const scale = Math.min(
    (width - traceInset * 2) / spanX,
    (height - traceInset * 2) / spanY,
  );
  const project = ([lng, lat]: LngLat) => ({
    x: width / 2 + (lng - midLng) * squeeze * scale,
    y: height / 2 - (lat - midLat) * scale,
  });
  const points = route
    .map(point => {
      const { x, y } = project(point);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <Svg
      width={width}
      height={height}
      accessibilityLabel="달린 경로, 출발에서 도착까지 1km마다 표시"
    >
      <RouteStroke points={points} />
      {kmMarks(route).map((mark, index) => {
        const { x, y } = project(mark);
        return (
          <Rect
            key={index}
            x={x - markSize / 2}
            y={y - markSize / 2}
            width={markSize}
            height={markSize}
            fill={resultLook.text}
            stroke={resultLook.route}
            strokeWidth={2.5}
          />
        );
      })}
    </Svg>
  );
}

// A box that takes the room the screen leaves and draws the route over it once measured, so the drawing never makes
// the box grow.
export function RouteArea({
  route,
  style,
}: {
  route: LngLat[];
  style?: object;
}) {
  const [area, setArea] = useState<{ width: number; height: number } | null>(
    null,
  );
  return (
    <View
      style={style}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setArea({ width, height });
      }}
    >
      {route.length > 1 && area && area.height > 0 ? (
        <View style={StyleSheet.absoluteFill}>
          <RouteTrace route={route} width={area.width} height={area.height} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  watermarkSlot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: watermarkWidth,
  },
  watermarkTurn: {
    position: 'absolute',
    height: watermarkWidth,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  mixed: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 26,
    color: resultLook.text,
  },
  mixedNumber: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 20,
    color: resultLook.text,
  },
  danger: { color: resultLook.danger },
  block: { flexDirection: 'row', gap: 16 },
  blockMain: { width: 160, alignItems: 'center' },
  bigValue: { marginTop: 4, alignSelf: 'stretch', textAlign: 'center' },
  // The handwriting tucks up under the figure on its right (시안).
  script: { alignSelf: 'flex-end', marginTop: -14 },
  divider: { width: 1, backgroundColor: resultLook.divider },
  blockSide: { flex: 1, minWidth: 0, justifyContent: 'center' },
  side: { gap: 2 },
  watermark: {
    fontFamily: fontFamily.resultBlack,
    fontSize: 38,
    lineHeight: 48,
    color: resultLook.watermark,
  },
  // The bottom tab bar's rounded square (PillTabBar 탭 칸: 높이 52, 모서리 18; 담당자 요청: 직사각형 대신 탭 바 네모).
  button: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  buttonPlain: { borderColor: resultLook.outline },
  buttonPrimary: {
    backgroundColor: resultLook.mint,
    borderColor: resultLook.mint,
  },
  pressed: { opacity: 0.8 },
  dim: { opacity: 0.45 },
  buttonText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: resultLook.text,
  },
  buttonTextPrimary: { color: resultLook.ink },
});
