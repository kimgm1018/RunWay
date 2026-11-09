export type ReadinessState =
  | 'ready'
  | 'collecting'
  | 'stale'
  | 'permissionDenied'
  | 'watchDisconnected';

export type UserProfile = {
  id: string;
  nickname: string;
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
  // H01 runType: group runs show their crew and how many met the goal (5.1 그룹런 표시).
  // group is null for solo runs and for runs without a group run link; groupRunId opens 6.7 (G14).
  runType: 'SOLO' | 'GROUP';
  group: {
    crewName: string;
    finisherCount: number;
    groupRunId: string;
  } | null;
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

// 기존 코스 태그 표현. U11·U12 기본값은 아래 RecommendationFilters를 사용한다.
export type EnvironmentType =
  | 'PARK'
  | 'RIVERSIDE'
  | 'URBAN'
  | 'BEACH'
  | 'TRACK';

export type Place = { name: string; position: [number, number] };

// U11·U12: 좌표·거리·페이스를 포함하지 않는 추천 기본값.
export type CourseShape = 'loop' | 'out_and_back' | 'point_to_point';
export type RecommendationFilters = {
  river: boolean;
  beach: boolean;
  park: boolean;
  trail: boolean;
  pedestrian: boolean;
  flat: boolean;
  avoid_major_road: boolean;
  avoid_steps: boolean;
  avoid_tunnel: boolean;
};
export type RecommendationPreferences = {
  shape: CourseShape;
  filters: RecommendationFilters;
};

// C01 코스 추천 request, from 3.1 오늘의 러닝.
export type CourseSearch = {
  origin: Place;
  targetDistanceM: number;
  goalInputType: 'TIME' | 'PACE';
  targetDurationSec: number | null;
  targetPaceSecPerKm: number | null;
  environmentTypes: EnvironmentType[];
  // 기존 호출은 순환·기존 환경을 사용하며, 추천 조건 화면은 아래 선택값을 명시한다.
  shape?: CourseShape;
  filters?: RecommendationFilters;
  destination?: Place | null;
  // C01 seed. Leaving it out asks for the first set (1); 다른 코스 sends the nextSeed of the last answer.
  seed?: number;
};

// One C01 answer: the cards, notices about the whole answer and the seed for 다른 코스 (null when there is no more).
export type CourseRecommendations = {
  courses: RecommendedCourse[];
  notices: string[];
  nextSeed: number | null;
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
  // A route C01 made just now: it has no course id yet, so it cannot be saved or run until 371 saves it.
  generated?: boolean;
};

// 2.9 알림 kinds, the server's notifications.notification_type (docs/design/api/notifications.md).
export type NotificationKind =
  | 'GROUP_RUN_PARTICIPATION_CANCELLED'
  | 'GROUP_RUN_START_REMINDER'
  | 'CREW_JOIN_APPROVED'
  | 'CREW_JOIN_REJECTED'
  | 'POST_COMMENT'
  | 'NEW_FOLLOWER'
  | 'FOLLOW_REQUEST'
  | 'FOLLOW_APPROVED';

// 7.x 커뮤니티 (CMT01–CMT11). The 7.3 share card shows heart rate and cadence and the bookmark,
// share and 코스도 함께 공유 controls follow the K1 sheets; the API has none of these yet.

// The run a post shares, drawn as the 7.1 record card. It is also a 5.1 record row (7.4 lists).
export type PostRecord = RunRecordSummary & {
  // 민락수변공원 in 민락수변공원 · 코스 러닝.
  place: string;
  // The shared course as GeoJSON [longitude, latitude] points (C03 route), for 7.2's map and 코스 재생; null
  // when the post has no course or the list (CMT02) does not carry it.
  route: [number, number][] | null;
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
  // null when the server does not count them yet (CMT02·CMT03); the screens then leave the number out.
  likeCount: number | null;
  liked: boolean;
  commentCount: number | null;
  bookmarked: boolean;
};

export type PostComment = {
  id: string;
  author: PostAuthor;
  // Mine shows 7.2's 댓글 수정·삭제 menu (CMT08·CMT09).
  isMine: boolean;
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
  // U21 profileImageUrl: the runner's photo address, or null without one (7.4 · 7.4b draw it big).
  profileImageUrl: string | null;
  // U21 runningLevel; null before the running profile is set or while the profile is closed to me.
  level: SelfReportedLevel | null;
  isMe: boolean;
  // Approved followers and followings; null while the profile is closed to me.
  followerCount: number | null;
  followingCount: number | null;
  followStatus: 'NONE' | 'PENDING' | 'FOLLOWING';
  // U21 profileAccessible: me, a public account, or a private one that approved my follow.
  accessible: boolean;
  // 7.4b 팔로우 요청 N건 (U24): more when there are further pages past the count. null on someone else's
  // profile, or when the requests could not be read.
  followRequests: { count: number; more: boolean } | null;
  monthly: {
    runCount: number;
    totalDistanceM: number;
    averagePaceSecPerKm: number | null;
  };
  // A shared run opens its post (postId); my own runs open 5.2.
  records: { record: RunRecordSummary; postId: string | null }[];
};

// 7.4b 팔로우 요청 (U24): one request to my private account, waiting for my answer.
export type FollowRequest = {
  requesterId: string;
  // U25 checks it is still the request I saw, not one sent again after a refusal or cancel.
  requestId: string;
  nickname: string;
  requestedAt: string;
};

// U24 pages of 10, newest first; nextCursor is null on the last page.
export type FollowRequestPage = {
  items: FollowRequest[];
  nextCursor: string | null;
};

export type FollowDecision = 'APPROVE' | 'REJECT';

// 7.4c 팔로워 · 팔로잉 (U26 · U27, S15P31E105-534): the runners approved on either side of a runner.
export type FollowListKind = 'followers' | 'following';

export type FollowListItem = {
  userId: string;
  nickname: string;
  profileImageUrl: string | null;
};

// U26 · U27 pages of 20, newest relation first; nextCursor is null on the last page.
export type FollowListPage = {
  items: FollowListItem[];
  nextCursor: string | null;
};

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  message: string;
  createdAt: string;
  read: boolean;
  // What the row opens: the group run, crew or post id, or the runner's user id for follow kinds.
  targetId: string;
};

