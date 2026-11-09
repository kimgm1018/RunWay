import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText, EmptyState, FadeIn } from '../../components';
import {
  useResource,
  type Repositories,
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
import { PillTabs, recordsLook } from './look';
import { kstDay, kstMonth } from './parts';
import { metricOptions, metrics, RecordView } from './RecordView';
import { RecordActions } from './RecordActions';
import type { SplitMetric } from './SplitChart';

// One day's runs and the chosen run's detail, shared by 5.1 내 기록 and 2.1 홈's 과거 러닝 기록 · 기록 상세
// (S15P31E105-564).

// The day's runs, newest first (H01 of the day's month).
export function useDayRuns(day: string) {
  const runs = useResource(
    useCallback(
      async (repositories: Repositories) => {
        const { records } = await repositories.records.getMonth(
          kstMonth(day),
          'ALL',
        );
        return records
          .filter(record => kstDay(record.startedAt) === day)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
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
      async (repositories: Repositories) =>
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
      <AppText style={styles.emptyTitle}>아직 이 날의 러닝 기록이 없어요</AppText>
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
// day's empty card. The check asks H01 for one run only while the day is empty.
const loadNewest = (repositories: Repositories) =>
  repositories.records.getRecent('recent', 1);

function HomeNoRun({
  onList,
  onStartRun,
}: {
  onList?: () => void;
  onStartRun?: () => void;
}) {
  const newest = useResource(loadNewest);
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
// onOpen opens it (5.2, 6.7 for a group run, or 홈's 기록 상세).
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
  const runs = useDayRuns(day);
  const list = runs.status === 'ready' ? runs.data : [];
  const run = pickRun(list, runId);
  const detail = useRunDetail(run);
  const failed = home ? '러닝 기록을 불러오지 못했어요.' : '기록을 불러오지 못했어요';
  if (runs.status === 'error') {
    return (
      <EmptyState
        icon="alert"
        title={failed}
        actionLabel="다시 시도"
        onAction={runs.reload}
      />
    );
  }
  if (runs.status !== 'ready') {
    return <ActivityIndicator style={styles.loading} />;
  }
  if (!run) {
    return home ? (
      <HomeNoRun onList={onList} onStartRun={onStartRun} />
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
            onOpen={() => onOpen(run)}
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

// 홈 기록 상세: the day's run as 5.2 was (the three figures, then the 페이스 · 심박 · 케이던스 graph) with its tabs on
// the card, and under it 내 코스에 저장 · 기록 공유 · 기록 삭제 (S15P31E105-564: 5.2 화면은 없앰).
export function DayRecordDetail({
  day,
  runId,
  onRun,
}: {
  day: string;
  runId: string | null;
  onRun: (id: string) => void;
}) {
  const runs = useDayRuns(day);
  const list = runs.status === 'ready' ? runs.data : [];
  const run = pickRun(list, runId);
  const detail = useRunDetail(run);
  const [metric, setMetric] = useState<SplitMetric>('pace');
  const record = detail.status === 'ready' ? detail.data : null;
  const options = record ? metricOptions(record) : metrics.slice(0, 1);
  // A run without 심박 or 케이던스 goes back to 페이스.
  const shown = options.some(option => option.value === metric)
    ? metric
    : 'pace';
  if (runs.status === 'error' || detail.status === 'error') {
    return (
      <EmptyState
        icon="alert"
        title="기록을 불러오지 못했어요"
        actionLabel="다시 시도"
        onAction={runs.status === 'error' ? runs.reload : detail.reload}
      />
    );
  }
  if (runs.status !== 'ready') {
    return <ActivityIndicator style={styles.loading} />;
  }
  if (!run) {
    return <NoRun />;
  }
  return (
    <>
      <RunChips runs={list} run={run} onRun={onRun} />
      <View style={styles.detailHead}>
        <PillTabs onCard options={options} value={shown} onChange={setMetric} />
      </View>
      {record ? (
        <FadeIn appearKey={record.id}>
          <RecordView
            key={record.id}
            layout="detail"
            record={record}
            chartHeight={240}
            metric={shown}
          />
          <RecordActions record={record} />
        </FadeIn>
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
    fontFamily: fontFamily.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCardSub,
  },
  runChipTextOn: { color: recordsLook.ink },
  detailHead: { marginBottom: 16 },
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
