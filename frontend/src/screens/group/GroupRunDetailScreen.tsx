import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  EmptyState,
  Icon,
  IconButton,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
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
import { fontFamily, k1, size, spacing, useTheme } from '../../theme';
import { RunMap, type RunMapLogo } from '../../components/RunMap';
import { MapScreenFrame } from '../run/MapScreenFrame';
import { GroupCta, groupLook, Raised } from './look';
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
const muted = groupLook.onLightSub;
const glass = groupLook.lightFill;

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
  return (
    <View style={styles.fit}>
      <AppText style={styles.blockTitle}>{verdict}</AppText>
      <AppText style={styles.muted}>
        {`최근 러닝 평균 ${formatPace(run.myFit.recentPaceSecPerKm)} · 준비도 ${
          run.myFit.readinessScore ?? '미산출'
        }`}
      </AppText>
    </View>
  );
}

// A pill: the one beside the title (D-n as a raised navy pill like 6.0's 오늘, or 취소됨 in coral) and the
// light grey tags on the cards.
function Pill({
  label,
  danger = false,
  large = false,
}: {
  label: string;
  danger?: boolean;
  large?: boolean;
}) {
  if (large && !danger) {
    return (
      <Raised tone="navy" style={[styles.pill, styles.pillLarge]}>
        <AppText style={[styles.pillText, styles.pillTextLarge, styles.onNavy]}>
          {label}
        </AppText>
      </Raised>
    );
  }
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

// Where the course goes: between the round header buttons and the sheet, a little clear of both; a lone
// meeting place in the middle of that.
function mapArea(hasRoute: boolean, logo: RunMapLogo | undefined) {
  const bottom = logo ? 1 - logo.above - 0.04 : 0.45;
  const top = 0.14;
  if (hasRoute) {
    return { top, bottom: Math.max(top + 0.1, bottom) };
  }
  const middle = (top + bottom) / 2;
  return { top: middle, bottom: middle };
}

// 6.4 그룹런 상세, and 6.4e 취소 완료 when the run was cancelled.
export function GroupRunDetailScreen() {
  const navigation = useNavigation();
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

  if (!run) {
    return (
      <SafeAreaView style={[styles.root, styles.loadingRoot]}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
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

  const actions = cancelled ? (
    <View style={styles.buttonRow}>
      <View style={styles.flex}>
        <GroupCta
          navy
          title="다시 만들기"
          primary={false}
          onPress={() =>
            navigation.navigate('GroupRunCreate', {
              crewId: run.crewId,
            })
          }
        />
      </View>
      <View style={styles.flex}>
        <GroupCta
          navy
          title="내 크루로"
          icon="arrowRight"
          onPress={() => navigateTo(navigation, 'MyCrews')}
        />
      </View>
    </View>
  ) : enterable ? (
    <GroupCta
      navy
      title={run.isHost ? '대기방 입장 · 그룹장' : '대기방 입장'}
      icon="arrowRight"
      onPress={() => navigation.navigate('WaitingRoom', { groupRunId: run.id })}
    />
  ) : (
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
          icon="arrowRight"
          disabled
          onPress={() => undefined}
        />
      ) : (
        <GroupCta
          navy
          title={run.joined ? '참가 취소' : '참가하기'}
          icon={run.joined ? undefined : 'plus'}
          primary={!run.joined}
          disabled={busy}
          onPress={toggleJoin}
        />
      )}
    </>
  );

  // Laid out like 2.0 코스 러닝 (담당자 요청, S15P31E105-563): the map full screen and one white sheet at the
  // bottom holding the title, every fact and the button. The former cards are sections set apart by
  // space only: the title with its round pill, when and where, the course, who comes, my fit and the host
  // row. Only what a runner needs: the duplicates and the computed time are gone.
  return (
    <MapScreenFrame
      // A white sheet rather than 2.0's glass (담당자 요청).
      sheetColor="#FFFFFF"
      renderMap={logo => (
        <RunMap
          muted={cancelled}
          route={run.route ?? undefined}
          position={run.route ? undefined : run.meetingPosition}
          // Between the header and the sheet, as measured (the sheet's height changes with what it holds).
          area={mapArea(Boolean(run.route), logo)}
          logo={logo}
          interactive={false}
          style={StyleSheet.absoluteFill}
        />
      )}
      top={
        <View style={styles.topRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.flex} />
          {!cancelled ? (
            <IconButton
              icon="share"
              accessibilityLabel="공유"
              onPress={() => navigateTo(navigation, 'PostWrite')}
            />
          ) : null}
        </View>
      }
      bottom={
        <>
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
            <View style={styles.section}>
              <View style={styles.tags}>
                <Pill label={run.crewName} />
                <Pill label={formatSchedule(run.scheduledAt)} />
                <Pill label={run.meetingPlaceName} />
              </View>
              {!cancelled ? (
                <AppText style={styles.muted}>{run.meetingAddress}</AppText>
              ) : null}
            </View>
            {cancelled ? (
              reason ? (
                <View style={styles.tags}>
                  <Pill label={`사유 · ${reason.label}`} />
                </View>
              ) : null
            ) : (
              <View style={styles.tags}>
                <Pill label={goalLine(run, false)} />
                <Pill label={`페이스 ${formatPace(run.goalPaceSecPerKm)}`} />
              </View>
            )}
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
                  <Icon name="bell" color={muted} size={14} />
                  <AppText style={styles.muted}>
                    {`크루 멤버 ${run.crewMemberCount}명에게 취소 알림을 보냈어요`}
                  </AppText>
                </View>
              </>
            ) : (
              <>
                <View style={styles.avatars}>
                  {run.participants.slice(0, 5).map((member, index) => (
                    <Initial
                      key={member.userId}
                      name={member.nickname}
                      index={index}
                      style={styles.overlap}
                    />
                  ))}
                  <AppText style={[styles.muted, styles.count]}>
                    {`${run.participantCount}명 참가 · 크루 멤버 ${run.crewMemberCount}명 중`}
                  </AppText>
                </View>
                <FitLine run={run} />
                {run.isHost ? (
                  <View style={styles.hostRow}>
                    <Initial name="나" index={0} size={28} />
                    <AppText style={[styles.muted, styles.flex]}>
                      내가 만든 그룹런
                    </AppText>
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
                      <AppText style={[styles.hostLink, styles.hostCancel]}>
                        그룹런 취소
                      </AppText>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>
          {/* The navy pill button like 6.0's 대기방 입장, inside the sheet as 2.0's 러닝 시작. */}
          <View style={styles.actions}>{actions}</View>
        </>
      }
    />
  );
}

// Buttons at the bottom of the group screens (DESIGN.md 2-10). They read the tone they sit in:
// primary is the solid accent pill, danger the coral fill (6.4d 취소하기), dangerOutline the coral
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
        backgroundColor: k1.coral,
        borderColor: k1.coral,
        color: colors.onDanger,
      }
    : dangerOutline
    ? {
        backgroundColor: 'transparent',
        borderColor: k1.coral,
        color: k1.coral,
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
  loadingRoot: { backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  headerRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
  },
  // The back and share buttons over the map; MapScreenFrame keeps them 16 from the edges.
  topRow: { flexDirection: 'row', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 28,
    lineHeight: 35,
    letterSpacing: -0.6,
    color: groupLook.onLight,
  },
  struck: {
    textDecorationLine: 'line-through',
    color: groupLook.onLightSub,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // The sheet's facts, sections 16 apart with no line between them (6.4 has no hairlines, 담당자 요청).
  info: { gap: 16 },
  section: { gap: 10 },
  actions: { gap: spacing.md, marginTop: 4 },
  pill: {
    height: 30,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: glass,
    justifyContent: 'center',
  },
  pillLarge: { height: 34, paddingHorizontal: 14, borderRadius: 17 },
  pillDanger: { backgroundColor: 'rgba(226,135,111,0.16)' },
  pillText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLight,
  },
  pillTextLarge: { fontSize: 15, lineHeight: 20 },
  onNavy: { color: groupLook.onDark },
  pillDangerText: { color: k1.coral },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: muted,
  },
  fit: { gap: 4 },
  blockTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  // The ring takes the white sheet's colour so the overlapping initials read apart.
  overlap: { marginRight: -6, borderWidth: 2, borderColor: '#FFFFFF' },
  count: { marginLeft: spacing.xxl },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  hostLink: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: groupLook.onLight,
  },
  hostCancel: { color: k1.coral },
  message: { gap: spacing.md },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  messageName: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLight,
  },
  messageText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 21,
    color: groupLook.onLight,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  opens: { textAlign: 'center' },
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
