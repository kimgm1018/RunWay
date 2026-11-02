import { createMockRepositories } from '../mock/createMockRepositories';
import type { Repositories } from '../types';

// Repositories backed by the server. Each API task swaps its mock here for the server version; the rest stay on mock data.
export function createApiRepositories(): Repositories {
  const mock = createMockRepositories();
  return { ...mock };
}
