import { Image } from 'react-native';
import type {
  AppNotification,
  AppSettings,
  CoursePlan,
  CrewJoinRequest,
  CrewListItem,
  CurrentPlace,
  MeetingPlace,
  MonthlyRunSummary,
  MusicLibrary,
  MusicState,
  MyCrew,
  Place,
  Post,
  PostComment,
  PostRecord,
  ProfileDetail,
  RecommendedCourse,
  SelfReportedLevel,
  PeriodSummary,
  RunRecordSummary,
  SavedCourse,
  TodayCondition,
  UserProfile,
  WatchConnection,
} from '../types';

// Mock sign-in for 1.2 로그인. The prototype shows `minjun_run`, but the API allows only letters and digits.
export const account = {
  loginId: 'minjun01',
  password: 'runway123',
  phoneNumber: '01024835917',
};

// Login IDs already taken, for 1.3's duplicate check.
export const takenLoginIds = [account.loginId, 'runner01'];

// Every mock SMS sends this code (1.2q 482913).
export const verificationCode = '482913';
export const verificationExpiresInSec = 180;

// Matches the policy shown on 1.2 and 1.2s.
export const maxAttempts = 5;
export const loginLockMs = 10 * 60 * 1000;

// 1.7 워치 연결 — 연결됨.
export const connectedWatch: WatchConnection = {
  status: 'connected',
  deviceName: 'Galaxy Watch7',
  lastSyncedAt: '2026-10-19T06:42:00+09:00',
  batteryPercent: 82,
  permissions: {
    heartRate: 'connected',
    location: 'connected',
    sleep: 'connected',
    activity: 'connected',
  },
};

// 1.8 워치 연결 문제: location comes from the phone GPS, so it stays connected.
export const disconnectedWatch: WatchConnection = {
  status: 'disconnected',
  deviceName: 'Galaxy Watch7',
  lastSyncedAt: '2026-10-19T06:42:00+09:00',
  batteryPercent: null,
  permissions: {
    heartRate: 'denied',
    location: 'connected',
    sleep: 'disconnected',
    activity: 'disconnected',
  },
};

// The 2.1 홈 avatar, taken from the prototype. It is a third-party poster kept only as mock data;
// replace it before release.
const mockProfilePhoto = require('../../../assets/images/mock-profile.jpg');

const assetUri = (asset: number) =>
  Image.resolveAssetSource(asset)?.uri ?? null;

// seoyun.run's 7.4 photo, given by the 담당자 as mock data only.
const mockSeoyunPhoto = require('../../../assets/images/mock-runner-seoyun.webp');

// Sample values shown in prototype v15 2.1 홈.
export const me: UserProfile = {
  id: 'user-minjun',
  nickname: '민준',
  profileImageUrl: assetUri(mockProfilePhoto),
};

// 8.1 설정 (U19 and U13), as on the K1 sheet.
export const appSettings: AppSettings = {
  voiceCoachingEnabled: true,
  bpmGuideEnabled: true,
  locationRecordingMode: 'RUNNING_ONLY',
  notifications: { groupRun: true, community: false },
  isPrivate: false,
};

// 8.2 프로필 수정 (U04·U06): the 1.5·1.6 answers.
export const profileDetail: ProfileDetail = {
  nickname: '민준',
  gender: 'MALE',
  birthDate: '1991-03-14',
  runningLevel: 'INTERMEDIATE',
  baseline: {
    baselineDistanceM: 5000,
    baselineDurationSec: 1800,
    usualPaceSecPerKm: 360,
  },
};

export const todayCondition: TodayCondition = {
  date: '2026-10-19',
  syncedAt: '2026-10-19T06:42:00+09:00',
  readinessState: 'ready',
  readinessScore: 82,
  condition: '보통',
  sleepMinutes: 432,
  restingHeartRate: 58,
  readinessSummary: '양호 · 계획한 강도로 달려도 좋아요',
  sleepLabel: '충분',
  restingHeartRateLabel: '평소 수준',
  weeklyLoad: '적정',
  weeklyLoadLabel: '과부하 없음',
  aiAdvice: '오늘은 5km를 6′00″ 페이스로 시작해도 좋아요.',
  lastAssessedDate: '2026-10-19',
};

// 2.P′ 신규 사용자: no score until enough health data is collected.
export const collectingCondition: TodayCondition = {
  ...todayCondition,
  syncedAt: null,
  readinessState: 'collecting',
  readinessScore: null,
  condition: null,
  readinessSummary: null,
  sleepLabel: null,
  restingHeartRateLabel: null,
  weeklyLoad: null,
  weeklyLoadLabel: null,
  aiAdvice: null,
  lastAssessedDate: null,
};

// 2.1 러닝 분석, October.
export const monthlySummary: MonthlyRunSummary = {
  month: '2026-10',
  runCount: 7,
  totalDistanceM: 34200,
  averagePaceSecPerKm: 352,
  weekdayRatios: [0.38, 0.04, 0.62, 0.48, 0.04, 0.8, 0.54],
  paceImprovementSec: 8,
};

export const shapes: Record<string, [number, number][]> = {
  coast: [
    [0.05, 0.6],
    [0.3, 0.45],
    [0.55, 0.5],
    [0.8, 0.35],
    [0.95, 0.4],
  ],
  loop: [
    [0.2, 0.8],
    [0.15, 0.3],
    [0.5, 0.15],
    [0.85, 0.35],
    [0.7, 0.8],
    [0.2, 0.8],
  ],
  hill: [
    [0.05, 0.75],
    [0.35, 0.7],
    [0.5, 0.3],
    [0.7, 0.45],
    [0.95, 0.25],
  ],
  line: [
    [0.05, 0.55],
    [0.95, 0.45],
  ],
};

