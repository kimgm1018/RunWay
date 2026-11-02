export type ReadinessState =
  | 'ready'
  | 'collecting'
  | 'stale'
  | 'permissionDenied'
  | 'watchDisconnected';

export type UserProfile = {
  id: string;
  nickname: string;
  runningLevel: 'beginner' | 'intermediate' | 'advanced';
  // 2.1 홈 avatar; null shows the first letter of the nickname.
  profileImageUrl: string | null;
};

export type TodayCondition = {
  date: string;
  syncedAt: string | null;
  readinessState: ReadinessState;
  readinessScore: number | null;
  condition: string | null;
  sleepMinutes: number | null;
  restingHeartRate: number | null;
  // Labels under each 2.1 metric, plus the AI line. All null until a score exists.
  readinessSummary: string | null;
  sleepLabel: string | null;
  restingHeartRateLabel: string | null;
  weeklyLoad: string | null;
  weeklyLoadLabel: string | null;
  aiAdvice: string | null;
  // 2.P′ 오래된 데이터: when the last score was made.
  lastAssessedDate: string | null;
};

// 2.1 러닝 분석 card.
export type MonthlyRunSummary = {
  month: string;
  runCount: number;
  totalDistanceM: number;
  averagePaceSecPerKm: number | null;
  // Monday-first share of the busiest weekday, 0–1.
  weekdayRatios: number[];
  // Positive when this month is faster than last month.
  paceImprovementSec: number | null;
};

export type RecordSort = 'recent' | 'distance' | 'pace';

export type RunRecordSummary = {
  id: string;
  title: string;
  startedAt: string;
  distanceM: number;
  durationSec: number;
  averagePaceSecPerKm: number;
  // Shape of the run for the small thumbnail, as [x, y] points in a 0–1 box.
  shape: [number, number][];
  // H01 runType: group runs show their crew and how many finished (5.1 그룹런 표시).
  runType: 'SOLO' | 'GROUP';
  group: { crewName: string; finisherCount: number } | null;
  // H01 goalAchieved: false shows the run in coral (5.1); null when the run had no goal.
  goalAchieved: boolean | null;
};

// 5.1 전체 · 개인 · 그룹런 탭 (H01 runType).
export type RecordFilter = 'ALL' | 'SOLO' | 'GROUP';

// Totals for a month, week or year (5.1 월 요약, 5.3 요약, H06).
export type PeriodSummary = {
  runCount: number;
  totalDistanceM: number;
  totalDurationSec: number;
  averagePaceSecPerKm: number | null;
};

// 5.1: one month of runs, newest first. The summary covers the whole month whatever the filter.
export type RecordMonth = {
  month: string;
  summary: PeriodSummary;
  records: RunRecordSummary[];
};

// H03 구간: one stretch of the run for the 5.2 graphs. Heart rate and cadence are null without a watch.
export type RunSplit = {
  startDistanceM: number;
  endDistanceM: number;
  paceSecPerKm: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
};

// 5.2 기록 상세 (H02 with H03 splits).
export type RunRecordDetail = RunRecordSummary & {
  // [longitude, latitude] points; null for a run recorded without location.
  route: [number, number][] | null;
  targetDurationSec: number | null;
  targetPaceSecPerKm: number | null;
  aiAdvice: string | null;
  splits: RunSplit[];
  // The planned course, if the run followed one.
  courseId: string | null;
  // My saved course for this run (내 코스에 저장), or null when it is not saved.
  myCourseId: string | null;
};

export type AnalysisPeriod = 'WEEK' | 'MONTH' | 'YEAR';

// 5.3 러닝 분석 (H06) for the week, month or year that holds baseDate.
export type RunStatistics = PeriodSummary & {
  // Distance by weekday (WEEK, Monday first), week of the month (MONTH) or month (YEAR).
  breakdown: number[];
  // Share of time in heart rate zones 1–5; empty without heart rate data.
  heartRateZones: number[];
  // H06 previousPeriod has no time total; 5.3 compares count, distance and pace.
  previousPeriod: Omit<PeriodSummary, 'totalDurationSec'> | null;
};

// 5.3 평균 페이스 추이 (H07), oldest month first.
export type PaceTrend = {
  items: {
    month: string;
    averagePaceSecPerKm: number | null;
    runCount: number;
  }[];
  changeSecPerKm: number | null;
};

