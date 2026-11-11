import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import {
  CommonActions,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { AppText, BottomSheet, Icon, useToast } from '../../components';
import {
  DataError,
  spotifyFailureMessage,
  SpotifyStateError,
  useRepositories,
  type GroupRunLive,
  type MusicState,
} from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { controlModeOf, statusOf } from '../run/RunProgressScreen';
import { RunControlBar } from '../run/live/RunControlBar';
import {
  liveLook,
  RunLiveFrame,
  type LivePage,
  type LiveView,
} from '../run/live/RunLiveFrame';
import {
  LiveMapPanel,
  LiveMusicRow,
  averagePace,
  metricPages,
  useRunHistory,
  type MusicCommand,
} from '../run/live/RunLivePages';
import { useRunSession } from '../run/RunSession';
import { groupTone, NumText } from './look';
import { ColorBar, stand, StandButton, standingBarColor } from './stand';
import { MissingTarget } from './MissingTarget';

type Tab = 'summary' | 'group';

const noSample = {
  elapsedSec: 0,
  paceSecPerKm: null,
  distanceM: 0,
  heartRate: null,
  cadence: null,
};

// 6.6b: the server's advice to slow the group; the pace is never changed for the user.
function LoadAlert({
  alert,
}: {
  alert: NonNullable<GroupRunLive['loadAlert']>;
}) {
  return (
    <View style={styles.alert} accessibilityLiveRegion="assertive">
      <Icon name="heart" color={groupTone.danger} size={18} />
      <View style={styles.flex}>
        <AppText style={styles.alertTitle}>
          {`멤버 ${alert.memberCount}명 페이스 조정 권고`}
        </AppText>
        <AppText style={styles.sub}>
          {`그룹 페이스를 ${formatPace(
            alert.nextPaceSecPerKm,
          )}로 늦추는 것을 권장해요`}
        </AppText>
      </View>
    </View>
  );
}

// 그룹: the shared pace, the spread and who is ahead or behind by how far, from G10. Members' places on the
// map are not given by the server, so this page shows distances only.
function GroupPage({
  live,
  liveError,
  goal,
  myPace,
}: {
  live: GroupRunLive | null;
  liveError: boolean;
  goal: number;
  myPace: number | null;
}) {
  const guide = live?.guidePaceSecPerKm ?? goal;
  const rows = live
    ? [...live.members].sort(
        (a, b) =>
          (a.rank ?? Number.MAX_SAFE_INTEGER) -
            (b.rank ?? Number.MAX_SAFE_INTEGER) ||
          (b.gapM ?? -Infinity) - (a.gapM ?? -Infinity),
      )
    : [];
  // Arranged as in 담당자 시안 (S15P31E105-594 담당자 시안) in the run screen's own colours (담당자 결정: 색은 그대로,
  // 구성만 시안대로): the guide pace big with its unit apart, a line, then the spread; the table with its head
  // over a line and a line between members.
  return (
    <View style={styles.page}>
      {live?.loadAlert ? <LoadAlert alert={live.loadAlert} /> : null}
      <View style={styles.guide}>
        <AppText style={styles.label}>
          {guide === goal ? '공동 목표 페이스' : '지금 안내 페이스'}
        </AppText>
        <View style={styles.bigLine}>
          <AppText style={styles.big}>{formatPace(guide)}</AppText>
          <AppText style={styles.bigUnit}>/km</AppText>
        </View>
        {guide !== goal ? (
          <NumText
            text={`지금 안내 ${formatPace(guide)} · 출발 목표 ${formatPace(
              goal,
            )}`}
            style={styles.sub}
          />
        ) : null}
        {live ? (
          <>
            <View style={styles.rule} />
            <NumText
              text={`${
                live.inRange === null
                  ? '현재 선두–후미 간격 '
                  : live.inRange
                  ? '그룹 범위 안이에요 · 선두–후미 '
                  : '그룹 범위를 벗어났어요 · 선두–후미 '
              }${live.spreadM === null ? '미확인' : `${live.spreadM}m`}`}
              style={[styles.spread, live.inRange === false && styles.warn]}
            />
          </>
        ) : null}
      </View>
      {/* 조회 상태 (S15P31E105-594 담당자 시안): the line on a tile with an icon before it. */}
      {liveError ? (
        <View style={[styles.errorRow, styles.noteRow]}>
          <Icon name="alert" color={liveLook.sub} size={18} />
          <AppText
            style={[styles.sub, styles.flex]}
            accessibilityLiveRegion="polite"
          >
            최신 현황을 확인하지 못했어요. 연결 상태를 확인해 주세요.
          </AppText>
        </View>
      ) : null}
      {live ? (
        <View style={styles.table}>
          <View style={[styles.row, styles.headRow]}>
            <AppText style={[styles.head, styles.flex]}>
              순위 · 최신 현황
            </AppText>
            <AppText style={[styles.head, styles.gapCol]}>나와의 거리</AppText>
            <AppText style={[styles.head, styles.paceCol]}>페이스</AppText>
          </View>
          {rows.map((member, index) => {
            const role = member.stale
              ? '미확인'
              : member.rank != null
              ? `${member.rank}위`
              : index === 0
              ? '선두'
              : index === rows.length - 1
              ? '후미'
              : '';
            const pace = member.paceSecPerKm ?? (member.isMe ? myPace : null);
            return (
              <View
                key={member.userId}
                style={[
                  styles.row,
                  styles.rowLine,
                  member.isMe && styles.meRow,
                ]}
              >
                <NumText text={role} style={styles.role} />
                <ColorBar
                  color={standingBarColor(index, rows.length)}
                  style={styles.bar}
                />
                <AppText
                  style={[styles.name, styles.flex, member.isMe && styles.mint]}
                  numberOfLines={1}
                >
                  {member.isMe ? `${member.nickname} (나)` : member.nickname}
                </AppText>
                <NumText
                  text={
                    member.isMe
                      ? '–'
                      : member.gapM === null
                      ? '—'
                      : `${member.gapM > 0 ? '↑' : '↓'} ${Math.abs(
                          member.gapM,
                        )}m`
                  }
                  style={[
                    styles.value,
                    styles.gapCol,
                    !member.isMe &&
                      member.gapM !== null &&
                      member.gapM > 0 &&
                      styles.mint,
                  ]}
                />
                <NumText
                  text={pace ? formatPace(pace) : '– –'}
                  style={[
                    styles.value,
                    styles.paceCol,
                    member.isMe && styles.mint,
                  ]}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// The group's notice above the controls, arranged as the 일시정지 card of 담당자 시안 (S15P31E105-594 담당자 시안): the
// line on a tile beside an icon, and its action (그룹 전체 강제 종료 · 그룹런 결과 보기) under a line, centred. It keeps
// LiveNotice's colours and labels.
function GroupNotice({
  label,
  text,
  action,
}: {
  label: string;
  text: string;
  action?: { label: string; onPress: () => void } | null;
}) {
  return (
    <View style={styles.notice}>
      <View style={styles.noteRow}>
        <Icon name="alert" color={liveLook.sub} size={18} />
        <AppText
          style={[styles.noticeText, styles.flex]}
          accessibilityLabel={label}
          accessibilityLiveRegion="polite"
        >
          {text}
        </AppText>
      </View>
      {action ? (
        <>
          <View style={styles.rule} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={8}
            style={styles.noticeButton}
          >
            <AppText style={styles.noticeAction}>{action.label}</AppText>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

// 6.6 그룹런 진행 (S15P31E105-517): the same frame as 4.2 with 요약 · 그룹 pages. Pausing stays here, and
// pause and finish apply to my record only; the leader of this run can also end it for everyone.
export function GroupRunProgressScreen({
  initialTab = 'summary',
}: {
  initialTab?: Tab;
}) {
  const { run } = useRunSession();
  const groupRunId = run?.config.groupRunId;
  // Only a started group run opens here (6.5 starts it first). Without one no mock run is started
  // (S15P31E105-635).
  if (!groupRunId) {
    return <MissingTarget title="진행 중인 그룹런이 없어요" />;
  }
  return (
    <GroupRunProgressContent initialTab={initialTab} groupRunId={groupRunId} />
  );
}

function GroupRunProgressContent({
  initialTab,
  groupRunId,
}: {
  initialTab: Tab;
  groupRunId: string;
}) {
  const navigation = useNavigation();
  const { groupRuns, music } = useRepositories();
  const toast = useToast();
  const { run, pause, resume, finish } = useRunSession();
  const [view, setView] = useState<LiveView>('numbers');
  // 6.6r opens on 그룹, after the four number pages.
  const [page, setPage] = useState(initialTab === 'group' ? 4 : 0);
  const [live, setLive] = useState<GroupRunLive | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [player, setPlayer] = useState<MusicState | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const finishing = useRef(false);
  // 결과 화면으로 한 번만 넘어간다. 그룹장이 끝냈거나(SERVER_END) 내 종료가 서버에 저장되면 내 기록도 끝난다(S15P31E105-420).
  const leftForResult = useRef(false);
  useFocusEffect(
    useCallback(
      () =>
        groupRuns.watchLive(
          groupRunId,
          value => {
            setLiveError(false);
            setLive(value);
          },
          () => {
            // Keep the last good snapshot so a transient poll failure does not
            // blank the board; only first-load failure leaves live null.
            setLiveError(true);
          },
        ),
      [groupRunId, groupRuns],
    ),
  );
  useEffect(() => {
    let active = true;
    groupRuns.get(groupRunId).then(
      detail => active && setIsHost(detail.isHost),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [groupRunId, groupRuns]);
  useEffect(() => {
    let active = true;
    music.getState().then(
      state => active && setPlayer(state),
      error => {
        if (active && error instanceof SpotifyStateError) {
          setPlayer(error.state);
        }
      },
    );
    const stop = music.subscribe?.(state => {
      if (active) {
        setPlayer(state);
      }
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [music]);
  const runMusic = async (command: MusicCommand) => {
    setMusicBusy(true);
    try {
      setPlayer(await music[command]());
    } catch (error) {
      if (error instanceof SpotifyStateError) {
        setPlayer(error.state);
      }
      const message = spotifyFailureMessage(error, '음악을 조작하지 못했어요');
      if (message) {
        toast(message);
      }
    }
    setMusicBusy(false);
  };

  const history = useRunHistory(
    run?.sample ?? noSample,
    run?.startedAt ?? 'none',
  );
  const status = useRef(run?.status);
  status.current = run?.status;
  const endedRunId =
    run?.status === 'finished' ? run.config.groupRunId : undefined;
  useEffect(() => {
    if (!endedRunId || leftForResult.current) {
      return;
    }
    leftForResult.current = true;
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'MainTabs' },
          { name: 'GroupRunResult', params: { groupRunId: endedRunId } },
        ],
      }),
    );
  }, [endedRunId, navigation]);
  const latest = useRef({ pause, toast });
  latest.current = { pause, toast };
  // The back key never leaves or resumes the run: while running it pauses, while paused it stays.
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        if (status.current === 'running') {
          latest.current.pause();
        } else {
          latest.current.toast('재개하거나 종료를 길게 눌러 러닝을 끝내요');
        }
        return true;
      });
      return () => back.remove();
    }, []),
  );

  if (!run) {
    return <View style={[styles.flex, styles.ground]} />;
  }
  const { config, sample, trail, trailParts } = run;
  const goal = config.goalPaceSecPerKm ?? 360;
  const toResult = () => {
    leftForResult.current = true;
    finish();
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'MainTabs' },
          {
            name: 'GroupRunResult',
            params: run.config.groupRunId
              ? { groupRunId: run.config.groupRunId }
              : undefined,
          },
        ],
      }),
    );
  };
  const mode = controlModeOf(run.status, null);
  const paused = run.status === 'paused';
  const ended = live?.status === 'COMPLETED' || live?.status === 'CANCELLED';
  const showPlayer =
    player?.source && player.source !== 'NONE' && player.linked;

  const pages: LivePage[] = [
    ...metricPages({
      pace: sample.paceSecPerKm,
      goalPace: live?.guidePaceSecPerKm ?? goal,
      distanceM: sample.distanceM,
      totalM: config.plan?.distanceM ?? null,
      elapsedSec: sample.elapsedSec,
      heartRate: sample.heartRate,
      cadence: sample.cadence,
      targetBpm: null,
      history,
      rival: null,
      guidance: null,
      group: true,
    }),
    {
      key: 'group',
      title: '그룹',
      content: (
        <GroupPage
          live={live}
          liveError={liveError}
          goal={goal}
          myPace={sample.paceSecPerKm}
        />
      ),
    },
  ];

  return (
    <>
      <RunLiveFrame
        // A long course name shrinks in the title; the group size keeps its own line.
        title={config.plan ? config.plan.name : '그룹런'}
        group
        status={statusOf(mode)}
        subtitle={`그룹런 ${live?.members.length ?? 1}명`}
        pages={pages}
        page={page}
        onPageChange={setPage}
        view={view}
        renderMap={({ area, logo }) => (
          <LiveMapPanel
            route={config.plan?.route}
            trail={trail}
            trailParts={trailParts ?? undefined}
            area={area}
            logo={logo}
            group
          />
        )}
        mapSummary={[
          { label: '거리', value: formatKm(sample.distanceM), unit: 'km' },
          { label: '운동 시간', value: formatDuration(sample.elapsedSec) },
          {
            label: '평균 페이스',
            value: (() => {
              const average = averagePace(sample.elapsedSec, sample.distanceM);
              return average === null ? '– –' : formatPace(average);
            })(),
            unit: '/km',
          },
        ]}
        elapsedSec={sample.elapsedSec}
        paused={paused}
        notes={
          <>
            {ended ? (
              <GroupNotice
                label="그룹런 종료 안내"
                text="그룹런이 종료되었어요"
                action={{
                  label: '그룹런 결과 보기',
                  onPress: () =>
                    navigation.navigate('GroupRunResult', { groupRunId }),
                }}
              />
            ) : null}
            {paused ? (
              <GroupNotice
                label="그룹런 일시정지 안내"
                text={
                  '일시정지·종료는 내 기록에만 적용돼요.\n다른 멤버는 계속 달려요.'
                }
                action={
                  isHost
                    ? {
                        label: '그룹 전체 강제 종료',
                        onPress: () => setConfirming(true),
                      }
                    : null
                }
              />
            ) : null}
          </>
        }
        music={
          showPlayer && player ? (
            <LiveMusicRow
              music={player}
              busy={musicBusy}
              onCommand={runMusic}
            />
          ) : null
        }
        controls={
          <RunControlBar
            mode={mode}
            view={view}
            onToggleView={() =>
              setView(current => (current === 'numbers' ? 'map' : 'numbers'))
            }
            onPause={pause}
            onResume={resume}
            onFinish={toResult}
            finishHint="종료는 1초 길게 · 내 기록만 끝나요"
            group
          />
        }
      />
      {/* 그룹 전체 종료 확인, centred as in 담당자 시안 (S15P31E105-594 담당자 시안): the red pink alert, the question, the
          line, then 돌아가기 and 전체 종료 side by side. */}
      <BottomSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        background={stand.sheet}
      >
        <View style={[styles.sheetIcon, { backgroundColor: stand.dangerFill }]}>
          <Icon name="alert" color={stand.danger} size={22} />
        </View>
        <AppText accessibilityRole="header" style={styles.sheetTitle}>
          그룹런을 모두 끝낼까요?
        </AppText>
        <AppText style={styles.sheetText}>
          달리고 있는 멤버의 기록도 지금까지로 끝나요. 완주로 바뀌지는 않아요.
        </AppText>
        <View style={styles.sheetButtons}>
          <StandButton
            title="돌아가기"
            tone="outline"
            style={styles.flex}
            onPress={() => setConfirming(false)}
          />
          <StandButton
            title="전체 종료"
            tone="danger"
            style={styles.flex}
            onPress={async () => {
              if (finishing.current || !run.config.groupRunId) {
                return;
              }
              finishing.current = true;
              try {
                await groupRuns.forceFinish(run.config.groupRunId);
                setConfirming(false);
                toResult();
              } catch (error) {
                const code =
                  error instanceof DataError ? error.code : undefined;
                toast(
                  error instanceof DataError && error.status === 409
                    ? code === 'INVALID_GROUP_STATE'
                      ? '이미 취소되었거나 끝난 그룹런이에요. 상세에서 상태를 확인해 주세요'
                      : error.message ||
                        '지금은 전체 종료를 할 수 없어요. 그룹 상태를 확인해 주세요'
                    : '전체 종료 응답을 확인하지 못했어요. 그룹 상태를 확인한 뒤 다시 시도해 주세요',
                );
              } finally {
                finishing.current = false;
              }
            }}
          />
        </View>
      </BottomSheet>
    </>
  );
}

// 6.6r opens the same screen on the 그룹 page.
export function GroupRunPositionScreen() {
  return <GroupRunProgressScreen initialTab="group" />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  ground: { backgroundColor: liveLook.ground },
  page: { flex: 1, paddingHorizontal: 19, gap: 12 },
  // 그룹런 시안 (S15P31E105-673): the guide pace in mint, big, over a line and the spread.
  guide: { gap: 4 },
  label: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.mint,
  },
  bigLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  big: {
    fontFamily: fontFamily.resultBlack,
    fontSize: 54,
    lineHeight: 64,
    letterSpacing: -1.5,
    color: stand.mint,
  },
  bigUnit: {
    fontFamily: fontFamily.numberBold,
    fontSize: 18,
    lineHeight: 22,
    color: stand.sub,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: stand.sub,
  },
  spread: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 21,
    color: stand.text,
  },
  warn: { color: stand.danger },
  rule: { height: 1, marginVertical: 8, backgroundColor: stand.line },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorRow: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: stand.field,
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: stand.dangerFill,
  },
  alertTitle: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.text,
  },
  // The standings as a table: its head over a heavier line, a thin line under each member.
  table: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  headRow: {
    minHeight: 32,
    gap: 8,
    borderBottomColor: stand.rule,
  },
  rowLine: {},
  // My row lit in mint, reaching 10 past the page's sides.
  meRow: {
    marginHorizontal: -10,
    paddingHorizontal: 10,
    backgroundColor: stand.meFill,
    borderBottomColor: stand.meLine,
  },
  mint: { color: stand.mint },
  head: {
    fontFamily: fontFamily.regular,
    fontSize: 13.5,
    lineHeight: 18,
    color: stand.sub,
  },
  role: {
    width: 56,
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: stand.text,
  },
  bar: { marginRight: 12 },
  name: {
    fontFamily: fontFamily.black,
    fontSize: 18.5,
    lineHeight: 25,
    color: stand.text,
  },
  value: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 16.5,
    lineHeight: 22,
    color: stand.text,
    textAlign: 'right',
  },
  gapCol: { width: 100, textAlign: 'right' },
  paceCol: { width: 76, textAlign: 'right' },
  // The pause notice: the line beside an icon between thin lines, its action under it, centred and underlined.
  notice: {
    paddingTop: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: stand.line,
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
    paddingBottom: 10,
  },
  noticeText: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 20,
    color: stand.text,
  },
  noticeButton: {
    alignSelf: 'center',
    minHeight: 32,
    justifyContent: 'center',
  },
  noticeAction: {
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 20,
    color: stand.text,
    textDecorationLine: 'underline',
  },
  sheetIcon: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: fontFamily.black,
    fontSize: 22,
    lineHeight: 30,
    color: stand.text,
  },
  sheetText: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 21,
    color: stand.sub,
  },
  // 돌아가기 and 전체 종료 side by side, as in the 시안.
  sheetButtons: { flexDirection: 'row', gap: 8, marginTop: 18 },
});
