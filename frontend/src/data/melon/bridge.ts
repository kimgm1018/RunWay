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

// 2.7 내 재생 목록 항목(S15P31E105-566): 멜론 음악서랍의 좋아요한 곡·최근들은 곡·내 플레이리스트. id는 멜론
// MediaBrowser의 mediaId로, 이 앱 안에서 재생 요청에만 쓴다.
export type MelonItemKind = 'LIKED' | 'RECENT' | 'PLAYLIST' | 'LIST';

export type MelonItem = {
  id: string;
  title: string;
  kind: MelonItemKind;
  // 웹 표지 주소. 없으면 null.
  artworkUri: string | null;
  // 곡 수. 멜론이 알려 주지 않아 이 앱에서 한 번 재생해 본 목록만 있다.
  trackCount?: number;
};

// 2.7 최근 들은 곡(S15P31E105-566): 이 기기에서 멜론이 재생한 곡, 최신순. 이 앱 저장소에만 있다.
export type MelonHeard = {
  id: string;
  title: string;
  artist: string;
  artworkUri: string | null;
  durationMs: number;
};

export type MelonBridge = {
  status(): Promise<MelonStatus>;
  connect(): Promise<boolean>;
  playback(): Promise<MelonPlayback>;
  // 보냈으면 true. 멜론이 지원하지 않거나 세션이 없으면 false.
  send(command: MelonCommand): Promise<boolean>;
  // 재생할 곡이 없을 때 첫 재생: 기본 재생목록, 없으면 TOP100(MUS-003). 재생한 목록, 못 찾으면 NONE.
  playDefault(): Promise<MelonStart>;
  // 연결된 멜론이 알려 준 재생 가능한 목록. 연결 전·메뉴 없음·실패면 빈 목록.
  library(): Promise<MelonItem[]>;
  // library()가 준 목록을 처음부터 재생한다. 보냈으면 true.
  playItem(id: string): Promise<boolean>;
  // 최근 들은 곡. 기록이 없거나 실패면 빈 목록.
  recent(): Promise<MelonHeard[]>;
  // recent()가 준 곡을 재생한다. 보냈으면 true.
  playTrack(id: string): Promise<boolean>;
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

export function parseLibrary(json: string): MelonItem[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) {
      return [];
    }
    const seen = new Set<string>();
    return raw.flatMap(entry => {
      const value =
        entry && typeof entry === 'object'
          ? (entry as Record<string, unknown>)
          : {};
      const id = text(value.id);
      const title = text(value.title)?.trim();
      if (!id || !title || seen.has(id)) {
        return [];
      }
      seen.add(id);
      const artwork = text(value.artworkUri);
      const kind = (['LIKED', 'RECENT', 'PLAYLIST'] as const).find(
        known => known === value.kind,
      );
      return [
        {
          id,
          title,
          kind: kind ?? 'LIST',
          artworkUri: webImage(artwork),
          ...(finite(value.trackCount) && value.trackCount > 0
            ? { trackCount: Math.round(value.trackCount) }
            : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

const webImage = (uri: string | null) =>
  uri && /^https?:\/\//.test(uri) ? uri : null;

export function parseRecent(json: string): MelonHeard[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) {
      return [];
    }
    const seen = new Set<string>();
    return raw.flatMap(entry => {
      const value =
        entry && typeof entry === 'object'
          ? (entry as Record<string, unknown>)
          : {};
      const id = text(value.id);
      const title = text(value.title)?.trim();
      if (!id || !title || seen.has(id)) {
        return [];
      }
      seen.add(id);
      return [
        {
          id,
          title,
          artist: text(value.artist) ?? '',
          artworkUri: webImage(text(value.artworkUri)),
          durationMs: finite(value.durationMs)
            ? Math.max(0, value.durationMs)
            : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}
