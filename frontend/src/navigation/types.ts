import type { NavigatorScreenParams } from '@react-navigation/native';
import type {
  AuthRouteName,
  GroupTabRouteName,
  HomeTabRouteName,
  MainRouteName,
  RunTabRouteName,
} from './routes';

export type RunStackParamList = Record<RunTabRouteName, undefined>;
// The home tab's stack: 2.1, then 5.1 (on a day, YYYY-MM-DD) and 5.3.
export type HomeStackParamList = {
  Home: undefined;
} & Record<Exclude<HomeTabRouteName, 'Records'>, undefined> & {
    Records: { day: string } | undefined;
  };
// The group tab is one pager screen; screen picks the page to show (GroupTabScreen).
export type GroupTabParams = { screen?: GroupTabRouteName };

export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList> | undefined;
  RunTab: NavigatorScreenParams<RunStackParamList> | undefined;
  GroupTab: GroupTabParams | undefined;
  CommunityTab: undefined;
  // 7.4b 내 프로필 as the fifth tab (S15P31E105-428).
  ProfileTab: undefined;
};

// Screens that open one item take its id; the rest take no params.
export type RootStackParamList = Record<
  Exclude<
    AuthRouteName | MainRouteName,
    | 'RecordDetail'
    | 'GroupRunDetail'
    | 'WaitingRoom'
    | 'GroupRunCreate'
    | 'GroupRunCancel'
    | 'GroupRunResult'
    | 'CrewDetail'
    | 'CrewJoinRequests'
    | 'PostDetail'
    | 'PostWrite'
    | 'PostEdit'
    | 'RunnerProfile'
  >,
  undefined
> & {
  // 6.2 shows one crew; without an id it shows my first crew. 6.2a takes the crew I lead.
  CrewDetail: { crewId: string } | undefined;
  CrewJoinRequests: { crewId: string } | undefined;
  // 7.x open one post; 7.3 shares one of my runs (my newest without an id); 7.4 shows one runner.
  PostDetail: { postId: string } | undefined;
  PostWrite: { recordId: string } | undefined;
  PostEdit: { postId: string } | undefined;
  RunnerProfile: { userId: string } | undefined;
  // 6.x open one group run; 6.8 makes one in a crew. Without an id they fall back to the next run.
  GroupRunDetail: { groupRunId: string } | undefined;
  WaitingRoom: { groupRunId: string } | undefined;
  // groupRunId opens 6.8 to edit that run (G04).
  GroupRunCreate: { crewId?: string; groupRunId?: string } | undefined;
  GroupRunCancel: { groupRunId: string } | undefined;
  GroupRunResult: { groupRunId: string } | undefined;
  // 5.2 shows one run; without an id it shows the newest run.
  RecordDetail: { recordId: string } | undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  HealthPoc: undefined;
  MapPoc: undefined;
  ComponentGallery: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
