import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearDirectionsCache, getDrivingRoute } from '../src/services/directions.service';

const from = { lat: 35.9121, lng: 74.3542 };
const to = { lat: 35.9208, lng: 74.3089 };

const osrmOk = (coordinates: number[][]) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 4874, duration: 301, geometry: { coordinates } }] }), {
      status: 200,
    })
  );

describe('driving directions', () => {
  beforeEach(() => clearDirectionsCache());

  it('returns road km, minutes and a [lat, lng] path, and caches the answer', async () => {
    const fetchStub = osrmOk([
      [74.3542, 35.9121],
      [74.33, 35.915],
      [74.3089, 35.9208],
    ]);
    const route = await getDrivingRoute(from, to, fetchStub as unknown as typeof fetch);
    expect(route).toEqual({
      distanceKm: 4.9,
      durationMin: 5,
      path: [
        [35.9121, 74.3542],
        [35.915, 74.33],
        [35.9208, 74.3089],
      ],
    });
    expect(String((fetchStub.mock.calls[0] as unknown[])[0])).toContain('/route/v1/driving/74.3542,35.9121;74.3089,35.9208');
    // Same trip again (within ~11 m): served from the cache.
    await getDrivingRoute({ lat: 35.91212, lng: 74.35421 }, to, fetchStub as unknown as typeof fetch);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('thins very long paths so responses stay small', async () => {
    const long = Array.from({ length: 5000 }, (_, i) => [74 + i / 10000, 35 + i / 10000]);
    const route = await getDrivingRoute(from, to, osrmOk(long) as unknown as typeof fetch);
    expect(route!.path.length).toBe(400);
    expect(route!.path[0]).toEqual([35, 74]);
    expect(route!.path.at(-1)).toEqual([35.4999, 74.4999]);
  });

  it('returns null (and retries next time) when the routing server is down', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await getDrivingRoute(from, to, down as unknown as typeof fetch)).toBeNull();
    expect(await getDrivingRoute(from, to, down as unknown as typeof fetch)).toBeNull();
    expect(down).toHaveBeenCalledTimes(2);
    const noRoute = vi.fn(async () => new Response(JSON.stringify({ code: 'NoRoute', routes: [] }), { status: 200 }));
    expect(await getDrivingRoute(from, { lat: 0, lng: -30 }, noRoute as unknown as typeof fetch)).toBeNull();
  });

  it('rejects malformed points at the API', async () => {
    const app = createApp();
    for (const bad of ['from=abc&to=1,2', 'from=91,0&to=1,2', 'to=1,2']) {
      const res = await request(app).get(`/api/directions/driving?${bad}`);
      expect(res.status, bad).toBe(422);
    }
  });
});
