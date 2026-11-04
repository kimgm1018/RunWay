import { appConfig } from '../../config';
import { DataError, errorCode } from '../errors';
import type { Gender, Repositories, RunningProfile } from '../types';
import { apiRequest } from './http';
import { uploadImage } from './images';

// U04 response, and U05's without loginId and status (docs/design/api/users.md).
type MeResponse = {
  id: number;
  nickname: string;
  gender: Gender;
  birthDate: string;
  profileImageUrl: string | null;
  onboardingCompleted: boolean;
};

const mePath = '/users/me';

// The server gives the F02 path (/api/v1/images/…); the photo is public, so the full address is enough.
const serverOrigin = appConfig.apiBaseUrl.replace(
  /^(https?:\/\/[^/]+).*$/,
  '$1',
);
const imageAddress = (path: string | null) =>
  path === null || /^https?:\/\//.test(path) ? path : serverOrigin + path;

// U04 내 프로필 조회 for 2.1, 8.1 and the community.
export const getMe: Repositories['profile']['getMe'] = async () => {
  const me = await apiRequest<MeResponse>(mePath);
  return {
    id: String(me.id),
    nickname: me.nickname,
    profileImageUrl: imageAddress(me.profileImageUrl),
  };
};

// 8.2 프로필 수정: the account part from U04 and the running level and pace from U06.
export const getDetail: Repositories['profile']['getDetail'] = async () => {
  const [me, running] = await Promise.all([
    apiRequest<MeResponse>(mePath),
    getRunningProfile(),
  ]);
  // 8.2 opens only after setup, which saves the running profile.
  if (!running) {
    throw new DataError('PROFILE_NOT_SET', '러닝 프로필 없음');
  }
  return {
    nickname: me.nickname,
    gender: me.gender,
    birthDate: me.birthDate,
    runningLevel: running.selfReportedLevel,
    baseline: {
      baselineDistanceM: running.baselineDistanceM,
      baselineDurationSec: running.baselineDurationSec,
      usualPaceSecPerKm: running.usualPaceSecPerKm,
    },
  };
};

// U05 내 프로필 수정 for 1.5 (after the account exists) and 8.2. The photo is left as it is.
export const updateBasic: Repositories['profile']['updateBasic'] = async ({
  nickname,
  gender,
  birthDate,
}) => {
  await apiRequest<MeResponse>(mePath, {
    method: 'PATCH',
    body: { nickname, gender, birthDate },
  });
};

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

// 8.2 사진 바꾸기: F01 stores the photo, then U05 makes it my profile photo.
export const changePhoto: Repositories['profile']['changePhoto'] =
  async photo => {
    const { imageId } = await uploadImage(photo, 'PROFILE');
    const me = await apiRequest<MeResponse>(mePath, {
      method: 'PATCH',
      body: { profileImageId: imageId },
    });
    return imageAddress(me.profileImageUrl);
  };

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
