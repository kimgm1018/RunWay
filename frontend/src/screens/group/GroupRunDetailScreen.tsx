import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  AppText,
  EmptyState,
  Icon,
  type IconName,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type GroupGoalUpdate,
  type GroupPaceMode,
  type GroupRunCancelReason,
  type GroupRunDetail,
  type Repositories,
} from '../../data';
import {
  formatClockTime,
  formatDotDateWeekday,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { RunMap } from '../../components/RunMap';
import { groupTone, NumText } from './look';
import {
  canEnterRoom,
  dDay,
  formatSchedule,
  goalLine,
  Initial,
  roomOpensMs,
  useGroupRunDraft,
} from './parts';
import { BackButton } from '../../components/BackButton';
import {
  ColorBar,
  crewColor,
  memberColors,
  stand,
  StandButton,
  StandHeader,
  StandTag,
} from './stand';
import {
  changeLabel,
  goalSummary,
  GroupPaceCard,
  runKind,
  type PaceChange,
} from './GroupPaceCard';
import { GroupGoalSheet } from './GroupGoalSheet';

export const cancelReasons: { value: GroupRunCancelReason; label: string }[] = [
  { value: 'WEATHER', label: '날씨' },
  { value: 'PERSONAL', label: '개인 사정' },
  { value: 'LACK_OF_PARTICIPANTS', label: '인원 부족' },
  { value: 'LOCATION_ISSUE', label: '장소 문제' },
  { value: 'OTHER', label: '기타' },
];

// 6.4 그룹런 상세 (그룹런 시안, S15P31E105-673): the map in a rounded box, then the title over a heavier line and a
// fact a row between thin lines, my fit lit in mint, mint and outlined pill buttons at the foot.

// The next group run, for links that open 6.4 without an id.
async function loadDetail(repositories: Repositories, groupRunId?: string) {
  const id =
    groupRunId ??
    (await repositories.groupRuns.listMine()).crews[0]?.groupRuns[0]?.id;
  return repositories.groupRuns.get(id);
}

// 내 페이스와 잘 맞아요 (6.4-PaceMatch): a bold line and a grey line.
function FitLine({ run }: { run: GroupRunDetail }) {
  if (!run.myFit) {
    return null;
  }
  const gap = run.myFit.recentPaceSecPerKm - run.goalPaceSecPerKm;
  const verdict =
    Math.abs(gap) <= 15
      ? '내 페이스와 잘 맞아요'
      : gap < 0
      ? '내 페이스보다 느긋해요'
      : '내 페이스보다 빨라요';
  // My own row, lit in mint like my row in a table (그룹런 시안).
  return (
    <View style={styles.fit}>
      <View style={styles.iconCell}>
        <Icon name="runner" color={stand.mint} size={20} />
      </View>
      <View style={styles.flex}>
        <AppText style={styles.blockTitle}>{verdict}</AppText>
        <NumText
          style={styles.muted}
          text={`최근 러닝 평균 ${formatPace(
            run.myFit.recentPaceSecPerKm,
          )} · 준비도 ${run.myFit.readinessScore ?? '미산출'}`}
        />
      </View>
    </View>
  );
}

// One fact on the card (S15P31E105-594 담당자 시안): its icon, the value, a grey line under it when it has one, and
// something on the right (참가: who comes); a line above every row but the first.
function InfoRow({
  icon,
  text,
  sub,
  right,
  line = true,
}: {
  icon: IconName;
  text: string;
  sub?: string | null;
  right?: React.ReactNode;
  // A thin line under the row (not under the last one before my row).
  line?: boolean;
}) {
  return (
    <View style={[styles.infoRow, line && styles.rowLine]}>
      <View style={styles.iconCell}>
        <Icon name={icon} color={stand.sub} size={18} />
      </View>
      <View style={styles.flex}>
        <NumText style={styles.infoText} text={text} numberOfLines={1} />
        {sub ? <NumText style={styles.infoSub} text={sub} /> : null}
      </View>
      {right}
    </View>
  );
}

// 6.4 그룹런 상세, and 6.4e 취소 완료 when the run was cancelled.
export function GroupRunDetailScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunDetail'>>();
  const groupRunId = route.params?.groupRunId;
  const { groupRuns, clock } = useRepositories();
  const { changed } = useGroupRunDraft();
  const toast = useToast();
  const detail = useResource(
    useCallback(
      (repositories: Repositories) => loadDetail(repositories, groupRunId),
      [groupRunId],
    ),
  );
  const { reload } = detail;
  // Coming back from 6.4c shows the cancelled state.
  useFocusEffect(useCallback(() => reload(), [reload]));
  const [run, setRun] = useState<GroupRunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const loaded = detail.status === 'ready' ? detail.data : null;
  useEffect(() => {
    if (loaded) {
      setRun(loaded);
    }
  }, [loaded]);

  // S15P31E105-680: while the server recalculates the shared pace (about 3 s a member), look again every 2 s, at
  // most 30 times, instead of showing the stale or median value.
  const polls = useRef(0);
  // A failed look schedules the next one too (review B-4), within the same 30-look limit.
  const [missed, setMissed] = useState(0);
  const calculating = run?.pace?.calculating === true;
  const runId = run?.id;
  useEffect(() => {
    if (!calculating || !runId) {
      polls.current = 0;
      return;
    }
    if (polls.current >= 30) {
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      polls.current += 1;
      try {
        const next = await groupRuns.get(runId);
        if (live) {
          setRun(next);
        }
      } catch {
        if (live) {
          setMissed(count => count + 1);
        }
      }
    }, 2000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [calculating, runId, run, missed, groupRuns]);

  // 방금 바뀜: compare the applied pace with the last settled one this screen saw (client side only).
  const settled = useRef<GroupRunDetail | null>(null);
  const [change, setChange] = useState<PaceChange | null>(null);
  useEffect(() => {
    const pace = run?.pace;
    if (!run || !pace || pace.calculating || pace.appliedSecPerKm == null) {
      return;
    }
    const before = settled.current;
    settled.current = run;
    const from = before?.id === run.id ? before.pace?.appliedSecPerKm : null;
    if (before?.pace && from != null && from !== pace.appliedSecPerKm) {
      setChange({
        from,
        to: pace.appliedSecPerKm,
        label: changeLabel(
          { pace: before.pace, participants: before.participants },
          { pace, participants: run.participants },
        ),
      });
    }
  }, [run]);
  useEffect(() => {
    if (!change) {
      return;
    }
    const timer = setTimeout(() => setChange(null), 6000);
    return () => clearTimeout(timer);
  }, [change]);

  if (!run) {
    return (
      <SafeAreaView style={[styles.root, styles.loadingRoot]}>
        <View style={styles.headerRow}>
          <BackButton tone="dark" onPress={() => navigation.goBack()} />
        </View>
        {detail.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="그룹런을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={detail.reload}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }

  const now = clock.now();
  const cancelled = run.status === 'CANCELLED';
  const enterable = canEnterRoom(run, now);
  const reason = cancelReasons.find(
    item => item.value === run.cancellation?.reason,
  );
  // Each participant's colour; whoever cancelled takes theirs, the host's mint when it was me.
  const colors = memberColors(run.participants);
  const canceller = run.participants.find(
    member => member.nickname === run.cancellation?.byNickname,
  );
  const cancellerColor =
    (canceller && colors.get(canceller.userId)) ??
    (run.isHost ? stand.mint : stand.sub);

  const changeMode = async (mode: GroupPaceMode) => {
    if (!groupRuns.setPaceMode) {
      return;
    }
    setBusy(true);
    try {
      await groupRuns.setPaceMode(run.id, mode);
      setRun(await groupRuns.get(run.id));
    } catch (error) {
      toast(
        errorCode(error) === 'EDIT_NOT_ALLOWED'
          ? '출발 전에만 페이스 모드를 바꿀 수 있어요'
          : '페이스 모드를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      setBusy(false);
    }
  };

  // S15P31E105-702: the host saves a new goal with G04; the card then shows 계산 중 until the new pace.
  const saveGoal = async (goal: GroupGoalUpdate) => {
    if (!groupRuns.updateGoal) {
      return;
    }
    setBusy(true);
    try {
      await groupRuns.updateGoal(
        run.id,
        goal,
        run.scheduledAt,
        run.courseId !== null,
      );
    } catch (error) {
      toast(
        errorCode(error) === 'EDIT_NOT_ALLOWED'
          ? '출발 전에만 목표를 바꿀 수 있어요'
          : '목표를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요',
      );
      setBusy(false);
      return;
    }
    // Saved: a failed look afterwards is not a failed save (review F-6); the next focus reloads.
    setEditingGoal(false);
    changed();
    try {
      setRun(await groupRuns.get(run.id));
    } catch {
      reload();
    } finally {
      setBusy(false);
    }
  };
  const hostBeforeRun = run.isHost && run.status === 'SCHEDULED';
  // The card explains the start pace, so only before the run (review A-3).
  const showPaceCard = !!run.pace && run.status === 'SCHEDULED';

  const toggleJoin = async () => {
    setBusy(true);
    try {
      if (run.joined) {
        await groupRuns.leave(run.id);
      } else {
        await groupRuns.join(run.id);
      }
      setRun(await groupRuns.get(run.id));
      changed();
    } catch (error) {
      toast(
        errorCode(error) === 'FULL_OR_ALREADY_JOINED'
          ? '이미 참가했거나 자리가 없는 그룹런이에요'
          : run.joined
          ? '참가를 취소하지 못했어요. 잠시 후 다시 시도해 주세요'
          : '참가하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      setBusy(false);
    }
  };

  // The main button on top, the other under it (S15P31E105-594 담당자 시안). Status CTA (S15P31E105-637): waiting
  // room only while SCHEDULED+enterable; RUNNING/COMPLETED re-enter progress/result for joined members. Progress still
  // needs RunSession.groupRunId — without a live session the route opens MissingTarget (no session recovery here).
  const actions = cancelled ? (
    <>
      <StandButton
        title="다시 만들기"
        onPress={() =>
          navigation.navigate('GroupRunCreate', {
            crewId: run.crewId,
          })
        }
      />
      <StandButton
        title="내 크루로"
        tone="outline"
        onPress={() => navigateTo(navigation, 'MyCrews')}
      />
    </>
  ) : run.status === 'RUNNING' && run.joined ? (
    <StandButton
      title="진행 화면으로"
      onPress={() => navigation.navigate('GroupRunProgress')}
    />
  ) : run.status === 'COMPLETED' && run.joined ? (
    <StandButton
      title="그룹런 결과 보기"
      onPress={() =>
        navigation.navigate('GroupRunResult', { groupRunId: run.id })
      }
    />
  ) : enterable ? (
    // A member who joined can still leave under 대기방 입장; the host leads the run.
    <>
      <StandButton
        title={run.isHost ? '대기방 입장 · 그룹장' : '대기방 입장'}
        onPress={() =>
          navigation.navigate('WaitingRoom', { groupRunId: run.id })
        }
      />
      {run.joined && !run.isHost ? (
        <StandButton
          title="참가 취소"
          tone="outline"
          disabled={busy}
          onPress={toggleJoin}
        />
      ) : null}
    </>
  ) : run.status === 'SCHEDULED' ? (
    <>
      {run.joined ? (
        <AppText style={[styles.muted, styles.opens]}>
          {`대기방은 ${formatDotDateWeekday(
            new Date(Date.parse(run.scheduledAt) - roomOpensMs),
          )} ${formatClockTime(
            new Date(Date.parse(run.scheduledAt) - roomOpensMs),
          )}에 열려요`}
        </AppText>
      ) : null}
      {run.isHost ? (
        // The creator leads the run, so they cannot leave it; the room opens 30 minutes before.
        <StandButton
          title="대기방 입장 · 그룹장"
          disabled
          onPress={() => undefined}
        />
      ) : (
        <StandButton
          title={run.joined ? '참가 취소' : '참가하기'}
          tone={run.joined ? 'outline' : 'mint'}
          disabled={busy}
          onPress={toggleJoin}
        />
      )}
    </>
  ) : null;

  // Laid out as in 담당자 시안 (S15P31E105-594): 그룹런 상세 with back on top, the map in a card, then
  // one card with the title, the crew, a fact a row, who comes, my fit and the host row, and the buttons at the
  // foot. Every fact of the former sheet stays.
  return (
    // The navy page takes the dark glass buttons and the dark theme (S15P31E105-594 담당자 결정: 진한 네이비).
    <ThemeProvider tone="dark">
      <View style={styles.page}>
        <StatusBar barStyle="light-content" />
        {/* Share only from the result screen (S15P31E105-637): detail has no reliable recordId. */}
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <StandHeader title="그룹런 상세" onBack={() => navigation.goBack()} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.mapCard}>
            <RunMap
              muted={cancelled}
              route={run.route ?? undefined}
              position={run.route ? undefined : run.meetingPosition}
              area={
                run.route
                  ? { top: 0.12, bottom: 0.88 }
                  : { top: 0.5, bottom: 0.5 }
              }
              interactive={false}
              groupLine
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View>
            <View>
              <View style={styles.titleRow}>
                <View style={styles.flex}>
                  <AppText style={[styles.title, cancelled && styles.struck]}>
                    {run.title}
                  </AppText>
                  {/* The crew under the title with its colour bar (그룹런 시안). */}
                  <View style={styles.crewRow}>
                    <Icon name="users" color={stand.sub} size={14} />
                    <AppText style={styles.crewName}>{run.crewName}</AppText>
                    <ColorBar color={crewColor(run.crewId)} height={11} />
                  </View>
                </View>
                {cancelled ? (
                  <StandTag label="취소됨" tone="danger" style={styles.tag} />
                ) : (
                  <StandTag
                    label={dDay(run.scheduledAt, now)}
                    style={styles.tag}
                  />
                )}
              </View>
              <View style={styles.rows}>
                <InfoRow
                  icon="calendar"
                  text={formatSchedule(run.scheduledAt)}
                />
                <InfoRow
                  icon="mapPin"
                  text={run.meetingPlaceName}
                  sub={cancelled ? null : run.meetingAddress}
                />
                {cancelled ? null : (
                  <InfoRow
                    icon="route"
                    // With the 공동 페이스 card the goal moves into its 목표 row (S15P31E105-702); without it the
                    // line keeps the whole goal as before.
                    text={
                      showPaceCard
                        ? runKind(run)
                        : `${goalLine(run, false)} · 페이스 ${formatPace(
                            run.goalPaceSecPerKm,
                          )}`
                    }
                  />
                )}
                {cancelled ? null : (
                  <InfoRow
                    icon="users"
                    line={false}
                    text={`참가 ${run.participantCount}명 · 크루 멤버 ${run.crewMemberCount}명 중`}
                    right={
                      // Who comes, small and side by side, each in their colour (그룹런 시안).
                      <View style={styles.avatars}>
                        {run.participants.slice(0, 5).map((member, index) => (
                          <Initial
                            key={member.userId}
                            name={member.nickname}
                            color={colors.get(member.userId)}
                            size={24}
                            photo={member.profileImageUrl}
                            style={index > 0 ? styles.overlap : styles.ring}
                          />
                        ))}
                      </View>
                    }
                  />
                )}
                {/* 취소된 그룹런: the reason as a row with its icon. */}
                {cancelled && reason ? (
                  <InfoRow icon="tag" text={`사유 · ${reason.label}`} />
                ) : null}
              </View>
              {cancelled ? (
                <>
                  {run.cancellation ? (
                    <View style={styles.message}>
                      <View style={styles.messageHead}>
                        <Initial
                          name={run.cancellation.byNickname}
                          size={28}
                          color={cancellerColor}
                        />
                        <ColorBar color={cancellerColor} height={22} />
                        <AppText style={[styles.messageName, styles.flex]}>
                          {`${run.cancellation.byNickname} · ${
                            run.cancellation.byRole === 'HOST'
                              ? '그룹장'
                              : run.cancellation.byRole
                          }`}
                        </AppText>
                      </View>
                      {run.cancellation.message ? (
                        <AppText style={styles.messageText}>
                          {run.cancellation.message}
                        </AppText>
                      ) : (
                        // G03 cancellation.message is always null on the server: cancelMessage
                        // is notification-only (group-runs.md G13). Avoid an empty quote block.
                        <AppText style={styles.messageText}>
                          호스트가 남긴 말은 알림함에서 확인할 수 있어요
                        </AppText>
                      )}
                    </View>
                  ) : null}
                  <View style={styles.notice}>
                    <Icon name="bell" color={stand.sub} size={14} />
                    <AppText style={styles.muted}>
                      {`크루 멤버 ${Math.max(
                        0,
                        run.crewMemberCount - 1,
                      )}명에게 취소 알림을 보냈어요`}
                    </AppText>
                  </View>
                </>
              ) : (
                <>
                  {/* The card explains the start pace, so only before the run (review A-3). */}
                  {run.pace && showPaceCard ? (
                    <GroupPaceCard
                      pace={run.pace}
                      goalText={goalSummary(run, run.pace.goalSecPerKm)}
                      change={change}
                      canChangeMode={
                        run.isHost &&
                        run.status === 'SCHEDULED' &&
                        !!groupRuns.setPaceMode
                      }
                      busy={busy}
                      onChangeMode={changeMode}
                      onEditGoal={
                        hostBeforeRun && groupRuns.updateGoal
                          ? () => setEditingGoal(true)
                          : undefined
                      }
                    />
                  ) : null}
                  <FitLine run={run} />
                  {run.isHost ? (
                    <View style={styles.hostRow}>
                      <Initial
                        name="나"
                        color={stand.mint}
                        size={28}
                        photo={
                          run.participants.find(member => member.isMe)
                            ?.profileImageUrl
                        }
                      />
                      <AppText style={[styles.muted, styles.flex]}>
                        내가 만든 그룹런
                      </AppText>
                      {run.status === 'SCHEDULED' ? (
                        <>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="그룹런 수정"
                            onPress={() =>
                              navigation.navigate('GroupRunCreate', {
                                groupRunId: run.id,
                              })
                            }
                            hitSlop={8}
                          >
                            <AppText style={styles.hostLink}>수정</AppText>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="그룹런 취소"
                            onPress={() =>
                              navigation.navigate('GroupRunCancel', {
                                groupRunId: run.id,
                              })
                            }
                            hitSlop={8}
                          >
                            <AppText
                              style={[styles.hostLink, styles.hostCancel]}
                            >
                              그룹런 취소
                            </AppText>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </View>
        </ScrollView>
        <View style={[styles.actions, { paddingBottom: insets.bottom + 12 }]}>
          {actions}
        </View>
        {hostBeforeRun ? (
          <GroupGoalSheet
            visible={editingGoal}
            distanceM={run.targetDistanceM}
            durationSec={run.targetDurationSec}
            courseLocked={run.courseId !== null}
            busy={busy}
            onClose={() => setEditingGoal(false)}
            onSave={saveGoal}
          />
        ) : null}
      </View>
    </ThemeProvider>
  );
}

// Buttons at the bottom of the group screens (DESIGN.md 2-10). They read the tone they sit in:
// primary is the solid accent pill, danger the red pink fill (6.4d 취소하기), dangerOutline the red pink
// outline (6.4c), and the rest are outlined.
export function FooterButton({
  title,
  onPress,
  primary = false,
  danger = false,
  dangerOutline = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  dangerOutline?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const fill = danger
    ? {
        backgroundColor: groupTone.danger,
        borderColor: groupTone.danger,
        color: colors.onDanger,
      }
    : dangerOutline
    ? {
        backgroundColor: 'transparent',
        borderColor: groupTone.danger,
        color: groupTone.danger,
      }
    : primary
    ? {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
        color: colors.onAccent,
      }
    : {
        backgroundColor: 'transparent',
        borderColor: colors.borderStrong,
        color: colors.text,
      };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerButton,
        {
          backgroundColor: fill.backgroundColor,
          borderColor: fill.borderColor,
        },
        (pressed || disabled) && styles.dim,
      ]}
    >
      <AppText variant="button" style={{ color: fill.color }}>
        {title}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingRoot: { backgroundColor: groupTone.page },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  headerRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
  },
  // The navy page, no cards: lines between the facts (그룹런 시안, S15P31E105-673).
  page: { flex: 1, backgroundColor: stand.page },
  header: { paddingHorizontal: 17 },
  content: { paddingHorizontal: 19, paddingBottom: 16 },
  mapCard: {
    height: 170,
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: stand.field,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  tag: { marginTop: 4 },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 22,
    lineHeight: 28,
    color: stand.text,
  },
  struck: {
    textDecorationLine: 'line-through',
    color: stand.sub,
  },
  crewRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  crewName: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: stand.sub,
  },
  rows: {},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 6,
  },
  rowLine: { borderBottomWidth: 1, borderBottomColor: stand.line },
  iconCell: { width: 30 },
  infoText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 20,
    color: stand.text,
  },
  infoSub: {
    marginTop: 1,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  actions: {
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: 19,
  },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  // My fit: a faint mint row with a mint line under it, 10 past the page's sides.
  fit: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    marginHorizontal: -10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: stand.meFill,
    borderBottomWidth: 1,
    borderBottomColor: stand.meLine,
  },
  blockTitle: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.text,
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  // The ring takes the page's colour so the overlapping initials read apart.
  ring: { borderWidth: 2, borderColor: stand.page },
  overlap: { marginLeft: -5, borderWidth: 2, borderColor: stand.page },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
  },
  hostLink: {
    paddingHorizontal: 6,
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 19,
    color: stand.text,
  },
  hostCancel: { color: stand.danger, paddingRight: 0 },
  message: { gap: 4 },
  messageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
  },
  messageName: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.text,
  },
  messageText: {
    fontFamily: fontFamily.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: stand.text,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: stand.field,
  },
  notice: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  opens: { textAlign: 'center', color: stand.sub, fontSize: 12.5 },
  footerButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.6 },
});
