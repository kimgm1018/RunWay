import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useRequestTicket } from '../requestTicket';

// R-1: a 다른 코스 answer is shown only while its request is still the latest for the same search on an open 3.1b.
type Ticket = ReturnType<typeof useRequestTicket>;

function Probe({
  search,
  onTicket,
}: {
  search: unknown;
  onTicket: (ticket: Ticket) => void;
}) {
  onTicket(useRequestTicket(search));
  return null;
}

async function mount(search: unknown) {
  let ticket!: Ticket;
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <Probe search={search} onTicket={value => (ticket = value)} />,
    );
  });
  return { screen, ticket: () => ticket };
}

test('the latest request for the same search stays current', async () => {
  const search = { seed: 1 };
  const { screen, ticket } = await mount(search);

  const first = ticket().take();
  expect(ticket().isCurrent(first)).toBe(true);
  const second = ticket().take();
  expect(ticket().isCurrent(first)).toBe(false);
  expect(ticket().isCurrent(second)).toBe(true);

  // Re-rendering with the same search keeps it.
  await act(async () => {
    screen.update(<Probe search={search} onTicket={() => {}} />);
  });
  expect(ticket().isCurrent(second)).toBe(true);
});

test('a new search from 3.1 makes the pending 다른 코스 answer stale', async () => {
  const { screen, ticket } = await mount({ seed: 1 });
  const pending = ticket().take();

  await act(async () => {
    screen.update(
      <Probe search={{ seed: 1, targetDistanceM: 7000 }} onTicket={() => {}} />,
    );
  });

  expect(ticket().isCurrent(pending)).toBe(false);
});

test('closing 3.1b makes the pending answer stale', async () => {
  const { screen, ticket } = await mount({ seed: 1 });
  const { isCurrent, take } = ticket();
  const pending = take();

  await act(async () => screen.unmount());

  expect(isCurrent(pending)).toBe(false);
});
