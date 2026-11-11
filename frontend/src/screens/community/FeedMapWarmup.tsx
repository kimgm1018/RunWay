import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RunMap } from '../../components/RunMap';
import type { LngLat } from '../../geo';
import { feedPageTop } from './CommunityScreen';
import { feedMapArea } from './FeedPage';

// 커뮤니티 첫 지도 미리 데우기 (S15P31E105-665). The first Naver map an app run makes waits for the map SDK to
// start (about 1 s) and then for its first tiles (about 1.7 s), so the first post on 7.1 stood dark, then
// gridded. While the user is on another tab, the feed's first course is drawn once on a map hidden behind the
// tabs, with the same size, place and view as 7.1 draws it, and let go once it is shown and its tiles have had
// time to come. 7.1 then starts on a running SDK with those tiles in its cache.
//
// What it costs someone who never opens 커뮤니티: one native map for a few seconds once per app run, and the
// tiles of one course's area (what 7.1 would read on entering). It stops at once when 커뮤니티 opens, so the
// feed never holds it alongside its own maps.

// Lets the tab the app opens on draw first.
const startAfterMs = 1000;
// After the camera rests, the time the tiles in view get to arrive.
const tilesMs = 2500;
// Let go however it went, so a map that never says it is shown does not stay.
const longestMs = 8000;

// Once per app run: the SDK stays started and the tiles cached after the first.
let warmed = false;

export function resetFeedMapWarmup() {
  warmed = false;
}

export function FeedMapWarmup({
  course,
  stop,
}: {
  // The course the feed's first real map will draw; null while unknown or when there is none.
  course: Promise<LngLat[] | null> | null;
  // 커뮤니티 is open: its own map takes over.
  stop: boolean;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<LngLat[] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(warmed);

  useEffect(() => {
    if (!course || done || stop) {
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    course.then(found => {
      if (!live) {
        return;
      }
      if (!found) {
        setDone(true);
        return;
      }
      timer = setTimeout(() => {
        warmed = true;
        setRoute(found);
      }, startAfterMs);
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [course, done, stop]);

  const drawing = route !== null && !done && !stop;
  useEffect(() => {
    if (!drawing) {
      return;
    }
    const timer = setTimeout(() => setDone(true), shown ? tilesMs : longestMs);
    return () => clearTimeout(timer);
  }, [drawing, shown]);

  // Opening 커뮤니티 ends the warm-up for this run, drawn or not.
  useEffect(() => {
    if (stop) {
      warmed = true;
      setDone(true);
    }
  }, [stop]);

  if (!drawing || !route) {
    return null;
  }
  return (
    <View
      testID="feed-map-warmup"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.behind, { width: window.width, height: window.height }]}
    >
      <RunMap
        route={route}
        view="lean"
        interactive={false}
        area={feedMapArea(feedPageTop(insets.top), window.height)}
        style={StyleSheet.absoluteFill}
        onShown={() => setShown(true)}
      />
    </View>
  );
}

// Under the tab screens, which cover it.
const styles = StyleSheet.create({
  behind: { position: 'absolute', left: 0, top: 0 },
});
