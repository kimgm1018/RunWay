import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../../components';
import type { RunMapArea, RunMapLogo } from '../../../components/RunMap';
import { formatDuration } from '../../../format';
import { fontFamily, k1 } from '../../../theme';

// 러닝 중 화면 (S15P31E105-517): one dark frame for personal, course and group runs, day and night alike.
// Top: what is running and how it is recorded. Middle: the number pages (swiped sideways). The map view
// fills the whole screen under the top and the foot, fading in (the reference's map button). The foot keeps
// its place: the run time and the controls, or on the map a row of distance · time · average pace.
export const liveLook = {
  ground: k1.night,
  tile: '#0D1521',
  line: 'rgba(232, 238, 244, 0.10)',
  text: k1.ice,
  sub: k1.light,
  muted: k1.mid,
  paused: k1.coral,
  button: '#1B2636',
  // The top and the foot over the map: dark enough to read on the light day map.
  band: 'rgba(2, 5, 14, 0.86)',
} as const;

export type LivePage = { key: string; title: string; content: React.ReactNode };
export type LiveView = 'numbers' | 'map';
export type LiveTone = 'live' | 'paused' | 'waiting';
export type LiveSummaryItem = { label: string; value: string; unit?: string };

const fadeMs = 250;

export function RunLiveFrame({
  title,
  status,
  subtitle,
  pages,
  page,
  onPageChange,
  view,
  renderMap,
  mapSummary,
  elapsedSec,
  paused,
  notes,
  music,
  controls,
}: {
  title: string;
  status: { text: string; tone: LiveTone };
  // The line under the title: 기록 중 · 폰으로 기록 중, or 그룹런 4명. Nothing when there is none.
  subtitle: string | null;
  pages: LivePage[];
  page: number;
  onPageChange: (page: number) => void;
  view: LiveView;
  // The full-screen map, told which part the top and the foot cover and where the NAVER logo may go.
  renderMap: (frame: {
    area: RunMapArea | undefined;
    logo: RunMapLogo | undefined;
  }) => React.ReactNode;
  // On the map the run time gives way to this row (distance · time · average pace).
  mapSummary: LiveSummaryItem[];
  elapsedSec: number;
  paused: boolean;
  notes?: React.ReactNode;
  music?: React.ReactNode;
  controls: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const pager = useRef<PagerView>(null);
  const shown = Math.min(page, pages.length - 1);
  const go = (next: number) => {
    onPageChange(next);
    pager.current?.setPage(next);
  };
  const onMap = view === 'map';
  // The map mounts the first time it is opened and then stays, so going back and forth does not reload it.
  const [mapOpened, setMapOpened] = useState(onMap);
  const fade = useRef(new Animated.Value(onMap ? 1 : 0)).current;
  useEffect(() => {
    if (onMap) {
      setMapOpened(true);
    }
    Animated.timing(fade, {
      toValue: onMap ? 1 : 0,
      duration: fadeMs,
      useNativeDriver: true,
    }).start();
  }, [fade, onMap]);
  const [size, setSize] = useState({ screen: 0, top: 0, bottom: 0 });
  const area =
    size.screen && size.top && size.bottom
      ? {
          top: size.top / size.screen,
          bottom: 1 - size.bottom / size.screen,
        }
      : undefined;
  const logo =
    size.screen && size.bottom
      ? { above: size.bottom / size.screen }
      : undefined;

  return (
    <View
      style={styles.root}
      onLayout={event => {
        // Read the height now: the event is not kept for the state update.
        const height = event.nativeEvent.layout.height;
        setSize(current => ({ ...current, screen: height }));
      }}
    >
      {/* On the map the light map runs up under the status bar, so its icons turn dark there. */}
      <StatusBar barStyle={onMap ? 'dark-content' : 'light-content'} />
      {mapOpened ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: fade }]}
          pointerEvents={onMap ? 'auto' : 'none'}
        >
          {renderMap({ area, logo })}
        </Animated.View>
      ) : null}

      <View style={styles.layout} pointerEvents="box-none">
        {/* On the map the top has no band: the map fills the screen to the very top and the title and the
            status float on it as small dark pills. */}
        <View
          style={[styles.header, { paddingTop: insets.top + 8 }]}
          pointerEvents="box-none"
          onLayout={event => {
            // Read the height now: the event is not kept for the state update.
            const height = event.nativeEvent.layout.height;
            setSize(current => ({ ...current, top: height }));
          }}
        >
          <View
            style={[styles.titleRow, onMap && styles.titleRowMap]}
            pointerEvents="box-none"
          >
            <View style={[styles.titleBox, onMap && styles.floating]}>
              <AppText style={styles.title} numberOfLines={1}>
                {title}
              </AppText>
              {subtitle ? (
                <AppText style={styles.device} numberOfLines={2}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <View
              style={[
                styles.status,
                status.tone === 'paused' && styles.statusPaused,
                // On the light map the pill stays dark; the coral dot still says paused.
                onMap && styles.statusFloating,
              ]}
              accessibilityLabel="기록 상태"
            >
              <View
                style={[
                  styles.statusDot,
                  status.tone === 'paused' && styles.statusDotPaused,
                  status.tone === 'waiting' && styles.statusDotWaiting,
                ]}
              />
              <AppText style={styles.statusText} numberOfLines={1}>
                {status.text}
              </AppText>
            </View>
          </View>
        </View>

        <Animated.View
          style={[
            styles.middle,
            {
              opacity: fade.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              }),
            },
          ]}
          pointerEvents={onMap ? 'none' : 'auto'}
        >
          <PagerView
            ref={pager}
            style={styles.flex}
            initialPage={shown}
            onPageSelected={event => onPageChange(event.nativeEvent.position)}
          >
            {pages.map(item => (
              <View key={item.key} style={styles.flex} collapsable={false}>
                {item.content}
              </View>
            ))}
          </PagerView>
          {pages.length > 1 ? (
            // The page names, not just dots, so a glance says which page is up.
            <View style={styles.tabs} accessibilityRole="tablist">
              {pages.map((item, index) => (
                <Pressable
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityLabel={`${item.title} 페이지`}
                  accessibilityState={{ selected: index === shown }}
                  onPress={() => go(index)}
                  hitSlop={8}
                  style={[styles.tab, index === shown && styles.tabOn]}
                >
                  <AppText
                    style={[
                      styles.tabText,
                      index === shown && styles.tabTextOn,
                    ]}
                  >
                    {item.title}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Animated.View>

        <View
          style={[
            styles.bottom,
            { paddingBottom: insets.bottom + 8 },
            onMap && styles.band,
          ]}
          onLayout={event => {
            // Read the height now: the event is not kept for the state update.
            const height = event.nativeEvent.layout.height;
            setSize(current => ({ ...current, bottom: height }));
          }}
        >
          {notes}
          {music}
          {onMap ? (
            <View style={styles.summary} accessibilityLabel="지도 요약">
              {mapSummary.map(item => (
                <View key={item.label} style={styles.summaryItem}>
                  <View style={styles.summaryLine}>
                    <AppText
                      style={[
                        styles.summaryValue,
                        item.label === '운동 시간' &&
                          paused &&
                          styles.timePaused,
                      ]}
                      accessibilityLabel={item.label}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {item.value}
                    </AppText>
                    {item.unit ? (
                      <AppText style={styles.summaryUnit}>{item.unit}</AppText>
                    ) : null}
                  </View>
                  <AppText style={styles.timeLabel}>{item.label}</AppText>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.time}>
              <AppText style={styles.timeLabel}>
                운동 시간 · 일시정지 제외
              </AppText>
              <AppText
                style={[styles.timeValue, paused && styles.timePaused]}
                accessibilityLabel="운동 시간"
              >
                {formatDuration(elapsedSec)}
              </AppText>
            </View>
          )}
          {controls}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: liveLook.ground },
  layout: { flex: 1 },
  flex: { flex: 1 },
  band: { backgroundColor: liveLook.band },
  header: { paddingHorizontal: 20, paddingBottom: 8, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleRowMap: { alignItems: 'flex-start' },
  titleBox: { flex: 1, gap: 4 },
  floating: {
    flex: 0,
    flexShrink: 1,
    gap: 2,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: liveLook.band,
  },
  // A long course name shrinks with an ellipsis; the status keeps its room.
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 24,
    color: liveLook.text,
  },
  status: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: liveLook.button,
  },
  statusFloating: { backgroundColor: liveLook.band, marginLeft: 'auto' },
  statusPaused: { backgroundColor: 'rgba(212, 74, 74, 0.18)' },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7FD6A4',
  },
  statusDotPaused: { backgroundColor: liveLook.paused },
  statusDotWaiting: { backgroundColor: liveLook.muted },
  statusText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.text,
  },
  device: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  middle: { flex: 1, marginTop: 4 },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tabOn: { backgroundColor: liveLook.button },
  tabText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  tabTextOn: { color: liveLook.text },
  bottom: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  time: { alignItems: 'center' },
  timeLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  timeValue: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 44,
    lineHeight: 52,
    color: liveLook.text,
    fontVariant: ['tabular-nums'],
  },
  timePaused: { color: liveLook.paused },
  summary: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  summaryItem: { flex: 1 },
  summaryLine: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  summaryValue: {
    flexShrink: 1,
    fontFamily: fontFamily.numberMedium,
    fontSize: 30,
    lineHeight: 38,
    color: liveLook.text,
    fontVariant: ['tabular-nums'],
  },
  summaryUnit: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.muted,
  },
});
