import type { AppSettings, Repositories } from '../types';
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
// Both PATCHes answer with their whole part, and the part left alone is read again,
// so the screen always gets the full AppSettings the server now holds.
const update: Repositories['settings']['update'] = async change => {
  const { isPrivate, ...appChange } = change;
  const changesApp = Object.keys(appChange).length > 0;
  const [app, privacy] = await Promise.all([
    changesApp
      ? apiRequest<AppPart>(appPath, { method: 'PATCH', body: appChange }).then(
          toApp,
        )
      : getApp(),
    isPrivate !== undefined
      ? apiRequest<PrivacyPart>(privacyPath, {
          method: 'PATCH',
          body: { isPrivate },
        }).then(toPrivacy)
      : getPrivacy(),
  ]);
  return { ...app, ...privacy };
};

export const settingsApi: Repositories['settings'] = { get, update };
