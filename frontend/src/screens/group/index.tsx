import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { dark, themed } from '../run';
import { CrewCreateScreen } from './CrewCreateScreen';
import { CrewDetailScreen } from './CrewDetailScreen';
import { CrewJoinRequestsScreen } from './CrewJoinRequestsScreen';
import { CrewRecruitScreen } from './CrewRecruitScreen';
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

// 6.x 그룹런. Like 4.2, 6.6 runs on the K1 dark map day and night; 6.6c and 6.7 sit on the K1
// background like 4.3·4.5. The rest follow the screen mode.
export const groupScreens: Partial<Record<RouteName, React.ComponentType>> = {
  MyCrews: GroupScreen,
  CrewRecruit: CrewRecruitScreen,
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
  GroupRunPause: GroupRunPauseScreen,
  GroupRunResult: GroupRunResultScreen,
  GroupRunCancel: GroupRunCancelScreen,
};
