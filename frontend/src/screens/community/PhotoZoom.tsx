import React from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components';

// S15P31E105-797 (TEAM QA T13): a runner's profile photo, large over a dimmed screen. 닫기, a tap on the dim and the
// phone's 뒤로 all close it. Without a photo there is nothing to enlarge, so it never opens (the caller also
// skips the press then).
export function PhotoZoom({
  photo,
  onClose,
}: {
  // The photo's address while it is open, or null when closed.
  photo: string | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={photo !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="사진 닫기"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        {photo ? (
          <Image
            testID="photo-zoom-image"
            source={{ uri: photo }}
            style={{ width, height: Math.round(height * 0.7) }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="확대 사진 닫기"
          onPress={onClose}
          hitSlop={8}
          style={[styles.close, { top: insets.top + 12 }]}
        >
          <Icon name="close" color="#FFFFFF" size={22} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,5,14,0.88)',
  },
  close: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});

// Which photo a press on the picture enlarges: another runner's own photo, never mine or a missing one.
export const zoomablePhoto = (profile: {
  isMe: boolean;
  profileImageUrl: string | null;
}) =>
  !profile.isMe && profile.profileImageUrl ? profile.profileImageUrl : null;
