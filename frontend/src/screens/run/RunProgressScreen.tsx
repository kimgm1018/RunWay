import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import {
  CommonActions,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { AppText, useToast } from '../../components';
import { useRepositories } from '../../data';
import {
  formatDuration,
  formatKm,
  formatPace,
  withoutDistance,
} from '../../format';
import { controlNotice, takeoverNotice } from './controlNotice';
import { RunControlBar, type ControlMode } from './live/RunControlBar';
import {
  liveLook,
  RunLiveFrame,
  type LivePage,
  type LiveView,
} from './live/RunLiveFrame';
import {
  CoachingPage,
  LiveMapPanel,
  LiveMusicRow,
  averagePace,
  LiveNotice,
  metricPages,
  useRunHistory,
} from './live/RunLivePages';
import { liveDelayNotice } from './liveDelay';
import { comparisonLine } from './recordComparison';
import { useLiveMusic } from './useLiveMusic';
import type { RunControlState } from './runControl';
import { goalPaceOf, useRunControlState, useRunSession } from './RunSession';
import { useRunForeground } from './useRunForeground';

const noSample = {
  elapsedSec: 0,
  paceSecPerKm: null,
  distanceM: 0,
  heartRate: null,
  cadence: null,
};

// Which controls show, from the confirmed run state and the request still waiting for the server or watch.
// A request that ended in a problem is not waiting any more; its notice says what happened.
export function controlModeOf(
  status: 'running' | 'paused' | 'finished',
  control: RunControlState | null,
): ControlMode {
  const waiting =
    control && control.problem === null
      ? control.pending?.action ?? null
      : null;
  if (waiting === 'END') {
    return 'finishing';
  }
  if (waiting === 'RESUME') {
    return 'resuming';
  }
  if (waiting === 'PAUSE') {
    return 'pausing';
  }
  return status === 'paused' ? 'paused' : 'running';
}

// The line under the title only when the phone records (after a takeover). With the watch recording it stays
// empty: the status pill already says 기록 중 (담당자 결정).
export function recordingDevice(control: RunControlState | null) {
  if (control?.recordingMode === 'PHONE_FALLBACK' || control?.recordingMode === 'PHONE_ONLY') {
    return control.phoneGps === 'off'
      ? '폰으로 기록 중 · 위치 권한이 없어 경로는 남지 않아요'
      : '폰으로 기록 중';
  }
  return null;
}

// 워치 기록 중 위치를 이만큼 받지 못하면 지도에 "위치 확인 중"을 띄운다(S15P31E105-549).
export const LOCATING_AFTER_MS = 30_000;

// 지도 보기의 작은 위치 안내. 워치 기록으로 달리는 중에 워치·폰 어느 쪽에서도 쓸 수 있는 위치를 30초 넘게 받지 못했을 때만
// 보인다. 한쪽 위치라도 오면 경로는 그쪽으로 채워지므로 띄우지 않는다. 거리·심박은 워치가 재므로 요약 화면에는 넣지 않는다.
export function locatingNotice(control: RunControlState | null, nowMs: number) {
  if (
    control?.recordingMode !== 'WATCH' ||
    control.status !== 'RUNNING' ||
    !control.startedAt
  ) {
    return null;
  }
  const at = control.live?.positionReceivedAt ?? null;
  return at === null || nowMs - at > LOCATING_AFTER_MS ? '위치 확인 중' : null;
}

export function statusOf(mode: ControlMode) {
  switch (mode) {
    case 'pausing':
    case 'resuming':
    case 'finishing':
      return { text: '확인 중', tone: 'waiting' as const };
    case 'paused':
      return { text: '일시정지', tone: 'paused' as const };
    default:
      return { text: '기록 중', tone: 'live' as const };
  }
}

// 4.2 러닝 진행 (S15P31E105-517): number pages (요약 · 코칭) or the map in the middle, the run time and the
// controls fixed at the foot. Pausing stays on this screen: the foot turns into 재개 · 종료.
export function RunProgressScreen() {
  const navigation = useNavigation();
  const { music, clock } = useRepositories();
  const toast = useToast();
  const { run, start, pause, resume, finish, recheck, takeOver } =
    useRunSession();
  const control = useRunControlState();
  const [view, setView] = useState<LiveView>('numbers');
  const [page, setPage] = useState(0);
  const {
    player,
    busy: musicBusy,
    command: runMusic,
  } = useLiveMusic(music, toast);

  const history = useRunHistory(
    run?.sample ?? noSample,
    run?.startedAt ?? 'none',
  );
  const status = useRef(run?.status);
  const foreground = useRunForeground();
  status.current = run?.status;
  const latest = useRef({ pause, toast });
  latest.current = { pause, toast };

  // 워치에서 종료해도 결과로 넘어간다. 결과는 진행 화면을 대신하므로 뒤로 가도 끝난 러닝이 다시 열리지 않는다.
  useEffect(() => {
    if (foreground && run?.status === 'finished') {
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [{ name: 'MainTabs' }, { name: 'RunResult' }],
        }),
      );
    }
  }, [foreground, navigation, run?.status]);

  // The back key never leaves or resumes a run: while running it asks to pause, while paused it stays.
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

  // Opened without a configured run (for example from a deep link): start a free run.
  useEffect(() => {
    if (!run) {
      start({
        mode: 'FREE',
        plan: null,
        goalDistanceM: null,
        goalPaceSecPerKm: null,
      });
    }
  }, [run, start]);

  if (!run) {
    return <View style={styles.empty} />;
  }
  const { config, sample, guidance, trail, trailParts } = run;
  const plan = config.plan;
  const total = plan?.distanceM ?? config.goalDistanceM;
  const goalPace = goalPaceOf(config);
  // 경쟁 모드: the server's same-distance comparison with the chosen earlier run (S15P31E105-422).
  const rival = comparisonLine(control?.comparison);
  const title = plan
    ? `${withoutDistance(plan.name)} ${formatKm(plan.distanceM, 1)}km${
        rival ? ' · 경쟁 모드' : ''
      }`
    : '자유 러닝';
  const mode = controlModeOf(run.status, control);
  const notice = controlNotice(control?.problem ?? null, [
    'PAUSE',
    'RESUME',
    'END',
  ]);
  // 워치 단절·측정 끊김과 폰으로 기록 계속(S08 TAKE_OVER_PHONE, S15P31E105-464). Phone recording itself is in the
  // header, so only the offer and the move in progress show here.
  const takeover = takeoverNotice(control);
  const takeoverShown =
    takeover && (takeover.offer || control?.pending?.action === 'TAKE_OVER')
      ? takeover
      : null;
  // 마지막으로 받은 실측값이 오래되면 알린다(S15P31E105-528). 화면은 시계 틱마다 다시 그려져 초가 갱신된다.
  const delay = liveDelayNotice(
    control?.live ?? null,
    Date.now(),
    run.status === 'running',
  );

  // 페이스 · 거리 · 심박 · 케이던스, one page each (S15P31E105-517), then 코칭.
  const pages: LivePage[] = metricPages({
    pace: sample.paceSecPerKm,
    goalPace,
    distanceM: sample.distanceM,
    totalM: total,
    elapsedSec: sample.elapsedSec,
    heartRate: sample.heartRate,
    cadence: sample.cadence,
    targetBpm: control?.coaching?.targetBpm ?? null,
    history,
    rival,
    guidance: plan ? guidance : null,
  });
  // 코칭 exists only with a session that can carry the server's coaching.
  if (control) {
    pages.push({
      key: 'coaching',
      title: '코칭',
      content: (
        <View>
          {control.recordingMode === 'PHONE_ONLY' ? (
            <AppText>워치가 없어 심박·케이던스 기반 코칭은 제공되지 않아요. 페이스 안내만 확인할 수 있어요.</AppText>
          ) : null}
          <CoachingPage
            pace={sample.paceSecPerKm}
            goalPace={goalPace}
            coaching={control.coaching}
            currentBpm={control.currentBpm}
            cadence={sample.cadence}
            now={clock.now()}
          />
        </View>
      ),
    });
  }

  return (
    <RunLiveFrame
      title={title}
      status={statusOf(mode)}
      subtitle={recordingDevice(control)}
      pages={pages}
      page={page}
      onPageChange={setPage}
      view={view}
      renderMap={({ area, logo }) => (
        <LiveMapPanel
          route={plan?.route}
          trail={trail}
          trailParts={trailParts ?? undefined}
          notice={locatingNotice(control, Date.now())}
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
      paused={run.status === 'paused'}
      notes={
        <>
          {notice ? (
            <LiveNotice
              label="제어 안내"
              text={notice.text}
              action={
                notice.recheck ? { label: '다시 확인', onPress: recheck } : null
              }
            />
          ) : null}
          {delay ? <LiveNotice label="측정 지연" text={delay} /> : null}
          {takeoverShown ? (
            <LiveNotice
              label="폰 기록 안내"
              text={takeoverShown.text}
              action={
                takeoverShown.offer
                  ? { label: '폰으로 기록 계속', onPress: takeOver }
                  : null
              }
            />
          ) : null}
        </>
      }
      music={
        player ? (
          <LiveMusicRow music={player} busy={musicBusy} onCommand={runMusic} />
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
          onFinish={finish}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, backgroundColor: liveLook.ground },
});
