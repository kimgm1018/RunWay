// Screen flow from RUNWAY 프로토타입 v15. Each screen lists the screens it links to; state variants
// (1.2r, 2.1La, 4.5F, 6.2f …) are not routes but states of the screen they belong to.
export type SessionAction = 'signIn' | 'signOut';

export type TabName =
  | 'HomeTab'
  | 'RunTab'
  | 'GroupTab'
  | 'CommunityTab'
  | 'ProfileTab';

type RouteInfo = {
  code: string;
  title: string;
  task: string;
  tab?: TabName;
  links: readonly (RouteName | SessionAction)[];
};

export const authRoutes = [
  'Start',
  'Login',
  'SignUp',
  'Consent',
  'ProfileBasic',
  'ProfileBirthday',
  'ProfileRunning',
  'ProfilePace',
  'WatchChoice',
  'WatchConnect',
  'PasswordPhone',
] as const;

export const runTabRoutes = [
  'RunMode',
  'FreeRun',
  'CourseStart',
  'CourseRun',
] as const;
// The 러닝 tab opens on the 2.0F map (S15P31E105-683). 2.0M 러닝 방식 선택 stays registered, but nothing leads to it:
// a course is picked from the map's 코스 설정 chip instead.
export const runTabInitialRoute =
  'FreeRun' satisfies (typeof runTabRoutes)[number];
// 5.1 · 5.3 sit in the home tab, under its tab bar (runway-records, S15P31E105-465).
export const homeTabRoutes = ['Records', 'Analysis'] as const;
export const groupTabRoutes = ['MyCrews', 'CrewRecruit'] as const;

// Screens pushed over the tabs. The prototype hides the tab bar on all of them.
export const mainRoutes = [
  'Notifications',
  'MusicCard',
  'MusicSource',
  'TodayRun',
  'SavedCourses',
  'RecommendedCourses',
  'RunProgress',
  'RunResult',
  'GroupRunDetail',
  'WaitingRoom',
  'GroupRunProgress',
  'GroupRunPosition',
  'GroupRunResult',
  'GroupRunCreate',
  'GroupRunCancel',
  'MeetingPlace',
  'CrewDetail',
  'CrewJoinRequests',
  'CrewCreate',
  'PostDetail',
  'PostWrite',
  'PostEdit',
  'RunnerProfile',
  'CommunitySearch',
  'MyProfile',
  'FollowList',
  'ProfileEdit',
  'RunningBaselineEdit',
  'Settings',
  'LocationSetting',
  'DataLicense',
  'WatchConnect',
  'Withdraw',
  'WithdrawPassword',
  'WithdrawDone',
] as const;

export type AuthRouteName = (typeof authRoutes)[number];
export type RunTabRouteName = (typeof runTabRoutes)[number];
export type HomeTabRouteName = (typeof homeTabRoutes)[number];
export type GroupTabRouteName = (typeof groupTabRoutes)[number];
export type MainRouteName = (typeof mainRoutes)[number];
export type RouteName =
  | AuthRouteName
  | MainRouteName
  | RunTabRouteName
  | HomeTabRouteName
  | GroupTabRouteName
  | 'Home'
  | 'Community';

const ONBOARDING = 'S15P31E105-145';
const HOME = 'S15P31E105-146';
const COURSE = 'S15P31E105-147';
const RUN = 'S15P31E105-148';
const RECORD = 'S15P31E105-149';
const GROUP_RUN = 'S15P31E105-150';
const CREW = 'S15P31E105-151';
const COMMUNITY = 'S15P31E105-152';
const SETTINGS = 'S15P31E105-153';