// 3.1c 저장한 코스 (2.1 shows the first three). The title is my own nickname (myAlias).
export const savedCourses: SavedCourse[] = [
  {
    id: 'course-gwangan-loop',
    name: '광안리해수욕장 출발 5.0km',
    myAlias: '광안대교 루프',
    distanceM: 5000,
    expectedMinutes: 30,
    shape: [
      [0.3, 0.2],
      [0.55, 0.15],
      [0.7, 0.35],
      [0.6, 0.6],
      [0.45, 0.85],
      [0.3, 0.65],
      [0.25, 0.4],
      [0.3, 0.2],
    ],
  },
  {
    id: 'course-minrak-round',
    name: '민락수변공원 출발 5.4km',
    myAlias: '민락수변 왕복',
    distanceM: 5400,
    expectedMinutes: 33,
    shape: [
      [0.25, 0.85],
      [0.4, 0.2],
      [0.5, 0.55],
      [0.6, 0.2],
      [0.75, 0.85],
    ],
  },
  {
    id: 'course-suyeong',
    name: '수영강 APEC나루 출발 4.8km',
    myAlias: '수영강 하천길',
    distanceM: 4800,
    expectedMinutes: 29,
    shape: [
      [0.2, 0.3],
      [0.45, 0.45],
      [0.75, 0.55],
      [0.6, 0.8],
      [0.35, 0.6],
      [0.2, 0.3],
    ],
  },
  {
    id: 'course-igidae',
    name: '이기대 입구 출발 6.2km',
    myAlias: '이기대 갈맷길',
    distanceM: 6200,
    expectedMinutes: 41,
    shape: [
      [0.65, 0.15],
      [0.6, 0.45],
      [0.5, 0.75],
      [0.3, 0.8],
      [0.3, 0.55],
      [0.45, 0.5],
    ],
  },
  {
    id: 'course-apec',
    name: 'APEC나루공원 출발 3.2km',
    myAlias: 'APEC 나루공원 루프',
    distanceM: 3200,
    expectedMinutes: 20,
    shape: [
      [0.2, 0.5],
      [0.35, 0.3],
      [0.65, 0.3],
      [0.8, 0.5],
      [0.65, 0.7],
      [0.35, 0.7],
      [0.2, 0.5],
    ],
  },
];

// 3.1 기준 위치 choices; the first one is the current position.
export const origins: Place[] = [
  { name: '광안리해수욕장 · 현재 위치', position: [129.1186, 35.1532] },
  { name: '민락수변공원', position: [129.1318, 35.1543] },
  { name: '수영강 APEC나루공원', position: [129.1345, 35.1697] },
];

const minrakLoop: [number, number][] = [
  [129.1318, 35.1543],
  [129.1352, 35.1561],
  [129.1384, 35.1592],
  [129.1402, 35.1631],
  [129.1376, 35.1662],
  [129.1331, 35.1668],
  [129.1289, 35.1651],
  [129.1271, 35.1614],
  [129.1282, 35.1578],
  [129.1318, 35.1543],
];

// 3.1b 추천 코스: the four cards of the prototype, front (map) and back (detail).
export const recommendedCourses: RecommendedCourse[] = [
  {
    id: 'course-minrak',
    name: '민락수변공원 출발 5.0km',
    distanceM: 5000,
    estimatedDurationSec: 1800,
    shapeKind: '순환',
    environmentLabels: ['공원', '하천변', '평지'],
    elevationGainM: 12,
    elevationProfile: [20, 24, 30, 46, 58, 40, 28, 24, 22, 20],
    reason:
      '목표 6′00″에 맞는 평지 순환이에요. 2km 지점 짧은 오르막만 조절하면 돼요.',
    route: minrakLoop,
    saved: false,
  },
  {
    id: 'course-gwangalli',
    name: '광안리해수욕장 출발 5.4km',
    distanceM: 5400,
    estimatedDurationSec: 1980,
    shapeKind: '왕복',
    environmentLabels: ['해변', '평지'],
    elevationGainM: 6,
    elevationProfile: [18, 20, 22, 22, 24, 24, 22, 20, 20, 18],
    reason:
      '고도 차가 거의 없어 페이스를 일정하게 유지하기 좋아요. 아침에는 그늘이 적어요.',
    route: [
      [129.1186, 35.1532],
      [129.1214, 35.1528],
      [129.1245, 35.1531],
      [129.1279, 35.1542],
      [129.1311, 35.1563],
      [129.1279, 35.1542],
      [129.1245, 35.1531],
      [129.1214, 35.1528],
      [129.1186, 35.1532],
    ],
    saved: false,
  },
  {
    id: 'course-apec-river',
    name: '수영강 APEC나루 출발 4.8km',
    distanceM: 4800,
    estimatedDurationSec: 1740,
    shapeKind: '왕복',
    environmentLabels: ['하천변', '공원'],
    elevationGainM: 8,
    elevationProfile: [22, 26, 28, 30, 28, 26, 24, 26, 24, 22],
    reason:
      '처음 달리는 코스예요. 강변 산책로라 신호 대기 없이 이어 달릴 수 있어요.',
    route: [
      [129.1345, 35.1697],
      [129.1322, 35.1735],
      [129.1298, 35.1771],
      [129.1281, 35.1809],
      [129.1298, 35.1771],
      [129.1322, 35.1735],
      [129.1345, 35.1697],
    ],
    saved: false,
  },
  {
    id: 'course-igidae-coast',
    name: '이기대 입구 출발 5.6km',
    distanceM: 5600,
    estimatedDurationSec: 2280,
    shapeKind: '편도 순환',
    environmentLabels: ['해안길', '언덕'],
    elevationGainM: 64,
    elevationProfile: [20, 34, 52, 70, 88, 76, 60, 48, 36, 24],
    reason:
      '준비도 82로 오르막 훈련도 가능해요. 3~4km 언덕 구간은 걷듯이 넘어가세요.',
    route: [
      [129.1205, 35.1238],
      [129.1241, 35.1222],
      [129.1279, 35.1207],
      [129.1302, 35.1176],
      [129.1268, 35.1158],
      [129.1226, 35.1171],
      [129.1205, 35.1238],
    ],
    saved: false,
  },
];

