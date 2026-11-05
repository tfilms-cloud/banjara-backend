/**
 * Sort + quick-filter rules for Explore. Single source of truth: the web and mobile
 * clients render `options` from the API and no longer re-implement these rules.
 */
import type {
  DiscoverCard,
  DiscoverOptions,
  DiscoverService,
  DiscoverSort,
  DiscoverToggle,
} from './types';

export const TOP_RATED_MIN = 4;

const SORT_LABEL: Record<DiscoverSort, string> = {
  recommended: 'Recommended',
  price: 'Cheapest',
  rating: 'Top rated',
  soonest: 'Soonest',
};
const TOGGLE_LABEL: Record<DiscoverToggle, string> = {
  topRated: '4★ & up',
  verified: 'Verified',
  freeCancel: 'Free cancellation',
  breakfast: 'Breakfast included',
};

const OFFERED: Partial<Record<DiscoverService, { sorts: DiscoverSort[]; toggles: DiscoverToggle[] }>> = {
  transport: { sorts: ['recommended', 'price', 'soonest'], toggles: ['verified'] },
  hotels: {
    sorts: ['recommended', 'price', 'rating'],
    toggles: ['topRated', 'verified', 'freeCancel', 'breakfast'],
  },
  guides: { sorts: ['recommended', 'rating'], toggles: ['topRated'] },
  restaurants: { sorts: ['recommended', 'rating'], toggles: ['topRated', 'verified'] },
};

/** Sort/filter chips per service. Services without an entry (tours) offer none. */
export function discoverOptions(service: DiscoverService): Omit<DiscoverOptions, 'categories'> {
  const offered = OFFERED[service];
  return {
    sorts: (offered?.sorts ?? []).map((id) => ({ id, label: SORT_LABEL[id] })),
    toggles: (offered?.toggles ?? []).map((id) => ({ id, label: TOGGLE_LABEL[id] })),
  };
}

/** Drop anything the service doesn't offer (unknown values are ignored, never an error). */
export function sanitizeRefine(
  service: DiscoverService,
  order: string | undefined,
  only: string[]
): { order: DiscoverSort; only: DiscoverToggle[] } {
  const offered = OFFERED[service];
  if (!offered) return { order: 'recommended', only: [] };
  return {
    order: offered.sorts.find((id) => id === order) ?? 'recommended',
    only: offered.toggles.filter((id) => only.includes(id)),
  };
}

const num = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** `items` must already be in "recommended" order; Array#sort is stable so ties keep it. */
export function applyRefine(
  items: DiscoverCard[],
  order: DiscoverSort,
  only: DiscoverToggle[]
): DiscoverCard[] {
  let out = items;
  if (only.includes('topRated')) out = out.filter((c) => num(c.rating) >= TOP_RATED_MIN);
  if (only.includes('verified')) out = out.filter((c) => c.verified);
  if (only.includes('freeCancel')) out = out.filter((c) => !!c.freeCancellation);
  if (only.includes('breakfast')) out = out.filter((c) => !!c.breakfastIncluded);
  const sorted = [...out];
  if (order === 'price') sorted.sort((a, b) => num(a.price) - num(b.price));
  else if (order === 'rating') sorted.sort((a, b) => num(b.rating) - num(a.rating));
  else if (order === 'soonest') {
    sorted.sort((a, b) => (a.departsAt ?? '').localeCompare(b.departsAt ?? ''));
  }
  return sorted;
}