export type SavedCourse = {
  id: string;
  name: string;
  // C09 myAlias: the nickname only I see (3.1c 카드 제목). null shows the course name.
  myAlias: string | null;
  distanceM: number;
  expectedMinutes: number;
  shape: [number, number][];
};

// U10 환경 코드 (3.1 환경 · 여러 개 선택).
export type EnvironmentType =
  | 'PARK'
  | 'RIVERSIDE'
  | 'URBAN'
  | 'BEACH'
  | 'TRACK';

export type Place = { name: string; position: [number, number] };

// C01 코스 추천 request, from 3.1 오늘의 러닝.
export type CourseSearch = {
  origin: Place;
  targetDistanceM: number;
  goalInputType: 'TIME' | 'PACE';
  targetDurationSec: number | null;
  targetPaceSecPerKm: number | null;
  environmentTypes: EnvironmentType[];
};

// One card of 3.1b 추천 코스; the back of the card is the course detail.
export type RecommendedCourse = {
  id: string;
  name: string;
  distanceM: number;
  estimatedDurationSec: number;
  // 순환 · 왕복 · 편도 순환
  shapeKind: string;
  environmentLabels: string[];
  // null when the course has no measured climb (C03 elevationGainM).
  elevationGainM: number | null;
  // Relative height of each tenth of the course, 0–100 (구간 고도).
  elevationProfile: number[];
  reason: string;
  route: [number, number][];
  saved: boolean;
};

export type NotificationKind =
  | 'GROUP_RUN_STARTING'
  | 'CREW_JOIN_APPROVED'
  | 'CREW_JOIN_REJECTED'
  | 'POST_COMMENT'
  | 'GROUP_RUN_CANCELED'
  | 'FOLLOW_REQUEST';

// 7.x 커뮤니티 (CMT01–CMT11). The 7.3 share card shows heart rate and cadence and the bookmark,
// share and 코스도 함께 공유 controls follow the K1 sheets; the API has none of these yet.

// The run a post shares, drawn as the 7.1 record card. It is also a 5.1 record row (7.4 lists).
export type PostRecord = RunRecordSummary & {
  // 민락수변공원 in 민락수변공원 · 코스 러닝.
  place: string;
  courseRun: boolean;
  averageHeartRate: number | null;
  cadence: number | null;
};

// The community name is a handle like seoyun.run; the avatar shows the first letter of the nickname.
export type PostAuthor = { userId: string; handle: string; nickname: string };

export type Post = {
  id: string;
  author: PostAuthor;
  isMine: boolean;
  body: string | null;
  record: PostRecord;
  courseShared: boolean;
  createdAt: string;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  bookmarked: boolean;
};

export type PostComment = {
  id: string;
  author: PostAuthor;
  body: string;
  createdAt: string;
  likeCount: number;
  liked: boolean;
};

export type PostDetail = Post & { comments: PostComment[] };

export type FeedScope = 'ALL' | 'FOLLOWING';

// 7.3 기록 공유 and 7.3e 게시물 수정.
export type PostDraft = { body: string | null; courseShared: boolean };

// 7.4 러너 프로필 and 7.4b 내 프로필 (U21). records are the runner's shared runs, or my recent runs.
export type RunnerProfile = {
  userId: string;
  handle: string;
  nickname: string;
  level: SelfReportedLevel;
  isMe: boolean;
  followerCount: number;
  followingCount: number;
  followStatus: 'NONE' | 'PENDING' | 'FOLLOWING';
  isPrivate: boolean;
  // 7.4b 팔로우 요청 N건; null on someone else's profile.
  followRequestCount: number | null;
  monthly: {
    runCount: number;
    totalDistanceM: number;
    averagePaceSecPerKm: number | null;
  };
  // A shared run opens its post (postId); my own runs open 5.2.
  records: { record: RunRecordSummary; postId: string | null }[];
};

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  message: string;
  createdAt: string;
  read: boolean;
};

export type GpsQuality = 'good' | 'weak' | 'none';

export type CurrentPlace = {
  name: string;
  gps: GpsQuality;
  // [longitude, latitude] as in GeoJSON.
  position: [number, number];
};

