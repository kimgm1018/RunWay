import { basemapImageAddress, basemapOf } from '../basemap';

// C03 basemap (S15P31E105-612): `{ imageUrl, osmDataTimestamp }`, a flat map PNG. A relative image path is made whole
// on the API server's origin (as profile photos are); anything that cannot be loaded is null.
const origin = 'https://k15e105.p.ssafy.io';

test('a valid basemap keeps its absolute image address and data time', () => {
  expect(
    basemapOf({
      imageUrl: 'https://cdn.example.com/basemaps/7.png',
      osmDataTimestamp: '2026-11-01T00:00:00Z',
    }),
  ).toEqual({
    imageUrl: 'https://cdn.example.com/basemaps/7.png',
    osmDataTimestamp: '2026-11-01T00:00:00Z',
  });
});

test('a relative image path is loaded from the API server', () => {
  expect(basemapOf({ imageUrl: '/api/v1/courses/7/basemap.png' })).toEqual({
    imageUrl: `${origin}/api/v1/courses/7/basemap.png`,
    osmDataTimestamp: null,
  });
  expect(basemapImageAddress('http://10.0.2.2:8080/b.png')).toBe(
    'http://10.0.2.2:8080/b.png',
  );
});

test('a missing basemap is null (an older server)', () => {
  expect(basemapOf(undefined)).toBeNull();
  expect(basemapOf(null)).toBeNull();
});

test.each([
  ['no imageUrl', { osmDataTimestamp: null }],
  ['an empty imageUrl', { imageUrl: '' }],
  ['a blank imageUrl', { imageUrl: '   ' }],
  ['a number', { imageUrl: 7 }],
  ['another scheme', { imageUrl: 'file:///sdcard/b.png' }],
  ['a data address', { imageUrl: 'data:image/png;base64,AAAA' }],
  ['a protocol-relative address', { imageUrl: '//evil.example.com/b.png' }],
  ['a bare word', { imageUrl: 'basemap.png' }],
  ['an address with spaces', { imageUrl: '/api/v1/a b.png' }],
  ['the old vector shape', { osmDataTimestamp: null, features: [] }],
  ['not an object', 'https://cdn.example.com/b.png'],
])('%s gives no basemap', (_, raw) => {
  expect(basemapOf(raw)).toBeNull();
});

test('a timestamp that is not a string is null', () => {
  expect(basemapOf({ imageUrl: '/b.png', osmDataTimestamp: 20261101 })).toEqual(
    { imageUrl: `${origin}/b.png`, osmDataTimestamp: null },
  );
});
