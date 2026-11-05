import { createHash } from 'node:crypto';
import { Types } from 'mongoose';

export const DEMO_NAMESPACE = 'banjara-demo-catalog-v1';
export const DEMO_CATEGORIES = ['transport', 'hotel', 'tour', 'travelGuide', 'restaurant'] as const;
export type DemoCategory = (typeof DEMO_CATEGORIES)[number];
export type DemoModel = 'User' | 'ProviderProfile' | 'Vehicle' | 'Route' | 'PickupPoint' |
  'Trip' | 'Hotel' | 'Room' | 'RoomAvailability' | 'TourItinerary' | 'ProviderPaymentAccount' | 'ServiceCatalog';
export type DemoRecord = { model: DemoModel; data: Record<string, unknown> & { _id: Types.ObjectId } };
export type DemoImage = 'van' | 'bus' | 'car' | 'suv' | 'hotel' | 'room' | 'familyRoom' |
  'valley' | 'mountain' | 'lake' | 'restaurant' | 'food' | 'foodTwo' |
  'man' | 'manTwo' | 'woman' | 'womanTwo';

export const DEMO_PHOTOS: Record<DemoImage, string> = {
  van: 'photo-1464219789935-c2d9d9aba644',
  bus: 'photo-1570125909232-eb263c188f7e',
  car: 'photo-1549317661-bd32c8ce0db2',
  suv: 'photo-1519641471654-76ce0107ad1b',
  hotel: 'photo-1566073771259-6a8506099945',
  room: 'photo-1611892440504-42a792e24d32',
  familyRoom: 'photo-1590490360182-c33d57733427',
  valley: 'photo-1589802829985-817e51171b92',
  mountain: 'photo-1464822759023-fed622ff2c3b',
  lake: 'photo-1501785888041-af3ef285b470',
  restaurant: 'photo-1517248135467-4c7edcad34c4',
  food: 'photo-1504674900247-0877df9cc836',
  foodTwo: 'photo-1555939594-58d7cb561ad1',
  man: 'photo-1506794778202-cad84cf45f1d',
  manTwo: 'photo-1500648767791-00dcc994a43e',
  woman: 'photo-1494790108377-be9c29b29330',
  womanTwo: 'photo-1534528741775-53994a69daeb',
};

export function demoId(key: string) {
  return new Types.ObjectId(createHash('sha256').update(`${DEMO_NAMESPACE}:${key}`).digest('hex').slice(0, 24));
}

export function pakistanDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function addDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

const places = [
  { city: 'Hunza', area: 'Karimabad', lat: 36.3167, lng: 74.65, region: 'Gilgit-Baltistan' },
  { city: 'Skardu', area: 'Shangrila Road', lat: 35.2971, lng: 75.6333, region: 'Gilgit-Baltistan' },
  { city: 'Gilgit', area: 'Jutial', lat: 35.9208, lng: 74.3089, region: 'Gilgit-Baltistan' },
  { city: 'Islamabad', area: 'F-6 Markaz', lat: 33.7294, lng: 73.0931, region: 'Islamabad Capital Territory' },
];

const origins = [
  { city: 'Islamabad', lat: 33.6844, lng: 73.0479 },
  { city: 'Rawalpindi', lat: 33.5651, lng: 73.0169 },
  { city: 'Gilgit', lat: 35.9208, lng: 74.3089 },
  { city: 'Islamabad', lat: 33.6844, lng: 73.0479 },
];

const businessNames: Record<DemoCategory, string[]> = {
  transport: ['Hunza Valley Transfers', 'Skardu Mountain Coaches', 'Gilgit Scenic Vans', 'Capital North Travel'],
  hotel: ['Hunza Orchard Hotel', 'Skardu Lake Resort', 'Gilgit Riverside Guest House', 'Capital Garden Lodge'],
  tour: ['Hunza Trails', 'Skardu Adventure Tours', 'Gilgit Valley Explorers', 'Capital Mountain Escapes'],
  travelGuide: ['Aamir Valley Guide', 'Sana Skardu Guide', 'Hassan Gilgit Guide', 'Ayesha Heritage Guide'],
  restaurant: ['Hunza Apricot Kitchen', 'Skardu Balti Table', 'Gilgit Riverside Cafe', 'Capital Northern Bites'],
};

export type DemoAccount = { email: string; name: string; category: DemoCategory; userId: string; providerId: string };
export type DemoPlan = { today: string; records: DemoRecord[]; accounts: DemoAccount[] };

