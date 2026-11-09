import type { MeetingPlace } from '../types';
import { apiRequest } from './http';

export async function searchPlaces(
  query: string,
  reference?: [number, number] | null,
): Promise<MeetingPlace[]> {
  const response = await apiRequest<{ items: MeetingPlace[] }>(
    '/places/search',
    {
      query: {
        query: query.trim(),
        longitude: reference?.[0],
        latitude: reference?.[1],
      },
    },
  );
  return response.items;
}
