import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { dark, dayNight, themed } from '../run';
import { GroupRunCancelScreen } from './GroupRunCancelScreen';
import { GroupRunCreateScreen } from './GroupRunCreateScreen';
import { GroupRunDetailScreen } from './GroupRunDetailScreen';
import { GroupRunPauseScreen } from './GroupRunPauseScreen';
import {
  GroupRunPositionScreen,
  GroupRunProgressScreen,
} from './GroupRunProgressScreen';
import { GroupRunResultScreen } from './GroupRunResultScreen';
import { GroupScreen } from './GroupScreen';
import { MeetingPlaceScreen } from './MeetingPlaceScreen';
import { WaitingRoomScreen } from './WaitingRoomScreen';

export { GroupRunDraftProvider } from './parts';

// 6.x 그룹런. Like 4.2, 6.6 is light by day and dark after sunset; 6.6c and 6.7 are always dark (as 4.3·4.5).
// The rest follow the screen mode.
export const groupScreens: Partial<Record<RouteName, React.ComponentType>> = {
  MyCrews: GroupScreen,
  GroupRunDetail: GroupRunDetailScreen,
  GroupRunCreate: GroupRunCreateScreen,
  MeetingPlace: MeetingPlaceScreen,
  WaitingRoom: WaitingRoomScreen,
  GroupRunProgress: themed(
    GroupRunProgressScreen,
    'GroupRunProgressScreen',
    dayNight,
  ),
  GroupRunPosition: themed(
    GroupRunPositionScreen,
    'GroupRunPositionScreen',
    dayNight,
  ),
  GroupRunPause: themed(GroupRunPauseScreen, 'GroupRunPauseScreen', dark),
  GroupRunResult: themed(GroupRunResultScreen, 'GroupRunResultScreen', dark),
  GroupRunCancel: GroupRunCancelScreen,
};
