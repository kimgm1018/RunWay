import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, EmptyState, Icon } from '../../components';
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
import {
  fontFamily,
  radius,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import {
  canEnterRoom,
  dDay,
  formatSchedule,
  InfoLine,
  startsIn,
  Tag,
  useGroupRunDraft,
} from './parts';
import { crewCard, groupLook, Raised, SearchField } from './look';

const loadMine = (repositories: Repositories, _version: number) =>
  repositories.groupRuns.listMine();

// The run starting next (6.0-UpcomingRunBanner) on a raised white card with navy text, so it reads
// apart from the crews' glass cards below (담당자 요청, S15P31E105-414).
function UpcomingCard({ run }: { run: GroupRunSummary }) {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const now = clock.now();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.title}, ${startsIn(run.scheduledAt, now)}`}
      onPress={() =>
        navigation.navigate('GroupRunDetail', { groupRunId: run.id })
      }
      style={({ pressed }) => pressed && styles.cardPressed}
    >
      <Raised tone="white" style={styles.upcoming}>
        <View style={styles.flex}>
          {/* Crew, time and place only (담당자 요청). The run's title is on 6.4, and the title and how
              soon it starts stay in the label for screen readers. */}
          <AppText style={styles.upcomingTitle} numberOfLines={1}>
            {run.crewName}
          </AppText>
          <AppText style={styles.upcomingSub} numberOfLines={1}>
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
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Raised tone="navy" style={styles.enter}>
              <AppText style={styles.enterText}>대기방 입장</AppText>
            </Raised>
          </Pressable>
        ) : null}
      </Raised>
    </Pressable>
  );
}

// One run under its crew, set in by a left line (white for today) instead of a card.
function RunCard({
  run,
  onToggle,
}: {
  run: GroupRunSummary;
  onToggle: () => void;
}) {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const day = dDay(run.scheduledAt, clock.now());
  const today = day === '오늘';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.title}, ${formatSchedule(run.scheduledAt)}`}
      onPress={() =>
        navigation.navigate('GroupRunDetail', { groupRunId: run.id })
      }
      style={[
        styles.run,
        { borderLeftColor: today ? groupLook.lineToday : groupLook.lineLater },
      ]}
    >
      <View style={styles.runTop}>
        <Raised tone={today ? 'white' : 'darkGlass'} style={styles.dayChip}>
          <AppText style={today ? styles.chipTextDark : styles.chipTextLight}>
            {day}
          </AppText>
        </Raised>
        {/* hostNickname shows only here (6.4 has no host line), so it stays on the list. */}
        <AppText style={styles.host}>
          {run.isHost ? '내가 만듦' : `${run.hostNickname}님이 만듦`}
        </AppText>
        <AppText style={[styles.sub, styles.count]}>
          {`참가 ${run.participantCount}명`}
        </AppText>
      </View>
      <View style={styles.runTitleRow}>
        <AppText style={[styles.runTitle, styles.flex]} numberOfLines={1}>
          {run.title}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            run.joined ? `${run.title} 참가 취소` : `${run.title} 참가하기`
          }
          accessibilityState={{ selected: run.joined }}
          onPress={onToggle}
          hitSlop={6}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Raised
            tone={run.joined ? 'white' : 'darkGlass'}
            style={styles.joinButton}
          >
            {run.joined ? (
              <Icon name="check" color={groupLook.navy} size={13} />
            ) : null}
            <AppText
              style={run.joined ? styles.joinTextOn : styles.joinTextOff}
            >
              {run.joined ? '참가 중' : '참가하기'}
            </AppText>
          </Raised>
        </Pressable>
      </View>
      {/* When and where in one line; the course is on 6.4 (담당자 결정, S15P31E105-414). */}
      <View style={styles.lines}>
        <InfoLine
          icon="clock"
          value={`${formatSchedule(run.scheduledAt)} · ${run.meetingPlaceName}`}
        />
      </View>
    </Pressable>
  );
}

