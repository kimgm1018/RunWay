import type { RecommendationPreferences } from '../types';
import { copyCoursePreferences } from '../coursePreferences';
import { apiRequest } from './http';

export const getCoursePreferences = () =>
  apiRequest<RecommendationPreferences>('/users/me/preferences');
export const saveCoursePreferences = (value: RecommendationPreferences) =>
  apiRequest<RecommendationPreferences>('/users/me/preferences', {
    method: 'PUT',
    body: copyCoursePreferences(value),
  });
