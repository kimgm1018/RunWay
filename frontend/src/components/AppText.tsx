import React from 'react';
import {
  StyleSheet,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';
import {
  fontFamily,
  typography,
  useTheme,
  type ThemeColors,
  type TypographyVariant,
} from '../theme';

type TextTone = Extract<
  keyof ThemeColors,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'textDisabled'
  | 'accentText'
  | 'danger'
  | 'onAccent'
>;

// Figures and Latin letters across the app are Archivo (S15P31E105-662 담당자 결정: 한글 문장 안 숫자·영문까지).
// A line set in Noto Sans KR draws each run of them in the Archivo cut of about the same weight; Korean stays in
// Noto Sans KR, which Archivo has no letters for. 5.0km, 6′00″, 10.13, D-4, 82 and RUN are one run each.
const latinRun = /([A-Za-z0-9](?:[A-Za-z0-9.,:%/′″'’+-]*[A-Za-z0-9%′″'’])?)/;

const latinFamily: Record<string, string> = {
  [fontFamily.regular]: fontFamily.numberRegular,
  [fontFamily.medium]: fontFamily.numberMedium,
  [fontFamily.bold]: fontFamily.numberBold,
  [fontFamily.black]: fontFamily.numberBold,
};

// Component tests read a line's text straight from its Text node, which nested runs would break apart, so
// jest.setup.js turns the split off (globalThis.__RUNWAY_LATIN_SPLIT__ = false); latinRuns.test.tsx turns it on.
function splitOn() {
  return (
    (globalThis as { __RUNWAY_LATIN_SPLIT__?: boolean })
      .__RUNWAY_LATIN_SPLIT__ !== false
  );
}

// The children of a line with its figure and Latin runs in Archivo. Lines already in another family (the figure
// cuts, the handwriting) and lines with no such run come back unchanged.
export function latinRuns(
  children: React.ReactNode,
  style: StyleProp<TextStyle>,
): React.ReactNode {
  if (!splitOn()) {
    return children;
  }
  const family = StyleSheet.flatten(style)?.fontFamily;
  const archivo = family ? latinFamily[family] : undefined;
  if (!archivo) {
    return children;
  }
  let changed = false;
  // The element type is spelled out: inferred from the three returns it can differ between TypeScript runs
  // (CI's incremental check read it as unknown[]).
  const parts = React.Children.toArray(children).flatMap<React.ReactNode>(
    (child, index): React.ReactNode[] => {
      if (typeof child !== 'string' && typeof child !== 'number') {
        return [child];
      }
      const pieces = String(child).split(latinRun);
      if (pieces.length === 1) {
        return [child];
      }
      changed = true;
      return pieces
        .map((piece, at) =>
          at % 2 === 1 ? (
            <Text key={`${index}-${at}`} style={{ fontFamily: archivo }}>
              {piece}
            </Text>
          ) : (
            piece
          ),
        )
        .filter(piece => piece !== '');
    },
  );
  return changed ? parts : children;
}

export function AppText({
  variant = 'body',
  tone = 'text',
  style,
  children,
  ...props
}: TextProps & { variant?: TypographyVariant; tone?: TextTone }) {
  const { colors } = useTheme();
  const lineStyle = [typography[variant], { color: colors[tone] }, style];
  return (
    <Text {...props} style={lineStyle}>
      {latinRuns(children, lineStyle)}
    </Text>
  );
}
