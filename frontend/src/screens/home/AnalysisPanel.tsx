import React, { useCallback, useEffect } from 'react';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import { AnalysisContent, loadPeriod } from '../records/AnalysisScreen';
import { addDays, kstDay, kstMonth, mondayOf } from '../records/parts';

// 2.1 홈의 러닝 분석 (S15P31E105-564, 담당자 결정: 하루치만): 5.3's card for the day on the date line, without
// period tabs. Each run of the day is a bar, compared with the day before; a swipe across the graph moves the date
// line a day. It is a single card: it does not turn over (담당자 결정).
export function AnalysisPanel({
  day,
  onDay,
  onOpen,
}: {
  day: string;
  onDay: (day: string) => void;
  onOpen: (record: RunRecordSummary) => void;
}) {
  const { clock } = useRepositories();
  const today = kstDay(clock.now());
  const data = useResource(
    useCallback(
      (repositories: Repositories) =>
        loadPeriod(
          repositories,
          'DAY',
          {
            day,
            week: mondayOf(day),
            month: kstMonth(day),
            year: Number(day.slice(0, 4)),
          },
          today,
        ),
      [day, today],
    ),
  );
  const refresh = data.refresh;
  useEffect(
    () =>
      onRecordsChanged(() => {
        void refresh();
      }),
    [refresh],
  );

  // Back a day, or forward up to today.
  const swipe = (direction: 1 | -1) => {
    const next = addDays(day, direction);
    if (next <= today) {
      onDay(next);
    }
  };

  return (
    <AnalysisContent
      data={data}
      mode="DAY"
      appearKey={`DAY:${day}`}
      view="tiles"
      onSwipe={swipe}
      onOpen={onOpen}
    />
  );
}
