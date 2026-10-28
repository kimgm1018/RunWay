import type { DataSource } from '../config';
import { createMockRepositories } from './mock/createMockRepositories';
import type { Repositories } from './types';

export function createRepositories(source: DataSource): Repositories {
  switch (source) {
    case 'mock':
      return createMockRepositories();
  }
}
