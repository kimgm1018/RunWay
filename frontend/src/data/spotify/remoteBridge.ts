export type RemoteCommand = 'play' | 'pause' | 'next' | 'previous';
export type RemotePlayback = {
  connected: boolean;
  playing: boolean;
  canPlayOnDemand: boolean;
  track: {
    id: string;
    title: string;
    artist: string;
    durationMs: number;
    positionMs: number;
    artworkUri: string | null;
  } | null;
};
export type SpotifyRemoteBridge = {
  installed(): Promise<boolean>;
  openApp?(): Promise<void>;
  connect(clientId: string, interactive: boolean): Promise<void>;
  getState(): Promise<RemotePlayback>;
  send(command: RemoteCommand): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (state: RemotePlayback) => void): () => void;
};
export function parseRemotePlayback(json: string): RemotePlayback {
  const value = JSON.parse(json);
  const track = value.track;
  return {
    connected: value.connected === true,
    playing: value.playing === true,
    canPlayOnDemand: value.canPlayOnDemand === true,
    track:
      value.connected &&
      typeof track?.id === 'string' &&
      track.id &&
      typeof track.title === 'string'
        ? {
            id: track.id,
            title: track.title,
            artist: typeof track.artist === 'string' ? track.artist : '',
            durationMs: Number.isFinite(track.durationMs)
              ? Math.max(0, track.durationMs)
              : 0,
            positionMs: Number.isFinite(track.positionMs)
              ? Math.max(0, track.positionMs)
              : 0,
            artworkUri:
              typeof track.artworkUri === 'string' ? track.artworkUri : null,
          }
        : null,
  };
}
