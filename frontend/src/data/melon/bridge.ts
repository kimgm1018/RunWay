// 멜론 Android 네이티브 모듈(MelonMedia)과 주고받는 값(S15P31E105-398). 곡 정보는 화면 표시에만 쓰고 로그에 남기지 않는다.

export type MelonCommand = 'play' | 'pause' | 'next' | 'previous';

export type MelonStart = 'PLAYLIST' | 'TOP100' | 'NONE';

export function parseStart(value: unknown): MelonStart {
  return value === 'PLAYLIST' || value === 'TOP100' ? value : 'NONE';
}

export type MelonStatus = {
  installed: boolean;
  // 멜론이 표준 MediaBrowser 서비스를 제공하는 버전인지.
  browsable: boolean;
  // 알림 접근 권한.
  permitted: boolean;
};

export type MelonTrack = {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  positionMs: number;
  // 앨범 아트 file:// URI. 메타데이터에 없으면 null.
  artworkUri: string | null;
};

export type MelonPlayback = {
  // 제어할 멜론 세션이 있는지.
  connected: boolean;
  playing: boolean;
  loginRequired: boolean;
  // 멜론이 지원한다고 알린 제어.
  commands: MelonCommand[];
  track: MelonTrack | null;
};

export type MelonBridge = {
  status(): Promise<MelonStatus>;
  connect(): Promise<boolean>;
  playback(): Promise<MelonPlayback>;
  // 보냈으면 true. 멜론이 지원하지 않거나 세션이 없으면 false.
  send(command: MelonCommand): Promise<boolean>;
  // 재생할 곡이 없을 때 첫 재생: 기본 재생목록, 없으면 TOP100(MUS-003). 재생한 목록, 못 찾으면 NONE.
  playDefault(): Promise<MelonStart>;
  openPermissionSettings(): Promise<boolean>;
  openMelon(): Promise<boolean>;
};

const commands: MelonCommand[] = ['play', 'pause', 'next', 'previous'];

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const text = (value: unknown) => (typeof value === 'string' ? value : null);

export function parseStatus(json: string): MelonStatus {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      installed: raw.installed === true,
      browsable: raw.browsable === true,
      permitted: raw.permitted === true,
    };
  } catch {
    return { installed: false, browsable: false, permitted: false };
  }
}

function parseTrack(raw: unknown): MelonTrack | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const id = text(value.id);
  const title = text(value.title);
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    artist: text(value.artist) ?? '',
    durationMs: finite(value.durationMs) ? Math.max(0, value.durationMs) : 0,
    positionMs: finite(value.positionMs) ? Math.max(0, value.positionMs) : 0,
    artworkUri: text(value.artworkUri) || null,
  };
}

const disconnected: MelonPlayback = {
  connected: false,
  playing: false,
  loginRequired: false,
  commands: [],
  track: null,
};

export function parsePlayback(json: string): MelonPlayback {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (raw.connected !== true) {
      return disconnected;
    }
    return {
      connected: true,
      playing: raw.playing === true,
      loginRequired: raw.loginRequired === true,
      commands: Array.isArray(raw.commands)
        ? commands.filter(command =>
            (raw.commands as unknown[]).includes(command),
          )
        : [],
      track: parseTrack(raw.track),
    };
  } catch {
    return disconnected;
  }
}