function CrewPanel({
  crew,
  runs,
  initiallyOpen,
  pinnedOnly,
  onToggleJoin,
}: {
  crew: MyCrew;
  runs: GroupRunSummary[];
  initiallyOpen: boolean;
  // The crew's only run is the one pinned in '곧 출발', so the empty-list hint would be wrong.
  pinnedOnly: boolean;
  onToggleJoin: (run: GroupRunSummary) => void;
}) {
  const navigation = useNavigation();
  const [open, setOpen] = useState(initiallyOpen);
  if (crew.membership === 'PENDING') {
    return (
      <View style={styles.crewHeader}>
        {/* Not faded: half opacity on the dark background was hard to read. '승인 대기' tells the state. */}
        <View style={styles.flex}>
          <AppText style={crewCard.name} numberOfLines={1}>
            {crew.name}
          </AppText>
          <AppText
            style={[crewCard.small, crewCard.lineGap, styles.subColor]}
            numberOfLines={1}
          >
            크루장이 승인하면 그룹런이 보여요
          </AppText>
        </View>
        {/* On the right, flat like the other crews' round buttons there (담당자 요청). */}
        <View style={styles.pendingChip}>
          <AppText style={styles.chipTextLight}>승인 대기</AppText>
        </View>
      </View>
    );
  }
  return (
    <View>
      <View style={styles.crewHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${crew.name} 크루 상세`}
          onPress={() => navigation.navigate('CrewDetail', { crewId: crew.id })}
          style={styles.crewName}
        >
          <View style={styles.flex}>
            {/* Name only: the area and the member count are on 6.2 (담당자 요청). */}
            <AppText style={crewCard.name} numberOfLines={1}>
              {`${crew.name} ›`}
            </AppText>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? `${crew.name} 접기` : `${crew.name} 펴기`}
          onPress={() => setOpen(value => !value)}
          style={({ pressed }) => [crewCard.round, pressed && styles.pressed]}
        >
          <Icon
            name={open ? 'chevronDown' : 'forward'}
            color={groupLook.onDark}
            size={16}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${crew.name} 그룹런 만들기`}
          onPress={() =>
            navigation.navigate('GroupRunCreate', { crewId: crew.id })
          }
          style={({ pressed }) => [crewCard.round, pressed && styles.pressed]}
        >
          <Icon name="plus" color={groupLook.onDark} size={16} />
        </Pressable>
      </View>
      {open ? (
        runs.length ? (
          <View style={styles.runs}>
            {runs.map(run => (
              <RunCard
                key={run.id}
                run={run}
                onToggle={() => onToggleJoin(run)}
              />
            ))}
          </View>
        ) : pinnedOnly ? null : (
          <AppText style={[styles.sub, styles.noRuns]}>
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
// One page of the group tab pager (GroupTabScreen).
export function MyCrewsPage({
  searching,
  onCloseSearch,
}: {
  // Opened by the round search button beside the tabs (GroupTabScreen).
  searching: boolean;
  onCloseSearch: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Search narrows my crews by name or area on this screen (담당자 요청); closing it clears it.
  const [query, setQuery] = useState('');
  const closeSearch = () => {
    onCloseSearch();
    setQuery('');
  };
  const term = query.trim();
  const matches = (...texts: string[]) =>
    !term || texts.some(text => text.includes(term));
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
    <View style={styles.root}>
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
                insets.bottom +
                size.tabBar +
                size.tabBarInset * 2 +
                spacing.xxxl * 2,
            },
          ]}
        >
          {searching ? (
            <SearchField
              label="내 크루 검색"
              value={query}
              onChangeText={setQuery}
              onClose={closeSearch}
            />
          ) : null}
          {mine.data.upcoming && matches(mine.data.upcoming.crewName) ? (
            <UpcomingCard run={withJoin(mine.data.upcoming)} />
          ) : null}
          {term &&
          !mine.data.crews.some(({ crew }) => matches(crew.name, crew.area)) ? (
            <AppText style={[styles.sub, styles.onMist, styles.noMatch]}>
              찾는 크루가 없어요.
            </AppText>
          ) : null}
          {mine.data.crews
            .filter(({ crew }) => matches(crew.name, crew.area))
            .map(({ crew, groupRuns: runs }, index) => {
              // The run in '곧 출발' is not listed again under its crew.
              const listed = runs.filter(
                run => run.id !== mine.data.upcoming?.id,
              );
              return (
                // The navy card keeps the dark theme inside it, so the run lines stay white on the mist.
                <ThemeProvider key={crew.id} tone="dark">
                  <View style={crewCard.card}>
                    <CrewPanel
                      crew={crew}
                      runs={listed.map(withJoin)}
                      initiallyOpen={index === 0}
                      pinnedOnly={runs.length > 0 && listed.length === 0}
                      onToggleJoin={toggle}
                    />
                  </View>
                </ThemeProvider>
              );
            })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  // Every card, 곧 출발 included, sits 14 apart (담당자 요청).
  content: {
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    gap: 14,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupLook.onDarkSub,
  },
  chipTextDark: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.navy,
  },
  chipTextLight: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onDark,
  },
  // 6.0-UpcomingRunBanner: a raised white card, the 대기방 입장 pill on the right.
  upcoming: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // Same padding, corners and gap as the crew cards below (담당자 요청).
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 20,
  },
  cardPressed: { transform: [{ scale: 0.985 }] },
  upcomingTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 27,
    letterSpacing: -0.4,
    color: groupLook.onLight,
  },
  upcomingSub: {
    marginTop: 10,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupLook.onLightSub,
  },
  enter: {
    width: 100,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onDark,
  },
  // 6.0-CrewCardExpanded: the crew's head row, then its runs below without a panel.
  // As tall as a two-line card (name 27 + 10 + note 18), so every card on 6.0 is one height (담당자 요청).
  crewHeader: {
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  crewName: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  crewTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: groupLook.darkFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No initial tile (there are no crew photos), so the name is bigger (담당자 요청).
  subColor: { color: groupLook.onDarkSub },
  // Text straight on the mist rather than in a navy crew card (S15P31E105-483).
  onMist: { color: groupLook.onLightSub },
  noMatch: { textAlign: 'center', paddingVertical: spacing.xxxl },
  pendingChip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: groupLook.darkButton,
    justifyContent: 'center',
  },
  runs: { marginTop: 16, gap: 16 },
  run: {
    marginLeft: 2,
    paddingLeft: 12,
    borderLeftWidth: 1.5,
  },
  runTop: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayChip: {
    height: 20,
    paddingHorizontal: 9,
    borderRadius: 10,
    justifyContent: 'center',
  },
  host: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupLook.onDarkMuted,
  },
  count: { marginLeft: 'auto' },
  runTitleRow: {
    marginTop: 6,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  runTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: groupLook.onDark,
  },
  lines: { marginTop: 4 },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingLeft: 11,
    paddingRight: 12,
    borderRadius: 15,
  },
  joinTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: groupLook.navy,
  },
  joinTextOff: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: groupLook.onDark,
  },
  noRuns: { textAlign: 'center', paddingVertical: spacing.xl },
  pressed: { transform: [{ scale: 0.97 }] },
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
