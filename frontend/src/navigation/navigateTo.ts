import type { NavigationProp } from '@react-navigation/native';
import {
  routes,
  type AuthRouteName,
  type GroupTabRouteName,
  type HomeTabRouteName,
  type MainRouteName,
  type RouteName,
  type RunTabRouteName,
} from './routes';
import type { RootStackParamList } from './types';

type Navigate = Pick<NavigationProp<RootStackParamList>, 'navigate'>;

// One of my runs on 2.1 러닝 분석, on its day (S15P31E105-594: 기록 상세 is gone).
export function openRecord(navigation: Navigate, recordId: string) {
  navigation.navigate(
    'MainTabs',
    { screen: 'HomeTab', params: { screen: 'Home', params: { recordId } } },
    { pop: true },
  );
}

// 러닝 시작하기 does what the 러닝 tab does (S15P31E105-683): the run tab's map as it was left (2.0F at first, or
// 2.0 once a course is picked), so it never stacks a second map and 뒤로 still leaves for 홈.
export function openRunTab(navigation: Navigate) {
  navigation.navigate('MainTabs', { screen: 'RunTab' }, { pop: true });
}

// 6.7 그룹런 결과 for a group run record (H01 group.groupRunId). Without the link the run opens as my own record,
// never a mock result (S15P31E105-635). Returns false when the caller should open the record itself.
export function openGroupRunResult(
  navigation: Navigate,
  group: { groupRunId: string } | null,
) {
  if (!group) {
    return false;
  }
  navigation.navigate('GroupRunResult', { groupRunId: group.groupRunId });
  return true;
}

// Tab screens live inside MainTabs, so a link to one goes through the tab instead of the root stack.
// pop: React Navigation 7 otherwise leaves the screens stacked over the tabs (4.5 완료 → 홈, 6.4e 내 크루로).
export function navigateTo(navigation: Navigate, name: RouteName) {
  const toTabs = { pop: true };
  switch (routes[name].tab) {
    case 'HomeTab':
      navigation.navigate(
        'MainTabs',
        name === 'Home'
          ? { screen: 'HomeTab', params: { screen: 'Home' } }
          : {
              screen: 'HomeTab',
              params: { screen: name as HomeTabRouteName },
            },
        toTabs,
      );
      return;
    case 'CommunityTab':
      navigation.navigate('MainTabs', { screen: 'CommunityTab' }, toTabs);
      return;
    case 'RunTab':
      navigation.navigate(
        'MainTabs',
        { screen: 'RunTab', params: { screen: name as RunTabRouteName } },
        toTabs,
      );
      return;
    case 'GroupTab':
      navigation.navigate(
        'MainTabs',
        { screen: 'GroupTab', params: { screen: name as GroupTabRouteName } },
        toTabs,
      );
      return;
    default:
      // Every root route takes no params, which the per-name overloads cannot express for a union.
      (navigation.navigate as (screen: AuthRouteName | MainRouteName) => void)(
        name as AuthRouteName | MainRouteName,
      );
  }
}
