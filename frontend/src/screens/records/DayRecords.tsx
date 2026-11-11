import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText, EmptyState, FadeIn } from '../../components';
import {
  useResource,
  type Repositories,
  type RunRecordDetail,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import {
  formatClockTime,
  formatDotDateWeekday,
  formatDuration,
  formatKm,
} from '../../format';
import { fontFamily } from '../../theme';
import { recordsLook } from './look';
import { kstDay, kstMonth } from './parts';
import { RecordView } from './RecordView';

// One day's runs and the chosen run's card, shared by 5.1 내 기록 and 2.1 홈's 러닝 분석 (S15P31E105-564; 기록 상세
// 화면은 S15P31E105-594 담당자 결정으로 없앰).

type DayBundle = {
  runs: RunRecordSummary[];
  // True when this Korean month has any solo or group run (first-run tip; S15P31E105-638).
  monthHasRuns: boolean;
};

// The day's runs, newest first (H01 of the day's month), plus whether the month itself has runs.
export function useDayRuns(day: string) {
  const runs = useResource(
    useCallback(
      async (repositories: Repositories): Promise<DayBundle> => {
        const { records } = await repositories.records.getMonth(
          kstMonth(day),
          'ALL',
        );
        return {
          monthHasRuns: records.length > 0,
          runs: records
            .filter(record => kstDay(record.startedAt) === day)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
        };
      },
      [day],
    ),
  );
  // A run deleted on 5.2 leaves the day (S15P31E105-394).
  const refresh = runs.refresh;
  useEffect(
    () =>
      onRecordsChanged(() => {
        void refresh();
      }),
    [refresh],
  );
  return runs;
}

// The chosen run's detail (H02).
function useRunDetail(run: RunRecordSummary | null) {
  return useResource(
    useCallback(
      async (repositories: Repositories): Promise<RunRecordDetail | null> =>
        run ? repositories.records.getDetail(run.id) : null,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [run?.id],
    ),
  );
}

function rowLabel(record: RunRecordSummary) {
  return `${record.title}, ${formatDotDateWeekday(
    record.startedAt,
  )} · ${formatDuration(record.durationSec)}, ${formatKm(record.distanceM)}km`;
}

// Two runs on one day: pick which one the card shows.
function RunChips({
  runs,
  run,
  onRun,
}: {
  runs: RunRecordSummary[];
  run: RunRecordSummary;
  onRun: (id: string) => void;
}) {
  if (runs.length < 2) {
    return null;
  }
  return (
    <View style={styles.runs}>
      {runs.map(item => (
        <Pressable
          key={item.id}
          accessibilityRole="tab"
          accessibilityLabel={`${formatClockTime(item.startedAt)} 러닝`}
          accessibilityState={{ selected: item.id === run.id }}
          onPress={() => onRun(item.id)}
          style={[styles.runChip, item.id === run.id && styles.runChipOn]}
        >
          <AppText
            style={[
              styles.runChipText,
              item.id === run.id && styles.runChipTextOn,
            ]}
          >
            {`${formatClockTime(item.startedAt)} · ${formatKm(
              item.distanceM,
            )}km`}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

function NoRun({ onList }: { onList?: () => void }) {
  return (
    <View style={styles.empty}>
      <AppText style={styles.emptyTitle}>
        아직 이 날의 러닝 기록이 없어요
      </AppText>
      <AppText style={styles.emptyText}>점이 있는 날을 눌러 보세요</AppText>
      {onList ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이 달 기록 보기"
          hitSlop={8}
          onPress={onList}
          style={({ pressed }) => [styles.listLink, pressed && styles.dim]}
        >
          <AppText style={styles.listLinkText}>이 달 기록 보기</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// 2.1 홈 with no run on the day (S15P31E105-615): someone who has never run is asked to start; anyone else gets the
// day's empty card. Solo and group both count (S15P31E105-638); the month list already covers this month.
const loadNewest = (repositories: Repositories) =>
  repositories.records.getRecent('recent', 1);

function HomeNoRun({
  monthHasRuns,
  onList,
  onStartRun,
}: {
  monthHasRuns: boolean;
  onList?: () => void;
  onStartRun?: () => void;
}) {
  const newest = useResource(loadNewest);
  if (monthHasRuns) {
    return <NoRun onList={onList} />;
  }
  if (newest.status === 'loading') {
    return <ActivityIndicator style={styles.loading} />;
  }
  if (newest.status === 'ready' && newest.data.length === 0) {
    return (
      <View style={styles.empty}>
        <AppText style={[styles.emptyTitle, styles.center]}>
          첫 러닝을 기록하고 페이스와 심박수의 변화를 확인해보세요.
        </AppText>
        {onStartRun ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="러닝 시작하기"
            hitSlop={8}
            onPress={onStartRun}
            style={({ pressed }) => [styles.listLink, pressed && styles.dim]}
          >
            <AppText style={styles.listLinkText}>러닝 시작하기</AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return <NoRun onList={onList} />;
}

// The run the card shows: the chosen one when it is that day's, else the newest.
const pickRun = (runs: RunRecordSummary[], runId: string | null) =>
  runs.find(item => item.id === runId) ?? runs[0] ?? null;

// 5.1 (and 홈 과거 러닝 기록): the day's run on the frost card, the average pace large and the split graph.
// onOpen opens it (6.7 for a group run; on 홈 a solo run is the card itself).
export function DayRecords({
  day,
  runId,
  onRun,
  onOpen,
  onList,
  home = false,
  onStartRun,
}: {
  day: string;
  runId: string | null;
  onRun: (id: string) => void;
  onOpen: (run: RunRecordSummary) => void;
  // 2.1: a day without a run can still turn the card over to the month's runs.
  onList?: () => void;
  // 2.1 홈 최근 러닝 (S15P31E105-615): the pace · heart rate card, and the first-run invitation.
  home?: boolean;
  onStartRun?: () => void;
}) {
  const dayRuns = useDayRuns(day);
  const list = dayRuns.status === 'ready' ? dayRuns.data.runs : [];
  const monthHasRuns =
    dayRuns.status === 'ready' ? dayRuns.data.monthHasRuns : false;
  const run = pickRun(list, runId);
  const detail = useRunDetail(run);
  const failed = home
    ? '러닝 기록을 불러오지 못했어요.'
    : '기록을 불러오지 못했어요';
  if (dayRuns.status === 'error') {
    return (
      <EmptyState
        icon="alert"
        title={failed}
        actionLabel="다시 시도"
        onAction={dayRuns.reload}
      />
    );
  }
  if (dayRuns.status !== 'ready') {
    return <ActivityIndicator style={styles.loading} />;
  }
  if (!run) {
    return home ? (
      <HomeNoRun
        monthHasRuns={monthHasRuns}
        onList={onList}
        onStartRun={onStartRun}
      />
    ) : (
      <NoRun onList={onList} />
    );
  }
  return (
    <>
      <RunChips runs={list} run={run} onRun={onRun} />
      {detail.status === 'ready' && detail.data ? (
        // Another day's run fades in rather than swap at once (S15P31E105-478).
        <FadeIn appearKey={detail.data.id}>
          <RecordView
            key={detail.data.id}
            record={detail.data}
            chartHeight={300}
            // On 홈 a solo run is already the card itself, so only a group run opens on (6.7).
            onOpen={
              !home || run.runType === 'GROUP' ? () => onOpen(run) : undefined
            }
            openLabel={rowLabel(run)}
            layout={home ? 'home' : 'records'}
          />
        </FadeIn>
      ) : detail.status === 'error' ? (
        <EmptyState
          icon="alert"
          title={failed}
          actionLabel="다시 시도"
          onAction={detail.reload}
        />
      ) : (
        <ActivityIndicator style={styles.loading} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { marginTop: 120 },
  empty: { marginTop: 150, alignItems: 'center', gap: 6 },
  emptyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: recordsLook.onCard,
  },
  center: { textAlign: 'center', paddingHorizontal: 24 },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: recordsLook.onCardSub,
  },
  runs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  runChip: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  runChipOn: { backgroundColor: 'rgba(255,255,255,0.72)' },
  runChipText: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCardSub,
  },
  runChipTextOn: { color: recordsLook.ink },
  listLink: {
    marginTop: 14,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  listLinkText: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.onCard,
  },
  dim: { opacity: 0.7 },
});
