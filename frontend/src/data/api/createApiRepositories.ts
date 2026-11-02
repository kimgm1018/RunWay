import {
  createMockRepositories,
  type MockOptions,
} from '../mock/createMockRepositories';
import type { Repositories } from '../types';
import { checkLoginId, login, signUp } from './auth';

// Repositories backed by the server. Each API task swaps its mock here for the server version; the rest stay on mock data.
export function createApiRepositories(mockOptions?: MockOptions): Repositories {
  const mock = createMockRepositories(mockOptions);
  return {
    ...mock,
    // Phone verification has no API yet, so it stays on mock data.
    auth: { ...mock.auth, login, checkLoginId, signUp },
  };
}
