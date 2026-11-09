import { listItems } from '../listItems';

test('keeps a real items array', () => {
  expect(listItems({ items: [1, 2] })).toEqual([1, 2]);
});

test('treats missing null or non-array items as an empty list', () => {
  expect(listItems(undefined)).toEqual([]);
  expect(listItems(null)).toEqual([]);
  expect(listItems({})).toEqual([]);
  expect(listItems({ items: null })).toEqual([]);
  expect(listItems({ items: undefined })).toEqual([]);
});
