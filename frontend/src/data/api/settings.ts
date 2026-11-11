import type { AppSettings, Repositories } from '../types';
import { DataError } from '../errors';
import { apiRequest } from './http';

// AppSettings comes from two server resources (docs/design/api/users.md):
// U19·U20 /users/me/settings holds everything but the account visibility, which U13·U14 keep apart.
type AppPart = Omit<AppSettings, 'isPrivate'>;
type PrivacyPart = { isPrivate: boolean };

const appPath = '/users/me/settings';
const privacyPath = '/users/me/privacy-settings';

// The server answers with exactly these fields; copying them keeps U14's updatedAt out of AppSettings.
const toApp = (r: AppPart): AppPart => ({
  voiceCoachingEnabled: r.voiceCoachingEnabled,
  bpmGuideEnabled: r.bpmGuideEnabled,
  locationRecordingMode: r.locationRecordingMode,
  notifications: {
    groupRun: r.notifications.groupRun,
    community: r.notifications.community,
  },
});
const toPrivacy = (r: PrivacyPart): PrivacyPart => ({ isPrivate: r.isPrivate });

const getApp = () => apiRequest<AppPart>(appPath).then(toApp);
const getPrivacy = () => apiRequest<PrivacyPart>(privacyPath).then(toPrivacy);

// 8.1 설정 and 8.1b 위치 기록: U19 and U13 together.
const get: Repositories['settings']['get'] = async () => {
  const [app, privacy] = await Promise.all([getApp(), getPrivacy()]);
  return { ...app, ...privacy };
};

// A switch on 8.1 sends only the field it changed: U20 for the app part, U14 for 계정 공개.
// Writes run first; the untouched part is read after. A failed companion GET must not look like
// a failed save (S15P31E105-638) — that is SAVE_UNCONFIRMED so 8.1 can keep the optimistic value.
const update: Repositories['settings']['update'] = async change => {
  const { isPrivate, ...appChange } = change;
  const changesApp = Object.keys(appChange).length > 0;
  const changesPrivacy = isPrivate !== undefined;

  let app: AppPart | undefined;
  let privacy: PrivacyPart | undefined;

  const writes: Promise<void>[] = [];
  if (changesApp) {
    writes.push(
      apiRequest<AppPart>(appPath, { method: 'PATCH', body: appChange })
        .then(toApp)
        .then(saved => {
          app = saved;
        }),
    );
  }
  if (changesPrivacy) {
    writes.push(
      apiRequest<PrivacyPart>(privacyPath, {
        method: 'PATCH',
        body: { isPrivate },
      })
        .then(toPrivacy)
        .then(saved => {
          privacy = saved;
        }),
    );
  }
  await Promise.all(writes);

  const reads: Promise<void>[] = [];
  if (!app) {
    reads.push(
      getApp().then(loaded => {
        app = loaded;
      }),
    );
  }
  if (!privacy) {
    reads.push(
      getPrivacy().then(loaded => {
        privacy = loaded;
      }),
    );
  }
  try {
    await Promise.all(reads);
  } catch (error) {
    // The PATCH already landed; 8.1 must not roll the switch back as a save failure.
    throw new DataError(
      'SAVE_UNCONFIRMED',
      '설정을 저장했지만 최신 값을 다시 읽지 못했어요',
      null,
      error instanceof DataError ? error.status : null,
    );
  }

  return { ...app!, ...privacy! };
};

export const settingsApi: Repositories['settings'] = { get, update };