// 2.9 알림, newest first. 2.9b uses an empty list.
export const notifications: AppNotification[] = [
  {
    id: 'noti-1',
    kind: 'GROUP_RUN_STARTING',
    message: '‘토요일 아침, 함께 5km’ 그룹런이 곧 시작해요',
    createdAt: '2026-10-19T12:42:00+09:00',
    read: false,
  },
  {
    id: 'noti-2',
    kind: 'CREW_JOIN_APPROVED',
    message: '‘민락 야경 러너스’ 가입이 승인됐어요',
    createdAt: '2026-10-19T12:33:00+09:00',
    read: false,
  },
  {
    id: 'noti-3',
    kind: 'POST_COMMENT',
    message: '서연님이 내 게시물에 댓글을 남겼어요: 페이스 좋네요!',
    createdAt: '2026-10-19T11:45:00+09:00',
    read: false,
  },
  {
    id: 'noti-4',
    kind: 'GROUP_RUN_CANCELED',
    message: '이번 주 ‘수요일 저녁 회복런’ 그룹런이 취소됐어요',
    createdAt: '2026-10-17T09:00:00+09:00',
    read: true,
  },
  {
    id: 'noti-5',
    kind: 'CREW_JOIN_REJECTED',
    message: '‘수영강 하프 크루’ 가입이 거절됐어요',
    createdAt: '2026-10-16T09:00:00+09:00',
    read: true,
  },
];

// The mock clock for relative times: 2026-10-19 12:45, as on every prototype screen.
export const now = '2026-10-19T12:45:00+09:00';
export const nightNow = '2026-10-19T20:30:00+09:00';

// 2.0F 현재 위치 near 민락수변공원.
export const currentPlace: CurrentPlace = {
  name: '민락수변공원 입구',
  gps: 'good',
  position: [129.1318, 35.1543],
};

// 2.0 코스 러닝: a 5km loop from 민락수변공원 with one recommended pace per km.
export const todayPlan: CoursePlan = {
  courseId: 'course-minrak',
  name: '민락수변공원 출발',
  distanceM: 5000,
  route: [
    [129.1318, 35.1543],
    [129.1352, 35.1561],
    [129.1384, 35.1592],
    [129.1402, 35.1631],
    [129.1376, 35.1662],
    [129.1331, 35.1668],
    [129.1289, 35.1651],
    [129.1271, 35.1614],
    [129.1282, 35.1578],
    [129.1318, 35.1543],
  ],
  segmentPacesSecPerKm: [365, 375, 360, 350, 350],
  strategy: '초반 안정 → 오르막 절제 → 후반 가속',
  targetPaceSecPerKm: 360,
  expectedDurationSec: 1800,
  caution: '2km 오르막 주의',
};

// 4.5F 자유 러닝: the path drawn for a free run, since it has no planned course.
export const freeRunTrack: [number, number][] = [
  [129.1318, 35.1543],
  [129.1295, 35.1571],
  [129.1279, 35.1606],
  [129.1301, 35.1638],
  [129.1343, 35.1652],
  [129.1381, 35.1631],
  [129.1392, 35.1597],
  [129.1365, 35.1566],
  [129.1318, 35.1543],
];

// 4.2 길 안내, by distance run.
export const guidance = [
  {
    untilM: 1200,
    instruction: '300m 앞 횡단보도에서 직진',
    detail: '민락수변공원 방향 · 경로를 벗어나면 진동으로 알려요',
  },
  {
    untilM: 2600,
    instruction: '120m 앞 갈림길에서 왼쪽',
    detail: '민락수변공원 방향 · 경로를 벗어나면 진동으로 알려요',
  },
  {
    untilM: 4200,
    instruction: '200m 앞 다리 진입 후 오른쪽',
    detail: '수변 산책로 방향 · 경로를 벗어나면 진동으로 알려요',
  },
  {
    untilM: Infinity,
    instruction: '도착까지 직진',
    detail: '출발점으로 돌아가요 · 경로를 벗어나면 진동으로 알려요',
  },
];

const melonLibrary: MusicLibrary = {
  likedCount: 128,
  liked: [
    {
      id: 'track-sea',
      title: '바다 쪽으로 달리기',
      subtitle: '아침 러닝 믹스',
      durationSec: 221,
    },
    {
      id: 'track-uphill',
      title: '오르막 끝에서',
      subtitle: '템포 업',
      durationSec: 192,
    },
  ],
  recent: [
    { id: 'pl-180', title: '페이스 유지 180' },
    { id: 'pl-recovery', title: '회복 조깅' },
    { id: 'pl-10k', title: '지난 주 10K' },
  ],
  playlists: [
    { id: 'pl-dawn', title: '광안리 새벽' },
    { id: 'pl-interval', title: '인터벌 데이' },
    { id: 'pl-long', title: '롱런 90분' },
  ],
  top100UpdatedAt: '2026-10-19T12:00:00+09:00',
  top100: [
    {
      id: 'top-1',
      title: 'TOP100 1위 곡',
      subtitle: '멜론 차트',
      durationSec: 200,
    },
    {
      id: 'top-2',
      title: 'TOP100 2위 곡',
      subtitle: '멜론 차트',
      durationSec: 210,
    },
  ],
};

