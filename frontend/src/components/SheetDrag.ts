import { useRef } from 'react';
import {
  Animated,
  PanResponder,
  type PanResponderGestureState,
} from 'react-native';

// 시트 드래그 (S15P31E105-899): a card that comes up from the bottom follows the finger the way it can go, and a
// long or quick enough drag finishes the move (close or fold going down, open going up); a short one settles back.

export type SheetDragDirection = 'down' | 'up';

type Gesture = Pick<PanResponderGestureState, 'dx' | 'dy' | 'vy'>;

// The finger has to move this far, and more up and down than sideways, before the card takes the drag: a tap still
// presses what is under it, and a sideways ruler keeps its drag.
const claimDistance = 8;
// A drag past this (or a third of the way when the card moves less) finishes the move.
const commitDistance = 96;
// A flick this fast in the drag's direction finishes it from a short drag too.
const commitVelocity = 0.6;
const flickDistance = 16;

const along = (dy: number, direction: SheetDragDirection) =>
  direction === 'down' ? dy : -dy;

export function claimsSheetDrag(
  gesture: Gesture,
  direction: SheetDragDirection,
): boolean {
  return (
    along(gesture.dy, direction) > claimDistance &&
    Math.abs(gesture.dy) > Math.abs(gesture.dx)
  );
}

// How far the card follows: only the drag's way, and never past where the move ends.
export function clampSheetDrag(
  dy: number,
  direction: SheetDragDirection,
  range: number,
): number {
  const travel = Math.min(Math.max(along(dy, direction), 0), range);
  return direction === 'down' ? travel : -travel;
}

export function commitsSheetDrag(
  gesture: Gesture,
  direction: SheetDragDirection,
  range: number,
): boolean {
  const travel = along(gesture.dy, direction);
  const speed = along(gesture.vy, direction);
  return (
    travel > Math.min(commitDistance, range / 3) ||
    (speed > commitVelocity && travel > flickDistance)
  );
}

// The drag of one card. drag is the card's extra translateY; onCommit gets how far it went, and from there the card
// is the caller's to move (drag stays where the finger left it). A drag left short springs back on its own.
export function useSheetDrag({
  direction,
  range,
  onCommit,
}: {
  direction: SheetDragDirection;
  range: number;
  onCommit: (dy: number) => void;
}) {
  const drag = useRef(new Animated.Value(0)).current;
  // The responder is made once; the latest direction, range and callback are read when the finger moves.
  const latest = useRef({ direction, range, onCommit });
  latest.current = { direction, range, onCommit };
  const following = useRef(false);
  const settle = () =>
    Animated.spring(drag, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  const pan = useRef(
    PanResponder.create({
      // A touch on the card's bare parts (its handle, title, gaps) is the card's from the start, as on the comment
      // sheet (S15P31E105-812): asked only once the finger moved, the phone never asked it there. A button, a list
      // or a ruler under the finger still takes the touch first.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        claimsSheetDrag(gesture, latest.current.direction),
      onPanResponderGrant: () => {
        following.current = false;
      },
      // Taken at the touch's start, the card still waits for an up-and-down drag before it moves.
      onPanResponderMove: (_, gesture) => {
        const { direction: way, range: span } = latest.current;
        following.current ||= claimsSheetDrag(gesture, way);
        if (following.current) {
          drag.setValue(clampSheetDrag(gesture.dy, way, span));
        }
      },
      onPanResponderRelease: (_, gesture) => {
        const { direction: way, range: span } = latest.current;
        if (following.current && commitsSheetDrag(gesture, way, span)) {
          latest.current.onCommit(clampSheetDrag(gesture.dy, way, span));
        } else {
          settle();
        }
      },
      // Once the card follows the finger it keeps the drag; a drag the system takes away (a list scrolling
      // natively) lets the card settle back instead of hanging where it was.
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: settle,
    }),
  ).current;
  return { drag, panHandlers: pan.panHandlers, settle };
}
