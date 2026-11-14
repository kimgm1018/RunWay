import type { Repositories } from '../types';
import { apiRequest } from './http';

// SV01 만족도 응답 제출 (docs/design/api/satisfaction-surveys.md, S15P31E105-813). The server trims the comment and
// stores a blank one as null, so an empty comment is simply left out.
const submit: Repositories['surveys']['submit'] = async ({
  score,
  comment,
  source,
}) => {
  const trimmed = comment?.trim();
  await apiRequest('/satisfaction-surveys', {
    method: 'POST',
    body: trimmed ? { score, comment: trimmed, source } : { score, source },
  });
};

export const surveysApi: Repositories['surveys'] = { submit };
