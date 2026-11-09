import { NativeModules } from 'react-native';
import {
  parseLibrary,
  parseRecent,
  parsePlayback,
  parseStart,
  parseStatus,
  type MelonBridge,
  type MelonCommand,
} from './bridge';

// 멜론 Android 연동(S15P31E105-398). 네이티브 MelonMedia 모듈이 없는 빌드에서는 undefined라 목업 멜론을 쓴다.

type NativeMelonMedia = {
  getStatus(): Promise<string>;
  connect(): Promise<boolean>;
  getNowPlaying(): Promise<string>;
  command(name: MelonCommand): Promise<boolean>;
  playDefault(): Promise<string>;
  getLibrary(): Promise<string>;
  playItem(mediaId: string): Promise<boolean>;
  getRecent(): Promise<string>;
  playTrack(id: string): Promise<boolean>;
  openPermissionSettings(): Promise<boolean>;
  openMelon(): Promise<boolean>;
};

export function createMelonBridge(): MelonBridge | undefined {
  const native = NativeModules.MelonMedia as NativeMelonMedia | undefined;
  if (!native) {
    return undefined;
  }
  return {
    status: async () => parseStatus(await native.getStatus()),
    connect: () => native.connect().catch(() => false),
    playback: async () => parsePlayback(await native.getNowPlaying()),
    send: command => native.command(command).catch(() => false),
    playDefault: async () =>
      parseStart(await native.playDefault().catch(() => 'NONE')),
    library: async () =>
      parseLibrary(await native.getLibrary().catch(() => '[]')),
    playItem: id => native.playItem(id).catch(() => false),
    recent: async () => parseRecent(await native.getRecent().catch(() => '[]')),
    playTrack: id => native.playTrack(id).catch(() => false),
    openPermissionSettings: () =>
      native.openPermissionSettings().catch(() => false),
    openMelon: () => native.openMelon().catch(() => false),
  };
}
