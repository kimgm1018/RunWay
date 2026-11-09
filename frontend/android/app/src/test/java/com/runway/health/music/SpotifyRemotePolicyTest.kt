package com.runway.health.music

import org.junit.Assert.assertEquals
import org.junit.Test

class SpotifyRemotePolicyTest {
  @Test fun givesPeopleTimeToReadConsentWithoutSlowingSilentReconnectTimeout() {
    assertEquals(120_000L, SpotifyRemotePolicy.connectionTimeout(true))
    assertEquals(20_000L, SpotifyRemotePolicy.connectionTimeout(false))
  }
  @Test fun allowsSpotifyConsentOnlyForExplicitConnectionsOnSupportedAndroid() {
    val original = 65
    val allowActivityStarts = android.content.Context.BIND_ALLOW_ACTIVITY_STARTS
    assertEquals(original or allowActivityStarts, SpotifyRemotePolicy.bindFlags(34, true, "com.spotify.music", original))
    assertEquals(original, SpotifyRemotePolicy.bindFlags(34, false, "com.spotify.music", original))
    assertEquals(original, SpotifyRemotePolicy.bindFlags(34, true, "other.app", original))
    assertEquals(original, SpotifyRemotePolicy.bindFlags(33, true, "com.spotify.music", original))
  }
  @Test fun distinguishesRegistrationFromPermissionAndPremium() {
    assertEquals("USER_NOT_REGISTERED", SpotifyRemotePolicy.failure("UserNotAuthorizedException", "The user is not registered for this application"))
    assertEquals("AUTH_REQUIRED", SpotifyRemotePolicy.failure("UserNotAuthorizedException", "Authorization denied"))
    assertEquals("PREMIUM_REQUIRED", SpotifyRemotePolicy.failure("RemoteClientException", "Premium required"))
    assertEquals("FAILED", SpotifyRemotePolicy.failure("RemoteClientException", "Forbidden"))
  }
  @Test fun tellsDeclinedConsentApartFromOtherSignInFailures() {
    assertEquals("DENIED", SpotifyRemotePolicy.authorizationFailure("access_denied"))
    assertEquals("FAILED", SpotifyRemotePolicy.authorizationFailure("invalid_client"))
    assertEquals("FAILED", SpotifyRemotePolicy.authorizationFailure(null))
  }
  @Test fun treatsAClosedSignInAsCanceledNotFailed() {
    assertEquals(true, SpotifyRemotePolicy.authorizationCanceled(android.app.Activity.RESULT_CANCELED))
    assertEquals(false, SpotifyRemotePolicy.authorizationCanceled(android.app.Activity.RESULT_OK))
  }
  @Test fun asksForAnUpdateOnlyBelowThePkceVersion() {
    assertEquals(true, SpotifyRemotePolicy.supportsPkce(200, 200))
    assertEquals(true, SpotifyRemotePolicy.supportsPkce(201, 200))
    assertEquals(false, SpotifyRemotePolicy.supportsPkce(199, 200))
    assertEquals(false, SpotifyRemotePolicy.supportsPkce(-1, 200))
  }
  @Test fun playsOnlyPlaylistAndTrackUris() {
    assertEquals(true, SpotifyRemotePolicy.playableUri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"))
    assertEquals(true, SpotifyRemotePolicy.playableUri("spotify:track:4uLU6hMCjMI75M1A2tKUQC"))
    assertEquals(false, SpotifyRemotePolicy.playableUri("spotify:album:4uLU6hMCjMI75M1A2tKUQC"))
    assertEquals(false, SpotifyRemotePolicy.playableUri("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"))
    assertEquals(false, SpotifyRemotePolicy.playableUri("spotify:track:"))
  }
}
