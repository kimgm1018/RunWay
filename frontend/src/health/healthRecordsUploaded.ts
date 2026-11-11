// S15P31E105-675: 2.1 loads today's readiness (R02) before this phone's Samsung Health records reach W06, and the
// server scores the day only after they are stored. This tells 2.1 to read it again once an upload stored new values.
const listeners = new Set<() => void>();

// Returns the unsubscribe function, so it fits a useEffect cleanup.
export function onHealthRecordsUploaded(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function healthRecordsUploaded() {
  listeners.forEach(listener => listener());
}
