import type { Repositories, SharedRun } from '../types';
import { apiRequest } from './http';
import { imageAddress } from './images';

// 공유 기록 조회(S15P31E105-704): 링크를 받은 누구나 로그인 없이 읽는다. 토큰을 보내지 않아 로그인 만료와 무관하다.
type SharedRunResponse = {
  title: string;
  startedAt: string;
  distanceM: number | null;
  durationSec: number | null;
  averagePaceSecPerKm: number | null;
  cadence: number | null;
  runner: { nickname: string; profileImageUrl: string | null };
  segments: { coordinates: [number, number][] }[];
};

export const sharedRunsApi: Repositories['sharedRuns'] = {
  get: async token => {
    const response = await apiRequest<SharedRunResponse>(
      `/shared-runs/${encodeURIComponent(token)}`,
      { auth: false },
    );
    const run: SharedRun = {
      title: response.title,
      startedAt: response.startedAt,
      distanceM: response.distanceM ?? 0,
      durationSec: response.durationSec ?? 0,
      averagePaceSecPerKm:
        response.averagePaceSecPerKm === null
          ? null
          : Math.round(response.averagePaceSecPerKm),
      cadence: response.cadence,
      runner: {
        nickname: response.runner.nickname,
        // The server sends /api/v1/images/{id}; the avatar needs the full address.
        profileImageUrl: imageAddress(response.runner.profileImageUrl),
      },
      parts: (response.segments ?? [])
        .map(segment => segment.coordinates)
        .filter(part => Array.isArray(part) && part.length > 0),
    };
    return run;
  },
};
