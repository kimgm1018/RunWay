export async function readAllPages<T>(
  read: (
    token?: string,
  ) => Promise<{ records: T[]; pageToken?: string | null }>,
): Promise<T[]> {
  const records: T[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  do {
    const page = await read(token);
    records.push(...page.records);
    const next = page.pageToken || undefined;
    if (next && seen.has(next)) {
      throw new Error('Repeated health record page token');
    }
    if (next) {
      seen.add(next);
    }
    token = next;
  } while (token);
  return records;
}