const spotifyLibrary: MusicLibrary = {
  likedCount: 0,
  liked: [],
  recent: [],
  playlists: [
    { id: 'sp-dawn', title: '광안리 새벽' },
    { id: 'sp-interval', title: '인터벌 데이' },
    { id: 'sp-long', title: '롱런 90분' },
    { id: 'sp-tempo', title: '템포 런' },
    { id: 'sp-recovery', title: '회복 조깅' },
    { id: 'sp-weekend', title: '주말 15K' },
  ],
  top100UpdatedAt: null,
  top100: [],
};

export const musicLibraries = { MELON: melonLibrary, SPOTIFY: spotifyLibrary };

// 2.7 멜론 연결됨, playing at 1:24 of 3:41.
export const musicState: MusicState = {
  source: 'MELON',
  services: { MELON: 'CONNECTED', SPOTIFY: 'LOGIN_REQUIRED' },
  linked: true,
  nowPlaying: { ...melonLibrary.liked[0], positionSec: 84, playing: true },
  library: melonLibrary,
  premium: false,
};

// 5.1 전체 기록 (and 2.1 과거 러닝 기록), newest first. October follows the prototype's 5.1 list and
// month summary (7회 · 34.2km · 3:21 · 5′52″); September matches 5.3's 지난달 (5회 · 26.8km · 6′00″).
export type RecordFixture = Omit<
  RunRecordSummary,
  'averagePaceSecPerKm' | 'goalAchieved'
> & {
  route: [number, number][] | null;
  targetDurationSec: number | null;
  targetPaceSecPerKm: number | null;
  courseId: string | null;
  // Runs without a watch have no heart rate or cadence (5.2 hides those tabs).
  watch: boolean;
  aiAdvice: string | null;
  // Records of a group run (6.7 reads my own).
  groupRunId?: string;
};

const solo = { runType: 'SOLO' as const, group: null };
const crew = (finisherCount: number, groupRunId = 'gr-today') => ({
  runType: 'GROUP' as const,
  group: { crewName: '광안리 새벽 크루', finisherCount, groupRunId },
});
const courseRoute = (id: string) =>
  recommendedCourses.find(course => course.id === id)!.route;

export const runRecords: RecordFixture[] = [
  {
    id: 'run-1015',
    title: '민락수변공원 출발',
    startedAt: '2026-10-15T06:30:00+09:00',
    distanceM: 5020,
    durationSec: 1781,
    shape: shapes.coast,
    ...solo,
    route: minrakLoop,
    targetDurationSec: 1800,
    targetPaceSecPerKm: 360,
    courseId: 'course-minrak',
    watch: true,
    aiAdvice: '3km에서 빨라져 심박이 올랐어요. 다음엔 3km를 5초만 늦춰 보세요.',
  },
  {
    id: 'run-1013',
    title: '민락수변공원 출발',
    startedAt: '2026-10-13T06:40:00+09:00',
    distanceM: 5020,
    durationSec: 1788,
    shape: shapes.coast,
    ...solo,
    route: minrakLoop,
    targetDurationSec: 1800,
    targetPaceSecPerKm: 360,
    courseId: 'course-minrak',
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-1011',
    title: '광안대교 루프 함께 달리기',
    startedAt: '2026-10-11T06:00:00+09:00',
    distanceM: 5400,
    durationSec: 1928,
    shape: shapes.line,
    ...crew(8),
    route: courseRoute('course-gwangalli'),
    targetDurationSec: 1944,
    targetPaceSecPerKm: 360,
    courseId: 'course-gwangalli',
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-1008',
    title: '남천 해변 언덕길',
    startedAt: '2026-10-08T07:00:00+09:00',
    distanceM: 5200,
    durationSec: 1982,
    shape: shapes.hill,
    ...solo,
    route: freeRunTrack,
    targetDurationSec: 1872,
    targetPaceSecPerKm: 360,
    courseId: null,
    watch: false,
    aiAdvice:
      '언덕에서 페이스가 크게 떨어졌어요. 오르막은 보폭을 줄이고 리듬을 유지해 보세요.',
  },
  {
    id: 'run-1005',
    title: '해운대 백사장',
    startedAt: '2026-10-05T06:50:00+09:00',
    distanceM: 4100,
    durationSec: 1470,
    shape: shapes.line,
    ...solo,
    route: courseRoute('course-gwangalli'),
    targetDurationSec: null,
    targetPaceSecPerKm: null,
    courseId: null,
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-1003',
    title: '수영강 하천길',
    startedAt: '2026-10-03T07:10:00+09:00',
    distanceM: 4800,
    durationSec: 1584,
    shape: shapes.loop,
    ...solo,
    route: courseRoute('course-apec-river'),
    targetDurationSec: 1680,
    targetPaceSecPerKm: 350,
    courseId: 'course-apec-river',
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-1001',
    title: '이기대 갈맷길',
    startedAt: '2026-10-01T06:45:00+09:00',
    distanceM: 4660,
    durationSec: 1505,
    shape: shapes.hill,
    ...solo,
    // Recorded without location: no route, so it cannot become a course.
    route: null,
    targetDurationSec: null,
    targetPaceSecPerKm: null,
    courseId: null,
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-0930',
    title: '민락수변공원 출발',
    startedAt: '2026-09-30T06:35:00+09:00',
    distanceM: 5020,
    durationSec: 1830,
    shape: shapes.coast,
    ...solo,
    route: minrakLoop,
    targetDurationSec: 1800,
    targetPaceSecPerKm: 360,
    courseId: 'course-minrak',
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-0926',
    title: '광안대교 루프 함께 달리기',
    startedAt: '2026-09-26T06:00:00+09:00',
    distanceM: 5400,
    durationSec: 1960,
    shape: shapes.line,
    ...crew(9),
    route: courseRoute('course-gwangalli'),
    targetDurationSec: 1998,
    targetPaceSecPerKm: 370,
    courseId: 'course-gwangalli',
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-0923',
    title: '수영강 하천길',
    startedAt: '2026-09-23T07:10:00+09:00',
    distanceM: 4800,
    durationSec: 1750,
    shape: shapes.loop,
    ...solo,
    route: courseRoute('course-apec-river'),
    targetDurationSec: null,
    targetPaceSecPerKm: null,
    courseId: 'course-apec-river',
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-0919',
    title: '남천 해변 언덕길',
    startedAt: '2026-09-19T07:00:00+09:00',
    distanceM: 5200,
    durationSec: 1900,
    shape: shapes.hill,
    ...solo,
    route: freeRunTrack,
    targetDurationSec: 1872,
    targetPaceSecPerKm: 360,
    courseId: null,
    watch: true,
    aiAdvice: null,
  },
  {
    id: 'run-0915',
    title: '광안리 해변 롱런',
    startedAt: '2026-09-15T06:20:00+09:00',
    distanceM: 6380,
    durationSec: 2208,
    shape: shapes.line,
    ...solo,
    route: courseRoute('course-gwangalli'),
    targetDurationSec: null,
    targetPaceSecPerKm: null,
    courseId: null,
    watch: true,
    aiAdvice: null,
  },
];

