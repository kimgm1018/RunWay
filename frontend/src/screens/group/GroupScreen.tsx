import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop, EmptyState, Icon } from '../../components';
import {
  useRepositories,
  useResource,
  type GroupRunSummary,
  type MyCrew,
  type MyGroupRuns,
  type Repositories,
} from '../../data';
import { formatClockTime } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { radius, size, spacing, useTheme } from '../../theme';
import {
  canEnterRoom,
  dDay,
  formatSchedule,
  goalLine,
  InfoLine,
  startsIn,
  Tag,
  useGroupRunDraft,
} from './parts';

const loadMine = (repositories: Repositories, _version: number) =>
  repositories.groupRuns.listMine();

// 내 크루 · 크루 모집 (6.0 · 6.1). 크루 모집 is its own screen in the same tab.
export function GroupTabs({ active }: { active: 'mine' | 'recruit' }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const tab = (key: 'mine' | 'recruit', label: string) => {
    const selected = key === active;
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() =>
          !selected &&
          navigateTo(navigation, key === 'mine' ? 'MyCrews' : 'CrewRecruit')
        }
        style={styles.tab}
      >
        <View style={styles.tabLabel}>
          <AppText
            variant="heading"
            tone={selected ? 'text' : 'textTertiary'}
            style={styles.tabText}
          >
            {label}
          </AppText>
          {selected ? (
            <View style={[styles.tabDot, { backgroundColor: colors.accent }]} />
          ) : null}
        </View>
        <View
          style={[
            styles.tabLine,
            { backgroundColor: selected ? colors.accent : 'transparent' },
          ]}
        />
      </Pressable>
    );
  };
  return (
    <View style={[styles.tabs, { borderColor: colors.border }]}>
      {tab('mine', '내 크루')}
      {tab('recruit', '크루 모집')}
    </View>
  );
}

function UpcomingCard({ run }: { run: GroupRunSummary }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { clock } = useRepositories();
  const now = clock.now();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.title}, ${startsIn(run.scheduledAt, now)}`}
      onPress={() =>
        navigation.navigate('GroupRunDetail', { groupRunId: run.id })
      }
      style={[
        styles.upcoming,
        { backgroundColor: colors.surface, borderColor: colors.accent },
      ]}
    >
      <View style={styles.flex}>
        <View style={[styles.soonChip, { backgroundColor: colors.accent }]}>
          <View
            style={[styles.soonDot, { backgroundColor: colors.onAccent }]}
          />
          <AppText variant="labelStrong" style={{ color: colors.onAccent }}>
            {startsIn(run.scheduledAt, now)}
          </AppText>
        </View>
        <AppText variant="labelStrong" tone="accentText">
          {run.crewName}
        </AppText>
        <AppText variant="heading" numberOfLines={1}>
          {run.title}
        </AppText>
        <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
          {`${formatClockTime(run.scheduledAt)} · ${run.meetingPlaceName}`}
        </AppText>
      </View>
      {canEnterRoom(run, now) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="대기방 입장"
          onPress={() =>
            navigation.navigate('WaitingRoom', { groupRunId: run.id })
          }
          style={({ pressed }) => [
            styles.enter,
            { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <AppText variant="bodyStrong" style={{ color: colors.onAccent }}>
            대기방 입장
          </AppText>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function RunCard({
  run,
  onToggle,
}: {
  run: GroupRunSummary;
  onToggle: () => void;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { clock } = useRepositories();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.title}, ${formatSchedule(run.scheduledAt)}`}
      onPress={() =>
        navigation.navigate('GroupRunDetail', { groupRunId: run.id })
      }
      style={[
        styles.runCard,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
      ]}
    >
      <View style={styles.rowBetween}>
        <Tag label={dDay(run.scheduledAt, clock.now())} tone="muted" />
        <AppText variant="label" tone="textTertiary">
          {run.isHost ? '내가 만듦' : `${run.hostNickname}님이 만듦`}
        </AppText>
      </View>
      <AppText variant="heading">{run.title}</AppText>
      <View style={styles.lines}>
        <InfoLine icon="clock" value={formatSchedule(run.scheduledAt)} />
        <InfoLine icon="mapPin" value={run.meetingPlaceName} />
        <InfoLine icon="route" value={goalLine(run)} />
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.rowBetween}>
        <AppText variant="caption" tone="textSecondary">
          {`참가 ${run.participantCount}명`}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            run.joined ? `${run.title} 참가 취소` : `${run.title} 참가하기`
          }
          accessibilityState={{ selected: run.joined }}
          onPress={onToggle}
          hitSlop={6}
          style={({ pressed }) => [
            styles.joinButton,
            run.joined
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : { borderColor: colors.borderStrong },
            pressed && styles.pressed,
          ]}
        >
          {run.joined ? (
            <Icon name="check" color={colors.onAccent} size={13} />
          ) : null}
          <AppText
            variant="captionStrong"
            style={{ color: run.joined ? colors.onAccent : colors.text }}
          >
            {run.joined ? '참가 중' : '참가하기'}
          </AppText>
        </Pressable>
      </View>
    </Pressable>
  );
}

