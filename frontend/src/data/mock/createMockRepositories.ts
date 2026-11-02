import { routeLengthM, walkAlong } from '../../geo';
import { DataError } from '../errors';
import type {
  AuthSession,
  CoursePlan,
  MusicSource,
  MusicState,
  PhoneCodeRequest,
  ProfileDetail,
  AppSettings,
  UserProfile,
  RecordSort,
  Repositories,
  RunRecordSummary,
  RunSample,
  SavedCourse,
  TodayCondition,
} from '../types';
import { createCommunityMock } from './community';
import { createCrewMock } from './crews';
import * as fixtures from './fixtures';
import { createGroupRunMock } from './groupRuns';
import {
  fromDraft,
  kstDay,
  monthOf,
  paceTrendOf,
  statisticsOf,
  toDetail,
  toSummary,
} from './records';

export type MockScenario =
  | 'default'
  // 2.P′ 신규 사용자: readiness still collecting.
  | 'newUser'
  | 'error'
  // 1.8 워치 연결 문제 and the 2.1 워치 미연결 state.
  | 'watchDisconnected'
  // The other 2.1 health data states.
  | 'staleHealth'
  | 'healthDenied'
  // 2.9b 알림 없음.
  | 'noNotifications'
  // 2.7S Spotify, 2.7a 미연결, 2.7b 연결 끊김, 2.8b 설치·권한 필요.
  | 'musicSpotify'
  | 'musicNotConnected'
  | 'musicDisconnected'
  | 'musicNeedsSetup'
  // 2.0N: after sunset.
  | 'night'
  // 3.1 추천 결과 없음 · 추천 실패.
  | 'noCourses'
  | 'courseError'
  // 6.0b 가입한 크루 없음.
  | 'noCrews'
  // 4.5 휴대폰에 저장하지 못했어요.
  | 'recordSaveFailed';

export type MockOptions = {
  scenario?: MockScenario;
  latencyMs?: number;
  // Real time between run samples; tests shorten it. Each sample is one second of running.
  tickMs?: number;
};

function respond<T>(
  value: T,
  { scenario = 'default', latencyMs = 300 }: MockOptions,
) {
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      if (scenario === 'error') {
        reject(new Error('목 데이터 오류 시나리오'));
      } else if (value === undefined) {
        resolve(value);
      } else {
        // A copy keeps screens from mutating the shared fixtures.
        resolve(JSON.parse(JSON.stringify(value)) as T);
      }
    }, latencyMs);
  });
}

function fail(error: DataError, { latencyMs = 300 }: MockOptions) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(error), latencyMs);
  });
}

function conditionFor(scenario: MockScenario = 'default'): TodayCondition {
  switch (scenario) {
    case 'newUser':
      return fixtures.collectingCondition;
    case 'staleHealth':
      return {
        ...fixtures.collectingCondition,
        readinessState: 'stale',
        lastAssessedDate: '2026-10-15',
      };
    case 'healthDenied':
      return {
        ...fixtures.collectingCondition,
        readinessState: 'permissionDenied',
      };
    case 'watchDisconnected':
      return {
        ...fixtures.collectingCondition,
        readinessState: 'watchDisconnected',
      };
    default:
      return fixtures.todayCondition;
  }
}

const recordOrder: Record<
  RecordSort,
  (a: RunRecordSummary, b: RunRecordSummary) => number
> = {
  recent: (a, b) => b.startedAt.localeCompare(a.startedAt),
  distance: (a, b) => b.distanceM - a.distanceM,
  pace: (a, b) => a.averagePaceSecPerKm - b.averagePaceSecPerKm,
};

// Picking a source swaps in that service's library; 음악 없음 clears the player.
function withSource(state: MusicState, source: MusicSource): MusicState {
  if (source === 'NONE') {
    return { ...state, source, nowPlaying: null, library: null };
  }
  const library = fixtures.musicLibraries[source];
  const first = library.liked[0] ?? null;
  return {
    ...state,
    source,
    library,
    nowPlaying: first ? { ...first, positionSec: 84, playing: true } : null,
  };
}

