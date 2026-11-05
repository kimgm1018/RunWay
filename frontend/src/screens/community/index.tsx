import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { CommunityScreen } from './CommunityScreen';
import { PostDetailScreen } from './PostDetailScreen';
import { PostEditScreen, PostWriteScreen } from './PostWriteScreen';
import { MyProfileScreen, RunnerProfileScreen } from './ProfileScreen';

// 7.x 커뮤니티 · 프로필, all on white (S15P31E105-426).
export const communityScreens: Partial<Record<RouteName, React.ComponentType>> =
  {
    Community: CommunityScreen,
    PostDetail: PostDetailScreen,
    PostWrite: PostWriteScreen,
    PostEdit: PostEditScreen,
    RunnerProfile: RunnerProfileScreen,
    MyProfile: MyProfileScreen,
  };
