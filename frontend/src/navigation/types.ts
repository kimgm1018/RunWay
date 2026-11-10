import type { NavigatorScreenParams } from '@react-navigation/native';
import type { FollowListKind } from '../data/types';
import type {
  AuthRouteName,
  GroupTabRouteName,
  HomeTabRouteName,
  MainRouteName,
  RunTabRouteName,
} from './routes';

export type RunStackParamList = Record<RunTabRouteName, undefined>;
// The home tab's stack: 2.1 (opening one of my runs on 러닝 분석, S15P31E105-594), then 5.1 (on a day, YYYY-MM-DD)
// and 5.3.
export type HomeStackParamList = {
  Home: { recordId: string } | undefined;
} & Record<Exclude<HomeTabRouteName, 'Records'>, undefined> & {
    Records: { day: string } | undefined;
  };
// The group tab is one pager screen; screen picks the page to show (GroupTabScreen). intro is set while its
// first screen (GroupIntro) shows, so the tab bar turns see-through over it (S15P31E105-563).
export type GroupTabParams = { screen?: GroupTabRouteName; intro?: boolean };

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
    | 'FollowList'
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
  // 7.4c opens on one of the runner's two lists.
  FollowList: { userId: string; kind: FollowListKind; nickname: string };
  // 6.x open one group run; 6.8 makes one in a crew. Without an id they fall back to the next run.
  GroupRunDetail: { groupRunId: string } | undefined;
  WaitingRoom: { groupRunId: string } | undefined;
  // groupRunId opens 6.8 to edit that run (G04).
  GroupRunCreate: { crewId?: string; groupRunId?: string } | undefined;
  GroupRunCancel: { groupRunId: string } | undefined;
  GroupRunResult: { groupRunId: string } | undefined;
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
