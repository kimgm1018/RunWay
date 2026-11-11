import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { AppText, Icon } from '../../components';
import { RunMap } from '../../components/RunMap';
import type { RunRoute } from '../../components/mapRoute';
import { useRepositories, type UserProfile } from '../../data';
import { formatKm, formatPace } from '../../format';
import type { LngLat } from '../../geo';
import { fontFamily } from '../../theme';
import { RouteReplay, type ReplayRun } from '../community/RouteReplay';

// My run's GPS route on the map with 경로 재생 (S15P31E105-690), shared by 4.5 러닝 결과 and the 5.1 record card. A
// run without a route worth drawing (indoors, no GPS) says so instead of showing an empty map.

// What the replay needs of my run besides its route.
export type RunRouteFacts = {
  id: string;
  title: string;
  startedAt: string;
  distanceM: number;
  durationSec: number;
  averagePaceSecPerKm: number | null;
  cadence: number | null;
};

// The replay's pin shows my avatar; until my profile is read (or when it cannot be) it shows 나.
function replayOf(
  facts: RunRouteFacts,
  route: RunRoute,
  me: UserProfile | null,
): ReplayRun {
  const pace =
    facts.averagePaceSecPerKm === null
      ? ''
      : ` · 평균 페이스 ${formatPace(facts.averagePaceSecPerKm)}/km`;
  return {
    key: facts.id,
    kind: '경로',
    title: facts.title,
    byline: `${formatKm(facts.distanceM)}km`,
    startedAt: facts.startedAt,
    shareMessage: `내 러닝 · ${facts.title} ${formatKm(
      facts.distanceM,
      1,
    )}km${pace}`,
    runner: {
      nickname: me?.nickname ?? '나',
      userId: me?.id ?? '',
      photo: me?.profileImageUrl ?? null,
      mine: true,
    },
    distanceM: facts.distanceM,
    durationSec: facts.durationSec,
    averagePaceSecPerKm: facts.averagePaceSecPerKm,
    cadence: facts.cadence,
    shape: [],
    parts: route.parts,
  };
}

// My profile is read only once the replay is asked for, so the map itself needs no data source.
function ReadMe({ onRead }: { onRead: (me: UserProfile) => void }) {
  const repositories = useRepositories();
  useEffect(() => {
    let active = true;
    repositories.profile.getMe().then(
      profile => {
        if (active) {
          onRead(profile);
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [onRead, repositories]);
  return null;
}

// The S · F poles stand above their points, so the frame keeps room over the run's northern edge: a point
// north of it by this share of the run's height (at least poleRoomM) is framed with the run.
const poleShare = 0.45;
const poleRoomM = 40;
const metresPerDegree = 111320;
export function frameOf(route: LngLat[]): LngLat[] {
  const lats = route.map(point => point[1]);
  const top = Math.max(...lats);
  const height = top - Math.min(...lats);
  const room = Math.max(height * poleShare, poleRoomM / metresPerDegree);
  return [...route, [route[0][0], top + room]];
}

export function RunRouteMap({
  route,
  facts,
  tone,
  style,
}: {
  route: RunRoute | null;
  facts: RunRouteFacts;
  // result: on 4.5's dark page; card: on 5.1's frost card. Both carry white text.
  tone: 'result' | 'card';
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<UserProfile | null>(null);
  const frame = useMemo(() => (route ? frameOf(route.route) : null), [route]);
  const run = useMemo(
    () => (route ? replayOf(facts, route, me) : null),
    [facts, route, me],
  );

  if (!route || !run) {
    return (
      <View
        style={[
          styles.box,
          styles.empty,
          tone === 'card' && styles.emptyCard,
          style,
        ]}
        accessible
        accessibilityLabel="경로 기록이 없어요. 실내에서 뛰었거나 GPS를 받지 못했어요"
      >
        <Icon name="route" color="rgba(255,255,255,0.7)" size={22} />
        <AppText style={styles.emptyTitle}>경로 기록이 없어요</AppText>
        <AppText style={styles.emptyText}>
          실내에서 뛰었거나 GPS를 받지 못했어요
        </AppText>
      </View>
    );
  }
  return (
    <View style={[styles.box, style]}>
      <RunMap
        route={route.route}
        routeParts={route.parts}
        // Framed on the run itself, so a short run is not lost in a kilometre of streets.
        fitTo={frame ?? route.route}
        interactive={false}
        mintLine
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="경로 재생"
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={({ pressed }) => [styles.play, pressed && styles.pressed]}
      >
        <Icon name="play" color="#FFFFFF" size={14} solid />
        <AppText style={styles.playText}>경로 재생</AppText>
      </Pressable>
      {open && !me ? <ReadMe onRead={setMe} /> : null}
      <RouteReplay run={run} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 18, overflow: 'hidden' },
  pressed: { opacity: 0.7 },
  play: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#02050E',
  },
  playText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: '#FFFFFF',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  emptyCard: { backgroundColor: 'rgba(255,255,255,0.12)' },
  emptyTitle: {
    marginTop: 4,
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: '#FFFFFF',
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.75)',
  },
});
