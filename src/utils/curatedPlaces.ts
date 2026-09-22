/** Curated northern Pakistan / Islamabad boarding places — returned before live geocode. */
export const CURATED_PLACES: Array<{
  name: string;
  aliases?: string[];
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
}> = [
  { name: 'Islamabad', latitude: 33.6844, longitude: 73.0479, city: 'Islamabad', region: 'Islamabad Capital Territory' },
  { name: 'Rawalpindi', latitude: 33.5651, longitude: 73.0169, city: 'Rawalpindi', region: 'Punjab' },
  { name: 'Faizabad', aliases: ['Faizabad Metro', 'Faizabad Interchange'], latitude: 33.6664, longitude: 73.0845, city: 'Islamabad', region: 'Islamabad Capital Territory' },
  { name: 'G-9', aliases: ['G9', 'G 9'], latitude: 33.6895, longitude: 73.033, city: 'Islamabad', region: 'Islamabad Capital Territory' },
  { name: 'Saddar Rawalpindi', latitude: 33.5973, longitude: 73.0442, city: 'Rawalpindi', region: 'Punjab' },
  { name: 'Gilgit', latitude: 35.9208, longitude: 74.3144, city: 'Gilgit', region: 'Gilgit-Baltistan' },
  { name: 'Hunza', aliases: ['Hunza Valley'], latitude: 36.3167, longitude: 74.65, city: 'Hunza', region: 'Gilgit-Baltistan' },
  { name: 'Karimabad', aliases: ['Karimabad Center', 'Karimabad Hunza'], latitude: 36.3256, longitude: 74.665, city: 'Hunza', region: 'Gilgit-Baltistan' },
  { name: 'Skardu', latitude: 35.2971, longitude: 75.6335, city: 'Skardu', region: 'Gilgit-Baltistan' },
  { name: 'Naran', latitude: 34.9092, longitude: 73.6497, city: 'Naran', region: 'Khyber Pakhtunkhwa' },
  { name: 'Murree', latitude: 33.9076, longitude: 73.3943, city: 'Murree', region: 'Punjab' },
  { name: 'Swat', aliases: ['Mingora', 'Saidu Sharif'], latitude: 35.2227, longitude: 72.4258, city: 'Swat', region: 'Khyber Pakhtunkhwa' },
  { name: 'Chilas', latitude: 35.4205, longitude: 74.098, city: 'Chilas', region: 'Gilgit-Baltistan' },
  { name: 'Passu', latitude: 36.4667, longitude: 74.8833, city: 'Passu', region: 'Gilgit-Baltistan' },
  { name: 'Fairy Meadows', latitude: 35.4194, longitude: 74.5869, city: 'Fairy Meadows', region: 'Gilgit-Baltistan' },
  { name: 'Chitral', latitude: 35.8518, longitude: 71.7864, city: 'Chitral', region: 'Khyber Pakhtunkhwa' },
  { name: 'Besham', latitude: 34.9333, longitude: 72.8833, city: 'Besham', region: 'Khyber Pakhtunkhwa' },
  { name: 'Mansehra', latitude: 34.3302, longitude: 73.2, city: 'Mansehra', region: 'Khyber Pakhtunkhwa' },
  { name: 'Abbottabad', latitude: 34.1463, longitude: 73.2117, city: 'Abbottabad', region: 'Khyber Pakhtunkhwa' },
  { name: 'Lahore', latitude: 31.5204, longitude: 74.3587, city: 'Lahore', region: 'Punjab' },
  { name: 'Peshawar', latitude: 34.0151, longitude: 71.5249, city: 'Peshawar', region: 'Khyber Pakhtunkhwa' },
  { name: 'Karachi', latitude: 24.8607, longitude: 67.0011, city: 'Karachi', region: 'Sindh' },
];

export function matchCuratedPlaces(query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  const scored = CURATED_PLACES.map((place) => {
    const hay = [place.name, ...(place.aliases ?? []), place.city, place.region]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    let score = 0;
    if (place.name.toLowerCase() === q) score = 100;
    else if (place.name.toLowerCase().startsWith(q)) score = 80;
    else if ((place.aliases ?? []).some((a) => a.toLowerCase().startsWith(q))) score = 75;
    else if (hay.includes(q)) score = 50;
    return { place, score };
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ place }) => ({
    name: place.name,
    address: {
      street: '',
      area: '',
      city: place.city ?? place.name,
      region: place.region ?? '',
      postalCode: '',
      country: 'Pakistan',
      formattedAddress: [place.name, place.city, place.region, 'Pakistan']
        .filter((part, i, arr) => part && arr.indexOf(part) === i)
        .join(', '),
    },
    latitude: place.latitude,
    longitude: place.longitude,
    location: {
      type: 'Point' as const,
      coordinates: [place.longitude, place.latitude] as [number, number],
    },
    source: 'curated' as const,
  }));
}
