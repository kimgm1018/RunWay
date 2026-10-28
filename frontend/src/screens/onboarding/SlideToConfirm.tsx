import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { AppText, Icon, type IconName } from '../../components';
import { radius, useTheme } from '../../theme';

const handleSize = 48;
const inset = 4;

// 1.7·1.8 "밀어서 시작하기 / 다시 연결": drag the handle to the end to confirm.
// Screen readers get a plain activate action instead of the drag.
export function SlideToConfirm({
  action,
  icon,
  onConfirm,
}: {
  action: string;
  icon: IconName;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;
  const max = Math.max(width - handleSize - inset * 2, 0);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) =>
          offset.setValue(Math.min(Math.max(gesture.dx, 0), max)),
        onPanResponderRelease: (_, gesture) => {
          if (max > 0 && gesture.dx >= max * 0.8) {
            Animated.timing(offset, {
              toValue: max,
              duration: 120,
              useNativeDriver: true,
            }).start(() => {
              confirm.current();
              offset.setValue(0);
            });
          } else {
            Animated.spring(offset, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [max, offset],
  );
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={`밀어서 ${action}`}
      accessibilityHint="두 번 탭하면 바로 실행돼요"
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'activate') {
          onConfirm();
        }
      }}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[
        styles.track,
        { backgroundColor: colors.surface, borderColor: colors.borderStrong },
      ]}
    >
      <AppText tone="textSecondary" style={styles.label}>
        밀어서 <AppText variant="bodyStrong">{action}</AppText>
      </AppText>
      <Animated.View
        {...responder.panHandlers}
        style={[
          styles.handle,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.borderStrong,
            transform: [{ translateX: offset }],
          },
        ]}
      >
        <Icon name={icon} color={colors.accentText} size={20} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: handleSize + inset * 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
  handle: {
    position: 'absolute',
    left: inset,
    width: handleSize,
    height: handleSize,
    borderRadius: handleSize / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
