import { createContext, useContext } from 'react';
import type { View } from 'react-native';

// A card inside a scroll asks to have its top shown (S15P31E105-689): the home 러닝 분석 card turns with its button at
// the foot, so after a turn the scroll brings the card's top back into view. Outside a scroll that offers it, asking
// does nothing.
export type RevealTop = (target: View | null) => void;

export const RevealTopContext = createContext<RevealTop>(() => undefined);

export const useRevealTop = () => useContext(RevealTopContext);

// The scroll position that shows a target whose top is at targetY (in the scroll's content) with a little room above,
// or null when its top is already in view below the current position, so a card already shown is not moved.
export function revealOffset(
  targetY: number,
  scrollY: number,
  room = 12,
): number | null {
  if (targetY >= scrollY) {
    return null;
  }
  return Math.max(0, targetY - room);
}