// 5.2 graphs for the prototype's run, in 500m splits (5′41″ 최고 at 3km, 평균 156 · 171 최고,
// 평균 172 · 178 최고).
export const recordSplits: Record<
  string,
  { pace: number[]; heartRate: number[]; cadence: number[] }
> = {
  'run-1015': {
    pace: [367, 363, 359, 356, 350, 341, 352, 357, 354, 351],
    heartRate: [137, 146, 151, 155, 160, 171, 166, 161, 159, 154],
    cadence: [167, 169, 170, 172, 173, 178, 175, 173, 171, 172],
  },
};

// 5.3 러닝 분석 values that come from longer history than the mock records.
// October: 1주 6.2 · 2주 10.4 · 3주 12.6 · 4주 5 (km).
export const octoberWeeklyDistanceM = [6200, 10400, 12600, 5000];
export const octoberHeartZones = [0.12, 0.46, 0.28, 0.11, 0.03];
export const defaultHeartZones = [0.15, 0.48, 0.25, 0.09, 0.03];
// Average pace by month; the prototype's 최근 6개월 runs from 6′31″ (5월) to 5′52″ (10월).
export const monthlyPace: Record<string, number> = {
  '2026-04': 398,
  '2026-05': 391,
  '2026-06': 380,
  '2026-07': 372,
  '2026-08': 366,
  '2026-09': 360,
  '2026-10': 352,
};
// Distance by month this year (km) for 5.3 년, January to October.
export const monthlyDistanceKm = [
  18.2, 15.6, 22.4, 25.1, 27, 28.3, 30.5, 21.4, 26.8, 34.2,
];
export const yearSummaries: Record<string, PeriodSummary> = {
  '2024': {
    runCount: 31,
    totalDistanceM: 158000,
    totalDurationSec: 62410,
    averagePaceSecPerKm: 395,
  },
  '2025': {
    runCount: 38,
    totalDistanceM: 201300,
    totalDurationSec: 76091,
    averagePaceSecPerKm: 378,
  },
  '2026': {
    runCount: 49,
    totalDistanceM: 249500,
    totalDurationSec: 90319,
    averagePaceSecPerKm: 362,
  },
};
export const augustSummary: PeriodSummary = {
  runCount: 4,
  totalDistanceM: 21400,
  totalDurationSec: 7832,
  averagePaceSecPerKm: 366,
};

// 6.1 크루 모집 lists every crew; distanceKm is from me, and 내 근처 keeps those within 3km.
export type CrewFixture = CrewListItem & { distanceKm: number };

// 6.x 그룹런. I am 민준 (me.id); the crews and runs follow prototype v15 6.0 and the 6.1 K1 sheet.
export const crewDirectory: CrewFixture[] = [
  {
    id: 'crew-gwangalli',
    name: '광안리 새벽 크루',
    description: '평일 아침 6시 반, 광안리 해변을 대화하며 천천히 달려요',
    area: '광안리',
    capacity: 30,
    memberCount: 18,
    myMembership: 'MEMBER',
    distanceKm: 0.8,
  },
  {
    id: 'crew-minrak-night',
    name: '민락 야경 러너스',
    description: '퇴근 후 민락수변 야경 보며 7km, 주 2회 모여요',
    area: '민락수변',
    capacity: 30,
    memberCount: 24,
    myMembership: 'MEMBER',
    distanceKm: 1.4,
  },
  {
    id: 'crew-namcheon',
    name: '남천 회복 조깅',
    description: '입문·부상 회복 환영, 숨차지 않는 페이스로 달려요',
    area: '남천',
    capacity: 15,
    memberCount: 11,
    myMembership: 'PENDING',
    distanceKm: 2.1,
  },
  {
    id: 'crew-suyeong-half',
    name: '수영강 하프 크루',
    description: '하프 마라톤 준비, 주 3회 인터벌과 롱런',
    area: '수영강',
    capacity: 200,
    memberCount: 200,
    myMembership: null,
    distanceKm: 2.6,
  },
  {
    id: 'crew-haeundae-sunset',
    name: '해운대 선셋 런',
    description: '주말 저녁 해운대 백사장에서 노을 보며 5km',
    area: '해운대',
    capacity: 40,
    memberCount: 27,
    myMembership: null,
    distanceKm: 5.3,
  },
  {
    id: 'crew-seomyeon-after',
    name: '서면 퇴근 러닝',
    description: '수요일 저녁 부산시민공원 트랙, 처음 오는 분도 함께해요',
    area: '부산시민공원',
    capacity: 25,
    memberCount: 9,
    myMembership: null,
    distanceKm: 6.8,
  },
];