// N01: the newest page of the inbox and the unread count across all of it.
export type NotificationList = {
  items: AppNotification[];
  unreadCount: number;
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
  // The server session a personal run belongs to; its record has the same id (H02). null for group runs and
  // the mock (S15P31E105-529).
  sessionId: string | null;
};

// What saving a finished run gives back. recordId is null when the run has no record of its own to open (a group
// run, whose result is 6.7). server holds the totals the server worked out (H02) when it has them; a null value
// keeps what the phone counted.
export type SavedRunRecord = {
  recordId: string | null;
  server: {
    distanceM: number | null;
    durationSec: number | null;
    averagePaceSecPerKm: number | null;
    averageHeartRate: number | null;
    averageCadence: number | null;
  } | null;
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

// 6.2a 가입 방식, saved on the server (M03 on create, M12 on change; S15P31E105-570).
export type CrewJoinPolicy = 'APPROVAL' | 'INSTANT';

// 6.2 크루 상세 (M02 with the M07 members). The 6.2m capacity edit and 6.2a join policy are saved
// with M12 (docs/design/api/crews.md).
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
  // 6.3 대표 사진 (F01 CREW → M03 imageKey, S15P31E105-531); null without one.
  photo: PhotoFile | null;
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
  // 최근 러닝 평균 페이스와 오늘 준비도.
  myFit: { recentPaceSecPerKm: number; readinessScore: number | null } | null;
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
  // 추천값은 방장 목표와 분리한다. 서버가 제공하지 않으면 null이다.
  recommendedPaceSecPerKm: number | null;
  // 서버가 제공한 참가자 페이스 범위. 미산출이면 null이다.
  comfortRange: [number, number] | null;
  expectedDurationSec: number;
  appliedCount: number;
  // G07 집계(S15P31E105-499/511). session null 포함 대기방 인원·준비 수.
  participantCount: number;
  readyCount: number;
  participants: GroupRunParticipant[];
  // G07 본인 항목의 sessionId. 준비 완료(G16)로 서버가 만든 내 READY 세션이며, 준비 전·목업은 null(S15P31E105-420).
  mySessionId?: string | null;
};

// G10 실시간 현황, seen from me. gapM is positive for members ahead of me.
export type GroupRunLive = {
  members: {
    userId: string;
    nickname: string;
    isMe: boolean;
    gapM: number | null;
    paceSecPerKm: number | null;
    rank?: number | null;
    stale?: boolean;
    gapToAheadM?: number | null;
    gapToBehindM?: number | null;
    // G10 앞·뒤 인원(S15P31E105-420 워치 전달). 서버가 주지 않으면 null.
    aheadCount?: number | null;
    behindCount?: number | null;
  }[];
  // G10 updatedAt. 워치가 늦게 온 현황을 구분하는 기준이다(S15P31E105-420).
  updatedAt?: string | null;
  spreadM: number | null;
  inRange: boolean | null;
  guidePaceSecPerKm: number | null;
  loadAlert: { memberCount: number; nextPaceSecPerKm: number } | null;
  status?: GroupRunStatus;
  // 서버 현황은 GPS 좌표를 제공하지 않는다. 목업만 지도 위 예상 위치를 그린다.
  locationsAvailable?: boolean;
};

