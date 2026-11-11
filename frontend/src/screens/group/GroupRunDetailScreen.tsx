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
import { GroupCta, groupTone, NumText, Raised } from './look';
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
import { changeLabel, GroupPaceCard, type PaceChange } from './GroupPaceCard';

export const cancelReasons: { value: GroupRunCancelReason; label: string }[] = [
  { value: 'WEATHER', label: '날씨' },
  { value: 'PERSONAL', label: '개인 사정' },
  { value: 'LACK_OF_PARTICIPANTS', label: '인원 부족' },
  { value: 'LOCATION_ISSUE', label: '장소 문제' },
  { value: 'OTHER', label: '기타' },
];

// 6.4 is laid out like the product cards the 담당자 chose (S15P31E105-414): the map full-bleed at the
// top, melting into its own colour as the photo does on those cards, with a big title, a round pill
// beside it, a grey description, see-through tag pills and a pill button. Since S15P31E105-563 it is laid
// out like 2.0 코스 러닝: the map full screen and every fact and the button on one white sheet at the
// bottom, the D-n pill and the button in navy.
const glass = groupTone.quiet;

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
  // A box with a runner beside the two lines (S15P31E105-594 담당자 시안).
  return (
    <View style={styles.fit}>
      <Icon name="runner" color={groupTone.text} size={22} />
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

// A pill: the one beside the title (D-n or 오늘 in a mint outline, 취소됨 in red pink) and the light grey tags on the card.
function Pill({
  label,
  danger = false,
  large = false,
}: {
  label: string;
  danger?: boolean;
  large?: boolean;
}) {
  return (
    <View
      style={[
        styles.pill,
        large && styles.pillLarge,
        danger && styles.pillDanger,
      ]}
    >
      <AppText
        style={[
          styles.pillText,
          large && styles.pillTextLarge,
          danger && styles.pillDangerText,
        ]}
      >
        {label}
      </AppText>
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
  first = false,
}: {
  icon: IconName;
  text: string;
  sub?: string | null;
  right?: React.ReactNode;
  first?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !first && styles.rowLine]}>
      <Icon name={icon} color={groupTone.sub} size={18} />
      <View style={styles.flex}>
        <NumText style={styles.infoText} text={text} />
        {sub ? <AppText style={styles.muted}>{sub}</AppText> : null}
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
      <GroupCta
        navy
        title="다시 만들기"
        onPress={() =>
          navigation.navigate('GroupRunCreate', {
            crewId: run.crewId,
          })
        }
      />
      <GroupCta
        navy
        title="내 크루로"
        primary={false}
        onPress={() => navigateTo(navigation, 'MyCrews')}
      />
    </>
  ) : run.status === 'RUNNING' && run.joined ? (
    <GroupCta
      navy
      title="진행 화면으로"
      onPress={() => navigation.navigate('GroupRunProgress')}
    />
  ) : run.status === 'COMPLETED' && run.joined ? (
    <GroupCta
      navy
      title="그룹런 결과 보기"
      onPress={() =>
        navigation.navigate('GroupRunResult', { groupRunId: run.id })
      }
    />
  ) : enterable ? (
    // A member who joined can still leave under 대기방 입장; the host leads the run.
    <>
      <GroupCta
        navy
        title={run.isHost ? '대기방 입장 · 그룹장' : '대기방 입장'}
        onPress={() =>
          navigation.navigate('WaitingRoom', { groupRunId: run.id })
        }
      />
      {run.joined && !run.isHost ? (
        <GroupCta
          navy
          title="참가 취소"
          primary={false}
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
        <GroupCta
          navy
          title="대기방 입장 · 그룹장"
          disabled
          onPress={() => undefined}
        />
      ) : (
        <GroupCta
          navy
          title={run.joined ? '참가 취소' : '참가하기'}
          primary={!run.joined}
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
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <BackButton tone="dark" onPress={() => navigation.goBack()} />
          <AppText style={styles.headerTitle} accessibilityRole="header">
            그룹런 상세
          </AppText>
          {/* Share only from the result screen (S15P31E105-637): detail has no reliable recordId. */}
          <View style={styles.headerSpace} />
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
              style={StyleSheet.absoluteFill}
            />
          </View>
          <Raised tone="night" style={styles.card}>
            <View style={styles.info}>
              <View style={styles.titleRow}>
                <AppText style={[styles.title, cancelled && styles.struck]}>
                  {run.title}
                </AppText>
                {cancelled ? (
                  <Pill label="취소됨" danger large />
                ) : (
                  <Pill label={dDay(run.scheduledAt, now)} large />
                )}
              </View>
              {/* The crew under the title, then a fact a row with its icon (S15P31E105-594 담당자 시안). */}
              <View style={styles.crewRow}>
                <Icon name="users" color={groupTone.sub} size={16} />
                <AppText style={styles.crewName}>{run.crewName}</AppText>
              </View>
              <View style={styles.rows}>
                <InfoRow
                  first
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
                    text={`${goalLine(run, false)} · 페이스 ${formatPace(
                      run.goalPaceSecPerKm,
                    )}`}
                  />
                )}
                {cancelled ? null : (
                  <InfoRow
                    icon="users"
                    text={`참가 ${run.participantCount}명 · 크루 멤버 ${run.crewMemberCount}명 중`}
                    right={
                      // Who comes, small and side by side on the row (S15P31E105-594 담당자 시안).
                      <View style={styles.avatars}>
                        {run.participants.slice(0, 5).map((member, index) => (
                          <Initial
                            key={member.userId}
                            name={member.nickname}
                            index={index}
                            size={26}
                            photo={member.profileImageUrl}
                            style={styles.overlap}
                          />
                        ))}
                      </View>
                    }
                  />
                )}
              </View>
              {/* 취소된 그룹런 (runway-group-screen-designs 10-7): the reason as a row with its icon. */}
              {cancelled && reason ? (
                <View style={styles.reasonRow}>
                  <Icon name="tag" color={groupTone.sub} size={18} />
                  <AppText
                    style={styles.infoText}
                  >{`사유 · ${reason.label}`}</AppText>
                </View>
              ) : null}
              {cancelled ? (
                <>
                  {run.cancellation ? (
                    <View style={styles.message}>
                      <View style={styles.messageHead}>
                        <Initial name={run.cancellation.byNickname} />
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
                    <Icon name="bell" color={groupTone.sub} size={14} />
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
                  {run.pace && run.status === 'SCHEDULED' ? (
                    <GroupPaceCard
                      pace={run.pace}
                      change={change}
                      canChangeMode={
                        run.isHost &&
                        run.status === 'SCHEDULED' &&
                        !!groupRuns.setPaceMode
                      }
                      busy={busy}
                      onChangeMode={changeMode}
                    />
                  ) : null}
                  <FitLine run={run} />
                  {run.isHost ? (
                    <View style={styles.hostRow}>
                      <Initial
                        name="나"
                        index={0}
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
          </Raised>
        </ScrollView>
        <View style={[styles.actions, { paddingBottom: insets.bottom + 12 }]}>
          {actions}
        </View>
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
  // The home card's navy page with a faint white card (S15P31E105-594 담당자 결정).
  page: { flex: 1, backgroundColor: groupTone.page },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    color: groupTone.text,
  },
  headerSpace: { width: 44 },
  content: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  mapCard: {
    height: 210,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: groupTone.card,
  },
  card: { borderRadius: 20, padding: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 23,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: groupTone.text,
  },
  struck: {
    textDecorationLine: 'line-through',
    color: groupTone.sub,
  },
  crewRow: {
    marginTop: -8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crewName: {
    fontFamily: fontFamily.medium,
    fontSize: 14.5,
    lineHeight: 20,
    color: groupTone.sub,
  },
  rows: {},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  rowLine: { borderTopWidth: 1, borderTopColor: groupTone.line },
  infoText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    color: groupTone.text,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // The card's parts, 16 apart.
  info: { gap: 16 },
  actions: {
    gap: spacing.md,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  pill: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: glass,
    justifyContent: 'center',
  },
  // D-n or 오늘 as the 시안's mint outline (a small mark, on the navy page).
  pillLarge: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: groupTone.accent,
  },
  // 취소됨 as the 시안's chip in the watch's red pink.
  pillDanger: { borderWidth: 0, backgroundColor: groupTone.danger },
  pillText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.text,
  },
  pillTextLarge: { fontSize: 14, lineHeight: 19, color: groupTone.accent },
  pillDangerText: { color: groupTone.onButton },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  fit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: groupTone.inner,
  },
  blockTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  // The ring takes the card's colour so the overlapping initials read apart.
  overlap: { marginLeft: -6, borderWidth: 2, borderColor: '#1A1D24' },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  hostLink: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.text,
  },
  hostCancel: { color: groupTone.danger },
  message: { gap: spacing.md },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  messageName: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
  messageText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 21,
    color: groupTone.text,
    padding: 12,
    borderRadius: 12,
    backgroundColor: groupTone.inner,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  opens: { textAlign: 'center', color: groupTone.sub },
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
