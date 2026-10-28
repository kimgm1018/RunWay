import React from 'react';
import { Image } from 'react-native';
import { useTheme } from '../theme';

const logos = {
  dark: require('../../assets/images/runway-logo-white.png'),
  light: require('../../assets/images/runway-logo-black.png'),
};

// The RUNWAY wordmark: white on dark screens, black on light ones (2.1La).
export function Logo({ width }: { width: number }) {
  const { name } = useTheme();
  return (
    <Image
      source={logos[name]}
      accessibilityLabel="RUNWAY"
      resizeMode="contain"
      // logo2_white.png and logo2_black.png are 1915×374.
      style={{ width, height: (width * 374) / 1915 }}
    />
  );
}