// 서버에 없는 집계·미측정 값은 null로 유지한다.
export type GroupRunResult = {
  groupRunId: string;
  title: string;
  status: GroupRunStatus;
  targetDistanceM: number | null;
  distanceM: number | null;
  averagePaceSecPerKm: number | null;
  maxGapM: number | null;
  analysisStatus?: string;
  hasUnconfirmedStarts?: boolean;
  // 내 참가 세션 = 내 그룹런 기록 ID(H02·CMT01). 시작하지 않았거나 목업이면 null(S15P31E105-420).
  mySessionId?: string | null;
  participants: {
    userId: string;
    nickname: string;
    isMe: boolean;
    state: 'FINISHED' | 'STOPPED' | 'RUNNING' | 'NOT_STARTED' | 'UNCONFIRMED';
    durationSec: number | null;
    distanceM: number | null;
    goalAchieved: boolean | null;
  }[];
};

// 6.9 만남 장소.
export type MeetingPlace = {
  name: string;
  address: string;
  position: [number, number];
  // From my current position.
  distanceM: number | null;
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
  // The album cover (Spotify Web API); without one 2.7 draws its default 'ocean' cover.
  artworkUrl?: string | null;
};

export type Playlist = {
  id: string;
  title: string;
  // The playlist cover and its song count (Spotify Web API); the card draws a plain tile without a cover.
  artworkUrl?: string | null;
  trackCount?: number;
  // The icon on the plain tile when there is no cover (멜론 좋아요한 곡 · 최근들은 곡); a note otherwise.
  icon?: 'heart' | 'clock';
};

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
  refreshExpiresAt: string;
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
  // U29 SIGN_UP proof for phoneNumber (users.md U15). Only dev/test servers accept a sign-up without it.
  phoneVerificationToken?: string;
};

