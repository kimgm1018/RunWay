import React from 'react';
import Svg, { Circle, Path, Polygon, Polyline, Rect } from 'react-native-svg';

// Outline icons used by the prototype (Lucide, ISC license).
const icons = {
  home: (
    <>
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  run: (
    <>
      <Path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
      <Path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
      <Path d="M16 17h4" />
      <Path d="M4 13h4" />
    </>
  ),
  group: (
    <>
      <Circle cx="8" cy="4.5" r="2" />
      <Path d="M6.5 21l2-6-2.5-2 1.5-4.5L10 10l2 1" />
      <Path d="M8.5 15l2.5 2v4" />
      <Circle cx="17" cy="5.5" r="1.8" />
      <Path d="M15.5 21l1.6-5-2-1.6 1.2-4 2 1.6 1.7.9" />
      <Path d="M17.1 16l2 1.7V21" />
    </>
  ),
  community: <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  bell: (
    <>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  settings: (
    <>
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  back: <Path d="m15 18-6-6 6-6" />,
  forward: <Path d="m9 18 6-6-6-6" />,
  // ↗ on the round button of 2.x cards (DESIGN.md 2-6 원 버튼).
  arrowUpRight: (
    <>
      <Path d="M7 7h10v10" />
      <Path d="M7 17 17 7" />
    </>
  ),
  close: (
    <>
      <Path d="M18 6 6 18" />
      <Path d="m6 6 12 12" />
    </>
  ),
  check: <Path d="M20 6 9 17l-5-5" />,
  alert: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Path d="M12 8v4" />
      <Path d="M12 16h.01" />
    </>
  ),
  bookmark: <Path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  plus: (
    <>
      <Path d="M5 12h14" />
      <Path d="M12 5v14" />
    </>
  ),
  more: (
    <>
      <Circle cx="12" cy="12" r="1" />
      <Circle cx="19" cy="12" r="1" />
      <Circle cx="5" cy="12" r="1" />
    </>
  ),
  play: <Polygon points="6 4 20 12 6 20 6 4" />,
  chevronDown: <Path d="m6 9 6 6 6-6" />,
  lock: (
    <>
      <Rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  heart: (
    <Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  ),
  watch: (
    <>
      <Circle cx="12" cy="12" r="6" />
      <Polyline points="12 10 12 12 13 13" />
      <Path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05" />
      <Path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05" />
    </>
  ),
  phone: (
    <>
      <Rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <Path d="M12 18h.01" />
    </>
  ),
  route: (
    <>
      <Circle cx="6" cy="19" r="3" />
      <Path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <Circle cx="18" cy="5" r="3" />
    </>
  ),
  refresh: (
    <>
      <Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <Path d="M21 3v5h-5" />
      <Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <Path d="M8 16H3v5" />
    </>
  ),
  heartPulse: (
    <>
      <Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <Path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </>
  ),
  mapPin: (
    <>
      <Path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <Circle cx="12" cy="10" r="3" />
    </>
  ),
  moon: <Path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  flame: (
    <Path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  activity: (
    <Path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  ),
  inbox: (
    <>
      <Path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  compass: (
    <>
      <Path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
      <Circle cx="12" cy="12" r="10" />
    </>
  ),
  music: (
    <>
      <Path d="M9 18V5l12-2v13" />
      <Circle cx="6" cy="18" r="3" />
      <Circle cx="18" cy="16" r="3" />
    </>
  ),
  musicOff: (
    <>
      <Path d="M9 18V9" />
      <Path d="M9 5.5V5l12-2v11" />
      <Circle cx="6" cy="18" r="3" />
      <Path d="m2 2 20 20" />
    </>
  ),
  skipBack: (
    <>
      <Polygon points="19 20 9 12 19 4 19 20" />
      <Rect x="4" y="5" width="2.4" height="14" rx="1.2" />
    </>
  ),
  skipForward: (
    <>
      <Polygon points="5 4 15 12 5 20 5 4" />
      <Rect x="17.6" y="5" width="2.4" height="14" rx="1.2" />
    </>
  ),
  pause: (
    <>
      <Rect x="14" y="4" width="4" height="16" rx="1" />
      <Rect x="6" y="4" width="4" height="16" rx="1" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Polyline points="12 6 12 12 16 14" />
    </>
  ),
  userCheck: (
    <>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Polyline points="16 11 18 13 22 9" />
    </>
  ),
  userX: (
    <>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Path d="m17 8 5 5" />
      <Path d="m22 8-5 5" />
    </>
  ),
  userPlus: (
    <>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Path d="M19 8v6" />
      <Path d="M22 11h-6" />
    </>
  ),
  circleX: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Path d="m15 9-6 6" />
      <Path d="m9 9 6 6" />
    </>
  ),
  stop: <Rect x="6" y="6" width="12" height="12" rx="2" />,
  turnLeft: (
    <>
      <Polyline points="9 14 4 9 9 4" />
      <Path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>
  ),
  straight: (
    <>
      <Polyline points="7 9 12 4 17 9" />
      <Path d="M12 4v16" />
    </>
  ),
  share: (
    <>
      <Path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <Polyline points="16 6 12 2 8 6" />
      <Path d="M12 2v13" />
    </>
  ),
  calendar: (
    <>
      <Rect x="3" y="4" width="18" height="18" rx="2" />
      <Path d="M16 2v4" />
      <Path d="M8 2v4" />
      <Path d="M3 10h18" />
    </>
  ),
  // 7.x 게시물: 공유, 수정, 삭제 and the vertical menu dots.
  send: (
    <>
      <Path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <Path d="m21.854 2.147-10.94 10.939" />
    </>
  ),
  pencil: (
    <>
      <Path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <Path d="m15 5 4 4" />
    </>
  ),
  trash: (
    <>
      <Path d="M3 6h18" />
      <Path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <Path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </>
  ),
  moreVertical: (
    <>
      <Circle cx="12" cy="12" r="1" />
      <Circle cx="12" cy="5" r="1" />
      <Circle cx="12" cy="19" r="1" />
    </>
  ),
  // 6.3 대표 사진 추가.
  camera: (
    <>
      <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <Circle cx="12" cy="13" r="3" />
    </>
  ),
  // 6.3 모집 인원 stepper.
  minus: <Path d="M5 12h14" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </>
  ),
  crown: (
    <Path d="M11.6 3.3a.5.5 0 0 1 .8 0l2.9 4.4a1 1 0 0 0 1.5.3l3.4-2.9a.5.5 0 0 1 .8.5l-2.8 10.1a1 1 0 0 1-1 .7H6.8a1 1 0 0 1-1-.7L3 5.6a.5.5 0 0 1 .8-.5L7.2 8a1 1 0 0 0 1.5-.3z" />
  ),
  locate: (
    <>
      <Path d="M2 12h3" />
      <Path d="M19 12h3" />
      <Path d="M12 2v3" />
      <Path d="M12 19v3" />
      <Circle cx="12" cy="12" r="7" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
} as const;

export type IconName = keyof typeof icons;

const filled: ReadonlySet<IconName> = new Set<IconName>([
  'play',
  'skipBack',
  'skipForward',
  'pause',
  'stop',
]);

export function Icon({
  name,
  color,
  size = 22,
  strokeWidth = 1.8,
  solid,
}: {
  name: IconName;
  color: string;
  size?: number;
  strokeWidth?: number;
  // Fills an outline icon, like a liked heart or a saved bookmark (7.1).
  solid?: boolean;
}) {
  const fill = solid ?? filled.has(name);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? color : 'none'}
      stroke={fill ? 'none' : color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </Svg>
  );
}
