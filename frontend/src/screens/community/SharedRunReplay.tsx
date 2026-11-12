import React, { useEffect, useMemo, useState } from 'react';
import { DataError, useRepositories, type SharedRun } from '../../data';
import { useToast } from '../../components';
import { formatKm, formatPace } from '../../format';
import { shapeOfRoute } from '../../geo';
import { runShareUrl } from '../../navigation/shareLinks';
import { RouteReplay, type ReplayRun } from './RouteReplay';

// A run opened from a shared link (S15P31E105-704): read without signing in, then played like my own run's
// replay. A link that cannot be shown (gone, never made, or no connection) says so and leaves the app as it was.

export function replayOfShared(token: string, shared: SharedRun): ReplayRun {
  const pace =
    shared.averagePaceSecPerKm === null
      ? ''
      : ` · 평균 페이스 ${formatPace(shared.averagePaceSecPerKm)}/km`;
  const flat = shared.parts.flat();
  return {
    key: token,
    kind: '경로',
    title: shared.title,
    byline: `${shared.runner.nickname} · ${formatKm(shared.distanceM)}km`,
    startedAt: shared.startedAt,
    shareMessage: `${shared.runner.nickname}님의 러닝 · ${
      shared.title
    } ${formatKm(shared.distanceM, 1)}km${pace}`,
    // Passing it on sends the same link.
    link: () => Promise.resolve(runShareUrl(token)),
    runner: {
      nickname: shared.runner.nickname,
      userId: '',
      photo: shared.runner.profileImageUrl,
      mine: false,
    },
    distanceM: shared.distanceM,
    durationSec: shared.durationSec,
    averagePaceSecPerKm: shared.averagePaceSecPerKm,
    cadence: shared.cadence,
    shape: flat.length >= 2 ? shapeOfRoute(flat) : [],
    parts: shared.parts.length > 0 ? shared.parts : null,
  };
}

export const sharedRunMissing = '열 수 없는 기록이에요. 링크가 만료됐거나 기록이 삭제됐어요';
export const sharedRunOffline = '기록을 불러오지 못했어요. 연결을 확인하고 링크를 다시 열어 주세요';

export function SharedRunReplay({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const repositories = useRepositories();
  const toast = useToast();
  const [shared, setShared] = useState<SharedRun | null>(null);

  useEffect(() => {
    let active = true;
    setShared(null);
    repositories.sharedRuns.get(token).then(
      run => {
        if (active) {
          setShared(run);
        }
      },
      error => {
        if (!active) {
          return;
        }
        toast(
          error instanceof DataError && error.code === 'NETWORK_ERROR'
            ? sharedRunOffline
            : sharedRunMissing,
        );
        onClose();
      },
    );
    return () => {
      active = false;
    };
  }, [onClose, repositories, toast, token]);

  const run = useMemo(
    () => (shared ? replayOfShared(token, shared) : null),
    [shared, token],
  );
  return run ? <RouteReplay run={run} visible onClose={onClose} /> : null;
}
