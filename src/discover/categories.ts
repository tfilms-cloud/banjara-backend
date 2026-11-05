/**
 * Per-service sub-types (vehicle class, residence, guide gender, tour type).
 * Same rules the web and mobile Explore pages used client-side.
 */
import type { DiscoverCard, DiscoverService } from './types';

const LABELS: Partial<Record<DiscoverService, Array<{ id: string; label: string }>>> = {
  transport: [
    { id: 'car', label: 'Car' },
    { id: 'jeep', label: 'Jeep' },
    { id: 'suv', label: 'SUV' },
    { id: 'van', label: 'Van' },
    { id: 'mini_bus', label: 'Mini bus' },
    { id: 'bus', label: 'Bus' },
    { id: 'other', label: 'Other' },
  ],
  hotels: [
    { id: 'hotel', label: 'Hotels' },
    { id: 'guest_house', label: 'Guest houses' },
    { id: 'lodge', label: 'Hostels & lodges' },
  ],
  guides: [
    { id: 'male', label: 'Male' },
    { id: 'female', label: 'Female' },
  ],
  tours: [
    { id: 'trek', label: 'Trek' },
    { id: 'expedition', label: 'Expedition' },
    { id: 'summit', label: 'Summits' },
  ],
};

const VEHICLE_IDS = new Set(['car', 'jeep', 'suv', 'van', 'mini_bus', 'bus']);

/** Registered class wins over the generic vehicle type; unknown classes become "other". */
export function vehicleClassOf(...candidates: unknown[]): string {
  const value =
    candidates
      .map((c) => (typeof c === 'string' ? c.trim().toLowerCase() : ''))
      .find(Boolean) ?? '';
  if (value === 'minibus' || value === 'mini-bus') return 'mini_bus';
  if (value === 'private') return 'car';
  return VEHICLE_IDS.has(value) ? value : 'other';
}

export function residenceClassOf(hotelType: unknown): string {
  const value = String(hotelType ?? '').toLowerCase();
  if (value.includes('guest')) return 'guest_house';
  if (/lodge|hostel|home/.test(value)) return 'lodge';
  return 'hotel';
}

/** Only sub-types that currently have listings, in the canonical order. */
export function categoryOptions(service: DiscoverService, cards: DiscoverCard[]) {
  const present = new Set(cards.map((card) => card.category));
  return (LABELS[service] ?? []).filter((option) => present.has(option.id));
}

/** Guides without a stated gender stay visible under every gender, as before. */
export function matchesCategory(card: DiscoverCard, category: string | null): boolean {
  if (!category) return true;
  if (card.service === 'guides' && !card.category) return true;
  return card.category === category;
}

export function isKnownCategory(service: DiscoverService, category: string | undefined): boolean {
  return !!category && (LABELS[service] ?? []).some((option) => option.id === category);
}