// A photo picked on the phone, as React Native's FormData sends it. The server takes jpeg or png up to 5MB.
export type PhotoFile = {
  uri: string;
  type: 'image/jpeg' | 'image/png';
  name: string;
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

// U28·U29 휴대전화 인증 (users.md), used by 1.3 회원가입 and 1.2q 전화번호로 찾기.
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
// U17 (users.md, S15P31E105-523). blockers are what must be cleared before U18 can go through: a crew I
// lead (CREW_OWNER), a group run I host (GROUP_RUN_HOST), a run in progress and so on. The server's message
// is shown as it is.
export type WithdrawalBlocker = { code: string; message: string };
export type WithdrawalSummary = {
  runningRecordCount: number;
  postCount: number;
  savedCourseCount: number;
  // 워치 · 휴대폰 for each connected device.
  connectedDevices: string[];
  ownedCrews: string[];
  // Group runs I host (cancel or end them first) and ones I only joined (cancelled on withdrawal).
  ownedGroupRuns: string[];
  scheduledGroupRuns: string[];
  blockers: WithdrawalBlocker[];
};

// S01~S08 러닝 세션 제어 (docs/design/api/sessions.md). 서버 ID는 int64 정밀도를 지키기 위해 문자열로 다룬다.
export type SessionStatus =
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'INTERRUPTED';

export type ControlAction = 'START' | 'PAUSE' | 'RESUME' | 'END';

export type ControlResultCode =
  | 'PENDING'
  | 'APPLIED'
  | 'REJECTED'
  | 'IGNORED'
  | 'UNKNOWN';

export type SessionCommand = {
  commandId: string;
  action: string;
  expectedVersion: number;
  result: ControlResultCode;
  appliedAt: string | null;
  reasonCode: string | null;
  // P07 SET_BPM·COACHING의 적용 박자와 코칭 ID. 나머지 명령은 null이다(S02 명령 객체, S15P31E105-257).
  targetBpm?: number | null;
  coachingId?: string | null;
  // 미확정 COACHING 명령의 원래 COACHING_GUIDE payload. 만료 후에도 결과 확인용으로 온다.
  coachingGuide?: CoachingGuide | null;
};

// S02 coaching 객체 = COACHING_GUIDE payload (sessions.md "coaching 객체 필드", 9.3).
export type CoachingGuide = {
  commandId: string;
  coachingId: string;
  expectedVersion: number;
  targetBpm: number;
  recommendedPaceSecPerKm: number;
  expiresAt: string;
};

// S02 comparison 객체(sessions.md "기록 비교", S15P31E105-422). 서버가 계산한 같은 거리 도달 운동시간이며 앱·워치는 다시 계산하지 않는다.
// 거리·시간은 AVAILABLE에만 값이 있다. pastElapsedSec - currentElapsedSec가 양수면 앞선다.
export type RecordComparison = {
  status: 'WAITING' | 'AVAILABLE' | 'NO_RECORD' | 'UNAVAILABLE';
  targetStartedAt: string | null;
  distanceM: number | null;
  currentElapsedSec: number | null;
  pastElapsedSec: number | null;
};

export type SessionGoalDraft = {
  courseId: string | null;
  comparisonSessionId: string | null;
  targetDistanceM: number | null;
  targetDurationSec: number | null;
  targetPaceSecPerKm: number | null;
};

export type RunningSessionView = {
  sessionId: string;
  controlDeviceId: string | null;
  relayDeviceId: string | null;
  state: SessionStatus;
  stateVersion: number;
  startedAt: string | null;
  endedAt: string | null;
  recordingMode: 'WATCH' | 'PHONE_FALLBACK' | null;
  pendingCommand: SessionCommand | null;
  lastCommand: SessionCommand | null;
  analysisStatus: string;
  // S02의 확정 BPM·현재 유효 코칭·서버 시각(S15P31E105-257). 목업 세션은 채우지 않는다.
  currentBpm?: number | null;
  coaching?: CoachingGuide | null;
  // 비교 기록을 고르지 않았거나 목업 세션이면 null(S15P31E105-422).
  comparison?: RecordComparison | null;
  serverReceiveAt?: string | null;
  serverSendAt?: string | null;
  // S02 groupEndedAt: 종료된 그룹런의 종료 기준시각. 개인런·진행 중 그룹런은 null(S15P31E105-420).
  groupEndedAt?: string | null;
};

// GROUP_STATUS payload(9.3, S15P31E105-420): G10 현황 중 워치 화면에 쓰는 값. 폰은 옮기기만 하고 계산하지 않는다.
export type WatchGroupStatus = {
  groupRunId: string;
  phase: 'WAITING' | 'RUNNING' | 'FINISHED' | 'FORCE_FINISHED';
  guidePaceSecPerKm: number | null;
  standing: {
    rank: number;
    aheadCount: number | null;
    behindCount: number | null;
    gapToAheadM: number | null;
    gapToBehindM: number | null;
  } | null;
  stale: boolean;
  leaderToLastGapM: number | null;
  updatedAt: string | null;
  // 지금 G10이 순위를 낸 참가자 수. 같은 거리(동순위)는 앞·뒤 인원에 들지 않아 그 합으로 총인원을 알 수 없다.
  rankedCount: number | null;
};

// P07 REQUEST 응답(pace-coaching.md). 재요청이면 저장된 결과가 온다.
export type BpmApproval = {
  commandId: string;
  action: 'SET_BPM' | 'COACHING';
  expectedVersion: number;
  targetBpm: number;
  coachingId: string | null;
  result: ControlResultCode;
};

// P07 RESULT 본문. SET_BPM·COACHING 모두 실행한 워치가 보고한 값을 그대로 옮긴다.
export type BpmReport = {
  commandId: string;
  deviceId: string;
  result: 'APPLIED' | 'REJECTED' | 'IGNORED' | 'UNKNOWN';
  appliedAt: string | null;
  reasonCode: string | null;
};

// S10 연결 상태. error는 45초 동안 서버 메시지가 없거나 연결이 끊긴 상태다.
export type SessionEventsStatus = 'connecting' | 'connected' | 'error';

// S10 스냅샷. reconnected는 (재)연결 뒤 첫 스냅샷이다(미확정 코칭 재전달 기준).
export type SessionSnapshot = {
  event: string;
  session: RunningSessionView;
  reconnected: boolean;
};

// S03~S06 REQUEST 응답. 같은 요청 슬롯의 재전송이면 저장된 결과가 온다.
export type CommandApproval = {
  commandId: string;
  action: ControlAction;
  expectedVersion: number;
  result: ControlResultCode;
};

// S03~S06 RESULT 본문. 실행기기(워치)가 보고한 값을 그대로 옮긴다.
export type CommandReport = {
  commandId: string;
  deviceId: string;
  result: 'APPLIED' | 'REJECTED' | 'UNKNOWN';
  appliedAt: string | null;
  reasonCode: string | null;
  uploadComplete?: boolean;
};

// W01 등록 기기(S15P31E105-308). 연동 전에는 목업 고정값이다.
export type LinkedDevices = { watchDeviceId: string; phoneDeviceId: string };

// 워치가 보낸 세션 메시지 (watch-mobile-server-integration.md 9.3).
export type WatchSessionEvent =
  | {
      type: 'COMMAND_RESULT';
      sessionId: string;
      commandId: string;
      result: 'APPLIED' | 'REJECTED' | 'UNKNOWN';
      appliedAt: string | null;
      reasonCode: string | null;
      pendingBatchCount: number | null;
      uploadComplete: boolean | null;
    }
  | { type: 'START_REQUEST'; sessionId: string; expectedVersion: number }
  | {
      type: 'COMMAND_REQUEST';
      sessionId: string;
      action: 'PAUSE' | 'RESUME' | 'END' | 'CANCEL';
      expectedVersion: number;
    }
  // 워치 BPM +/- (P07 SET_BPM 중계 요청, S15P31E105-257).
  | {
      type: 'COMMAND_REQUEST';
      sessionId: string;
      action: 'SET_BPM';
      expectedVersion: number;
      targetBpm: number;
    }
  | {
      type: 'COACHING_RESULT';
      sessionId: string;
      commandId: string;
      coachingId: string | null;
      result: 'APPLIED' | 'IGNORED' | 'UNKNOWN';
      appliedAt: string | null;
      reasonCode: string | null;
    }
  // 워치의 상태 조회. SERVER면 폰이 S02로 답한다(clientSendAt은 그대로 돌려준다).
  | {
      type: 'STATE_QUERY';
      sessionId: string;
      scope: 'WATCH' | 'SERVER';
      clientSendAt: string | null;
    }
  // 워치 측정 batch(S15P31E105-311). body는 워치가 해시한 W07 본문 원문이며 그대로 업로드한다(값을 로그에 남기지 않는다).
  | {
      type: 'BATCH_DATA';
      sessionId: string;
      batchId: string;
      deviceId: string;
      itemCount: number;
      body: string;
    };

// 폰 GPS 한 점. time은 측정 시각(epoch ms), 좌표는 WGS84.
export type PhoneFix = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  altitudeM: number | null;
  time: number;
};