function CrewTile({ crew, faded = false }: { crew: MyCrew; faded?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.crewTile,
        { backgroundColor: colors.surfaceMuted, opacity: faded ? 0.5 : 1 },
      ]}
    >
      <AppText variant="heading">{crew.name.slice(0, 1)}</AppText>
    </View>
  );
}

function CrewPanel({
  crew,
  runs,
  initiallyOpen,
  onToggleJoin,
}: {
  crew: MyCrew;
  runs: GroupRunSummary[];
  initiallyOpen: boolean;
  onToggleJoin: (run: GroupRunSummary) => void;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  if (crew.membership === 'PENDING') {
    return (
      <View style={[styles.pending, { borderColor: colors.borderStrong }]}>
        <CrewTile crew={crew} faded />
        <View style={styles.flex}>
          <View style={styles.nameLine}>
            <AppText variant="heading" tone="textSecondary">
              {crew.name}
            </AppText>
            <Tag label="승인 대기" tone="outline" />
          </View>
          <AppText variant="caption" tone="textTertiary">
            {`${crew.area} · 크루장이 승인하면 그룹런이 보여요`}
          </AppText>
        </View>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.panelHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${crew.name} 크루 상세`}
          onPress={() => navigateTo(navigation, 'CrewDetail')}
          style={styles.crewName}
        >
          <CrewTile crew={crew} />
          <View style={styles.flex}>
            <AppText variant="heading" numberOfLines={1}>
              {`${crew.name}  ›`}
            </AppText>
            <AppText variant="caption" tone="textTertiary">
              {`${crew.area} · 멤버 ${crew.memberCount}`}
            </AppText>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? `${crew.name} 접기` : `${crew.name} 펴기`}
          onPress={() => setOpen(value => !value)}
          style={[styles.round, { backgroundColor: colors.surfaceMuted }]}
        >
          <Icon
            name={open ? 'chevronDown' : 'forward'}
            color={colors.text}
            size={16}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${crew.name} 그룹런 만들기`}
          onPress={() =>
            navigation.navigate('GroupRunCreate', { crewId: crew.id })
          }
          style={[styles.round, { backgroundColor: colors.surfaceMuted }]}
        >
          <Icon name="plus" color={colors.text} size={16} />
        </Pressable>
      </View>
      {open ? (
        runs.length ? (
          runs.map(run => (
            <RunCard
              key={run.id}
              run={run}
              onToggle={() => onToggleJoin(run)}
            />
          ))
        ) : (
          <AppText variant="caption" tone="textTertiary" style={styles.noRuns}>
            예정된 그룹런이 없어요. + 로 만들어 보세요.
          </AppText>
        )
      ) : null}
    </View>
  );
}

function NoCrews({ data }: { data: MyGroupRuns }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  return (
    <View style={styles.noCrews}>
      <Tag label="러닝 크루" tone="muted" />
      <AppText variant="display" numberOfLines={1} adjustsFontSizeToFit>
        혼자 달리던 길, 같이 달려 볼까요
      </AppText>
      <AppText variant="caption" tone="textSecondary">
        {`내 근처 3km에서 ${data.nearbyRecruiting.count}개 크루가 멤버를 찾고 있어요`}
      </AppText>
      <View
        style={[
          styles.recruitCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.recruitRow}>
          <View
            style={[styles.crewTile, { backgroundColor: colors.surfaceMuted }]}
          >
            <Icon name="mapPin" color={colors.accentText} size={18} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">
              {`내 근처 크루 ${data.nearbyRecruiting.count}곳이 모집 중`}
            </AppText>
            <AppText variant="caption" tone="textTertiary">
              {data.nearbyRecruiting.areas.join(' · ')}
            </AppText>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="크루 모집 보러 가기"
          onPress={() => navigateTo(navigation, 'CrewRecruit')}
          style={({ pressed }) => [
            styles.recruitButton,
            { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <AppText variant="button" style={{ color: colors.onAccent }}>
            크루 모집 보러 가기 ›
          </AppText>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="직접 만들기"
        onPress={() => navigateTo(navigation, 'CrewCreate')}
        style={styles.createLink}
      >
        <AppText variant="caption" tone="textSecondary">
          원하는 크루가 없다면{' '}
          <AppText variant="captionStrong" tone="accentText">
            직접 만들기
          </AppText>
        </AppText>
      </Pressable>
    </View>
  );
}

// 6.0 그룹 · 내 크루 (6.0b without crews): the next group run pinned on top, then each crew's runs.
export function GroupScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { groupRuns } = useRepositories();
  const { version } = useGroupRunDraft();
  // Reloads when 6.4 joins, leaves or cancels, or 6.8 makes a run.
  const mine = useResource(
    useCallback(
      (repositories: Repositories) => loadMine(repositories, version),
      [version],
    ),
  );
  // Join changes on this screen show at once.
  const [joined, setJoined] = useState<Record<string, boolean>>({});
  useEffect(() => setJoined({}), [version]);

  const toggle = async (run: GroupRunSummary) => {
    const next = !(joined[run.id] ?? run.joined);
    setJoined(current => ({ ...current, [run.id]: next }));
    try {
      await (next ? groupRuns.join(run.id) : groupRuns.leave(run.id));
    } catch {
      setJoined(current => ({ ...current, [run.id]: !next }));
    }
  };
  const withJoin = (run: GroupRunSummary): GroupRunSummary => {
    const isIn = joined[run.id] ?? run.joined;
    return {
      ...run,
      joined: isIn,
      participantCount:
        run.participantCount + (isIn === run.joined ? 0 : isIn ? 1 : -1),
    };
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <View style={{ paddingTop: insets.top }}>
        <GroupTabs active="mine" />
      </View>
      {mine.status === 'loading' ? (
        <ActivityIndicator style={styles.loading} />
      ) : mine.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="그룹런을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={mine.reload}
        />
      ) : mine.data.crews.length === 0 ? (
        <NoCrews data={mine.data} />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + size.tabBar + size.tabBarInset * 2 + spacing.xl,
            },
          ]}
        >
          {mine.data.upcoming ? (
            <UpcomingCard run={withJoin(mine.data.upcoming)} />
          ) : null}
          {mine.data.crews.map(({ crew, groupRuns: runs }, index) => (
            <CrewPanel
              key={crew.id}
              crew={crew}
              runs={runs.map(withJoin)}
              initiallyOpen={index === 0}
              onToggleJoin={toggle}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.screen,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: spacing.xl },
  tabLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tabText: { paddingBottom: spacing.lg },
  tabDot: { width: 5, height: 5, borderRadius: 3, marginBottom: spacing.lg },
  tabLine: { height: 2, width: 52, borderRadius: 1 },
  content: { padding: spacing.screen, gap: spacing.xl },
  upcoming: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: 1.5,
  },
  soonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  soonDot: { width: 5, height: 5, borderRadius: 3 },
  enter: {
    height: size.buttonSmall + 6,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  panel: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.xl,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  crewName: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  crewTile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {
    width: size.iconButton - 4,
    height: size.iconButton - 4,
    borderRadius: (size.iconButton - 4) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lines: { gap: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  noRuns: { textAlign: 'center', paddingVertical: spacing.xl },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pressed: { opacity: 0.8 },
  noCrews: {
    flex: 1,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xxxl,
    gap: spacing.xl,
  },
  recruitCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.xl,
    marginTop: spacing.xxl,
  },
  recruitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  recruitButton: {
    height: size.buttonMedium,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createLink: { alignSelf: 'center', padding: spacing.md },
});
