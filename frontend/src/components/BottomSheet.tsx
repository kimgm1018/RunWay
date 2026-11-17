import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, radius, spacing, useTheme } from '../theme';
import { AppText } from './AppText';
import { useSheetDrag } from './SheetDrag';

// 6.2x 가입 신청 불가, 6.4d 취소 확인, 7.2b 게시물 메뉴: a sheet that rises from the bottom over a dark scrim.
// It floats 8 away from the screen edges with every corner rounded (DESIGN.md 2-9). Dragged down far or fast
// enough it closes like a tap on the scrim; a short drag settles back (S15P31E105-899).
export function BottomSheet({
  visible,
  onClose,
  title,
  description,
  background,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  // A fill of its own instead of the theme's raised surface (3.1 기준 위치: the 코스 조건 card's navy).
  background?: string;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const offset = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (visible) {
      offset.setValue(1);
      Animated.timing(offset, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [offset, visible]);
  // How far the sheet goes to leave the screen: its height and the gap under it.
  const [height, setHeight] = useState(400);
  const leave = height + sheetGap + insets.bottom;
  const visibleNow = useRef(visible);
  visibleNow.current = visible;
  const { drag, panHandlers } = useSheetDrag({
    direction: 'down',
    range: leave,
    onCommit: () => {
      onClose();
      Animated.timing(drag, {
        toValue: leave,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        // A sheet its screen keeps open (busy, say) comes back up instead of staying out of sight.
        if (visibleNow.current) {
          Animated.spring(drag, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      });
    },
  });
  // Opened again, the sheet starts where it belongs, not where the last drag left it.
  useEffect(() => {
    if (visible) {
      drag.setValue(0);
    }
  }, [drag, visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <Animated.View
          accessibilityViewIsModal
          onLayout={event => setHeight(event.nativeEvent.layout.height)}
          {...panHandlers}
          style={[
            styles.sheet,
            {
              backgroundColor: background ?? colors.surfaceRaised,
              marginBottom: sheetGap + insets.bottom,
              transform: [
                {
                  translateY: Animated.add(
                    offset.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 400],
                    }),
                    drag,
                  ),
                },
              ],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {title ? (
            <AppText
              variant="title"
              accessibilityRole="header"
              style={styles.title}
            >
              {title}
            </AppText>
          ) : null}
          {description ? (
            <AppText variant="body" tone="textSecondary">
              {description}
            </AppText>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const sheetGap = 8;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    marginHorizontal: sheetGap,
    borderRadius: 34,
    paddingTop: spacing.xl,
    paddingHorizontal: 22,
    paddingBottom: spacing.xxxl,
    gap: 14,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fontFamily.medium },
});
