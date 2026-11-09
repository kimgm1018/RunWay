import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
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
import { useSession } from '../../session/SessionProvider';
import { fontFamily, k1 } from '../../theme';
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
  LiveNotice,
  metricPages,
  useRunHistory,
  type MusicCommand,
} from '../run/live/RunLivePages';
import { useRunSession } from '../run/RunSession';
import { FooterButton } from './GroupRunDetailScreen';

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
      <Icon name="heart" color={k1.coral} size={18} />
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
  return (
    <View style={styles.page}>
      {live?.loadAlert ? <LoadAlert alert={live.loadAlert} /> : null}
      <View style={styles.tile}>
        <AppText style={styles.label}>
          {guide === goal ? '공동 목표 페이스' : '지금 안내 페이스'}
        </AppText>
        <AppText style={styles.big}>{`${formatPace(guide)}/km`}</AppText>
        {guide !== goal ? (
          <AppText style={styles.sub}>
            {`지금 안내 ${formatPace(guide)} · 출발 목표 ${formatPace(goal)}`}
          </AppText>
        ) : null}
        {live ? (
          <AppText style={[styles.sub, live.inRange === false && styles.warn]}>
            {`${
              live.inRange === null
                ? '현재 선두–후미 간격 '
                : live.inRange
                ? '그룹 범위 안이에요 · 선두–후미 '
                : '그룹 범위를 벗어났어요 · 선두–후미 '
            }${live.spreadM === null ? '미확인' : `${live.spreadM}m`}`}
          </AppText>
        ) : null}
      </View>
      {liveError ? (
        <AppText style={styles.sub} accessibilityLiveRegion="polite">
          최신 현황을 확인하지 못했어요. 연결 상태를 확인해 주세요.
        </AppText>
      ) : null}
      {live ? (
        <View style={styles.tile}>
          <View style={styles.row}>
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
              <View key={member.userId} style={styles.row}>
                <AppText style={styles.role}>{role}</AppText>
                <AppText style={[styles.name, styles.flex]} numberOfLines={1}>
                  {member.isMe ? `${member.nickname} (나)` : member.nickname}
                </AppText>
                <AppText style={[styles.value, styles.gapCol]}>
                  {member.isMe
                    ? '–'
                    : member.gapM === null
                    ? '—'
                    : `${member.gapM > 0 ? '↑' : '↓'} ${Math.abs(
                        member.gapM,
                      )}m`}
                </AppText>
                <AppText style={[styles.value, styles.paceCol]}>
                  {pace ? formatPace(pace) : '– –'}
                </AppText>
              </View>
            );
          })}
        </View>
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
  const navigation = useNavigation();
  const { groupRuns, music } = useRepositories();
  const toast = useToast();
  const { run, start, pause, resume, finish } = useRunSession();
  const { ensureRunLogin } = useSession();
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
            setLiveError(true);
            setLive(null);
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
  const { config, sample, trail } = run;
  const goal = config.goalPaceSecPerKm ?? 360;
  const toResult = () => {
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
            area={area}
            logo={logo}
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
              <LiveNotice
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
              <LiveNotice
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
          />
        }
      />
      <BottomSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="그룹런을 모두 끝낼까요?"
        description="달리고 있는 멤버의 기록도 지금까지로 끝나요. 완주로 바뀌지는 않아요."
      >
        <View style={styles.sheetButtons}>
          <FooterButton title="돌아가기" onPress={() => setConfirming(false)} />
          <FooterButton
            title="전체 종료"
            danger
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
  ground: { backgroundColor: liveLook.ground },
  page: { flex: 1, paddingHorizontal: 20, gap: 12 },
  tile: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: liveLook.tile,
    gap: 6,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.sub,
  },
  big: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 32,
    lineHeight: 40,
    color: liveLook.text,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: liveLook.sub,
  },
  warn: { color: liveLook.paused },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(226, 135, 111, 0.16)',
  },
  alertTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.text,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  head: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.muted,
  },
  role: {
    width: 44,
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: liveLook.sub,
  },
  name: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: liveLook.text,
  },
  value: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 16,
    lineHeight: 20,
    color: liveLook.text,
    textAlign: 'right',
  },
  gapCol: { width: 100, textAlign: 'right' },
  paceCol: { width: 64, textAlign: 'right' },
  sheetButtons: { flexDirection: 'row', gap: 10 },
});