export type PhoneLocation = {
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
  subscribe: (listener: (fix: PhoneFix) => void) => () => void;
  // 위치 권한을 묻는다. 거절해도 인계는 이어가며 경로만 남지 않는다.
  requestPermission: () => Promise<boolean>;
  // 3.1 기준 위치의 현재 위치 한 번(S15P31E105-494). 권한을 묻고, 실패는 LOCATION_* DataError로 거절한다.
  // 러닝 중 start/subscribe와 별개의 리스너를 쓴다.
  current: () => Promise<PhoneFix>;
};

// W07 서버 저장 ACK (devices-health.md W07 Response).
export type SyncBatchAck = {
  status: string;
  batchId: string;
  acceptedCount: number;
};

// 7.5 검색 (CMT13, docs/design/api/community.md). 전체 asks for both kinds, 러너 · 크루 for one.
export type SearchType = 'ALL' | 'RUNNER' | 'CREW';

export type SearchRequest = {
  query: string;
  type: SearchType;
  // The cursor of the previous page; left out for the first one.
  cursor?: string | null;
};

// Up to 20 of each kind per page. A kind not asked for, or used up, is an empty list.
// cursor is null when nothing more is left.
export type SearchPage = {
  runners: { userId: string; nickname: string }[];
  crews: { crewId: string; name: string }[];
  cursor: string | null;
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
    // U03 로그아웃: revokes the login the refresh token belongs to (204). Needs no access token.
    logout: (refreshToken: string) => Promise<void>;
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
    // 8.2 사진 바꾸기: F01 upload, then U05 profileImageId. Resolves to the new photo address.
    changePhoto: (photo: PhotoFile) => Promise<string | null>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (change: Partial<AppSettings>) => Promise<AppSettings>;
  };
  // 8.1 건강정보 수집 (W04·W05): the server's HEALTH_DATA consent, true when given.
  // setHealth resolves to the value the server applied.
  consents: {
    getHealth: () => Promise<boolean>;
    setHealth: (granted: boolean) => Promise<boolean>;
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
    // S09: deletes my run and, on the server in the same call, my posts that share it.
    remove: (recordId: string) => Promise<void>;
    // 2.0 경쟁 모드 '이 코스의 내 기록'(H01 courseId): my completed runs on this course, newest first (S15P31E105-422).
    getCourseRuns: (courseId: string) => Promise<RunRecordSummary[]>;
  };
  courses: {
    getSaved: () => Promise<SavedCourse[]>;
    // 2.0's plan for the course picked last with choose(); a default course until then.
    getTodayPlan: () => Promise<CoursePlan>;
    getPreferences: () => Promise<RecommendationPreferences>;
    savePreferences: (
      value: RecommendationPreferences,
    ) => Promise<RecommendationPreferences>;
    recommend: (search: CourseSearch) => Promise<CourseRecommendations>;
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
    // M08: 크루장은 승인된 다른 멤버에게 이양한 뒤 탈퇴한다.
    leave: (crewId: string, successorUserId?: string) => Promise<void>;
    // M11: 크루장만 인원 수와 관계없이 해산할 수 있다.
    dissolve: (crewId: string) => Promise<void>;
    // M09: 크루장만 다른 일반 멤버를 내보낼 수 있다.
    removeMember: (crewId: string, userId: string) => Promise<void>;
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
    // G13 cancelMessage: the host's note, sent once as the cancel notification body (not stored).
    cancel: (
      groupRunId: string,
      reason: GroupRunCancelReason,
      message?: string | null,
    ) => Promise<void>;
    searchPlaces: (
      query: string,
      reference?: [number, number] | null,
    ) => Promise<MeetingPlace[]>;
    getWaitingRoom: (groupRunId: string) => Promise<WaitingRoom>;
    setReady: (groupRunId: string, ready: boolean) => Promise<WaitingRoom>;
    // G09는 명령 승인만 수행한다. 실제 기기 실행·결과 보고는 폰·워치 연동에서 처리한다.
    start: (groupRunId: string) => Promise<void>;
    // 서버 개인 세션의 실제 startedAt이 확인된 경우에만 호출한다.
    watchStart: (
      groupRunId: string,
      onStart: (startedAt: string) => void,
      onError?: (error: unknown) => void,
      onParticipants?: (
        participants: GroupRunParticipant[],
        recommendedPaceSecPerKm?: number | null,
        comfortRange?: WaitingRoom['comfortRange'],
        counts?: { participantCount: number; readyCount: number },
      ) => void,
    ) => () => void;
    // G10을 주기적으로 조회한다. 구독 해제 후 도착한 응답은 전달하지 않는다.
    watchLive: (
      groupRunId: string,
      onUpdate: (live: GroupRunLive) => void,
      onError?: (error: unknown) => void,
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
    // CMT08 · CMT09 on one of my comments; updateComment answers with the saved text.
    updateComment: (commentId: string, body: string) => Promise<string>;
    removeComment: (commentId: string) => Promise<void>;
  };
  // 7.4 · 7.4b (U21–U23). userId null is me.
  runners: {
    getProfile: (userId: string | null) => Promise<RunnerProfile>;
    setFollowing: (
      userId: string,
      following: boolean,
    ) => Promise<RunnerProfile>;
    // 7.4b 팔로우 요청 (U24 · U25, S15P31E105-525). cursor null reads the first page.
    listFollowRequests: (cursor: string | null) => Promise<FollowRequestPage>;
    decideFollowRequest: (
      request: FollowRequest,
      decision: FollowDecision,
    ) => Promise<void>;
    // 7.4c (U26 · U27). A private account I may not see answers ACCOUNT_ACCESS_DENIED.
    listFollows: (
      userId: string,
      kind: FollowListKind,
      cursor: string | null,
    ) => Promise<FollowListPage>;
  };
  // 7.5 검색 (CMT13): runners and crews whose name holds the query.
  search: {
    find: (request: SearchRequest) => Promise<SearchPage>;
  };
  notifications: {
    list: () => Promise<NotificationList>;
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
    // Saves the finished run (4.5 기록 저장 중 → 기록 저장됨 · 동기화 완료). With the server the run is already stored
    // when its session completes, so this confirms the record (H02) instead; a failure there is SAVE_UNCONFIRMED.
    saveRecord: (record: RunRecordDraft) => Promise<SavedRunRecord>;
  };
  music: {
    // Optional native player updates; older repositories continue using getState.
    subscribe?: (listener: (state: MusicState) => void) => () => void;
    canStartWithoutTrack?: boolean;
    // Spotify's Web API sign-in for 내 재생 목록 · 최근 들은 곡 (and with their scopes), apart from the playback
    // link: App Remote controls playback without it.
    connectLibrary?: () => Promise<void>;
    getState: () => Promise<MusicState>;
    // null clears the pick (2.8: the picked row pressed again), back to 2.7a 미연결.
    selectSource: (source: MusicSource | null) => Promise<MusicState>;
    // Opens login, permission or install for a service (2.8 오른쪽 버튼).
    resolveService: (service: MusicService) => Promise<MusicState>;
    reconnect: () => Promise<MusicState>;
    // 2.7 이전 · 재생/일시정지 · 다음. Each resolves to the state read back after the command (MUS-004).
    play: () => Promise<MusicState>;
    pause: () => Promise<MusicState>;
    next: () => Promise<MusicState>;
    previous: () => Promise<MusicState>;
    // 2.7 내 재생 목록 (담당자 요청): the picked service's playlists, [] when it has none to offer (멜론: its 음악서랍
    // lists — 좋아요한 곡, 최근들은 곡 and the user's own playlists). Playing one starts it from the top on the music app.
    getPlaylists: () => Promise<Playlist[]>;
    playPlaylist: (playlistId: string) => Promise<MusicState>;
    // 2.7 최근 들은 곡 (담당자 요청): songs heard lately on the picked service, newest first, each once; [] where
    // the service has none to offer (멜론 lists no song-by-song history). Playing one starts that song.
    getRecentTracks: () => Promise<Track[]>;
    playTrack: (trackId: string) => Promise<MusicState>;
  };
  // The current time; mock data pins it to the prototype's 12:45 so relative times and day/night match.
  clock: {
    now: () => Date;
  };
  // S01·S02·S03~S07·S08(REPORT_PREPARED·ABORT_UNCONFIRMED_START). 실패는 DataError(code)로 던진다.
  session: {
    create: (request: {
      controlDeviceId: string;
      relayDeviceId: string;
      goal: SessionGoalDraft;
    }) => Promise<RunningSessionView>;
    get: (sessionId: string) => Promise<RunningSessionView>;
    // 워치의 준비 결과를 그대로 전달한다(ready=false 포함, sessions.md S08 REPORT_PREPARED).
    reportPrepared: (
      sessionId: string,
      request: {
        deviceId: string;
        expectedVersion: number;
        ready: boolean;
        reasonCode: string | null;
      },
    ) => Promise<void>;
    requestControl: (
      sessionId: string,
      action: ControlAction,
      request: { deviceId: string; expectedVersion: number },
    ) => Promise<CommandApproval>;
    reportResult: (
      sessionId: string,
      action: ControlAction,
      report: CommandReport,
    ) => Promise<{
      commandId: string;
      result: ControlResultCode;
      session: RunningSessionView;
    }>;
    cancel: (
      sessionId: string,
    ) => Promise<{ id: string; status: SessionStatus }>;
    abortUnconfirmedStart: (
      sessionId: string,
      request: { deviceId: string; expectedVersion: number },
    ) => Promise<RunningSessionView>;
    // S08 TAKE_OVER_PHONE(S15P31E105-464). deviceId는 세션의 중계 폰(relayDeviceId). receivedWatchBatchesUploaded=true는
    // 저장소가 넣는다(폰이 받은 워치 batch 전체의 COMMITTED를 확인한 뒤에만 호출한다). 서버 연동 저장소만 구현한다.
    takeOverPhone?: (
      sessionId: string,
      request: { deviceId: string; expectedVersion: number },
    ) => Promise<RunningSessionView>;
    // P07 SET_BPM REQUEST·SET_BPM/COACHING RESULT와 S10 구독(S15P31E105-257). 서버 연동 저장소만 구현한다.
    requestBpm?: (
      sessionId: string,
      request: { deviceId: string; expectedVersion: number; targetBpm: number },
    ) => Promise<BpmApproval>;
    reportBpmResult?: (
      sessionId: string,
      report: BpmReport,
    ) => Promise<{
      commandId: string;
      result: ControlResultCode;
      session: RunningSessionView;
    }>;
    subscribeEvents?: (
      sessionId: string,
      handlers: {
        onSnapshot: (snapshot: SessionSnapshot) => void;
        onStatus?: (status: SessionEventsStatus) => void;
      },
    ) => () => void;
    // W07. 워치 batch 본문 원문을 바꾸지 않고 보낸다(S15P31E105-311).
    uploadBatch: (body: string) => Promise<SyncBatchAck>;
  };
  // 폰 인계 뒤 폰 GPS(S15P31E105-464). start는 권한·GPS가 없으면 false로 답하고 기록은 시간만 이어간다.
  phoneLocation?: PhoneLocation;
  // 워치 세션 메시지 중계 (watch-mobile-server-integration.md 9장).
  watchSession: {
    getLinkedDevices: () => Promise<LinkedDevices | null>;
    // SESSION_PREPARE를 보내고 같은 세션의 SESSION_PREPARED를 기다린다. deviceId는 워치 자신의 기기 ID(batch 생산 기기).
    prepare: (
      sessionId: string,
      request: {
        stateVersion: number;
        deviceId: string;
        goal: SessionGoalDraft;
        // 그룹런 참가 세션이면 그 그룹런 ID. 워치가 그룹 화면을 쓴다(S15P31E105-420).
        groupRunId?: string | null;
      },
    ) => Promise<{
      stateVersion: number;
      ready: boolean;
      reasonCode: string | null;
    }>;
    // 서버가 승인한 명령을 전달만 한다. START는 START_AUTHORIZED, 그 외는 COMMAND_REQUEST(APPLY).
    sendCommand: (
      sessionId: string,
      approval: CommandApproval,
    ) => Promise<void>;
    sendReceived: (
      sessionId: string,
      receipt: {
        commandId: string;
        persisted: boolean;
        stateVersion: number | null;
      },
    ) => Promise<void>;
    // G12 그룹 종료로 서버가 승인한 개인 END를 SERVER_END로 전달만 한다(9.3, S15P31E105-420).
    sendServerEnd?: (
      sessionId: string,
      end: { commandId: string; expectedVersion: number; endedAt: string; reason: string },
    ) => Promise<void>;
    // G10 현황을 GROUP_STATUS로 전달만 한다(9.3, S15P31E105-420).
    sendGroupStatus?: (sessionId: string, status: WatchGroupStatus) => Promise<void>;
    // SET_BPM 승인 명령을 COMMAND_REQUEST(APPLY)로 전달만 한다.
    sendBpmCommand: (sessionId: string, approval: BpmApproval) => Promise<void>;
    // COACHING_GUIDE. 같은 미확정 명령의 결과 확인용 재전달에도 쓴다.
    sendCoachingGuide: (
      sessionId: string,
      guide: CoachingGuide,
    ) => Promise<void>;
    // STATE_RESULT(scope=SERVER). clientSendAt은 워치 STATE_QUERY의 값, 서버 스냅샷 전달이면 null.
    sendServerState: (
      sessionId: string,
      session: RunningSessionView,
      clientSendAt?: string | null,
    ) => Promise<void>;
    // ERROR: 워치 요청을 처리하지 못한 이유(9.3). 예: 워치 CANCEL에 서버가 COMMAND_PENDING.
    sendError: (
      sessionId: string,
      error: { code: string; retryable: boolean; failedType: string },
    ) => Promise<void>;
    // W07 COMMITTED를 폰에 기록하고 워치에 BATCH_COMMITTED를 보낸다. 기록과 맞지 않으면 실패한다.
    commitBatch: (batchId: string, acceptedCount: number) => Promise<void>;
    // 폰 인계(S15P31E105-464) 1단계: 이 세션의 새 워치 batch 수신·수신 확인을 멈추고, 이미 저장했지만 W07 저장 확인이
    // 없는 batch를 돌려준다. 인계를 요청하지 않았거나 WATCH 유지가 확인됐거나 운동이 끝났을 때만 unblockBatches로 연다.
    blockBatches?: (
      sessionId: string,
    ) => Promise<Extract<WatchSessionEvent, { type: 'BATCH_DATA' }>[]>;
    unblockBatches?: (sessionId: string) => Promise<void>;
    // 워치와의 연결(MessageClient 노드) 여부. 워치 앱 상태까지 뜻하지는 않는다.
    isWatchConnected?: () => Promise<boolean>;
    // W07이 다시 보내도 소용없는 이유로 거절한 batch. 워치에 ERROR(retryable=false)를 보낸다.
    failBatch: (batchId: string, code: string) => Promise<void>;
    // 등록하면 수신함에 남은 이벤트부터 전달한다.
    subscribe: (listener: (event: WatchSessionEvent) => void) => () => void;
    // 러닝 중 포그라운드 서비스. 켜는 동안 활성 세션 ID를 기억해 앱 재실행 때 다시 붙는다.
    // location은 폰 인계 뒤 폰 GPS를 화면이 꺼져도 받도록 위치 유형을 함께 켠다(S15P31E105-464).
    setRunActive: (
      active: boolean,
      sessionId?: string,
      options?: { location: boolean },
    ) => Promise<void>;
    getActiveSessionId: () => Promise<string | null>;
    // 결과 대기 시간. 없으면 30초/120초.
    timing?: { resultWaitMs: number; endResultWaitMs: number };
  };
  watch: {
    getConnection: () => Promise<WatchConnection>;
    reconnect: () => Promise<WatchConnection>;
    // 8.3 연결 해제 (실행 취소 reconnects).
    disconnect: () => Promise<WatchConnection>;
  };
};
