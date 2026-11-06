import { DataError } from '../errors';
import type { Repositories } from '../types';
import { apiRequest } from './http';

// W04 수집 동의·철회 and W05 동의 상태 조회 (docs/design/api/devices-health.md, S15P31E105-250).
type ConsentItem = { consentType: string; granted: boolean };

const path = '/consents';

// W05 lists all four consents; 8.1 only shows HEALTH_DATA. A missing or odd item is an error, not a guess.
const getHealth: Repositories['consents']['getHealth'] = async () => {
  const { items } = await apiRequest<{ items: ConsentItem[] }>(path);
  const health = items?.find(item => item.consentType === 'HEALTH_DATA');
  if (typeof health?.granted !== 'boolean') {
    throw new DataError('UNKNOWN', '건강정보 동의 상태 없음');
  }
  return health.granted;
};

// W04 changes only HEALTH_DATA; the same value again is still 200.
const setHealth: Repositories['consents']['setHealth'] = async granted => {
  const saved = await apiRequest<ConsentItem>(path, {
    method: 'POST',
    body: { consentType: 'HEALTH_DATA', granted },
  });
  return saved.granted;
};

export const consentsApi: Repositories['consents'] = { getHealth, setHealth };
