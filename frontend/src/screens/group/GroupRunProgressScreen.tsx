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
import { AppText, Card, Icon, Segmented } from '../../components';
import {
  useRepositories,
  type GroupRunLive,
  type MusicState,
} from '../../data';
import { formatPace } from '../../format';
import { walkAlong, routeLengthM } from '../../geo';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, size, spacing, useTheme } from '../../theme';
import { MockMap } from '../run/MockMap';
import { MiniPlayer, PaceBar } from '../run/RunProgressScreen';
import { useRunSession } from '../run/RunSession';

type Tab = 'pace' | 'position';

const tabs: { value: Tab; label: string }[] = [
  { value: 'pace', label: '페이스' },
  { value: 'position', label: '위치·간격' },
];
// The color bar on each member's tag (DESIGN.md 2-10 진행).
const memberColors = [k1.coral, '#A5B6C8', k1.ice, k1.light];

function LoadAlert({
  alert,
}: {
  alert: NonNullable<GroupRunLive['loadAlert']>;
}) {
  // A dark glass banner with a coral 60% rim; the coming pace is the white part (DESIGN.md 2-10 6.6b).
  return (
    <Card variant="deep" style={styles.alert}>
      <View accessibilityLiveRegion="assertive" style={styles.alertRow}>
        <View style={styles.alertIcon}>
          <Icon name="heart" color={k1.coral} size={18} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong" style={styles.coral}>
            {`멤버 ${alert.memberCount}명 부담 ↑`}
          </AppText>
          <AppText variant="caption" tone="textSecondary">
            {'1분 뒤 그룹 페이스를 '}
            <AppText variant="captionStrong">
              {formatPace(alert.nextPaceSecPerKm)}
            </AppText>
            로 늦춰요
          </AppText>
        </View>
      </View>
    </Card>
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
  // A dark glass table: 선두·후미 labels, names, distance from me and pace (DESIGN.md 2-10 6.6r).
  return (
    <Card variant="deep" style={styles.list}>
      <PositionRows rows={rows} myPace={myPace} />
    </Card>
  );
}

function PositionRows({
  rows,
  myPace,
}: {
  rows: GroupRunLive['members'];
  myPace: number | null;
}) {
  const { colors } = useTheme();
  return (
    <>
      <View style={styles.listHead}>
        <AppText variant="label" tone="textSecondary" style={styles.flex}>
          앞에서부터 · 순위 아님
        </AppText>
        <AppText variant="label" tone="textSecondary" style={styles.gap}>
          나와의 거리
        </AppText>
        <AppText variant="label" tone="textSecondary" style={styles.listPace}>
          페이스
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
            <AppText variant="label" tone="textSecondary" style={styles.role}>
              {role}
            </AppText>
            <View style={[styles.flex, styles.nameLine]}>
              <AppText variant="bodyMedium">{member.nickname}</AppText>
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
            <AppText tone="textSecondary" style={[styles.number, styles.gap]}>
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

// 6.6 그룹런 진행 (6.6b 멤버 부담 알림, 6.6r 위치·간격): like 4.2 with the other members on the map.
export function GroupRunProgressScreen({
  initialTab = 'pace',
}: {
  initialTab?: Tab;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { groupRuns, music } = useRepositories();
  const { run, start, pause, resume } = useRunSession();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [live, setLive] = useState<GroupRunLive | null>(null);
  const [player, setPlayer] = useState<MusicState | null>(null);
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
  const showPlayer =
    player?.source && player.source !== 'NONE' && player.linked;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      {/* The whole screen is the K1 dark map, day and night (DESIGN.md 2-10 진행). */}
      <MockMap
        k1Style
        night
        route={route}
        trail={trail.length > 0 ? trail : undefined}
        markers={markers}
        routeArea={
          tab === 'pace' ? { top: 200, bottom: 400 } : { top: 170, bottom: 330 }
        }
      />
      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        <View style={styles.top}>
          {live?.loadAlert ? <LoadAlert alert={live.loadAlert} /> : null}
          {/* Status chip: dark pill, coral dot (DESIGN.md 2-7 상태 칩). */}
          <View style={styles.chip}>
            <View style={styles.dot} />
            <AppText variant="labelStrong">
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
              <AppText style={styles.spread}>{`${live.spreadM}m`}</AppText>
            </AppText>
          ) : null}
        </View>
        <View style={styles.bottom}>
          {tab === 'pace' ? (
            // 내 페이스 on the vignette card, as on 4.2.
            <Card variant="vignette" style={styles.paceCard}>
              <AppText variant="caption" tone="textSecondary">
                내 페이스
              </AppText>
              <AppText style={styles.pace} accessibilityLabel="내 페이스">
                {sample.paceSecPerKm === null
                  ? '– –'
                  : formatPace(sample.paceSecPerKm)}
              </AppText>
              <AppText variant="caption" tone="textSecondary">
                /km
              </AppText>
              <PaceBar
                pace={sample.paceSecPerKm}
                goal={guide}
                goalLabel={guide === goal ? '공동 목표' : '지금 안내'}
              />
              {guide !== goal ? (
                <AppText variant="label" tone="textSecondary">
                  {`지금 안내 ${formatPace(guide)} · 출발 목표 ${formatPace(
                    goal,
                  )}`}
                </AppText>
              ) : null}
            </Card>
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
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  chip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(2,5,14,0.72)',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: k1.coral },
  center: { alignItems: 'center' },
  rangeText: { textAlign: 'center' },
  spread: { fontFamily: fontFamily.numberSemiBold, fontSize: 14 },
  alert: { borderColor: 'rgba(226,135,111,0.6)', paddingVertical: 14 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(226,135,111,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coral: { color: k1.coral },
  bottom: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  paceCard: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs },
  // Big numbers stay Barlow Regular at the sheet's 64.
  pace: { fontFamily: fontFamily.numberRegular, fontSize: 64, lineHeight: 72 },
  pause: {
    width: size.buttonLarge + 8,
    height: size.buttonLarge + 8,
    borderRadius: (size.buttonLarge + 8) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  list: { alignSelf: 'stretch', gap: spacing.xs, paddingVertical: 14 },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: 28 + spacing.md,
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
  meBadge: { paddingHorizontal: spacing.md, borderRadius: 999 },
  number: { fontFamily: fontFamily.numberMedium, fontSize: 15 },
  gap: { width: 76, textAlign: 'right' },
  listPace: { width: 56, textAlign: 'right' },
});
