import { NativeEventEmitter, NativeModules } from 'react-native';
import {
  parseRemotePlayback,
  type AppAuthorization,
  type RemoteCommand,
  type SpotifyRemoteBridge,
} from './remoteBridge';
type NativeRemote = {
  installed(): Promise<boolean>;
  authorize(
    clientId: string,
    redirectUri: string,
    scopes: string[],
    codeChallenge: string,
    state: string,
  ): Promise<AppAuthorization>;
  openApp(): Promise<void>;
  connect(
    clientId: string,
    redirectUri: string,
    interactive: boolean,
  ): Promise<void>;
  getState(): Promise<string>;
  command(command: RemoteCommand): Promise<void>;
  playUri(uri: string): Promise<void>;
  disconnect(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};
export function createSpotifyRemoteBridge(): SpotifyRemoteBridge | undefined {
  const native = NativeModules.SpotifyRemote as NativeRemote | undefined;
  if (!native) {
    return undefined;
  }
  const events = new NativeEventEmitter(native);
  return {
    installed: () => native.installed(),
    authorize: request =>
      native.authorize(
        request.clientId,
        request.redirectUri,
        request.scopes,
        request.codeChallenge,
        request.state,
      ),
    openApp: () => native.openApp(),
    connect: (clientId, interactive) =>
      native.connect(clientId, 'runway://spotify-callback', interactive),
    getState: async () => parseRemotePlayback(await native.getState()),
    send: command => native.command(command),
    playUri: uri => native.playUri(uri),
    disconnect: () => native.disconnect(),
    subscribe: listener => {
      const subscription = events.addListener(
        'SpotifyRemoteState',
        (json: string) => {
          try {
            listener(parseRemotePlayback(json));
          } catch {
            /* Ignore malformed native events. */
          }
        },
      );
      return () => subscription.remove();
    },
  };
}
