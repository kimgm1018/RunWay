import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, radius, spacing, useTheme } from '../theme';
import { AppText } from './AppText';

// 6.2x 가입 신청 불가, 6.4d 취소 확인, 7.2b 게시물 메뉴: a sheet that rises from the bottom over a dark scrim.
// It floats 8 away from the screen edges with every corner rounded (DESIGN.md 2-9).
export function BottomSheet({
  visible,
  onClose,
  title,
  description,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
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
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceRaised,
              marginBottom: sheetGap + insets.bottom,
              transform: [
                {
                  translateY: offset.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 400],
                  }),
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
