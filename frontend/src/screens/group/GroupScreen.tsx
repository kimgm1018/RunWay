import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  animateNextLayout,
  AppText,
  EmptyState,
  Icon,
  PressableScale,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type GroupRunSummary,
  type MyCrew,
  type MyGroupRuns,
  type Repositories,
} from '../../data';
import { formatClockTime } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, size, spacing } from '../../theme';
import {
  canEnterRoom,
  CrewPhoto,
  dDay,
  formatSchedule,
  startsIn,
  useGroupRunDraft,
} from './parts';
import { groupTone, NumText, Raised, SearchField } from './look';
import { ColorBar, crewColor, stand, StandTag } from './stand';

const loadMine = (repositories: Repositories, _version: number) =>
  repositories.groupRuns.listMine();

// 그룹런 시안 6.0 내 크루 (S15P31E105-673): no cards, each crew a heading with its colour bar over a heavier line and
// its runs as rows between thin lines; 곧 출발 lit in mint on top.

// The run starting next (6.0-UpcomingRunBanner): 곧 출발, the crew, time and place, then 대기방 입장 past a line.
function UpcomingCard({ run }: { run: GroupRunSummary }) {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const now = clock.now();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${run.title}, ${startsIn(run.scheduledAt, now)}`}
      onPress={() =>
        navigation.navigate('GroupRunDetail', { groupRunId: run.id })
      }
    >
      <View style={styles.upcoming}>
        <ColorBar color={crewColor(run.crewId)} height={52} />
        <View style={styles.flex}>
          {/* Crew, time and place only (담당자 요청). The run's title is on 6.4, and the title and how soon it
              starts stay in the label for screen readers. */}
          <StandTag label="곧 출발" style={styles.soonChip} />
          <AppText style={styles.upcomingTitle} numberOfLines={1}>
            {run.crewName}
          </AppText>
          <NumText
            style={styles.sub}
            numberOfLines={1}
            text={`${formatClockTime(run.scheduledAt)} · ${
              run.meetingPlaceName
            }`}
          />
        </View>
        {canEnterRoom(run, now) ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="대기방 입장"
            onPress={() =>
              navigation.navigate('WaitingRoom', { groupRunId: run.id })
            }
            style={styles.enter}
          >
            <AppText style={styles.enterText}>대기방 입장</AppText>
          </PressableScale>
        ) : null}
      </View>
    </PressableScale>
  );
}

// One run under its crew: D-4 (or 오늘) in a box on the left, then the title, when and where, and who made it ·
// how many joined; 참가 중 (mint outline) or 참가하기 (mint) on the right.
function RunCard({
  run,
  busy,
  onToggle,
}: {
  run: GroupRunSummary;
  busy: boolean;
  onToggle: () => void;
}) {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const day = dDay(run.scheduledAt, clock.now());
  // Hosts cannot leave their own run; only SCHEDULED runs accept join toggles (6.4, S15P31E105-637).
  const canToggle = !run.isHost && run.status === 'SCHEDULED';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.title}, ${formatSchedule(run.scheduledAt)}`}
      onPress={() =>
        navigation.navigate('GroupRunDetail', { groupRunId: run.id })
      }
      style={styles.run}
    >
      <View style={styles.dayBox}>
        <NumText style={styles.dayText} text={day} />
      </View>
      <ColorBar color={crewColor(run.crewId)} style={styles.runBar} />
      <View style={styles.flex}>
        <AppText style={styles.runTitle} numberOfLines={1}>
          {run.title}
        </AppText>
        {/* When and where in one line; the course is on 6.4 (담당자 결정, S15P31E105-414). */}
        <NumText
          style={styles.small}
          numberOfLines={1}
          text={`${formatSchedule(run.scheduledAt)} · ${run.meetingPlaceName}`}
        />
        {/* hostNickname shows only here (6.4 has no host line), so it stays on the list. */}
        <NumText
          style={styles.muted}
          numberOfLines={1}
          text={`${
            run.isHost ? '내가 만듦' : `${run.hostNickname}님이 만듦`
          } · 참가 ${run.participantCount}명`}
        />
      </View>
      {canToggle ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            run.joined ? `${run.title} 참가 취소` : `${run.title} 참가하기`
          }
          accessibilityState={{ selected: run.joined, disabled: busy }}
          disabled={busy}
          onPress={onToggle}
          hitSlop={6}
          style={[
            styles.joinButton,
            run.joined ? styles.joinOn : styles.joinOff,
          ]}
        >
          <AppText style={run.joined ? styles.joinTextOn : styles.joinTextOff}>
            {run.joined ? '참가 중' : '참가하기'}
          </AppText>
        </PressableScale>
      ) : null}
    </Pressable>
  );
}

