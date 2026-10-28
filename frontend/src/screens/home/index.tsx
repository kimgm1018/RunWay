import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { HomeScreen } from './HomeScreen';
import { NotificationsScreen } from './NotificationsScreen';

// 2.1 홈 follows the screen mode: dark is 2.1, light is 2.1La.
export const homeScreens: Partial<Record<RouteName, React.ComponentType>> = {
  Home: HomeScreen,
  Notifications: NotificationsScreen,
};
