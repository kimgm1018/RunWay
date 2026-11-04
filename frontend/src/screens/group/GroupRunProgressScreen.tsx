import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { AppText, Icon, LightGlass } from '../../components';
import {
  useRepositories,
  type GroupRunLive,
  type MusicState,
} from '../../data';
import { formatPace } from '../../format';
import { walkAlong, routeLengthM, type LngLat } from '../../geo';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { fontFamily, k1, spacing, ThemeProvider } from '../../theme';
import { courseMapSize } from '../run/courseMapArt';
import { coursePaceColors, CourseMockMap } from '../run/CourseMockMap';
import { MiniPlayer, PaceBar } from '../run/RunProgressScreen';
import { useRunSession } from '../run/RunSession';
import { groupLook, Raised } from './look';

type Tab = 'pace' | 'position';

const tabs: { value: Tab; label: string }[] = [
  { value: 'pace', label: '페이스' },
  { value: 'position', label: '위치·간격' },
];
// The other members on the light map (6.6r-MapView): steel blue dots with their names.
const memberDot = '#5D8194';

// Where the run sits on the 390×844 light map: the course before the first metres, then the run so far,
// both above the info under the scrim (as MockMap places them on 4.2 by day).
const courseArea = { top: 160, bottom: 470 };
const runArea = { top: 330, bottom: 470 };

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Fits points into an area of the light map, the way MockMap does for its day map.
function projector(points: LngLat[], area: { top: number; bottom: number }) {
  const lngs = points.map(point => point[0]);
  const lats = points.map(point => point[1]);
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const midLat = (minLat + maxLat) / 2;
  const spanX = Math.max((maxLng - minLng) * Math.cos(toRadians(midLat)), 1e-4);
  const spanY = Math.max(maxLat - minLat, 1e-4);
  const box = { left: 50, right: courseMapSize.width - 50, ...area };
  const scale = Math.min(
    (box.right - box.left) / spanX,
    (box.bottom - box.top) / spanY,
  );
  const offsetX = (box.left + box.right) / 2;
  const offsetY = (box.top + box.bottom) / 2;
  const midLng = (minLng + maxLng) / 2;
  return ([lng, lat]: LngLat) => ({
    x: offsetX + (lng - midLng) * Math.cos(toRadians(midLat)) * scale,
    y: offsetY - (lat - midLat) * scale,
  });
}

type Marker = { position: LngLat; label: string };

// 6.6 · 6.6r map (runway-group-handoff): the light thin-line map of 2.0, the run so far as the black hollow
// line, the other members as dots with their names, and the #f3f5f6 scrim under the info.
function GroupMap({
  route,
  trail,
  markers,
}: {
  route?: LngLat[];
  trail?: LngLat[];
  markers?: Marker[];
}) {
  const running = !!trail && trail.length > 0;
  const points = [...(route ?? []), ...(trail ?? [])];
  const project =
    points.length > 0
      ? projector(points, running ? runArea : courseArea)
      : () => ({ x: courseMapSize.width / 2, y: 400 });
  const { width, height } = courseMapSize;
  return (
    <>
      <CourseMockMap
        project={project}
        parts={route ? [route] : []}
        colors={[coursePaceColors[2]]}
        paceLabels={null}
        trail={running ? trail : undefined}
      />
      {markers && markers.length > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid slice"
          >
            {markers.map(marker => {
              const at = project(marker.position);
              return (
                <React.Fragment key={marker.label}>
                  <Circle
                    cx={at.x}
                    cy={at.y}
                    r={6}
                    fill={memberDot}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                  />
                  {/* A light halo first, then the name, so it reads over the streets. */}
                  <SvgText
                    x={at.x + 13}
                    y={at.y + 4}
                    fontSize={11}
                    fontWeight="700"
                    fill="#F3F5F6"
                    stroke="#F3F5F6"
                    strokeWidth={3}
                  >
                    {marker.label}
                  </SvgText>
                  <SvgText
                    x={at.x + 13}
                    y={at.y + 4}
                    fontSize={11}
                    fontWeight="700"
                    fill={groupLook.onLight}
                  >
                    {marker.label}
                  </SvgText>
                </React.Fragment>
              );
            })}
          </Svg>
        </View>
      ) : null}
    </>
  );
}

