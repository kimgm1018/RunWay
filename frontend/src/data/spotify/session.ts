import { spotifyTokens } from './auth';
import { createSpotifyRemoteBridge } from './native';
import { remoteConsent } from './remoteConsent';
// The next RunWay session must explicitly connect again, even if Spotify still remembers its grant.
export async function clearSpotifySession() {
  await Promise.allSettled([
    spotifyTokens.clear(),
    remoteConsent.clear(),
    createSpotifyRemoteBridge()?.disconnect(),
  ]);
}