function CrewPanel({
  crew,
  runs,
  initiallyOpen,
  pinnedOnly,
  joinBusy,
  onToggleJoin,
}: {
  crew: MyCrew;
  runs: GroupRunSummary[];
  initiallyOpen: boolean;
  // The crew's only run is the one pinned in '곧 출발', so the empty-list hint would be wrong.
  pinnedOnly: boolean;
  joinBusy: Record<string, boolean>;
  onToggleJoin: (run: GroupRunSummary) => void;
}) {
  const navigation = useNavigation();
  const [open, setOpen] = useState(initiallyOpen);
  if (crew.membership === 'PENDING') {
    return (
      <View style={[styles.crewHeader, styles.pendingHeader]}>
        {/* Not faded: half opacity was hard to read. '승인 대기' tells the state. */}
        <ColorBar color={crewColor(crew.id)} height={18} />
        <CrewPhoto photo={crew.imageUrl} size={40} />
        <View style={styles.flex}>
          <AppText style={styles.crewName} numberOfLines={1}>
            {crew.name}
          </AppText>
          <AppText style={[styles.small, styles.lineGap]} numberOfLines={1}>
            크루장이 승인하면 그룹런이 보여요
          </AppText>
        </View>
        <StandTag label="승인 대기" tone="outline" style={styles.center} />
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
          style={[styles.flex, styles.photoRow]}
        >
          <ColorBar color={crewColor(crew.id)} height={18} />
          {/* Name only: the area and the member count are on 6.2 (담당자 요청). The crew photo sits left of
              it when the crew has one (S15P31E105-636). */}
          <CrewPhoto photo={crew.imageUrl} size={40} />
          <AppText style={[styles.crewName, styles.flex]} numberOfLines={1}>
            {crew.name}
          </AppText>
        </Pressable>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${crew.name} 그룹런 만들기`}
          onPress={() =>
            navigation.navigate('GroupRunCreate', { crewId: crew.id })
          }
          style={styles.plus}
        >
          <View style={styles.plusDot}>
            <Icon name="plus" color={stand.onMint} size={16} />
          </View>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={open ? `${crew.name} 접기` : `${crew.name} 펴기`}
          onPress={() => {
            // The runs fold in and out instead of jumping (S15P31E105-478).
            animateNextLayout();
            setOpen(value => !value);
          }}
          hitSlop={8}
          style={styles.fold}
        >
          {/* Down to open, up to close. */}
          <View style={open ? styles.flip : null}>
            <Icon name="chevronDown" color={stand.text} size={20} />
          </View>
        </PressableScale>
      </View>
      {open ? (
        runs.length ? (
          <View style={styles.runs}>
            {runs.map(run => (
              <RunCard
                key={run.id}
                run={run}
                busy={!!joinBusy[run.id]}
                onToggle={() => onToggleJoin(run)}
              />
            ))}
          </View>
        ) : pinnedOnly ? null : (
          <View style={styles.noRuns}>
            <AppText style={styles.small}>아직 예정된 그룹런이 없어요</AppText>
            <AppText style={styles.small}>+로 만들어 보세요</AppText>
          </View>
        )
      ) : null}
    </View>
  );
}

// 6.0b 내 크루 없음 (09-8 in runway-group-screen-designs): one dark card with the crew icon, the lines, 크루 모집 보러
// 가기 in mint and 직접 만들기 in slate.
function NoCrews({ data }: { data: MyGroupRuns }) {
  const navigation = useNavigation();
  return (
    <View style={styles.noCrews}>
      <Raised tone="night" style={styles.noCrewsCard}>
        <Icon name="users" color={groupTone.sub} size={36} />
        <AppText style={styles.noCrewsTag}>러닝 크루</AppText>
        <AppText
          style={styles.noCrewsTitle}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          혼자 달리던 길, 같이 달려 볼까요
        </AppText>
        <NumText
          style={[styles.small, styles.center]}
          text={`모집 중인 크루 ${data.nearbyRecruiting.count}곳`}
        />
        <View style={styles.nearby}>
          <Icon name="mapPin" color={groupTone.text} size={18} />
          <View style={styles.flex}>
            <NumText
              style={styles.nearbyTitle}
              text={`내 근처 크루 ${data.nearbyRecruiting.count}곳이 모집 중`}
            />
            <AppText style={styles.small}>
              {data.nearbyRecruiting.areas.join(' · ')}
            </AppText>
          </View>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="크루 모집 보러 가기"
          onPress={() => navigateTo(navigation, 'CrewRecruit')}
          style={[styles.wide, styles.wideMint]}
        >
          <AppText style={styles.wideTextMint}>크루 모집 보러 가기 ›</AppText>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="직접 만들기"
          onPress={() => navigateTo(navigation, 'CrewCreate')}
          style={[styles.wide, styles.wideSlate]}
        >
          <AppText style={styles.wideTextSlate}>
            원하는 크루가 없다면 직접 만들기
          </AppText>
        </PressableScale>
      </Raised>
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
  const toast = useToast();
  const { version } = useGroupRunDraft();
  // Reloads when 6.4 joins, leaves or cancels, or 6.8 makes a run.
  const mine = useResource(
    useCallback(
      (repositories: Repositories) => loadMine(repositories, version),
      [version],
    ),
  );
  // Changes made elsewhere (a leader approving my request on their phone, leaving a crew on 6.2) show when
  // the group tab comes back into view, with the old list kept until the new one arrives
  // (S15P31E105-592). The first focus is the first load.
  const refreshMine = mine.refresh;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) {
        void refreshMine();
      }
      focused.current = true;
    }, [refreshMine]),
  );
  // Join changes on this screen show at once.
  const [joined, setJoined] = useState<Record<string, boolean>>({});
  const [joinBusy, setJoinBusy] = useState<Record<string, boolean>>({});
  const joinBusyRef = useRef<Record<string, boolean>>({});
  useEffect(() => setJoined({}), [version]);

  const toggle = async (run: GroupRunSummary) => {
    if (run.isHost || run.status !== 'SCHEDULED') {
      return;
    }
    if (joinBusyRef.current[run.id]) {
      return;
    }
    const next = !(joined[run.id] ?? run.joined);
    joinBusyRef.current[run.id] = true;
    setJoinBusy(current => ({ ...current, [run.id]: true }));
    setJoined(current => ({ ...current, [run.id]: next }));
    try {
      await (next ? groupRuns.join(run.id) : groupRuns.leave(run.id));
    } catch (error) {
      setJoined(current => ({ ...current, [run.id]: !next }));
      toast(
        errorCode(error) === 'FULL_OR_ALREADY_JOINED'
          ? '이미 참가했거나 자리가 없는 그룹런이에요'
          : next
          ? '참가하지 못했어요. 잠시 후 다시 시도해 주세요'
          : '참가를 취소하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      joinBusyRef.current[run.id] = false;
      setJoinBusy(current => ({ ...current, [run.id]: false }));
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
              찾는 크루가 없어요
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
                // The same raised white card as 곧 출발 above (S15P31E105-563), so the run lines use the
                // app's light theme with navy text.
                <View key={crew.id}>
                  <CrewPanel
                    crew={crew}
                    runs={listed.map(withJoin)}
                    initiallyOpen={index === 0}
                    pinnedOnly={runs.length > 0 && listed.length === 0}
                    joinBusy={joinBusy}
                    onToggleJoin={toggle}
                  />
                </View>
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
  // 곧 출발 14 under the tabs, each crew 10 under the one before (그룹런 시안).
  content: {
    paddingHorizontal: 19,
    paddingTop: 14,
    gap: 10,
  },
  center: { alignSelf: 'center' },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: stand.sub,
  },
  small: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.muted,
  },
  lineGap: { marginTop: 2 },
  // Text straight on the page (찾는 크루가 없어요).
  onMist: { color: stand.sub },
  noMatch: { textAlign: 'center', paddingVertical: spacing.xxxl },
  soonChip: { marginBottom: 3 },
  // 곧 출발: a faint mint row with a mint line under it, reaching 10 past the page's sides.
  upcoming: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 92,
    marginHorizontal: -10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: stand.meFill,
    borderBottomWidth: 1,
    borderBottomColor: stand.meLine,
  },
  upcomingTitle: {
    fontFamily: fontFamily.black,
    fontSize: 18,
    lineHeight: 24,
    color: stand.text,
  },
  enter: {
    width: 112,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stand.mint,
  },
  enterText: {
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 19,
    color: stand.onMint,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // A crew's heading over a heavier line.
  crewHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  pendingHeader: { minHeight: 66, gap: 10 },
  crewName: {
    fontFamily: fontFamily.black,
    fontSize: 17,
    lineHeight: 23,
    color: stand.text,
  },
  // + as a 30 mint circle with a navy plus in a 44 touch area, the fold as a bare chevron.
  plus: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: stand.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fold: {
    width: 40,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  flip: { transform: [{ rotate: '180deg' }] },
  runs: {},
  // A run: 오늘 or D-4 on the left, the crew's colour bar, the lines, then 참가 중 or 참가하기.
  run: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 74,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  dayBox: { width: 52 },
  dayText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: stand.text,
  },
  runBar: { marginLeft: 6, marginRight: 12 },
  runTitle: {
    fontFamily: fontFamily.black,
    fontSize: 15.5,
    lineHeight: 21,
    color: stand.text,
  },
  joinButton: {
    marginLeft: 8,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 참가 중 as an outlined tag, 참가하기 in mint.
  joinOn: { borderWidth: 1, borderColor: stand.rule },
  joinOff: { backgroundColor: stand.mint },
  joinTextOn: {
    fontFamily: fontFamily.black,
    fontSize: 12,
    lineHeight: 16,
    color: stand.sub,
  },
  joinTextOff: {
    fontFamily: fontFamily.black,
    fontSize: 12,
    lineHeight: 16,
    color: stand.onMint,
  },
  noRuns: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xl,
  },
  noCrews: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: spacing.xl,
  },
  noCrewsCard: {
    alignItems: 'center',
    gap: 12,
    padding: 22,
    borderRadius: 22,
  },
  noCrewsTag: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.text,
  },
  noCrewsTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 28,
    color: groupTone.text,
  },
  nearby: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: groupTone.inner,
  },
  nearbyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 20,
    color: groupTone.text,
  },
  wide: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wideMint: { backgroundColor: groupTone.button },
  wideSlate: { backgroundColor: groupTone.quiet },
  wideTextMint: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.onButton,
  },
  wideTextSlate: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
});
