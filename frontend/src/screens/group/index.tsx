import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { dark, themed } from '../run';
import { CrewCreateScreen } from './CrewCreateScreen';
import { CrewDetailScreen } from './CrewDetailScreen';
import { CrewJoinRequestsScreen } from './CrewJoinRequestsScreen';
import { GroupRunCancelScreen } from './GroupRunCancelScreen';
import { GroupRunCreateScreen } from './GroupRunCreateScreen';
import { GroupRunDetailScreen } from './GroupRunDetailScreen';
import {
  GroupRunPositionScreen,
  GroupRunProgressScreen,
} from './GroupRunProgressScreen';
import { GroupRunResultScreen } from './GroupRunResultScreen';
import { MeetingPlaceScreen } from './MeetingPlaceScreen';
import { WaitingRoomScreen } from './WaitingRoomScreen';

export { GroupRunDraftProvider } from './parts';
export { GroupTabScreen } from './GroupTabScreen';

// 6.x 그룹런. Like 4.2, 6.6 (with 6.6c 일시정지 folded in, S15P31E105-517) is one dark frame day and night;
// 6.7 sits on the K1 background like 4.5. The rest follow the screen mode.
export const groupScreens: Partial<Record<RouteName, React.ComponentType>> = {
  CrewDetail: CrewDetailScreen,
  CrewJoinRequests: CrewJoinRequestsScreen,
  CrewCreate: CrewCreateScreen,
  GroupRunDetail: GroupRunDetailScreen,
  GroupRunCreate: GroupRunCreateScreen,
  MeetingPlace: MeetingPlaceScreen,
  WaitingRoom: WaitingRoomScreen,
  GroupRunProgress: themed(
    GroupRunProgressScreen,
    'GroupRunProgressScreen',
    dark,
  ),
  GroupRunPosition: themed(
    GroupRunPositionScreen,
    'GroupRunPositionScreen',
    dark,
  ),
  GroupRunResult: GroupRunResultScreen,
  GroupRunCancel: GroupRunCancelScreen,
};