// 2.0 코스 러닝: the course split into 1km segments with a recommended pace each.
export type CoursePlan = {
  courseId: string;
  name: string;
  distanceM: number;
  route: [number, number][];
  segmentPacesSecPerKm: number[];
  strategy: string;
  targetPaceSecPerKm: number;
  expectedDurationSec: number;
  caution: string | null;
  // 경쟁 모드: the earlier run on this course to race against (4.2 기록 차이, 4.5 비교 결과).
  rival: { startedAt: string; durationSec: number } | null;
};

// One reading during a run, once a second (4.2 러닝 진행).
export type RunSample = {
  elapsedSec: number;
  distanceM: number;
  paceSecPerKm: number | null;
  // null without a watch (4.5F 워치가 없으면 ‘– –’).
  heartRate: number | null;
  cadence: number | null;
  // GPS position as [longitude, latitude]; null while the signal is lost.
  position: [number, number] | null;
};

// 4.2 길 안내 줄.
export type RunGuidance = { instruction: string; detail: string };

export type RunRecordDraft = {
  mode: 'FREE' | 'COURSE' | 'GROUP';
  courseId: string | null;
  groupRunId: string | null;
  startedAt: string;
  durationSec: number;
  distanceM: number;
  averagePaceSecPerKm: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
  // The GPS track; null when the run had no location.
  route: [number, number][] | null;
  goalDistanceM: number | null;
  goalPaceSecPerKm: number | null;
};

// G03 status (group_runs.status).
export type GroupRunStatus =
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED';

// G13 cancelReason (6.4c 취소 이유).
export type GroupRunCancelReason =
  | 'WEATHER'
  | 'PERSONAL'
  | 'LACK_OF_PARTICIPANTS'
  | 'LOCATION_ISSUE'
  | 'OTHER';

// 6.0 내 크루 panel. PENDING is a join request the crew leader has not approved yet.
export type MyCrew = {
  id: string;
  name: string;
  area: string;
  memberCount: number;
  membership: 'MEMBER' | 'PENDING';
};

// 6.1 크루 모집 card (M01). myMembership is null for a crew I have not asked to join.
export type CrewListItem = {
  id: string;
  name: string;
  description: string | null;
  area: string;
  capacity: number;
  memberCount: number;
  myMembership: MyCrew['membership'] | null;
};

// 6.2 구성원 row (M07). Pace is the member's recent average, null before their first run.
export type CrewMember = {
  userId: string;
  nickname: string;
  isOwner: boolean;
  isMe: boolean;
  recentPaceSecPerKm: number | null;
};

// 6.2a 가입 방식. M03 fixes it to APPROVAL; 바로 가입 follows the K1 sheet and has no API yet.
export type CrewJoinPolicy = 'APPROVAL' | 'INSTANT';

// 6.2 크루 상세 (M02 with the M07 members). The 6.2m capacity edit and 6.2a join policy follow
// the K1 sheets and have no API yet (docs/design/api/crews.md).
export type CrewDetail = CrewListItem & {
  joinPolicy: CrewJoinPolicy;
  amOwner: boolean;
  members: CrewMember[];
  // 6.2m 가입 신청 N건, only for the crew leader.
  pendingRequestCount: number | null;
};

// 6.3 크루 만들기 (M03). area is the place picked from the search; joinPolicy follows the K1 sheet.
export type CrewDraft = {
  name: string;
  area: string;
  // The picked place's address, which the server reads its region from.
  address: string | null;
  description: string | null;
  joinPolicy: CrewJoinPolicy;
  capacity: number;
};

// 6.2a 대기 중인 신청 (M05). recent5kPaceSecPerKm is null before the applicant's first 5km.
// M05 has only the nickname, so loginId and level are null for server requests.
export type CrewJoinRequest = {
  userId: string;
  nickname: string;
  loginId: string | null;
  level: SelfReportedLevel | null;
  recent5kPaceSecPerKm: number | null;
  // 첫 크루: the applicant has never been in a crew.
  firstCrew: boolean;
  requestedAt: string;
};

