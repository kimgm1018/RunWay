import type { NavigatorScreenParams } from '@react-navigation/native';
import type {
  AuthRouteName,
  GroupTabRouteName,
  MainRouteName,
  RunTabRouteName,
} from './routes';

export type RunStackParamList = Record<RunTabRouteName, undefined>;
export type GroupStackParamList = Record<GroupTabRouteName, undefined>;

export type MainTabParamList = {
  HomeTab: undefined;
  RunTab: NavigatorScreenParams<RunStackParamList> | undefined;
  GroupTab: NavigatorScreenParams<GroupStackParamList> | undefined;
  CommunityTab: undefined;
};

// Screens that open one item take its id; the rest take no params.
export type RootStackParamList = Record<
  Exclude<
    AuthRouteName | MainRouteName,
    | 'Records'
    | 'RecordDetail'
    | 'GroupRunDetail'
    | 'WaitingRoom'
    | 'GroupRunCreate'
    | 'GroupRunCancel'
    | 'GroupRunResult'
  >,
  undefined
> & {
  // 6.x open one group run; 6.8 makes one in a crew. Without an id they fall back to the next run.
  GroupRunDetail: { groupRunId: string } | undefined;
  WaitingRoom: { groupRunId: string } | undefined;
  GroupRunCreate: { crewId: string } | undefined;
  GroupRunCancel: { groupRunId: string } | undefined;
  GroupRunResult: { groupRunId: string } | undefined;
  // 5.1 opens on a month (YYYY-MM), this month by default.
  Records: { month: string } | undefined;
  // 5.2 shows one run; without an id it shows the newest run.
  RecordDetail: { recordId: string } | undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  HealthPoc: undefined;
  ComponentGallery: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
