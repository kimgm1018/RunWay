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

// One of my runs in 2.1 기록 상세 (S15P31E105-564: 5.2 is part of 2.1).
export function openRecord(navigation: Navigate, recordId: string) {
  navigation.navigate(
    'MainTabs',
    { screen: 'HomeTab', params: { screen: 'Home', params: { recordId } } },
    { pop: true },
  );
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
