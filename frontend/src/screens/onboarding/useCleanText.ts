import { useState } from 'react';

// S15P31E105-773: a text field that drops the characters it does not take as they are typed or pasted. dropped stays
// true until the next edit, so the field can say why the character did not appear.
export function useCleanText(initial: string, clean: (text: string) => string) {
  const [value, setValue] = useState(() => clean(initial));
  const [dropped, setDropped] = useState(false);
  const change = (text: string) => {
    const next = clean(text);
    setDropped(next !== text);
    setValue(next);
  };
  return [value, change, dropped] as const;
}
