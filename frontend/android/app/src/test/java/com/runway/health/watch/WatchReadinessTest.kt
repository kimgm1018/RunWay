package com.runway.health.watch

import org.junit.Assert.*
import org.junit.Test

class WatchReadinessTest {
  @Test fun onlyTheRequestedWatchAndFreshRequestCanAnswer() {
    assertEquals(SensorReadiness(true, false), matchingReadiness("watch", "watch", "new", "new", 1, true, false))
    assertNull(matchingReadiness("other", "watch", "new", "new", 1, true, true))
    assertNull(matchingReadiness("watch", "watch", "old", "new", 1, true, true))
    assertNull(matchingReadiness("watch", "watch", "new", "new", 2, true, true))
  }

  @Test fun incompleteOrMistypedPermissionsAreNotInterpretedAsAllowed() {
    assertNull(matchingReadiness("watch", "watch", "new", "new", 1, null, true))
    assertNull(matchingReadiness("watch", "watch", "new", "new", 1, "true", true))
    assertNull(matchingReadiness("watch", "watch", "new", "new", 1, true, 1))
  }
}
