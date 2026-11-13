import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

// The default profile picture (S15P31E105-775, 담당자 결정): a line-drawn person — head and shoulders — on a flat
// mist circle. Everyone without a photo, or whose photo does not load, shows this one in every place a profile
// picture appears, instead of the first letter of the nickname.
export const defaultAvatarColors = {
  background: '#E2EAEE',
  figure: '#5D8194',
};

export function DefaultAvatar({
  size,
  round = true,
  background = defaultAvatarColors.background,
  color = defaultAvatarColors.figure,
  style,
  testID = 'default-avatar',
}: {
  size: number;
  // false fills a square (the profile backdrop); the parent clips it.
  round?: boolean;
  background?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const figure = Math.round(size * 0.62);
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.box,
        { width: size, height: size, backgroundColor: background },
        round && { borderRadius: size / 2 },
        style,
      ]}
    >
      <Svg width={figure} height={figure} viewBox="0 0 24 24">
        <Circle
          cx={12}
          cy={8.6}
          r={3.9}
          fill="none"
          stroke={color}
          strokeWidth={1.7}
        />
        <Path
          d="M4.6 20.4c1.4-3.6 4.2-5.5 7.4-5.5s6 1.9 7.4 5.5"
          fill="none"
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