function musicFor(scenario: MockScenario = 'default'): MusicState {
  switch (scenario) {
    case 'musicSpotify':
      return {
        ...fixtures.musicState,
        source: 'SPOTIFY',
        services: { MELON: 'CONNECTED', SPOTIFY: 'CONNECTED' },
        library: fixtures.musicLibraries.SPOTIFY,
      };
    case 'musicNotConnected':
      return {
        ...fixtures.musicState,
        source: null,
        services: { MELON: 'LOGIN_REQUIRED', SPOTIFY: 'LOGIN_REQUIRED' },
        nowPlaying: null,
        library: null,
      };
    case 'musicDisconnected':
      return { ...fixtures.musicState, linked: false };
    case 'musicNeedsSetup':
      return {
        ...fixtures.musicState,
        services: { MELON: 'PERMISSION_REQUIRED', SPOTIFY: 'INSTALL_REQUIRED' },
      };
    default:
      return fixtures.musicState;
  }
}

// Fits a GeoJSON route into the 0–1 box used by list thumbnails.
function shapeOf(route: [number, number][]): [number, number][] {
  const xs = route.map(point => point[0]);
  const ys = route.map(point => point[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  return route.map(([x, y]) => [
    0.1 + ((x - minX) / span) * 0.8,
    0.9 - ((y - minY) / span) * 0.8,
  ]);
}

// 2.0 shows the course chosen on 3.1b or 3.1c; the paces spread around the 6′00″ goal.
function planFor(courseId: string | null, saved: SavedCourse[]): CoursePlan {
  const recommended = fixtures.recommendedCourses.find(
    item => item.id === courseId,
  );
  const mine = saved.find(item => item.id === courseId);
  if (!recommended && !mine) {
    return fixtures.todayPlan;
  }
  const distanceM = recommended?.distanceM ?? mine!.distanceM;
  const km = Math.ceil(distanceM / 1000);
  const base = fixtures.todayPlan.segmentPacesSecPerKm;
  return {
    ...fixtures.todayPlan,
    courseId: courseId!,
    name: mine?.myAlias ?? recommended?.name ?? mine!.name,
    distanceM,
    route: recommended?.route ?? fixtures.todayPlan.route,
    segmentPacesSecPerKm: Array.from(
      { length: km },
      (_, index) => base[index % base.length],
    ),
    expectedDurationSec:
      recommended?.estimatedDurationSec ?? mine!.expectedMinutes * 60,
  };
}

// One second of a steady mock run: pace drifts around 5′58″, heart rate climbs to the 150s.
function nextSample(previous: RunSample): RunSample {
  const elapsedSec = previous.elapsedSec + 1;
  const paceSecPerKm = Math.round(358 + 8 * Math.sin(elapsedSec / 20));
  return {
    elapsedSec,
    distanceM: previous.distanceM + 1000 / paceSecPerKm,
    paceSecPerKm,
    heartRate: Math.round(
      Math.min(158, 120 + elapsedSec / 4) + 3 * Math.sin(elapsedSec / 7),
    ),
    cadence: Math.round(170 + 2 * Math.sin(elapsedSec / 9)),
    position: previous.position,
  };
}

type Account = {
  password: string;
  phoneNumber: string;
  onboardingCompleted: boolean;
};

type PendingCode = { expiresAt: number; failures: number };

export function createMockRepositories(
  options: MockOptions = {},
): Repositories {
  // Each repository set keeps its own accounts and attempt counts, so tests do not share state.
  const accounts = new Map<string, Account>(
    fixtures.takenLoginIds.map(loginId => [
      loginId,
      {
        password: fixtures.account.password,
        phoneNumber:
          loginId === fixtures.account.loginId
            ? fixtures.account.phoneNumber
            : '01000000000',
        onboardingCompleted: true,
      },
    ]),
  );
  let notifications = fixtures.notifications;
  let saved = fixtures.savedCourses;
  let profile: ProfileDetail = { ...fixtures.profileDetail };
  let settings: AppSettings = {
    ...fixtures.appSettings,
    notifications: { ...fixtures.appSettings.notifications },
  };
  // 1.8 starts with the watch off; 8.1 연결 해제 turns it off until 1.7 or 실행 취소 reconnects.
  let watchConnected = options.scenario !== 'watchDisconnected';
  const watchState = () =>
    watchConnected ? fixtures.connectedWatch : fixtures.disconnectedWatch;
  let chosen: string | null = null;
  // Finished runs (4.5) join the list that 5.1·5.2·5.3 and 2.1 read.
  let records = fixtures.runRecords;
  // 7.3 shares and 7.4b lists the runs this mock keeps, including ones saved while the app runs.
  const social = createCommunityMock({
    respond: value => respond(value, options),
    records: () => records,
  });
  let music = musicFor(options.scenario);
  const loginFailures = new Map<
    string,
    { count: number; lockedUntil: number }
  >();
  const pendingCodes = new Map<string, PendingCode>();
  // 6.0 lists the crews this mock keeps, so a 6.2 join request shows there as 승인 대기.
  const crews = createCrewMock({
    respond: value => respond(value, options),
    fail: error => fail(error, options),
    noCrews: options.scenario === 'noCrews',
  });
  const verifiedPhones = new Map<string, string>();
  let nextUserId = 101;

  const session = (loginId: string, account: Account): AuthSession => ({
    user: { id: nextUserId++, loginId },
    accessToken: `mock-token-${loginId}`,
    refreshToken: `mock-refresh-${loginId}`,
    onboardingCompleted: account.onboardingCompleted,
  });
  const isRegistered = (phoneNumber: string) =>
    [...accounts.values()].some(account => account.phoneNumber === phoneNumber);
  const codeKey = ({ phoneNumber, purpose }: PhoneCodeRequest) =>
    `${purpose}:${phoneNumber}`;

  return {
    auth: {
      login: ({ loginId, password }) => {
        const now = Date.now();
        const failures = loginFailures.get(loginId) ?? {
          count: 0,
          lockedUntil: 0,
        };
        if (failures.lockedUntil > now) {
          return fail(
            new DataError('LOGIN_LOCKED', '로그인 제한', fixtures.maxAttempts),
            options,
          );
        }
        const account = accounts.get(loginId);
        if (!account || account.password !== password) {
          const count = failures.lockedUntil ? 1 : failures.count + 1;
          const locked = count >= fixtures.maxAttempts;
          loginFailures.set(loginId, {
            count,
            lockedUntil: locked ? now + fixtures.loginLockMs : 0,
          });
          return fail(
            locked
              ? new DataError('LOGIN_LOCKED', '로그인 제한', count)
              : new DataError('INVALID_CREDENTIALS', '로그인 실패', count),
            options,
          );
        }
        loginFailures.delete(loginId);
        return respond(session(loginId, account), options);
      },
      checkLoginId: loginId =>
        respond(
          {
            loginId,
            available: !accounts.has(loginId),
            reason: accounts.has(loginId) ? ('DUPLICATED' as const) : null,
          },
          options,
        ),
      requestPhoneCode: request => {
        const registered = isRegistered(request.phoneNumber);
        if (request.purpose === 'PASSWORD_RESET' && !registered) {
          return fail(
            new DataError('PHONE_NOT_REGISTERED', '가입되지 않은 전화번호'),
            options,
          );
        }
        if (request.purpose === 'SIGN_UP' && registered) {
          return fail(
            new DataError('PHONE_ALREADY_REGISTERED', '이미 가입된 전화번호'),
            options,
          );
        }
        pendingCodes.set(codeKey(request), {
          expiresAt: Date.now() + fixtures.verificationExpiresInSec * 1000,
          failures: 0,
        });
        return respond(
          { expiresInSec: fixtures.verificationExpiresInSec },
          options,
        );
      },
      verifyPhoneCode: ({ code, ...request }) => {
        const pending = pendingCodes.get(codeKey(request));
        if (!pending || pending.expiresAt < Date.now()) {
          return fail(
            new DataError('VERIFICATION_EXPIRED', '인증 시간 만료'),
            options,
          );
        }
        if (code !== fixtures.verificationCode) {
          pending.failures += 1;
          if (pending.failures >= fixtures.maxAttempts) {
            pendingCodes.delete(codeKey(request));
            return fail(
              new DataError(
                'VERIFICATION_ATTEMPTS_EXCEEDED',
                '인증 시도 초과',
                pending.failures,
              ),
              options,
            );
          }
          return fail(
            new DataError(
              'VERIFICATION_CODE_MISMATCH',
              '인증번호 불일치',
              pending.failures,
            ),
            options,
          );
        }
        pendingCodes.delete(codeKey(request));
        const verificationToken = `mock-verified-${codeKey(request)}`;
        verifiedPhones.set(verificationToken, request.phoneNumber);
        return respond({ verificationToken }, options);
      },
      signUp: request => {
        if (accounts.has(request.loginId)) {
          return fail(
            new DataError('LOGIN_ID_DUPLICATED', '이미 사용 중인 아이디'),
            options,
          );
        }
        const account = {
          password: request.password,
          phoneNumber: request.phoneNumber,
          onboardingCompleted: false,
        };
        accounts.set(request.loginId, account);
        return respond(session(request.loginId, account), options);
      },
      resetPassword: ({ verificationToken, newPassword }) => {
        const phoneNumber = verifiedPhones.get(verificationToken);
        const account = [...accounts.values()].find(
          candidate => candidate.phoneNumber === phoneNumber,
        );
        if (!account) {
          return fail(
            new DataError('VERIFICATION_EXPIRED', '인증 시간 만료'),
            options,
          );
        }
        account.password = newPassword;
        verifiedPhones.delete(verificationToken);
        return respond(undefined, options);
      },
    },
    profile: {
      getMe: () =>
        respond(
          {
            ...fixtures.me,
            nickname: profile.nickname,
            runningLevel:
              profile.runningLevel.toLowerCase() as UserProfile['runningLevel'],
          },
          options,
        ),
      updateBasic: basic => {
        profile = { ...profile, ...basic };
        return respond(undefined, options);
      },
      setRunningLevel: runningLevel => {
        profile = { ...profile, runningLevel };
        return respond(undefined, options);
      },
      setRunningBaseline: baseline => {
        profile = { ...profile, baseline };
        return respond(undefined, options);
      },
      getDetail: () => respond(profile, options),
    },
    settings: {
      get: () => respond(settings, options),
      update: change => {
        settings = {
          ...settings,
          ...change,
          notifications: { ...settings.notifications, ...change.notifications },
        };
        if (change.isPrivate !== undefined) {
          social.setPrivate(change.isPrivate);
        }
        return respond(settings, options);
      },
    },
    account: {
      getWithdrawalSummary: () =>
        respond(
          {
            runningRecordCount: records.length,
            postCount: social.myPostCount(),
            savedCourseCount: saved.length,
            connectedDevices: watchConnected
              ? [fixtures.connectedWatch.deviceName]
              : [],
            ownedCrews: crews.owned(),
          },
          options,
        ),
      // U18: the mock account is gone afterwards, so 1.2 can no longer sign in with it.
      withdraw: password => {
        if (password !== fixtures.account.password) {
          return fail(
            new DataError('INVALID_PASSWORD', '비밀번호가 맞지 않아요'),
            options,
          );
        }
        accounts.delete(fixtures.account.loginId);
        return respond(undefined, options);
      },
    },
    home: {
      getTodayCondition: () => respond(conditionFor(options.scenario), options),
      getMonthlySummary: () => respond(fixtures.monthlySummary, options),
    },
    records: {
      getRecent: (sort, limit) =>
        respond(
          records
            .filter(run => run.runType === 'SOLO')
            .map(toSummary)
            .sort(recordOrder[sort])
            .slice(0, limit),
          options,
        ),
      getMonth: (month, filter) =>
        respond(monthOf(records, month, filter), options),
      getDetail: recordId => {
        const record = records.find(run => run.id === recordId);
        return record
          ? respond(toDetail(record, saved), options)
          : fail(new DataError('RECORD_NOT_FOUND', '기록 없음'), options);
      },
      getStatistics: (period, baseDate) =>
        respond(statisticsOf(records, period, baseDate), options),
      getPaceTrend: months =>
        respond(
          paceTrendOf(records, months, kstDay(fixtures.now).slice(0, 7)),
          options,
        ),
    },
    courses: {
      getSaved: () => respond(saved, options),
      getTodayPlan: () => respond(planFor(chosen, saved), options),
      getOrigins: () => respond(fixtures.origins, options),
      recommend: () => {
        if (options.scenario === 'courseError') {
          return fail(new DataError('UNKNOWN', '추천 실패'), options);
        }
        return respond(
          options.scenario === 'noCourses'
            ? []
            : fixtures.recommendedCourses.map(course => ({
                ...course,
                saved: saved.some(item => item.id === course.id),
              })),
          options,
        );
      },
      save: courseId => {
        const course = fixtures.recommendedCourses.find(
          item => item.id === courseId,
        );
        if (course && !saved.some(item => item.id === courseId)) {
          saved = [
            ...saved,
            {
              id: course.id,
              name: course.name,
              myAlias: null,
              distanceM: course.distanceM,
              expectedMinutes: Math.round(course.estimatedDurationSec / 60),
              shape: shapeOf(course.route),
            },
          ];
        }
        return respond(undefined, options);
      },
      unsave: courseId => {
        saved = saved.filter(item => item.id !== courseId);
        return respond(undefined, options);
      },
      saveFromRun: ({ recordId, route, distanceM, durationSec }) => {
        const id = `course-${recordId}`;
        saved = [
          ...saved.filter(item => item.id !== id),
          {
            id,
            name: '자유 러닝 코스',
            myAlias: null,
            distanceM: Math.round(distanceM),
            expectedMinutes: Math.round(durationSec / 60),
            shape: shapeOf(route),
          },
        ];
        return respond({ courseId: id }, options);
      },
      choose: courseId => {
        chosen = courseId;
        return respond(undefined, options);
      },
    },
    crews: crews.repository,
    community: social.community,
    runners: social.runners,
    groupRuns: createGroupRunMock({
      respond: value => respond(value, options),
      tickMs: options.tickMs ?? 1000,
      myCrews: crews.mine,
      myRecord: groupRunId =>
        records.find(record => record.groupRunId === groupRunId) ?? null,
    }),
    notifications: {
      list: () =>
        respond(
          options.scenario === 'noNotifications' ? [] : notifications,
          options,
        ),
      markAllRead: () => {
        notifications = notifications.map(item => ({ ...item, read: true }));
        return respond(undefined, options);
      },
    },
    run: {
      getCurrentPlace: () => respond(fixtures.currentPlace, options),
      startTracking: (from, route, onSample) => {
        let sample = from;
        const path = route ?? fixtures.freeRunTrack;
        const lap = routeLengthM(path);
        const timer = setInterval(() => {
          sample = nextSample(sample);
          const along = walkAlong(path, sample.distanceM % lap);
          sample = { ...sample, position: along[along.length - 1] };
          const step = fixtures.guidance.find(
            item => sample.distanceM < item.untilM,
          );
          onSample(
            sample,
            step
              ? { instruction: step.instruction, detail: step.detail }
              : null,
          );
        }, options.tickMs ?? 1000);
        return () => clearInterval(timer);
      },
      saveRecord: draft => {
        if (options.scenario === 'recordSaveFailed') {
          return fail(new DataError('UNKNOWN', '기록 저장 실패'), options);
        }
        const id = `run-${kstDay(draft.startedAt).replace(/-/g, '')}-${
          records.length + 1
        }`;
        const course =
          saved.find(item => item.id === draft.courseId) ??
          fixtures.recommendedCourses.find(item => item.id === draft.courseId);
        const groupRun = fixtures.groupRuns.find(
          item => item.id === draft.groupRunId,
        );
        const title = groupRun
          ? groupRun.title
          : course
          ? ('myAlias' in course && course.myAlias) || course.name
          : '자유 러닝';
        records = [
          fromDraft(
            draft,
            id,
            title,
            draft.route ? shapeOf(draft.route) : fixtures.shapes.line,
            groupRun
              ? {
                  crewName: fixtures.crews.find(
                    crew => crew.id === groupRun.crewId,
                  )!.name,
                  finisherCount: fixtures.groupResults.length + 1,
                }
              : null,
          ),
          ...records,
        ];
        return respond({ recordId: id }, options);
      },
    },
    music: {
      getState: () => respond(music, options),
      selectSource: source => {
        music = withSource(music, source);
        return respond(music, options);
      },
      resolveService: service => {
        music = {
          ...music,
          services: { ...music.services, [service]: 'CONNECTED' },
        };
        return respond(music, options);
      },
      reconnect: () => {
        music = { ...music, linked: true };
        return respond(music, options);
      },
    },
    clock: {
      now: () =>
        new Date(
          options.scenario === 'night' ? fixtures.nightNow : fixtures.now,
        ),
    },
    watch: {
      getConnection: () => respond(watchState(), options),
      // 1.8's scenario keeps failing to reconnect.
      reconnect: () => {
        watchConnected = options.scenario !== 'watchDisconnected';
        return respond(watchState(), options);
      },
      disconnect: () => {
        watchConnected = false;
        return respond(watchState(), options);
      },
    },
  };
}
