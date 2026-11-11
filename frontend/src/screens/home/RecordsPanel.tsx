import React, { useCallback, useEffect } from 'react';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import { AnalysisContent, loadPeriod } from '../records/AnalysisScreen';
import { kstDay, kstMonth, mondayOf } from '../records/parts';

// 2.1 홈의 러닝 기록 (S15P31E105-615, 담당자 요청: 월 기록 목록을 러닝 기록에): the month of the chosen date as a list of
// its runs; a run opens its detail (onOpen). The day's pace · heart rate card moved to 러닝 분석, so the list no longer
// turns over to a day card.
export function RecordsPanel({
  day,
  onOpen,
}: {
  day: string;
  onOpen: (run: RunRecordSummary) => void;
}) {
  const { clock } = useRepositories();
  const today = kstDay(clock.now());
  const month = useResource(
    useCallback(
      (repositories: Repositories) =>
        loadPeriod(
          repositories,
          'MONTH',
          {
            week: mondayOf(day),
            month: kstMonth(day),
            year: Number(day.slice(0, 4)),
          },
          today,
        ),
      [day, today],
    ),
  );
  const refresh = month.refresh;
  useEffect(
    () =>
      onRecordsChanged(() => {
        void refresh();
      }),
    [refresh],
  );

  return (
    <AnalysisContent
      data={month}
      mode="MONTH"
      appearKey={`MONTH:${kstMonth(day)}`}
      view="list"
      onSwipe={() => undefined}
      onOpen={onOpen}
    />
  );
}
