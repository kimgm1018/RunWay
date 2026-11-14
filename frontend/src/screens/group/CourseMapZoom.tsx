import React, { useState, type ReactNode } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon, LightGlass } from '../../components';
import { RunMap } from '../../components/RunMap';
import type { GroupPaceInfo } from '../../data';
import { formatDuration, formatPace } from '../../format';
import type { LngLat } from '../../geo';
import { fontFamily, size } from '../../theme';
import { KmPacePills, visibleKmPaces } from '../run/KmPacePills';
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
  strategy,
}: {
  visible: boolean;
  onClose: () => void;
  route: LngLat[];
  // One pace a km (sec/km); empty leaves the line alone.
  paces: number[];
  distanceM: number;
  strategy?: GroupPaceInfo['startStrategy'];
}) {
  const insets = useSafeAreaInsets();
  const mapPaces = visibleKmPaces(paces, distanceM);
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
            mapPaces.length ? mapPaces.map(value => formatPace(value)) : undefined
          }
          pacePlanDistanceM={distanceM}
          fitTo={route}
          area={{ top: 0.12, bottom: strategy ? 0.55 : paces.length ? 0.62 : 0.88 }}
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
          <LightGlass
            radius={34}
            style={[styles.sheet, { bottom: Math.max(insets.bottom, size.tabBarInset) }]}
          >
            {strategy ? (
              <View>
                <AppText style={styles.strategyTitle}>오늘의 전략</AppText>
                <AppText style={styles.strategyLabel}>{strategy.label}</AppText>
                <AppText style={styles.strategyGoal}>
                  {`목표 ${formatPace(strategy.expectedDurationSec * 1000 / distanceM)} · 예상 ${formatDuration(strategy.expectedDurationSec)}`}
                </AppText>
              </View>
            ) : (
              <AppText style={styles.sheetTitle}>km별 페이스</AppText>
            )}
            <KmPacePills paces={paces} distanceM={distanceM} />
          </LightGlass>
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
  strategy,
  children,
  style,
}: {
  route: LngLat[];
  paces: number[];
  distanceM: number;
  strategy?: GroupPaceInfo['startStrategy'];
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
        strategy={strategy}
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
    left: 8,
    right: 8,
    padding: 18,
  },
  strategyTitle: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: '#67696E',
  },
  strategyLabel: {
    marginTop: 1,
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 27,
    letterSpacing: -0.5,
    color: '#02050E',
  },
  strategyGoal: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: '#67696E',
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