// 6.0 내 크루: the crews I joined or asked to join.
export const crews: MyCrew[] = crewDirectory.flatMap(entry =>
  entry.myMembership
    ? [
        {
          id: entry.id,
          name: entry.name,
          area: entry.area,
          memberCount: entry.memberCount,
          membership: entry.myMembership,
        },
      ]
    : [],
);

export const members = {
  seongyun: { userId: 'user-seongyun', nickname: '성윤' },
  eunseo: { userId: 'user-eunseo', nickname: '은서' },
  seoyeon: { userId: 'user-seoyeon', nickname: '서연' },
  jiwoo: { userId: 'user-jiwoo', nickname: '지우' },
  me: { userId: 'user-minjun', nickname: '민준' },
};

// 6.2 구성원: the leader first, then the members named elsewhere in the mock. 6.2m needs a crew I
// lead, so I lead 민락 야경 러너스. The mock fills each crew up to its memberCount from crewNicknames.
export const crewRoster: Record<
  string,
  { userId: string; nickname: string }[]
> = {
  'crew-gwangalli': [
    members.seongyun,
    members.eunseo,
    members.seoyeon,
    members.jiwoo,
    members.me,
  ],
  'crew-minrak-night': [members.me, members.jiwoo, members.eunseo],
  'crew-namcheon': [members.seoyeon],
};

export const crewNicknames = [
  '하준',
  '서윤',
  '도윤',
  '하린',
  '지호',
  '수아',
  '예준',
  '지유',
  '시우',
  '채원',
  '주원',
  '유나',
  '건우',
  '다은',
  '현우',
  '소율',
];

// 6.2a 대기 중인 신청 for the crew I lead.
export const crewJoinRequests: Record<string, CrewJoinRequest[]> = {
  'crew-minrak-night': [
    {
      userId: 'user-harin',
      nickname: '하린',
      loginId: 'harin07',
      level: 'INTERMEDIATE',
      recent5kPaceSecPerKm: 356,
      firstCrew: false,
      requestedAt: '2026-10-19T12:42:00+09:00',
    },
    {
      userId: 'user-doyun',
      nickname: '도윤',
      loginId: 'doyun22',
      level: 'BEGINNER',
      recent5kPaceSecPerKm: null,
      firstCrew: true,
      requestedAt: '2026-10-17T21:10:00+09:00',
    },
  ],
};

export type GroupRunFixture = {
  id: string;
  crewId: string;
  title: string;
  hostId: string;
  scheduledAt: string;
  meetingPlaceName: string;
  meetingAddress: string;
  meetingPosition: [number, number];
  courseId: string | null;
  courseName: string | null;
  route: [number, number][] | null;
  targetDistanceM: number | null;
  targetDurationSec: number | null;
  goalPaceSecPerKm: number;
  // Participants other than me; joined says whether I am in.
  others: { userId: string; nickname: string }[];
  joined: boolean;
};

const gwangalliEntrance: [number, number] = [129.1186, 35.1532];

export const groupRuns: GroupRunFixture[] = [
  {
    // Starts 15 minutes after the mock clock (12:45): pinned on 6.0 and used for 6.5–6.7.
    id: 'gr-today',
    crewId: 'crew-gwangalli',
    title: '월요일 점심, 함께 5km',
    hostId: members.seongyun.userId,
    scheduledAt: '2026-10-19T13:00:00+09:00',
    meetingPlaceName: '광안리해수욕장 입구',
    meetingAddress: '부산 수영구 광안해변로 219',
    meetingPosition: gwangalliEntrance,
    courseId: 'course-minrak',
    courseName: '민락수변공원 출발 5.0km',
    route: minrakLoop,
    targetDistanceM: 5000,
    targetDurationSec: null,
    goalPaceSecPerKm: 360,
    others: [members.seongyun, members.eunseo, members.seoyeon, members.jiwoo],
    joined: true,
  },
  {
    id: 'gr-saturday',
    crewId: 'crew-gwangalli',
    title: '토요일 아침, 함께 5km',
    hostId: members.seongyun.userId,
    scheduledAt: '2026-10-24T07:00:00+09:00',
    meetingPlaceName: '광안리해수욕장 입구 · 편의점 앞',
    meetingAddress: '부산 수영구 광안해변로 219',
    meetingPosition: gwangalliEntrance,
    courseId: 'course-minrak',
    courseName: '민락수변공원 출발 5.0km',
    route: minrakLoop,
    targetDistanceM: 5000,
    targetDurationSec: null,
    goalPaceSecPerKm: 360,
    others: [
      members.seongyun,
      members.eunseo,
      members.seoyeon,
      members.jiwoo,
      { userId: 'user-hayun', nickname: '하윤' },
    ],
    joined: true,
  },
  {
    // My own group run, so 6.4 offers 그룹런 취소 (6.4c–6.4e).
    id: 'gr-wednesday',
    crewId: 'crew-gwangalli',
    title: '수요일 회복 조깅',
    hostId: members.me.userId,
    scheduledAt: '2026-10-28T06:30:00+09:00',
    meetingPlaceName: '민락수변공원 주차장 입구',
    meetingAddress: '부산 수영구 민락수변로 7',
    meetingPosition: [129.1318, 35.1543],
    courseId: null,
    courseName: null,
    route: null,
    targetDistanceM: null,
    targetDurationSec: 2400,
    goalPaceSecPerKm: 400,
    others: [members.eunseo, members.seoyeon],
    joined: true,
  },
  {
    id: 'gr-night',
    crewId: 'crew-minrak-night',
    title: '월요일 야경 7km',
    hostId: members.jiwoo.userId,
    scheduledAt: '2026-10-26T20:00:00+09:00',
    meetingPlaceName: '민락수변공원 계단 앞',
    meetingAddress: '부산 수영구 광안해변로 361',
    meetingPosition: [129.1352, 35.1561],
    courseId: 'course-gwangalli',
    courseName: '민락수변공원 출발 7.0km',
    route: minrakLoop,
    targetDistanceM: 7000,
    targetDurationSec: null,
    goalPaceSecPerKm: 370,
    others: [
      members.jiwoo,
      { userId: 'user-dohyun', nickname: '도현' },
      { userId: 'user-yerin', nickname: '예린' },
      { userId: 'user-junho', nickname: '준호' },
      { userId: 'user-sora', nickname: '소라' },
      { userId: 'user-taeho', nickname: '태호' },
      { userId: 'user-mina', nickname: '미나' },
      { userId: 'user-hyun', nickname: '현' },
      { userId: 'user-nari', nickname: '나리' },
    ],
    joined: false,
  },
];