// A group run as listed on 6.0 and opened on 6.4 (G02·G03).
export type GroupRunSummary = {
  id: string;
  crewId: string;
  crewName: string;
  title: string;
  hostId: string;
  hostNickname: string;
  isHost: boolean;
  scheduledAt: string;
  meetingPlaceName: string;
  meetingAddress: string;
  // null for a free run without a course.
  courseId: string | null;
  courseName: string | null;
  targetDistanceM: number | null;
  // A free run's goal is its time (6.4 ‘자유 러닝 · 40분’).
  targetDurationSec: number | null;
  participantCount: number;
  joined: boolean;
  status: GroupRunStatus;
};

// 6.0: the run about to start is pinned on top; crews list their upcoming runs.
export type MyGroupRuns = {
  upcoming: GroupRunSummary | null;
  crews: { crew: MyCrew; groupRuns: GroupRunSummary[] }[];
  // 6.0b: crews recruiting near me, shown when I have none.
  nearbyRecruiting: { count: number; areas: string[] };
};

// G07 참가자. Other members' readiness score is not shared (6.5 설계 메모).
export type GroupRunParticipant = {
  userId: string;
  nickname: string;
  isHost: boolean;
  isMe: boolean;
  readyStatus: 'READY' | 'WAITING';
  readinessScore: number | null;
};

// 6.4 그룹런 상세 (G03 with G07 participants).
export type GroupRunDetail = GroupRunSummary & {
  route: [number, number][] | null;
  meetingPosition: [number, number];
  // 예상 공동 페이스: an estimate from the participants so far, not a fixed goal.
  goalPaceSecPerKm: number;
  crewMemberCount: number;
  participants: GroupRunParticipant[];
  // 내 페이스와 잘 맞아요: my recent 5km pace and today's readiness.
  myFit: { recentPaceSecPerKm: number; readinessScore: number } | null;
  // 6.4e 취소 완료.
  cancellation: {
    reason: GroupRunCancelReason;
    message: string | null;
    byNickname: string;
    byRole: string;
  } | null;
};

// 6.5 출발 준비.
export type WaitingRoom = {
  groupRunId: string;
  goalPaceSecPerKm: number;
  // 참가자 편한 범위.
  comfortRange: [number, number];
  expectedDurationSec: number;
  appliedCount: number;
  participants: GroupRunParticipant[];
};

// G10 실시간 현황, seen from me. gapM is positive for members ahead of me.
export type GroupRunLive = {
  members: {
    userId: string;
    nickname: string;
    isMe: boolean;
    gapM: number;
    paceSecPerKm: number;
  }[];
  // 선두–후미 간격.
  spreadM: number;
  inRange: boolean;
  // 지금 안내 페이스; it differs from the start goal after a load alert.
  guidePaceSecPerKm: number;
  // 6.6b 멤버 부담 알림: how many members are strained and the pace the group slows to.
  loadAlert: { memberCount: number; nextPaceSecPerKm: number } | null;
};

// 6.7 그룹런 결과 (G14).
export type GroupRunResult = {
  groupRunId: string;
  title: string;
  status: GroupRunStatus;
  targetDistanceM: number | null;
  // 함께 달린 거리 · 그룹 평균 · 최대 간격.
  distanceM: number;
  averagePaceSecPerKm: number;
  maxGapM: number;
  participants: {
    userId: string;
    nickname: string;
    isMe: boolean;
    state: 'FINISHED' | 'STOPPED' | 'RUNNING';
    durationSec: number;
    distanceM: number;
    goalAchieved: boolean | null;
  }[];
};

// 6.9 만남 장소.
export type MeetingPlace = {
  name: string;
  address: string;
  position: [number, number];
  // From my current position.
  distanceM: number;
};

// G01 그룹런 생성 (6.8).
export type GroupRunDraft = {
  crewId: string;
  courseId: string | null;
  meetingPlaceName: string;
  meetingAddress: string;
  meetingPosition: [number, number];
  // 찾아오는 법 (6.9b, optional).
  meetingNote: string | null;
  scheduledAt: string;
  targetDistanceM: number | null;
  targetDurationSec: number | null;
};

export type MusicService = 'MELON' | 'SPOTIFY';
export type MusicSource = MusicService | 'NONE';
export type MusicServiceStatus =
  | 'CONNECTED'
  | 'LOGIN_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'INSTALL_REQUIRED';

