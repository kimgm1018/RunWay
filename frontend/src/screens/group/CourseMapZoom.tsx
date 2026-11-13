import React, { useState, type ReactNode } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon } from '../../components';
import { RunMap } from '../../components/RunMap';
import { formatPace } from '../../format';
import type { LngLat } from '../../geo';
import { fontFamily } from '../../theme';
import { KmPacePills } from '../run/KmPacePills';
import { stand } from './stand';

// S15P31E105-739: a group run's course map opens full screen on a press, like the solo course start map
// (S15P31E105-748): the whole course in one mint line with each km's pace on it, movable and zoomable, the km pills
// under it, and 닫기 or the back button to close. The small map stays view-only with a ⤢ mark in its corner.

export function CourseMapModal({
  visible,
  onClose,
  route,
  paces,
  distanceM,
}: {
  visible: boolean;
  onClose: () => void;
  route: LngLat[];
  // One pace a km (sec/km); empty leaves the line alone.
  paces: number[];
  distanceM: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      hardwareAccelerated
    >
      <StatusBar barStyle="dark-content" />
      <View style={styles.page}>
        <RunMap
          route={route}
          paceLabels={
            paces.length ? paces.map(value => formatPace(value)) : undefined
          }
          fitTo={route}
          area={{ top: 0.12, bottom: paces.length ? 0.62 : 0.88 }}
          look="mint"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="지도 닫기"
          onPress={onClose}
          hitSlop={8}
          style={[styles.close, { top: insets.top + 12 }]}
        >
          <Icon name="close" color={stand.onMint} size={20} />
        </Pressable>
        {paces.length ? (
          <View
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
            accessibilityLabel="km별 페이스"
          >
            <AppText style={styles.sheetTitle}>km별 페이스</AppText>
            <KmPacePills paces={paces} distanceM={distanceM} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// A small map that opens the big one: `children` is the small map itself (view-only), drawn under a ⤢ badge.
export function CourseMapZoom({
  route,
  paces,
  distanceM,
  children,
  style,
}: {
  route: LngLat[];
  paces: number[];
  distanceM: number;
  children: ReactNode;
  style?: object;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="코스 지도 크게 보기"
        onPress={() => setOpen(true)}
        style={style}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {children}
        </View>
        <View pointerEvents="none" style={styles.badge}>
          <Icon
            name="expand"
            color={stand.onMint}
            size={16}
            strokeWidth={2.2}
          />
        </View>
      </Pressable>
      <CourseMapModal
        visible={open}
        onClose={() => setOpen(false)}
        route={route}
        paces={paces}
        distanceM={distanceM}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F4F5F7' },
  close: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#FFFFFF',
  },
  sheetTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 22,
    color: '#02050E',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
});
