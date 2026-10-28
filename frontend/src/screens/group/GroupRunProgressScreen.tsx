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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Icon, Segmented } from '../../components';
import {
  useRepositories,
  type GroupRunLive,
  type MusicState,
} from '../../data';
import { formatPace } from '../../format';
import { walkAlong, routeLengthM } from '../../geo';
import { navigateTo } from '../../navigation/navigateTo';
import {
  palette,
  radius,
  size,
  spacing,
  typography,
  useTheme,
} from '../../theme';
import { MockMap } from '../run/MockMap';
import { MiniPlayer, PaceBar } from '../run/RunProgressScreen';
import { useRunSession } from '../run/RunSession';

type Tab = 'pace' | 'position';

const tabs: { value: Tab; label: string }[] = [
  { value: 'pace', label: '페이스' },
  { value: 'position', label: '위치·간격' },
];
const memberColors = [
  palette.coral,
  palette.lavender,
  palette.periwinkle,
  palette.pale,
];

function LoadAlert({
  alert,
}: {
  alert: NonNullable<GroupRunLive['loadAlert']>;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLiveRegion="assertive"
      style={[
        styles.alert,
        {
          backgroundColor: colors.dangerSurface,
          borderColor: colors.dangerBorder,
        },
      ]}
    >
      <View style={[styles.alertIcon, { borderColor: colors.dangerBorder }]}>
        <Icon name="heart" color={colors.danger} size={18} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" tone="danger">
          {`멤버 ${alert.memberCount}명 부담 ↑`}
        </AppText>
        <AppText variant="caption" tone="textSecondary">
          {`1분 뒤 그룹 페이스를 ${formatPace(
            alert.nextPaceSecPerKm,
          )}로 늦춰요`}
        </AppText>
      </View>
    </View>
  );
}

