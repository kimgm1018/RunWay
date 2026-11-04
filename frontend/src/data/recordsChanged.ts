// Screens that list my runs (2.1 홈, 5.1 기록) load them once; this tells them to read again after a run is
// deleted on 5.2 (S15P31E105-394).
const listeners = new Set<() => void>();

// Returns the unsubscribe function, so it fits a useEffect cleanup.
export function onRecordsChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordsChanged() {
  listeners.forEach(listener => listener());
}