// 6.4 내 페이스와 잘 맞아요.
export const myFit = { recentPaceSecPerKm: 356, readinessScore: 82 };

// 6.5: who is in the waiting room of gr-today (지우 applied but has not entered).
export const waitingRoomReady: Record<string, boolean> = {
  [members.seongyun.userId]: true,
  [members.eunseo.userId]: true,
  [members.seoyeon.userId]: false,
};

// 6.6 G10: where the other members run, in metres ahead of me (negative is behind), and their pace.
export const liveMembers = [
  { ...members.seongyun, gapM: 60, paceSecPerKm: 338 },
  { ...members.seoyeon, gapM: -40, paceSecPerKm: 347 },
  { ...members.eunseo, gapM: -120, paceSecPerKm: 365 },
];

// 6.7: how the other members finished gr-today.
export const groupResults = [
  {
    ...members.seongyun,
    state: 'FINISHED' as const,
    durationSec: 1752,
    distanceM: 5000,
  },
  {
    ...members.seoyeon,
    state: 'FINISHED' as const,
    durationSec: 1805,
    distanceM: 5000,
  },
  {
    ...members.eunseo,
    state: 'STOPPED' as const,
    durationSec: 1420,
    distanceM: 3800,
  },
];

// 6.9 만남 장소 검색 results, nearest first.
export const meetingPlaces: MeetingPlace[] = [
  {
    name: '광안리해수욕장 입구',
    address: '부산 수영구 광안해변로 219',
    position: gwangalliEntrance,
    distanceM: 320,
  },
  {
    name: '민락수변공원 주차장 입구',
    address: '부산 수영구 민락수변로 7',
    position: [129.1318, 35.1543],
    distanceM: 1250,
  },
  {
    name: '민락수변공원 계단 앞',
    address: '부산 수영구 광안해변로 361',
    position: [129.1352, 35.1561],
    distanceM: 1580,
  },
  {
    name: '수영강 APEC나루공원 입구',
    address: '부산 해운대구 우동 1418',
    position: [129.1345, 35.1697],
    distanceM: 2900,
  },
];

// 6.0b 내 근처 크루 모집 (within 3km).
export const nearbyRecruiting = {
  count: 8,
  areas: ['광안리', '민락', '남천', '수영강'],
};

// 7.x 커뮤니티 handles from the K1 7번 sheets, on the members above. I am minjun.run.
export const communityUsers = {
  me: {
    userId: members.me.userId,
    handle: 'minjun.run',
    nickname: members.me.nickname,
  },
  seoyun: {
    userId: members.seoyeon.userId,
    handle: 'seoyun.run',
    nickname: members.seoyeon.nickname,
  },
  sungyoon: {
    userId: members.seongyun.userId,
    handle: 'sungyoon.k',
    nickname: members.seongyun.nickname,
  },
  eunseo: {
    userId: members.eunseo.userId,
    handle: 'eunseo_jog',
    nickname: members.eunseo.nickname,
  },
  jiwoo: {
    userId: members.jiwoo.userId,
    handle: 'jiwoo.runs',
    nickname: members.jiwoo.nickname,
  },
};

const sharedRun = (
  id: string,
  title: string,
  place: string,
  startedAt: string,
  distanceM: number,
  durationSec: number,
  shape: [number, number][],
  heart: [number, number],
  goalAchieved: boolean | null = true,
): PostRecord => ({
  id,
  title,
  startedAt,
  distanceM,
  durationSec,
  averagePaceSecPerKm: Math.round(durationSec / (distanceM / 1000)),
  shape,
  runType: 'SOLO',
  group: null,
  goalAchieved,
  place,
  courseRun: true,
  averageHeartRate: heart[0],
  cadence: heart[1],
});

// isMine is worked out from the author, as for the post.
export type PostFixture = Omit<Post, 'isMine' | 'commentCount'> & {
  comments: Omit<PostComment, 'isMine'>[];
};

