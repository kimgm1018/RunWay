import React from 'react';
import {
  type AccessibilityState,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { k1 } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './Motion';

// The one round icon button of the app (S15P31E105-466, 담당자 결정: 버튼 디자인 통일): a 44 glass circle with a
// navy icon, the records screens' look. On dark screens (crew, a photo, the night bar) the same circle is a dim
// white glass with a white icon. 뒤로 · 설정 · 알림 · 검색 · 더보기 · 공유 · 닫기 · 내 위치 all use it.
export function GlassIconButton({
  icon,
  accessibilityLabel,
  onPress,
  tone = 'light',
  dot = false,
  diameter = 44,
  disabled = false,
  accessibilityState,
  style,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  tone?: 'light' | 'dark';
  // A small coral dot at the top right (unread 알림).
  dot?: boolean;
  // 44 everywhere; the run start bar keeps its 52 beside the 러닝 시작 pill.
  diameter?: number;
  disabled?: boolean;
  accessibilityState?: AccessibilityState;
  style?: ViewStyle;
}) {
  const dark = tone === 'dark';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState ?? { disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[
        styles.button,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
        },
        dark ? styles.dark : styles.light,
        style,
      ]}
    >
      <Icon
        name={icon}
        color={dark ? '#FFFFFF' : '#02050E'}
        size={20}
        strokeWidth={1.9}
      />
      {dot ? <View style={styles.dot} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  light: {
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.5)',
    boxShadow:
      '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
  },
  dark: {
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
  },
  dot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: k1.coral,
  },
});