// The #f3f5f6 cover over the lower map, fading in, so the info reads on a plain light ground.
function Scrim() {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  return (
    <View
      style={styles.scrim}
      pointerEvents="none"
      onLayout={event => setBox(event.nativeEvent.layout)}
    >
      {box ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <LinearGradient id="groupRunScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#F3F5F6" stopOpacity={0} />
              <Stop offset="0.22" stopColor="#F3F5F6" stopOpacity={1} />
              <Stop offset="1" stopColor="#F3F5F6" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect
            width={box.width}
            height={box.height}
            fill="url(#groupRunScrim)"
          />
        </Svg>
      ) : null}
    </View>
  );
}

// 페이스 · 위치·간격: a light glass track with the picked tab a raised navy pill (6.6-ModeTabs).
function ModeTabs({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <LightGlass radius={16} style={styles.tabs} accessibilityRole="radiogroup">
      {tabs.map(option => {
        const selected = option.value === value;
        const label = (
          <AppText style={[styles.tabText, selected && styles.tabTextOn]}>
            {option.label}
          </AppText>
        );
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={styles.tab}
          >
            {selected ? (
              <Raised tone="navy" style={styles.tabOn}>
                {label}
              </Raised>
            ) : (
              label
            )}
          </Pressable>
        );
      })}
    </LightGlass>
  );
}

function LoadAlert({
  alert,
}: {
  alert: NonNullable<GroupRunLive['loadAlert']>;
}) {
  // A light glass banner with a coral rim; the coming pace is the bold part.
  return (
    <LightGlass radius={20} style={styles.alert}>
      <View accessibilityLiveRegion="assertive" style={styles.alertRow}>
        <View style={styles.alertIcon}>
          <Icon name="heart" color={k1.coral} size={18} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.alertTitle}>
            {`멤버 ${alert.memberCount}명 부담 ↑`}
          </AppText>
          <AppText style={styles.sub}>
            {'1분 뒤 그룹 페이스를 '}
            <AppText style={styles.subStrong}>
              {formatPace(alert.nextPaceSecPerKm)}
            </AppText>
            로 늦춰요
          </AppText>
        </View>
      </View>
    </LightGlass>
  );
}

function PositionList({
  live,
  myPace,
}: {
  live: GroupRunLive;
  myPace: number | null;
}) {
  const rows = [...live.members].sort((a, b) => b.gapM - a.gapM);
  // On the scrim without a card or dividers: 선두·후미 labels, names, distance from me and pace (6.6r).
  return (
    <View style={styles.list}>
      <PositionRows rows={rows} myPace={myPace} />
    </View>
  );
}

function PositionRows({
  rows,
  myPace,
}: {
  rows: GroupRunLive['members'];
  myPace: number | null;
}) {
  return (
    <>
      <View style={styles.listHead}>
        <AppText style={[styles.headText, styles.flex]}>
          앞에서부터 · 순위 아님
        </AppText>
        <AppText style={[styles.headText, styles.gap]}>나와의 거리</AppText>
        <AppText style={[styles.headText, styles.listPace]}>페이스</AppText>
      </View>
      {rows.map((member, index) => {
        const role =
          index === 0 ? '선두' : index === rows.length - 1 ? '후미' : '';
        const pace = member.isMe ? myPace : member.paceSecPerKm;
        return (
          <View key={member.userId} style={styles.listRow}>
            <AppText style={styles.role}>{role}</AppText>
            <View style={[styles.flex, styles.nameLine]}>
              <AppText style={styles.name}>{member.nickname}</AppText>
              {member.isMe ? (
                <Raised tone="navy" style={styles.meBadge}>
                  <AppText style={styles.meText}>나</AppText>
                </Raised>
              ) : null}
            </View>
            <AppText style={[styles.gapText, styles.gap]}>
              {member.isMe
                ? '–'
                : `${member.gapM > 0 ? '↑' : '↓'} ${Math.abs(member.gapM)}m`}
            </AppText>
            <AppText style={[styles.number, styles.listPace]}>
              {pace ? formatPace(pace) : '– –'}
            </AppText>
          </View>
        );
      })}
    </>
  );
}