// 7.1 피드, newest first. The 7.4 lists show each runner's posts.
export const posts: PostFixture[] = [
  {
    id: 'post-seoyun-1019',
    author: communityUsers.seoyun,
    body: '오늘 광안대교 루프 처음으로 30분 안에 들어왔어요. 3km에서 코칭대로 페이스 늦춘 게 신의 한 수였네요',
    record: sharedRun(
      'shared-seoyun-1019',
      '민락수변공원 출발',
      '민락수변공원',
      '2026-10-19T07:12:00+09:00',
      5020,
      1781,
      shapes.loop,
      [158, 170],
    ),
    courseShared: true,
    createdAt: '2026-10-19T07:50:00+09:00',
    likeCount: 38,
    liked: true,
    bookmarked: true,
    comments: [
      {
        id: 'comment-1',
        author: communityUsers.sungyoon,
        body: '축하해요! 3km 구간 페이스 조절 진짜 잘했네요',
        createdAt: '2026-10-19T10:45:00+09:00',
        likeCount: 4,
        liked: false,
      },
      {
        id: 'comment-2',
        author: communityUsers.eunseo,
        body: '저도 다음 주에 이 코스 도전해볼게요',
        createdAt: '2026-10-19T11:45:00+09:00',
        likeCount: 0,
        liked: false,
      },
      {
        id: 'comment-3',
        author: communityUsers.jiwoo,
        body: '코칭 알림 진동으로 오나요?',
        createdAt: '2026-10-19T12:13:00+09:00',
        likeCount: 0,
        liked: false,
      },
    ],
  },
  {
    id: 'post-sungyoon-1018',
    author: communityUsers.sungyoon,
    body: null,
    record: sharedRun(
      'shared-sungyoon-1018',
      '광안리 해변 왕복',
      '광안리해수욕장',
      '2026-10-18T07:04:00+09:00',
      5000,
      1850,
      shapes.coast,
      [149, 164],
    ),
    courseShared: true,
    createdAt: '2026-10-18T08:10:00+09:00',
    likeCount: 251,
    liked: false,
    bookmarked: false,
    comments: [],
  },
  {
    id: 'post-eunseo-1017',
    author: communityUsers.eunseo,
    body: '남천 해변 언덕길 오르막 구간 팁 있을까요? 2km 지점에서 매번 심박이 확 올라가요',
    record: sharedRun(
      'shared-eunseo-1017',
      '남천 해변 언덕길',
      '남천 해변',
      '2026-10-17T19:30:00+09:00',
      4040,
      1623,
      shapes.hill,
      [167, 161],
    ),
    courseShared: false,
    createdAt: '2026-10-17T20:20:00+09:00',
    likeCount: 12,
    liked: false,
    bookmarked: false,
    comments: [
      {
        id: 'comment-4',
        author: communityUsers.seoyun,
        body: '오르막 직전에 보폭을 줄여 보세요. 심박이 덜 올라요',
        createdAt: '2026-10-17T21:02:00+09:00',
        likeCount: 2,
        liked: false,
      },
    ],
  },
  {
    id: 'post-seoyun-1016',
    author: communityUsers.seoyun,
    body: '민락수변 왕복, 바람이 세서 돌아오는 길이 힘들었어요',
    record: sharedRun(
      'shared-seoyun-1016',
      '민락수변 왕복',
      '민락수변공원',
      '2026-10-16T06:40:00+09:00',
      5400,
      1880,
      shapes.coast,
      [155, 168],
    ),
    courseShared: true,
    createdAt: '2026-10-16T07:30:00+09:00',
    likeCount: 21,
    liked: false,
    bookmarked: false,
    comments: [],
  },
  {
    id: 'post-seoyun-1012',
    author: communityUsers.seoyun,
    body: null,
    record: sharedRun(
      'shared-seoyun-1012',
      '남천 해변 언덕길',
      '남천 해변',
      '2026-10-12T06:30:00+09:00',
      5200,
      2020,
      shapes.hill,
      [163, 166],
      false,
    ),
    courseShared: false,
    createdAt: '2026-10-12T07:40:00+09:00',
    likeCount: 9,
    liked: false,
    bookmarked: false,
    comments: [],
  },
];

// My post on 7.1 (7.2b·7.2c), sharing my 10.15 run.
export const myPost = {
  id: 'post-minjun-1015',
  recordId: 'run-1015',
  body: '오늘 목표 30분 안쪽으로 성공! 다음엔 남천 언덕길 도전',
  courseShared: true,
  createdAt: '2026-10-19T12:40:00+09:00',
  likeCount: 7,
};

// 7.4 러너 프로필 (U21). I follow sungyoon.k and eunseo_jog; jiwoo.runs is private.
export const runnerProfiles: Record<
  string,
  {
    level: SelfReportedLevel;
    followerCount: number;
    followingCount: number;
    isPrivate: boolean;
    followStatus: 'NONE' | 'PENDING' | 'FOLLOWING';
  }
> = {
  [communityUsers.me.userId]: {
    level: 'INTERMEDIATE',
    followerCount: 86,
    followingCount: 102,
    isPrivate: false,
    followStatus: 'NONE',
  },
  [communityUsers.seoyun.userId]: {
    level: 'INTERMEDIATE',
    followerCount: 248,
    followingCount: 131,
    isPrivate: false,
    followStatus: 'NONE',
  },
  [communityUsers.sungyoon.userId]: {
    level: 'ADVANCED',
    followerCount: 512,
    followingCount: 88,
    isPrivate: false,
    followStatus: 'FOLLOWING',
  },
  [communityUsers.eunseo.userId]: {
    level: 'BEGINNER',
    followerCount: 64,
    followingCount: 70,
    isPrivate: false,
    followStatus: 'FOLLOWING',
  },
  [communityUsers.jiwoo.userId]: {
    level: 'INTERMEDIATE',
    followerCount: 120,
    followingCount: 140,
    isPrivate: true,
    followStatus: 'NONE',
  },
};

// 7.4 러너 프로필 photos (U21 profileImageUrl); runners left out have none.
export const runnerPhotos: Record<string, string | null> = {
  [communityUsers.seoyun.userId]: assetUri(mockSeoyunPhoto),
};

// 7.4b 팔로우 요청 N건.
export const myFollowRequestCount = 0;