export type Track = {
  id: string;
  title: string;
  subtitle: string;
  durationSec: number;
};

export type Playlist = { id: string; title: string };

export type MusicLibrary = {
  likedCount: number;
  liked: Track[];
  recent: Playlist[];
  playlists: Playlist[];
  top100UpdatedAt: string | null;
  top100: Track[];
};

export type MusicState = {
  // null until the user picks a source in 2.8 (2.7a 미연결).
  source: MusicSource | null;
  services: Record<MusicService, MusicServiceStatus>;
  // 2.7b: the link between RunWay and the music app dropped.
  linked: boolean;
  nowPlaying: (Track & { positionSec: number; playing: boolean }) | null;
  library: MusicLibrary | null;
  // Spotify plays chosen tracks only with Premium (2.7S).
  premium: boolean;
};

// U01 로그인 · U15 회원가입 response.
export type AuthSession = {
  user: { id: number; loginId: string };
  accessToken: string;
  refreshToken: string;
  onboardingCompleted: boolean;
};

export type Gender = 'MALE' | 'FEMALE';

// ERD code for users.health_data_access, spelled as in the API spec.
export type HealthDataAccess = 'AGREEE' | 'DISAGREE';

export type SignUpRequest = {
  loginId: string;
  password: string;
  nickname: string;
  birthDate: string;
  gender: Gender;
  phoneNumber: string;
  healthDataAccess: HealthDataAccess;
};

export type BasicProfile = Pick<
  SignUpRequest,
  'nickname' | 'birthDate' | 'gender'
>;

export type LoginIdAvailability = {
  loginId: string;
  available: boolean;
  reason: 'DUPLICATED' | null;
};

// Phone verification has no API spec yet; these shapes cover 1.3 and 1.2q until it does.
export type PhoneVerificationPurpose = 'SIGN_UP' | 'PASSWORD_RESET';

export type PhoneCodeRequest = {
  phoneNumber: string;
  purpose: PhoneVerificationPurpose;
};

export type SelfReportedLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

// 평소 러닝 정보, part of the running profile (U06). Distance and time are null when the pace was typed directly.
export type RunningBaseline = {
  baselineDistanceM: number | null;
  baselineDurationSec: number | null;
  usualPaceSecPerKm: number;
};

// U06 러닝 프로필: the running level and the usual pace in one.
export type RunningProfile = RunningBaseline & {
  selfReportedLevel: SelfReportedLevel;
  onboardingCompleted: boolean;
};

// How the usual pace was entered (U07 inputType). Sending the other way's fields is rejected as mixed input.
export type PaceEntry =
  | { inputType: 'PACE'; usualPaceSecPerKm: number }
  | {
      inputType: 'DISTANCE_TIME';
      baselineDistanceM: number;
      baselineDurationSec: number;
      // Worked out on the phone; the server stores it as given.
      usualPaceSecPerKm: number;
    };

// U07 저장·부분 수정. The first save needs both; after that either one alone keeps the other.
export type RunningProfileChange = {
  selfReportedLevel?: SelfReportedLevel;
  pace?: PaceEntry;
};

export type WatchLinkState = 'connected' | 'denied' | 'disconnected';

// Read from the watch on the phone, not from the server.
export type WatchConnection = {
  status: 'connected' | 'disconnected';
  // 8.1 Galaxy Watch7 · 06:42 동기화.
  deviceName: string;
  lastSyncedAt: string | null;
  batteryPercent: number | null;
  permissions: Record<
    'heartRate' | 'location' | 'sleep' | 'activity',
    WatchLinkState
  >;
};

// 8.1 설정: the app settings (U19) and the account visibility (U13).
export type LocationRecordingMode = 'ALWAYS' | 'RUNNING_ONLY' | 'OFF';

export type AppSettings = {
  voiceCoachingEnabled: boolean;
  bpmGuideEnabled: boolean;
  locationRecordingMode: LocationRecordingMode;
  notifications: { groupRun: boolean; community: boolean };
  isPrivate: boolean;
};

// 8.2 프로필 수정 (U04·U05 and the running profile U06).
export type ProfileDetail = BasicProfile & {
  runningLevel: SelfReportedLevel;
  baseline: RunningBaseline;
};