function PositionList({
  live,
  myPace,
}: {
  live: GroupRunLive;
  myPace: number | null;
}) {
  const { colors } = useTheme();
  const rows = [...live.members].sort((a, b) => b.gapM - a.gapM);
  return (
    <View
      style={[
        styles.list,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.rowBetween}>
        <AppText variant="label" tone="textTertiary">
          앞에서부터 · 순위 아님
        </AppText>
        <AppText variant="label" tone="textTertiary">
          나와의 거리 · 페이스
        </AppText>
      </View>
      {rows.map((member, index) => {
        const role =
          index === 0 ? '선두' : index === rows.length - 1 ? '후미' : '';
        const pace = member.isMe ? myPace : member.paceSecPerKm;
        return (
          <View
            key={member.userId}
            style={[
              styles.listRow,
              index > 0 && {
                borderTopColor: colors.border,
                borderTopWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <AppText variant="label" tone="textTertiary" style={styles.role}>
              {role}
            </AppText>
            <View style={[styles.flex, styles.nameLine]}>
              <AppText variant="bodyStrong">{member.nickname}</AppText>
              {member.isMe ? (
                <View
                  style={[styles.meBadge, { backgroundColor: colors.accent }]}
                >
                  <AppText
                    variant="labelStrong"
                    style={{ color: colors.onAccent }}
                  >
                    나
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText
              variant="metricSmall"
              tone="textSecondary"
              style={styles.gap}
            >
              {member.isMe
                ? '–'
                : `${member.gapM > 0 ? '↑' : '↓'} ${Math.abs(member.gapM)}m`}
            </AppText>
            <AppText variant="metricSmall" style={styles.listPace}>
              {pace ? formatPace(pace) : '– –'}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

// 6.6 그룹런 진행 (6.6b 멤버 부담 알림, 6.6r 위치·간격): like 4.2 with the other members on the map.
export function GroupRunProgressScreen({
  initialTab = 'pace',
}: {
  initialTab?: Tab;
}) {
  const navigation = useNavigation();
  const { colors, name } = useTheme();
  const { groupRuns, music } = useRepositories();
  const { run, start, pause, resume } = useRunSession();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [live, setLive] = useState<GroupRunLive | null>(null);
  const [player, setPlayer] = useState<MusicState | null>(null);
  const night = name === 'dark';
  const groupRunId = run?.config.groupRunId ?? 'gr-today';

  // Opened without a run: start a group run without a course.
  useEffect(() => {
    if (!run) {
      start({
        mode: 'GROUP',
        plan: null,
        groupRunId,
        goalDistanceM: null,
        goalPaceSecPerKm: 360,
      });
    }
  }, [groupRunId, run, start]);
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
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]} />
    );
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
          .map((member, index) => {
            const along = walkAlong(
              route,
              (((sample.distanceM + member.gapM) % lap) + lap) % lap,
            );
            return {
              position: along[along.length - 1],
              label: member.nickname,
              color: memberColors[index % memberColors.length],
            };
          })
      : undefined;
  const fade = night ? colors.background : palette.white;
  const showPlayer =
    player?.source && player.source !== 'NONE' && player.linked;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <MockMap
        night={night}
        route={route}
        trail={trail.length > 0 ? trail : undefined}
        markers={markers}
        routeArea={
          tab === 'pace' ? { top: 200, bottom: 400 } : { top: 170, bottom: 330 }
        }
      />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="groupFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={fade} stopOpacity={0.4} />
            <Stop offset="0.18" stopColor={fade} stopOpacity={0} />
            <Stop offset="0.48" stopColor={fade} stopOpacity={0} />
            <Stop offset="0.62" stopColor={fade} stopOpacity={0.9} />
            <Stop offset="1" stopColor={fade} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#groupFade)" />
      </Svg>
      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        <View style={styles.top}>
          {live?.loadAlert ? <LoadAlert alert={live.loadAlert} /> : null}
          <View style={styles.titleRow}>
            <View style={[styles.dot, { backgroundColor: colors.accent }]} />
            <AppText variant="label" tone="textSecondary">
              {`${config.plan ? `${config.plan.name} · ` : ''}그룹런 ${
                live?.members.length ?? 1
              }명`}
            </AppText>
          </View>
          <View style={styles.center}>
            <Segmented compact options={tabs} value={tab} onChange={setTab} />
          </View>
          {live ? (
            <AppText
              variant="caption"
              tone={live.inRange ? 'textSecondary' : 'danger'}
              style={styles.rangeText}
            >
              {live.inRange
                ? '그룹 범위 안이에요 · 선두–후미 '
                : '그룹 범위를 벗어났어요 · 선두–후미 '}
              <AppText variant="captionStrong" tone="accentText">
                {`${live.spreadM}m`}
              </AppText>
            </AppText>
          ) : null}
        </View>
        <View style={styles.bottom}>
          {tab === 'pace' ? (
            <>
              <AppText variant="caption" tone="textSecondary">
                내 페이스
              </AppText>
              <AppText style={styles.pace} accessibilityLabel="내 페이스">
                {sample.paceSecPerKm === null
                  ? '– –'
                  : formatPace(sample.paceSecPerKm)}
              </AppText>
              <AppText variant="caption" tone="textTertiary">
                /km
              </AppText>
              <PaceBar
                pace={sample.paceSecPerKm}
                goal={guide}
                goalLabel={guide === goal ? '공동 목표' : '지금 안내'}
              />
              {guide !== goal ? (
                <AppText variant="label" tone="textTertiary">
                  {`지금 안내 ${formatPace(guide)} · 출발 목표 ${formatPace(
                    goal,
                  )}`}
                </AppText>
              ) : null}
            </>
          ) : live ? (
            <PositionList live={live} myPace={sample.paceSecPerKm} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="일시정지"
            onPress={openPause}
            style={({ pressed }) => [
              styles.pause,
              { backgroundColor: colors.accent },
              pressed && styles.pressed,
            ]}
          >
            <Icon name="pause" color={colors.onAccent} size={24} />
          </Pressable>
          {showPlayer && player && tab === 'pace' ? (
            <MiniPlayer music={player} />
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

// 6.6r opens the same screen on the 위치·간격 tab.
export function GroupRunPositionScreen() {
  return <GroupRunProgressScreen initialTab="position" />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  layout: { flex: 1, justifyContent: 'space-between' },
  top: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  center: { alignItems: 'center' },
  rangeText: { textAlign: 'center' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  pace: { ...typography.metricHero, fontSize: 72, lineHeight: 80 },
  pause: {
    width: size.buttonLarge + 20,
    height: size.buttonLarge + 20,
    borderRadius: (size.buttonLarge + 20) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  pressed: { opacity: 0.8 },
  list: {
    alignSelf: 'stretch',
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  role: { width: 28 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meBadge: { paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  gap: { width: 72, textAlign: 'right' },
  listPace: { width: 52, textAlign: 'right' },
});
