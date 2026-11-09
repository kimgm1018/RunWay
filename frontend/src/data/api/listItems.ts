// List APIs return 200 with items=[] for an empty result. Missing/null items must not
// become a TypeError and look like a failed load (S15P31E105-588).

export function listItems<T>(
  value: { items?: T[] | null } | null | undefined,
): T[] {
  return Array.isArray(value?.items) ? value.items : [];
}
