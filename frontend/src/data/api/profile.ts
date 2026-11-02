import { errorCode } from '../errors';
import type { Repositories, RunningProfile } from '../types';
import { apiRequest } from './http';

// U06·U07 response (docs/design/api/users.md). updatedAt is not shown anywhere yet.
type RunningProfileResponse = RunningProfile & { updatedAt: string };

const path = '/users/me/running-profile';

function toProfile(response: RunningProfileResponse): RunningProfile {
  return {
    selfReportedLevel: response.selfReportedLevel,
    baselineDistanceM: response.baselineDistanceM,
    baselineDurationSec: response.baselineDurationSec,
    usualPaceSecPerKm: response.usualPaceSecPerKm,
    onboardingCompleted: response.onboardingCompleted,
  };
}

// U06 러닝 프로필 조회. No profile yet is a normal state for 1.6, not an error.
export const getRunningProfile: Repositories['profile']['getRunningProfile'] =
  async () => {
    try {
      return toProfile(await apiRequest<RunningProfileResponse>(path));
    } catch (error) {
      if (errorCode(error) === 'PROFILE_NOT_SET') {
        return null;
      }
      throw error;
    }
  };

// U07 러닝 프로필 저장·부분 수정. Left-out parts keep their saved values; the pace entry goes flat in the body.
export const saveRunningProfile: Repositories['profile']['saveRunningProfile'] =
  async ({ selfReportedLevel, pace }) =>
    toProfile(
      await apiRequest<RunningProfileResponse>(path, {
        method: 'PATCH',
        body: { selfReportedLevel, ...pace },
      }),
    );