// 6.6 그룹런 진행 (6.6b 멤버 부담 알림, 6.6r 위치·간격): the light map of runway-group-handoff with the other
// members on it, and my pace or the members' gaps on the scrim below.
export function GroupRunProgressScreen({
  initialTab = 'pace',
}: {
  initialTab?: Tab;
}) {
  const navigation = useNavigation();
  const { groupRuns, music } = useRepositories();
  const { run, start, pause, resume } = useRunSession();
  const { ensureRunLogin } = useSession();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [live, setLive] = useState<GroupRunLive | null>(null);
  const [player, setPlayer] = useState<MusicState | null>(null);
  const groupRunId = run?.config.groupRunId ?? 'gr-today';

  // Opened without a run: start a group run without a course.
  useEffect(() => {
    if (!run) {
      if (!ensureRunLogin()) {
        return;
      }
      start({
        mode: 'GROUP',
        plan: null,
        groupRunId,
        goalDistanceM: null,
        goalPaceSecPerKm: 360,
      });
    }
  }, [groupRunId, run, start, ensureRunLogin]);
  useEffect(
    () => groupRuns.watchLive(groupRunId, setLive),
    [groupRunId, groupRuns],
  );
  useEffect(() => {
    let active = true;
    music.getState().then(
      state => active && setPlayer(state),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [music]);

  const status = useRef(run?.status);
  status.current = run?.status;
  const latest = useRef({ pause, resume });
  latest.current = { pause, resume };
  const openPause = useCallback(() => {
    latest.current.pause();
    navigateTo(navigation, 'GroupRunPause');
  }, [navigation]);
  useFocusEffect(
    useCallback(() => {
      if (status.current === 'paused') {
        latest.current.resume();
      }
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        openPause();
        return true;
      });
      return () => back.remove();
    }, [openPause]),
  );

  if (!run) {
    return <View style={[styles.root, styles.mapGround]} />;
  }
  const { config, sample, trail } = run;
  const route = config.plan?.route;
  const goal = config.goalPaceSecPerKm ?? 360;
  const guide = live?.guidePaceSecPerKm ?? goal;
  const lap = route ? routeLengthM(route) : 0;
  const markers =
    route && live
      ? live.members
          .filter(member => !member.isMe)
          .map(member => {
            const along = walkAlong(
              route,
              (((sample.distanceM + member.gapM) % lap) + lap) % lap,
            );
            return {
              position: along[along.length - 1],
              label: member.nickname,
            };
          })
      : undefined;
  const showPlayer =
    player?.source && player.source !== 'NONE' && player.linked;

  return (
    // The map is light day and night here (runway-group-handoff), so the screen takes the light theme.
    <ThemeProvider tone="light">
      <View style={[styles.root, styles.mapGround]}>
        <StatusBar barStyle="dark-content" />
        <GroupMap
          route={route}
          trail={trail.length > 0 ? trail : undefined}
          markers={markers}
        />
        <Scrim />
        <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
          <View style={styles.top}>
            {live?.loadAlert ? <LoadAlert alert={live.loadAlert} /> : null}
            {/* 6.6-StatusPill: a light glass pill with a navy dot. */}
            <LightGlass radius={14} style={styles.chip}>
              <View style={styles.dot} />
              <AppText style={styles.chipText}>
                {`${config.plan ? `${config.plan.name} · ` : ''}그룹런 ${
                  live?.members.length ?? 1
                }명`}
              </AppText>
            </LightGlass>
            <ModeTabs value={tab} onChange={setTab} />
            {live ? (
              <LightGlass radius={14} style={styles.range}>
                <AppText
                  style={[styles.rangeText, !live.inRange && styles.outOfRange]}
                >
                  {live.inRange
                    ? '그룹 범위 안이에요 · 선두–후미 '
                    : '그룹 범위를 벗어났어요 · 선두–후미 '}
                  <AppText style={styles.spread}>{`${live.spreadM}m`}</AppText>
                </AppText>
              </LightGlass>
            ) : null}
          </View>
          <View style={styles.bottom}>
            {tab === 'pace' ? (
              // 6.6-PacePanel: 내 페이스 on the scrim, no card.
              <View style={styles.pacePanel}>
                <View style={styles.paceHead}>
                  <View style={styles.dot} />
                  <AppText style={styles.paceLabel}>내 페이스</AppText>
                </View>
                <View style={styles.paceLine}>
                  <AppText style={styles.pace} accessibilityLabel="내 페이스">
                    {sample.paceSecPerKm === null
                      ? '– –'
                      : formatPace(sample.paceSecPerKm)}
                  </AppText>
                  <AppText style={styles.paceUnit}>/km</AppText>
                </View>
                <PaceBar
                  pace={sample.paceSecPerKm}
                  goal={guide}
                  goalLabel={guide === goal ? '공동 목표' : '지금 안내'}
                />
                {guide !== goal ? (
                  <AppText style={styles.guide}>
                    {`지금 안내 ${formatPace(guide)} · 출발 목표 ${formatPace(
                      goal,
                    )}`}
                  </AppText>
                ) : null}
              </View>
            ) : live ? (
              <PositionList live={live} myPace={sample.paceSecPerKm} />
            ) : null}
            {showPlayer && player && tab === 'pace' ? (
              <View style={styles.player}>
                <MiniPlayer music={player} />
              </View>
            ) : null}
            {/* 6.6-PauseButton: a raised navy circle of 64. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="일시정지"
              onPress={openPause}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Raised tone="navy" style={styles.pause}>
                <Icon name="pause" color={groupLook.onDark} size={24} />
              </Raised>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </ThemeProvider>
  );
}

// 6.6r opens the same screen on the 위치·간격 tab.
export function GroupRunPositionScreen() {
  return <GroupRunProgressScreen initialTab="position" />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  mapGround: { backgroundColor: groupLook.mapBackground },
  // From a little above the middle down; the info sits on the plain part.
  scrim: { position: 'absolute', left: 0, right: 0, top: '50%', bottom: 0 },
  layout: { flex: 1, justifyContent: 'space-between' },
  top: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: groupLook.onLight,
  },
  chipText: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupLook.onLight,
  },
  // 6.6-ModeTabs: 136 × 32.
  tabs: { flexDirection: 'row', height: 32, padding: 2, gap: 2 },
  tab: {
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: {
    alignSelf: 'stretch',
    flex: 1,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    paddingHorizontal: 10,
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: groupLook.onLightSub2,
  },
  tabTextOn: { paddingHorizontal: 0, color: groupLook.onDark },
  range: { height: 28, paddingHorizontal: 12, justifyContent: 'center' },
  rangeText: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupLook.onLightSub,
  },
  outOfRange: { color: k1.coralText },
  spread: {
    fontFamily: fontFamily.numberBold,
    fontSize: 13,
    color: groupLook.onLight,
  },
  alert: {
    alignSelf: 'stretch',
    borderColor: 'rgba(226,135,111,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(226,135,111,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: k1.coralText,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupLook.onLightSub,
  },
  subStrong: { fontFamily: fontFamily.bold, color: groupLook.onLight },
  bottom: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  pacePanel: { alignSelf: 'stretch', paddingHorizontal: 6, gap: 6 },
  paceHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paceLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLight,
  },
  paceLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  // Big numbers stay Barlow Regular at the sheet's 64.
  pace: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 64,
    lineHeight: 72,
    color: groupLook.onLight,
  },
  paceUnit: {
    marginBottom: 12,
    fontFamily: fontFamily.numberMedium,
    fontSize: 14,
    color: groupLook.onLightSub2,
  },
  guide: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLightSub,
  },
  player: { alignSelf: 'stretch' },
  pause: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.97 }] },
  // 6.6r-MemberGapList: on the scrim, no card or dividers.
  list: { alignSelf: 'stretch', paddingHorizontal: 6 },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: 28 + spacing.md,
    marginBottom: spacing.xs,
  },
  headText: {
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 15,
    color: groupLook.onLightSub2,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    gap: spacing.md,
  },
  role: {
    width: 28,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLightSub2,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.onLight,
  },
  meBadge: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    justifyContent: 'center',
  },
  meText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: groupLook.onDark,
  },
  gapText: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 14,
    color: groupLook.onLightSub,
  },
  number: {
    fontFamily: fontFamily.numberBold,
    fontSize: 15,
    color: groupLook.onLight,
  },
  gap: { width: 76, textAlign: 'right' },
  listPace: { width: 56, textAlign: 'right' },
});