// 8.4 회원탈퇴 확인 (U17): what goes away and the crews I lead, handed to their oldest member.
export type WithdrawalSummary = {
  runningRecordCount: number;
  postCount: number;
  savedCourseCount: number;
  connectedDevices: string[];
  ownedCrews: string[];
};

export type Repositories = {
  auth: {
    login: (request: {
      loginId: string;
      password: string;
    }) => Promise<AuthSession>;
    checkLoginId: (loginId: string) => Promise<LoginIdAvailability>;
    requestPhoneCode: (
      request: PhoneCodeRequest,
    ) => Promise<{ expiresInSec: number }>;
    verifyPhoneCode: (
      request: PhoneCodeRequest & { code: string },
    ) => Promise<{ verificationToken: string }>;
    signUp: (request: SignUpRequest) => Promise<AuthSession>;
    resetPassword: (request: {
      verificationToken: string;
      newPassword: string;
    }) => Promise<void>;
  };
  profile: {
    getMe: () => Promise<UserProfile>;
    updateBasic: (profile: BasicProfile) => Promise<void>;
    // null until the first U07 save (404 PROFILE_NOT_SET).
    getRunningProfile: () => Promise<RunningProfile | null>;
    saveRunningProfile: (
      change: RunningProfileChange,
    ) => Promise<RunningProfile>;
    getDetail: () => Promise<ProfileDetail>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (change: Partial<AppSettings>) => Promise<AppSettings>;
  };
  // 8.4–8.6 회원탈퇴 (U17·U18). A wrong password fails with INVALID_PASSWORD.
  account: {
    getWithdrawalSummary: () => Promise<WithdrawalSummary>;
    withdraw: (password: string) => Promise<void>;
  };
  home: {
    getTodayCondition: () => Promise<TodayCondition>;
    getMonthlySummary: () => Promise<MonthlyRunSummary>;
  };
  records: {
    // 2.1 과거 러닝 기록: my own runs only; group runs are listed in 5.1.
    getRecent: (sort: RecordSort, limit: number) => Promise<RunRecordSummary[]>;
    // month is YYYY-MM.
    getMonth: (month: string, filter: RecordFilter) => Promise<RecordMonth>;
    getDetail: (recordId: string) => Promise<RunRecordDetail>;
    // baseDate is any day (YYYY-MM-DD) inside the period.
    getStatistics: (
      period: AnalysisPeriod,
      baseDate: string,
    ) => Promise<RunStatistics>;
    getPaceTrend: (months: number) => Promise<PaceTrend>;
  };
  courses: {
    getSaved: () => Promise<SavedCourse[]>;
    // 2.0's plan for the course picked last with choose(); a default course until then.
    getTodayPlan: () => Promise<CoursePlan>;
    getOrigins: () => Promise<Place[]>;
    recommend: (search: CourseSearch) => Promise<RecommendedCourse[]>;
    save: (courseId: string) => Promise<void>;
    unsave: (courseId: string) => Promise<void>;
    choose: (courseId: string) => Promise<void>;
    // 4.5F 내 코스에 저장: turns a free run's path into a saved course.
    saveFromRun: (run: {
      recordId: string;
      route: [number, number][];
      distanceM: number;
      durationSec: number;
    }) => Promise<{ courseId: string }>;
  };
  // 6.1–6.3 크루 (M01–M11).
  crews: {
    // query matches the crew name or area; nearby keeps crews within 3km of me.
    search: (request: {
      query: string;
      nearby: boolean;
    }) => Promise<CrewListItem[]>;
    get: (crewId: string) => Promise<CrewDetail>;
    // M04: the request waits as PENDING, or makes me a MEMBER at once in a 바로 가입 crew.
    // A full crew fails with CREW_CAPACITY_EXCEEDED.
    requestJoin: (crewId: string) => Promise<MyCrew['membership']>;
    // 6.2m 정원: from the member count up to 200 (M03's limit).
    updateCapacity: (crewId: string, capacity: number) => Promise<void>;
    setJoinPolicy: (crewId: string, policy: CrewJoinPolicy) => Promise<void>;
    listJoinRequests: (crewId: string) => Promise<CrewJoinRequest[]>;
    // M03: I become the leader and the only member.
    create: (draft: CrewDraft) => Promise<{ id: string }>;
    // M08 크루 나가기. The leader cannot leave this way (OWNER_CANNOT_LEAVE).
    leave: (crewId: string) => Promise<void>;
    // M06: approving a full crew fails with CREW_CAPACITY_EXCEEDED.
    decideJoinRequest: (
      crewId: string,
      userId: string,
      approve: boolean,
    ) => Promise<void>;
  };
  // 6.x 그룹런 (G01–G16).
  groupRuns: {
    listMine: () => Promise<MyGroupRuns>;
    get: (groupRunId: string) => Promise<GroupRunDetail>;
    join: (groupRunId: string) => Promise<void>;
    leave: (groupRunId: string) => Promise<void>;
    create: (draft: GroupRunDraft) => Promise<{ id: string }>;
    // G04 그룹런 수정 (6.8 opened from 6.4 by the host): the crew stays.
    update: (
      groupRunId: string,
      draft: Omit<GroupRunDraft, 'crewId'>,
    ) => Promise<void>;
    cancel: (groupRunId: string, reason: GroupRunCancelReason) => Promise<void>;
    searchPlaces: (query: string) => Promise<MeetingPlace[]>;
    getWaitingRoom: (groupRunId: string) => Promise<WaitingRoom>;
    setReady: (groupRunId: string, ready: boolean) => Promise<WaitingRoom>;
    // Calls onStart when the group leader starts; ready members' records start with it.
    watchStart: (
      groupRunId: string,
      onStart: (startedAt: string) => void,
    ) => () => void;
    // Calls onUpdate every second with where the other members are (G10).
    watchLive: (
      groupRunId: string,
      onUpdate: (live: GroupRunLive) => void,
    ) => () => void;
    forceFinish: (groupRunId: string) => Promise<void>;
    getResult: (groupRunId: string) => Promise<GroupRunResult>;
  };
  community: {
    listFeed: (scope: FeedScope) => Promise<Post[]>;
    get: (postId: string) => Promise<PostDetail>;
    // The run 7.3 shares: the given record, or my newest one.
    getShareable: (recordId: string | null) => Promise<PostRecord>;
    create: (recordId: string, draft: PostDraft) => Promise<{ id: string }>;
    update: (postId: string, draft: PostDraft) => Promise<void>;
    remove: (postId: string) => Promise<void>;
    setLiked: (postId: string, liked: boolean) => Promise<void>;
    setBookmarked: (postId: string, bookmarked: boolean) => Promise<void>;
    addComment: (postId: string, body: string) => Promise<PostComment>;
  };
  // 7.4 · 7.4b (U21–U23). userId null is me.
  runners: {
    getProfile: (userId: string | null) => Promise<RunnerProfile>;
    setFollowing: (
      userId: string,
      following: boolean,
    ) => Promise<RunnerProfile>;
  };
  notifications: {
    list: () => Promise<AppNotification[]>;
    markAllRead: () => Promise<void>;
  };
  run: {
    getCurrentPlace: () => Promise<CurrentPlace>;
    // Starts reading GPS and the watch from where the run left off; returns a function that stops it.
    startTracking: (
      from: RunSample,
      // The course being run, so the mock can follow it; the real tracker ignores it and reads GPS.
      route: [number, number][] | null,
      onSample: (sample: RunSample, guidance: RunGuidance | null) => void,
    ) => () => void;
    // Saves the finished run (4.5 기록 저장 중 → 기록 저장됨 · 동기화 완료).
    saveRecord: (record: RunRecordDraft) => Promise<{ recordId: string }>;
  };
  music: {
    getState: () => Promise<MusicState>;
    selectSource: (source: MusicSource) => Promise<MusicState>;
    // Opens login, permission or install for a service (2.8 오른쪽 버튼).
    resolveService: (service: MusicService) => Promise<MusicState>;
    reconnect: () => Promise<MusicState>;
  };
  // The current time; mock data pins it to the prototype's 12:45 so relative times and day/night match.
  clock: {
    now: () => Date;
  };
  watch: {
    getConnection: () => Promise<WatchConnection>;
    reconnect: () => Promise<WatchConnection>;
    // 8.3 연결 해제 (실행 취소 reconnects).
    disconnect: () => Promise<WatchConnection>;
  };
};