/** Pure fixture builder. No database, storage, clock or password side effects. */
export function buildDemoCatalog(options: {
  now: Date;
  passwordHash: string;
  image: (userId: string, folder: string, photo: DemoImage) => string;
}): DemoPlan {
  const today = pakistanDate(options.now);
  const records: DemoRecord[] = [];
  const accounts: DemoAccount[] = [];
  const put = (model: DemoModel, key: string, data: Record<string, unknown>) => {
    const _id = demoId(key);
    records.push({ model, data: { _id, ...data, createdAt: options.now, updatedAt: options.now } });
    return _id;
  };

  const labels = ['Transportation', 'Lodging', 'Tour Operators', 'Guides', 'Restaurants'];
  DEMO_CATEGORIES.forEach((category, index) => put('ServiceCatalog', `service-${category}`, {
    key: category, label: labels[index], description: `${labels[index]} on Banjara`,
    active: true, sortOrder: index + 1, platformFeePercent: 0.2,
  }));

  DEMO_CATEGORIES.forEach((category, categoryIndex) => {
    for (let index = 0; index < 4; index++) {
      const key = `${category}-${index + 1}`;
      const userId = demoId(`user-${key}`);
      const providerId = demoId(`provider-${key}`);
      const place = places[index];
      const email = `demo.${category.toLowerCase()}${index + 1}@banjara.example`;
      const name = `DEMO ${businessNames[category][index]}`;
      const phone = `0300000${1000 + categoryIndex * 4 + index}`;
      const address = `Demo office ${index + 1}, ${place.area}, ${place.city}, Pakistan`;
      const owner = category === 'travelGuide' ? name : `Demo Owner ${categoryIndex + 1} ${index + 1}`;
      const description = `DEMO LISTING — fictional business for Banjara testing. ${businessNames[category][index]} offers friendly service in ${place.city}. Stock photographs are illustrative. Contact details and approval are test data; do not send real money.`;
      const folder = category === 'transport' ? 'vehicles' : category === 'hotel' ? 'hotels' :
        category === 'tour' ? 'tours' : category === 'travelGuide' ? 'guides' : 'restaurants';
      const img = (photo: DemoImage) => options.image(userId.toString(), folder, photo);
      const portraits: DemoImage[] = ['man', 'woman', 'manTwo', 'womanTwo'];
      const gallery: DemoImage[] = category === 'transport' ? [index === 1 ? 'bus' : 'van', 'car', portraits[index]] :
        category === 'hotel' ? ['hotel', 'room', 'familyRoom', 'restaurant'] :
        category === 'tour' ? ['valley', 'mountain', 'lake'] :
        category === 'travelGuide' ? [portraits[index], 'valley', 'mountain'] : ['restaurant', 'food', 'foodTwo'];
      const images = gallery.map(img);
      const profile: Record<string, unknown> = {
        userId, businessName: name, ownerName: owner,
        providerType: [category === 'transport' ? 'travelAgency' : category === 'tour' ? 'tourOperator' : category],
        services: [category], description, phone, email, address, city: place.city,
        structuredAddress: { street: `Demo Street ${index + 1}`, area: place.area, city: place.city,
          region: place.region, country: 'Pakistan', formattedAddress: address },
        location: { type: 'Point', coordinates: [place.lng, place.lat] }, locationUpdatedAt: options.now,
        verificationStatus: 'approved', rating: 0, totalReviews: 0, yearsExperience: 5 + index,
        logo: images[0], website: `https://demo-${key}.example`,
      };

      put('User', `user-${key}`, { name: owner, email, phone, passwordHash: options.passwordHash,
        role: 'provider', status: 'active', avatar: images[0], preferences: { demoSeed: DEMO_NAMESPACE } });
      accounts.push({ email, name, category, userId: userId.toString(), providerId: providerId.toString() });

      // Deliberately non-routable bank fixture: exercises the manual payment UI only.
      put('ProviderPaymentAccount', `account-${key}`, { providerId, channel: 'bank',
        label: 'DEMO - never transfer real funds', accountTitle: 'Demo Travel Account',
        identifier: '0000000000000000', bankName: 'Demo Bank - TEST ONLY',
        instructions: 'TEST DATA ONLY. This is not a real receiving account. Do not transfer money.', active: true });

      if (category === 'transport') {
        const origin = origins[index];
        const destination = index === 3 ? places[2] : place;
        const primaryId = demoId(`vehicle-${key}-shared`);
        const details = {
          businessName: name, vehicleClass: index === 1 ? 'bus' : 'van',
          vehicleTypes: [index === 1 ? 'bus' : 'van', 'car'], vehicleCount: 2, ownershipType: 'owned',
          operatingCities: [origin.city, destination.city],
          operatingRoutes: [`${origin.city} → ${destination.city}`],
          pickupLocations: [`${origin.city} demo terminal`], dropoffLocations: [`${destination.city} demo stop`],
          description, pricingMethod: 'per_seat', priceAmount: 3500 + index * 500, pricePercent: 20,
          ownerName: owner, vehicleModel: index === 1 ? 'Toyota Coaster' : 'Toyota Hiace',
          vehicleMakeYear: '2023', engineNumber: `DEMO-ENGINE-${index + 1}`,
          registrationNumber: `DEMO-${100 + index}`, driverName: `Demo Driver ${index + 1}`,
          driverPhone: phone, driverEmail: email, driverPermanentAddress: address,
          driverCnic: `00000-${String(index + 1).padStart(7, '0')}-0`,
          driverLicenseNumber: `DEMO-LICENCE-${index + 1}`, driverExperienceYears: String(5 + index),
          driverEmergencyContact: phone, hasInsurance: 'yes', insuranceCompany: 'Demo Insurance - Not a real policy',
          insuranceNumber: `DEMO-POLICY-${index + 1}`, insuranceYear: String(options.now.getUTCFullYear()),
          vehicleImageFront: images[0], vehicleImageBack: images[0], driverPhoto: images[2],
        };
        profile.transportDetails = details;
        // Simulated completed review applies only to explicitly labelled local demo accounts.
        profile.identityVerification = { verificationStatus: 'verified', cnicVerified: true,
          cnicNumberMasked: 'DEMO-IDENTITY', fatherNameVerified: true, expiryDateVerified: true,
          informationMatched: true, documentVerificationDate: options.now };
        profile.onboarding = { locationConfirmed: true, transportConfirmed: true,
          vehicleId: primaryId, submittedAt: options.now };
        const seats = index === 1 ? 22 : 14;
        put('Vehicle', `vehicle-${key}-shared`, { providerId, name: `DEMO ${details.vehicleModel}`,
          type: details.vehicleClass, brand: 'Toyota', vehicleModel: details.vehicleModel, year: 2023,
          registrationNumber: details.registrationNumber, seatCount: seats,
          seatConfiguration: { rows: Math.ceil(seats / 4), seatsPerRow: 4, layoutType: '2+2' },
          amenities: ['AC', 'Charging ports', 'Luggage space'], images: [images[0]], status: 'active',
          approvedAt: options.now, registrationCompletedAt: options.now, verificationDetails: details });
        const privateId = put('Vehicle', `vehicle-${key}-private`, { providerId, name: 'DEMO Toyota Corolla private car',
          type: 'car', brand: 'Toyota', vehicleModel: 'Corolla', year: 2022,
          registrationNumber: `DEMO-PRIVATE-${100 + index}`, seatCount: 4,
          amenities: ['AC', 'Private transfer', 'Luggage space'], images: [images[1]], status: 'active',
          approvedAt: options.now, registrationCompletedAt: options.now,
          verificationDetails: { ...details, vehicleClass: 'car', vehicleModel: 'Corolla', vehicleMakeYear: '2022',
            registrationNumber: `DEMO-PRIVATE-${100 + index}`, vehicleImageFront: images[1], vehicleImageBack: images[1] } });
        const routeId = put('Route', `route-${key}`, { providerId,
          origin: { name: origin.city, latitude: origin.lat, longitude: origin.lng },
          destination: { name: destination.city, latitude: destination.lat, longitude: destination.lng },
          stops: index === 2 ? ['Nagar'] : ['Besham', 'Chilas'],
          distance: index === 2 ? 100 : 600, estimatedDuration: index === 2 ? 120 : 960 });
        const pickup = put('PickupPoint', `pickup-${key}`, { providerId, name: `${origin.city} DEMO terminal`,
          description: 'Illustrative demo meeting point. Arrive 30 minutes before departure.',
          address: `${origin.city} demo terminal, Pakistan`, latitude: origin.lat, longitude: origin.lng,
          images: [img('valley')], active: true });
        const dropoff = put('PickupPoint', `dropoff-${key}`, { providerId, name: `${destination.city} DEMO stop`,
          address: `${destination.city} demo stop, Pakistan`, latitude: destination.lat, longitude: destination.lng,
          images: [img('mountain')], active: true });

        [0, 1, 3, 7].forEach((offset, slot) => {
          const departureDate = addDays(today, offset);
          const isPrivate = slot === 3;
          const capacity = isPrivate ? 4 : seats;
          const departureTime = offset === 0 ? '23:50' : '08:00';
          const duration = index === 2 ? 120 : 960;
          const arrival = new Date(`${departureDate}T${departureTime}:00Z`);
          arrival.setUTCMinutes(arrival.getUTCMinutes() + duration);
          put('Trip', `trip-${key}-${today}-${slot}`, { providerId, vehicleId: isPrivate ? privateId : primaryId,
            routeId, origin: origin.city, destination: destination.city,
            originLat: origin.lat, originLng: origin.lng, destinationLat: destination.lat, destinationLng: destination.lng,
            departureDate, departureTime, arrivalDate: arrival.toISOString().slice(0, 10),
            arrivalTime: arrival.toISOString().slice(11, 16), pickupPoints: [pickup], dropoffPoints: [dropoff],
            price: isPrivate ? 24000 + index * 2000 : details.priceAmount + (slot === 2 ? 1500 : 0),
            totalSeats: capacity, availableSeats: capacity, bookedSeats: 0,
            seatLayout: Array.from({ length: capacity }, (_, seat) => ({
              seatNumber: `${String.fromCharCode(65 + Math.floor(seat / 4))}${seat % 4 + 1}`,
              row: Math.floor(seat / 4) + 1, column: seat % 4 + 1, type: 'standard', status: 'available',
            })), amenities: ['AC', 'Luggage space', 'Charging ports'], status: 'scheduled',
            journeyType: slot === 2 ? 'round_trip' : 'one_way',
            ...(slot === 2 ? { returnDate: addDays(departureDate, 3), returnTime: '09:00' } : {}),
            bookingMode: isPrivate ? 'vehicle' : 'seat', description });
        });
      }

      if (category === 'hotel') {
        const type = ['hotel', 'resort', 'guestHouse', 'lodge'][index];
        const price = 6500 + index * 1500;
        profile.providerType = [type];
        profile.hotelDetails = { hotelName: name, hotelType: type, managerName: owner, phone, email, address,
          city: place.city, district: place.city, latitude: place.lat, longitude: place.lng,
          description, checkInTime: '14:00', checkOutTime: '11:00', yearsExperience: 5 + index,
          businessRegistered: 'yes', businessRegistrationNumber: `DEMO-HOTEL-${index + 1}`,
          amenities: ['WiFi', 'Parking', 'Restaurant', 'Hot water'],
          outlookImages: [images[0]], roomImages: images.slice(1, 3), restaurantImages: [images[3]], images };
        const hotelId = put('Hotel', `hotel-${key}`, { providerId, name, description, hotelType: type,
          rating: 0, reviewCount: 0, address, city: place.city, country: 'Pakistan', phone, email,
          location: { type: 'Point', coordinates: [place.lng, place.lat] },
          amenities: ['WiFi', 'Parking', 'Restaurant', 'Hot water', 'Mountain view'], images,
          checkInTime: '14:00', checkOutTime: '11:00', priceFrom: price,
          cancellationPolicy: 'DEMO policy: free cancellation until 24 hours before arrival.',
          status: 'active', approvalStatus: 'approved', isVerified: true });
        ['double', 'family'].forEach((roomType, roomIndex) => {
          const roomId = put('Room', `room-${key}-${roomType}`, { providerId, hotelId,
            name: `DEMO ${roomIndex ? 'Family mountain-view room' : 'Deluxe double room'}`, roomType,
            bedType: roomIndex ? 'Two double beds' : 'King bed', capacity: roomIndex ? 4 : 2,
            size: roomIndex ? 38 : 25, pricePerNight: price + roomIndex * 3500,
            totalRooms: 5, availableRooms: 5, breakfastIncluded: true,
            amenities: ['Private bathroom', 'WiFi', 'Hot water', 'Breakfast'],
            cancellationPolicy: 'DEMO: free cancellation up to 24 hours before check-in.',
            images: [images[roomIndex + 1], images[0]], status: 'active' });
          for (let day = 0; day < 60; day++) {
            const date = addDays(today, day);
            put('RoomAvailability', `availability-${key}-${roomType}-${date}`, {
              roomId, date, totalRooms: 5, availableRooms: 5, bookedRooms: 0, blockedRooms: 0,
            });
          }
        });
      }

      if (category === 'tour') {
        profile.tourDetails = { companyName: name, tourName: `DEMO ${place.city} discovery`, description,
          destination: place.city, duration: '3 days / 2 nights', departureLocation: place.city,
          pickupLocations: [address], price: 22000 + index * 3500, maxParticipants: 12,
          included: ['Local transport', 'Guide', 'Accommodation', 'Breakfast'],
          excluded: ['Flights', 'Personal shopping'], images };
        [3, 5].forEach((days, variant) => put('TourItinerary', `itinerary-${key}-${days}`, {
          providerId, title: `DEMO ${place.city} ${variant ? 'mountain adventure' : 'valley discovery'}`,
          tourType: variant ? 'expedition' : 'trek', summary: `${days}-day demo package around ${place.city}`,
          description, destination: place.city, region: place.region, durationDays: days,
          durationNights: days - 1, difficulty: variant ? 'moderate' : 'easy', maxParticipants: 12,
          pricePerPerson: 22000 + index * 3500 + variant * 14000, currency: 'PKR',
          included: ['Local transfers', 'Guide', 'Breakfast', 'Accommodation'], excluded: ['Flights', 'Personal expenses'],
          days: Array.from({ length: days }, (_, day) => ({ dayNumber: day + 1,
            title: day === 0 ? 'Arrival and orientation' : day === days - 1 ? 'Return and farewell' : `Explore ${place.city}`,
            description: 'Illustrative test itinerary with photo stops, local walks and rest breaks.' })),
          coverImage: images[variant], images, departureLocation: place.city,
          bestSeason: 'Demo availability - confirm real travel conditions separately',
          status: 'published', featured: true, publishedAt: options.now,
        }));
      }

      if (category === 'travelGuide') {
        const services = [4, 8].map((hours, variant) => ({ id: `demo-${key}-${hours}`,
          name: variant ? 'Full-day valley and heritage tour' : 'Half-day culture and food walk',
          category: variant ? 'tour' : 'cultural', description: `${description} English and Urdu guided experience.`,
          durationLabel: `${hours} hours`, durationHours: hours, price: 4000 + index * 1000 + variant * 4000,
          pricingType: 'per_group', currency: 'PKR', minGuests: 1, maxGuests: 6,
          included: ['Guiding', 'Local history', 'Photo stops'], excluded: ['Transport', 'Meals', 'Entry tickets'],
          meetingPoint: address, availableLocations: [place.city], notes: 'DEMO service for app testing.', active: true }));
        profile.guideDetails = { profileStatus: 'approved', fullName: name, profilePhoto: images[0],
          gender: index % 2 ? 'female' : 'male', age: 28 + index * 3, phone, whatsapp: phone, email,
          country: 'Pakistan', province: place.region, district: place.city, city: place.city,
          currentLocation: place.city, areasCovered: [place.city, place.area], pickupLocations: [address],
          guideTypes: ['local', 'cultural', 'hiking'], yearsExperience: 5 + index,
          shortBio: `DEMO guide offering heritage walks and scenic day tours in ${place.city}.`,
          detailedDescription: description, specialSkills: ['Local history', 'Photography stops', 'Route planning'],
          areasOfExpertise: ['Culture', 'Food', 'Easy hikes'], certifications: [], documents: [],
          languages: [{ language: 'Urdu', proficiency: 'native' }, { language: 'English', proficiency: 'fluent' },
            { language: index === 1 ? 'Balti' : 'Shina', proficiency: 'conversational' }],
          photos: images.map((url, photoIndex) => ({ id: `demo-photo-${photoIndex}`, url,
            category: photoIndex ? 'destinations' : 'profile', caption: 'Illustrative stock photograph for demo testing' })),
          services, dailyHireRate: services[1].price,
          availability: { weekly: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .map(day => ({ day, enabled: true, startTime: '08:00', endTime: '18:00' })),
            minBookingHours: 1, maxBookingHours: 10, advanceBookingHours: 0,
            availableFrom: today, availableUntil: addDays(today, 90), blockedDates: [] } };
      }

      if (category === 'restaurant') {
        profile.restaurantDetails = { restaurantName: name, cuisineTypes: ['Pakistani', 'Northern cuisine'],
          menuVariety: ['Chapshuro', 'Dumplings', 'Grilled trout', 'Chicken karahi', 'Vegetable rice', 'Apricot dessert'],
          city: place.city, address, phone, description, images, hours: '10:00 AM - 10:00 PM daily (demo)',
          latitude: place.lat, longitude: place.lng,
          offers: [{ id: `demo-${key}-family`, title: 'DEMO family meal offer', type: 'discount',
            discountPercent: 15, description: 'Illustrative 15% discount on a family meal. Not redeemable.', active: true },
          { id: `demo-${key}-lunch`, title: 'DEMO lunch special', type: 'offer',
            description: 'Sample lunch selection with tea. Test listing only.', active: true }] };
      }
      put('ProviderProfile', `provider-${key}`, profile);
    }
  });
  return { today, records, accounts };
}
