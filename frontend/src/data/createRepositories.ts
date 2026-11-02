import type { DataSource } from '../config';
import { createApiRepositories } from './api/createApiRepositories';
import { createMockRepositories } from './mock/createMockRepositories';
import type { Repositories } from './types';

export function createRepositories(source: DataSource): Repositories {
  switch (source) {
    case 'mock':
      return createMockRepositories();
    case 'api':
      return createApiRepositories();
  }
}