export const routes: Record<RouteName, RouteInfo> = {
  Start: {
    code: '1.1',
    title: '시작',
    task: ONBOARDING,
    links: ['Login', 'SignUp'],
  },
  Login: {
    code: '1.2',
    title: '로그인',
    task: ONBOARDING,
    // 비밀번호를 잊으셨나요? → 1.2q 전화번호 입력으로 바로 간다(1.2p 안내 화면 제거, S15P31E105-627).
    links: ['PasswordPhone', 'SignUp', 'signIn'],
  },
  SignUp: {
    code: '1.3',
    title: '회원가입',
    task: ONBOARDING,
    links: ['Consent'],
  },
  Consent: {
    code: '1.4',
    title: '개인정보·데이터 이용 동의',
    task: ONBOARDING,
    links: ['ProfileBasic'],
  },
  ProfileBasic: {
    code: '1.5',
    title: '기본 프로필',
    task: ONBOARDING,
    links: ['ProfileBirthday'],
  },
  ProfileBirthday: {
    code: '1.5b',
    title: '생년월일',
    task: ONBOARDING,
    links: ['ProfileRunning'],
  },
  ProfileRunning: {
    code: '1.6',
    title: '러닝 프로필',
    task: ONBOARDING,
    links: ['ProfilePace'],
  },
  ProfilePace: {
    code: '1.6b',
    title: '평소 페이스',
    task: ONBOARDING,
    links: ['WatchChoice'],
  },
  WatchChoice: {
    code: '1.6w',
    title: '워치 사용 여부',
    task: ONBOARDING,
    links: ['WatchConnect', 'signIn'],
  },
  WatchConnect: {
    code: '1.7',
    title: '워치 연결',
    task: ONBOARDING,
    links: ['signIn'],
  },
  PasswordPhone: {
    code: '1.2q',
    title: '전화번호로 비밀번호 찾기',
    task: ONBOARDING,
    links: ['Login', 'SignUp'],
  },

  Home: {
    code: '2.1',
    title: '홈',
    task: HOME,
    tab: 'HomeTab',
    // S15P31E105-564: 준비도 · 과거 러닝 기록 · 기록 상세 · 러닝 분석 are on 2.1 itself (5.2 is gone, 담당자 결정);
    // 기록 공유 opens 7.3, a group run 6.7, and a readiness state without a score its fix.
    links: [
      'Notifications',
      'Settings',
      'WatchConnect',
      'PostWrite',
      'GroupRunResult',
    ],
  },
  Notifications: {
    code: '2.9',
    title: '알림',
    task: HOME,
    links: ['GroupRunDetail', 'CrewDetail', 'PostDetail', 'RunnerProfile'],
  },
  RunMode: {
    code: '2.0M',
    title: '러닝 방식 선택',
    task: HOME,
    tab: 'RunTab',
    links: ['FreeRun', 'CourseStart'],
  },
  FreeRun: {
    code: '2.0F',
    title: '자유 러닝',
    task: HOME,
    tab: 'RunTab',
    links: ['CourseStart', 'MusicCard', 'RunProgress'],
  },
  // 코스 러닝 opens on the map like 2.0F, with 코스 설정 in place of 목표 설정 (담당자 요청).
  CourseStart: {
    code: '2.0C',
    title: '코스 러닝 시작',
    task: HOME,
    tab: 'RunTab',
    links: ['TodayRun', 'FreeRun', 'MusicCard', 'SavedCourses'],
  },
  CourseRun: {
    code: '2.0',
    title: '코스 러닝',
    task: HOME,
    tab: 'RunTab',
    links: [
      'RunMode',
      'TodayRun',
      'RecommendedCourses',
      'MusicCard',
      'Settings',
      'RunProgress',
    ],
  },
  MusicCard: {
    code: '2.7',
    title: '음악 카드',
    task: HOME,
    links: ['MusicSource'],
  },
  MusicSource: { code: '2.8', title: '음원 선택', task: HOME, links: [] },

  TodayRun: {
    code: '3.1',
    title: '오늘의 러닝',
    task: COURSE,
    links: ['RecommendedCourses', 'SavedCourses', 'CourseRun'],
  },
  SavedCourses: {
    code: '3.1c',
    title: '저장한 코스',
    task: COURSE,
    links: ['CourseRun', 'TodayRun'],
  },
  RecommendedCourses: {
    code: '3.1b',
    title: '추천 코스',
    task: COURSE,
    links: ['CourseRun', 'TodayRun'],
  },

  RunProgress: {
    code: '4.2',
    title: '러닝 진행',
    task: RUN,
    // 4.3 일시정지 is part of 4.2 now (S15P31E105-517): the foot turns into 재개 · 종료.
    links: ['RunResult'],
  },
  RunResult: {
    code: '4.5',
    title: '러닝 결과',
    task: RUN,
    // 기록 보기 opens the run on 2.1 러닝 분석 (S15P31E105-594: 기록 상세 is gone).
    links: ['Home', 'PostWrite'],
  },

  Analysis: {
    code: '5.3',
    title: '러닝 분석',
    task: RECORD,
    tab: 'HomeTab',
    links: ['Records'],
  },
  Records: {
    code: '5.1',
    title: '전체 기록',
    task: RECORD,
    tab: 'HomeTab',
    links: ['Home', 'GroupRunResult'],
  },

  MyCrews: {
    code: '6.0',
    title: '그룹 · 내 크루',
    task: GROUP_RUN,
    tab: 'GroupTab',
    links: [
      'CrewRecruit',
      'WaitingRoom',
      'GroupRunDetail',
      'GroupRunCreate',
      'CrewDetail',
    ],
  },
  GroupRunDetail: {
    code: '6.4',
    title: '그룹런 상세',
    task: GROUP_RUN,
    links: ['WaitingRoom', 'GroupRunCancel'],
  },
  WaitingRoom: {
    code: '6.5',
    title: '그룹런 대기방',
    task: GROUP_RUN,
    links: ['GroupRunDetail', 'MusicCard', 'GroupRunProgress'],
  },
  GroupRunProgress: {
    code: '6.6',
    title: '그룹런 진행',
    task: GROUP_RUN,
    // 6.6c 일시정지 is part of 6.6 now (S15P31E105-517).
    links: ['GroupRunPosition', 'GroupRunResult'],
  },
  GroupRunPosition: {
    code: '6.6r',
    title: '그룹런 위치·간격',
    task: GROUP_RUN,
    links: ['GroupRunResult'],
  },
  GroupRunResult: {
    code: '6.7',
    title: '그룹런 결과',
    task: GROUP_RUN,
    links: ['MyCrews', 'Records', 'PostWrite'],
  },
  GroupRunCreate: {
    code: '6.8',
    title: '그룹런 만들기',
    task: GROUP_RUN,
    links: ['SavedCourses', 'MeetingPlace', 'GroupRunDetail'],
  },
  GroupRunCancel: {
    code: '6.4c',
    title: '그룹런 취소',
    task: GROUP_RUN,
    links: ['GroupRunDetail', 'MyCrews'],
  },
  MeetingPlace: {
    code: '6.9',
    title: '만남 장소 선택',
    task: GROUP_RUN,
    links: ['GroupRunCreate'],
  },

  CrewRecruit: {
    code: '6.1',
    title: '크루 모집',
    task: CREW,
    tab: 'GroupTab',
    links: ['MyCrews', 'CrewDetail', 'CrewCreate'],
  },
  CrewDetail: {
    code: '6.2',
    title: '크루 상세',
    task: CREW,
    links: ['CrewJoinRequests', 'MyCrews', 'CrewRecruit'],
  },
  CrewJoinRequests: {
    code: '6.2a',
    title: '가입 신청 관리',
    task: CREW,
    links: ['CrewDetail', 'Notifications'],
  },
  CrewCreate: {
    code: '6.3',
    title: '크루 만들기',
    task: CREW,
    links: ['MyCrews', 'CrewJoinRequests'],
  },

  Community: {
    code: '7.1',
    title: '커뮤니티',
    task: COMMUNITY,
    tab: 'CommunityTab',
    links: ['PostDetail', 'RunnerProfile', 'SavedCourses', 'CommunitySearch'],
  },
  PostDetail: {
    code: '7.2',
    title: '게시물 상세',
    task: COMMUNITY,
    links: ['PostEdit', 'SavedCourses', 'Community'],
  },
  PostWrite: {
    code: '7.3',
    title: '글쓰기',
    task: COMMUNITY,
    links: ['Community', 'PostDetail'],
  },
  PostEdit: {
    code: '7.3e',
    title: '게시물 수정',
    task: COMMUNITY,
    links: ['PostDetail'],
  },
  RunnerProfile: {
    code: '7.4',
    title: '러너 프로필',
    task: COMMUNITY,
    links: ['FollowList'],
  },
  // S15P31E105-534: a runner's approved followers and followings (U26 · U27), from 7.4 · 7.4b's counts.
  FollowList: {
    code: '7.4c',
    title: '팔로워 · 팔로잉',
    task: COMMUNITY,
    links: ['RunnerProfile'],
  },
  // runway-search (S15P31E105-390): runners and crews by name (CMT13).
  CommunitySearch: {
    code: '7.5',
    title: '검색',
    task: COMMUNITY,
    links: ['RunnerProfile', 'CrewDetail'],
  },
  MyProfile: {
    code: '7.4b',
    title: '내 프로필',
    task: COMMUNITY,
    links: ['ProfileEdit', 'Settings', 'FollowList'],
  },

  ProfileEdit: {
    code: '8.2',
    title: '프로필 수정',
    task: SETTINGS,
    links: ['MyProfile', 'RunningBaselineEdit'],
  },
  // S15P31E105-551: 평소 거리·완주 시간 또는 페이스 수정 (U06·U07).
  RunningBaselineEdit: {
    code: '8.2b',
    title: '평소 러닝 정보',
    task: SETTINGS,
    links: ['ProfileEdit'],
  },
  Settings: {
    code: '8.1',
    title: '설정',
    task: SETTINGS,
    links: [
      'LocationSetting',
      'DataLicense',
      'WatchConnect',
      'Withdraw',
      'signOut',
    ],
  },
  LocationSetting: {
    code: '8.1b',
    title: '위치 기록',
    task: SETTINGS,
    links: ['Settings'],
  },
  // S15P31E105-612: OpenStreetMap's notice for the course cards' maps and the NAVER Map SDK's legal screens.
  DataLicense: {
    code: '8.1c',
    title: '데이터 라이선스',
    task: SETTINGS,
    links: ['Settings'],
  },
  Withdraw: {
    code: '8.4',
    title: '회원탈퇴 확인',
    task: SETTINGS,
    links: ['WithdrawPassword'],
  },
  WithdrawPassword: {
    code: '8.5',
    title: '비밀번호 확인',
    task: SETTINGS,
    links: ['WithdrawDone'],
  },
  WithdrawDone: {
    code: '8.6',
    title: '탈퇴 완료',
    task: SETTINGS,
    links: ['signOut'],
  },
};

export function isSessionAction(
  link: RouteName | SessionAction,
): link is SessionAction {
  return link === 'signIn' || link === 'signOut';
}
