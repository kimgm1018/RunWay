import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components';
import { fontFamily } from '../../theme';
import { groupLook } from '../group/look';

// runway-community-handoff tokens.css (S15P31E105-426). Every community screen is white like the 7.1
// feed, and nothing is a pill (담당자 요청): buttons are bare icons or words, fields and tags flat
// mist boxes. Only the run photos stay dark. Grain is left out as on the other
// handoff screens (담당자 결정).
export const communityLook = {
  background: '#FFFFFF',
  ink: '#02050E',
  sub: '#56646C',
  meta: '#8A8A8A',
  like: '#E2876F',
  // Flat mist boxes on white: fields, tags, the follow button, the run tiles (--follow-btn-bg).
  field: '#F3F5F6',
  // A row lights up faintly when pressed.
  pressedRow: 'rgba(2,5,14,0.04)',
  // The 4:5 photos take one of three gradients, by post: --media-free, --media-dark-panel, --bg-dark.
  media: [
    {
      colors: [
        '#F9F9F9',
        '#E2EAEE',
        '#C4D4DC',
        '#A4BDC9',
        '#8DACBA',
        '#7DA0B2',
        '#5D8194',
        '#3A5A6C',
        '#182E3D',
        '#091019',
        '#060606',
        '#1A2E39',
      ],
      offsets: [0, 0.12, 0.2, 0.28, 0.34, 0.42, 0.56, 0.64, 0.72, 0.8, 0.9, 1],
    },
    {
      colors: ['#060606', '#091019', '#182E3D', '#3A5A6C', '#5D8194'],
      offsets: [0, 0.24, 0.5, 0.76, 1],
    },
    {
      colors: [...groupLook.darkBackground],
      offsets: [...groupLook.darkBackgroundStops],
    },
  ],
  // White text on the run photos.
  onDark: groupLook.onDark,
} as const;

// A section title in place of a card: a 1.5px navy line on its left.
export function LineLabel({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.label}>
      <AppText style={styles.labelText} accessibilityRole="header">
        {children}
      </AppText>
    </View>
  );
}

// 코스도 함께 공유 (7.3 · 7.3e): a navy track with a white knob when on, pale mist off. dark: over 7.3's dark map
// (S15P31E105-563), the feed's neon mint track with a navy knob when on, faint white off. disabled: fixed
// where it stands and faded (a free run has no course to share yet).
export function CourseToggle({
  label,
  value,
  onChange,
  dark = false,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  dark?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[
        styles.track,
        value ? styles.trackOn : styles.trackOff,
        dark && (value ? styles.trackOnDark : styles.trackOffDark),
        disabled && styles.disabled,
      ]}
    >
      <View
        style={[
          styles.knob,
          value ? styles.on : styles.off,
          dark && value && styles.knobOnDark,
        ]}
      />
    </Pressable>
  );
}

// The community's bottom sheet look, shared by the 댓글 sheet and the menus (담당자 요청: 하단 시트 통일): white,
// edge to edge with only its top corners rounded, a pale handle, over a navy dim.
export const sheetLook = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(2,5,14,0.45)' },
  sheet: {
    backgroundColor: communityLook.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: { alignItems: 'center', paddingTop: 10, paddingBottom: 12 },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C4D4DC',
  },
  title: {
    marginTop: 10,
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: communityLook.ink,
  },
});

// A short sheet in that look (7.2b 게시물 메뉴, 댓글 메뉴, 7.2c 삭제 확인): it rises from the bottom; the dim
// closes it.
export function CommunitySheet({
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
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (visible) {
      rise.setValue(1);
      Animated.timing(rise, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [rise, visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, sheetLook.scrim]}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            sheetLook.sheet,
            styles.sheetBody,
            {
              paddingBottom: insets.bottom + 16,
              transform: [
                {
                  translateY: rise.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 400],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={sheetLook.header}>
            <View style={sheetLook.handle} />
            {title ? (
              <AppText style={sheetLook.title} accessibilityRole="header">
                {title}
              </AppText>
            ) : null}
          </View>
          {description ? (
            <AppText style={styles.sheetNote}>{description}</AppText>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

// A sheet button: a flat mist box with a navy label, or coral for 삭제.
export function SheetButton({
  title,
  danger = false,
  disabled = false,
  onPress,
}: {
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <AppText
        style={[styles.sheetButtonText, danger && styles.sheetButtonDanger]}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBody: { paddingHorizontal: 16 },
  sheetNote: {
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: communityLook.sub,
  },
  sheetButton: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: communityLook.field,
  },
  sheetButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: communityLook.ink,
  },
  sheetButtonDanger: { color: '#C4644B' },

  label: {
    borderLeftWidth: 1.5,
    borderLeftColor: communityLook.ink,
    paddingLeft: 8,
  },
  labelText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 19,
    color: communityLook.ink,
  },
  track: {
    width: 52,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: communityLook.ink },
  trackOff: { backgroundColor: '#E2EAEE' },
  trackOnDark: { backgroundColor: '#4DFFD2' },
  trackOffDark: { backgroundColor: 'rgba(255,255,255,0.24)' },
  knobOnDark: { backgroundColor: communityLook.ink },
  knob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 3px rgba(2,5,14,0.25)',
  },
  on: { alignSelf: 'flex-end' },
  off: { alignSelf: 'flex-start' },
});
