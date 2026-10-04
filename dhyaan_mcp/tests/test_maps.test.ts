import { afterEach, describe, expect, it, vi } from 'vitest';
import { distanceMeters, googleMapsTransport } from '../src/adapters/google-maps.js';
import { config, providerEnv } from './test_offline_support.js';

const place = (id: string, latitude = 12.001) => ({
  id, displayName: { text: 'Synthetic pharmacy' }, formattedAddress: 'Synthetic address',
  location: { latitude, longitude: 77 }, googleMapsUri: 'https://maps.google.com/?cid=123',
  attributions: [{ provider: 'Synthetic attribution', providerUri: 'https://provider.example.test' }]
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent Maps offline contract', () => {
  it('uses minimal fixed pharmacy-only DISTANCE request and preserves attribution', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      places: [place('z'), place('outside', 13), place('a'), place('closer', 12)]
    })));
    vi.stubGlobal('fetch', fetch);
    const candidates = await googleMapsTransport(config).nearby(12, 77, 3000, 5);
    expect(candidates.map(p => p.place_id)).toEqual(['closer', 'a', 'z']);
    expect(candidates[0]).toEqual({
      place_id: 'closer', name: 'Synthetic pharmacy', address: 'Synthetic address',
      maps_link: 'https://maps.google.com/?cid=123', approximate_straight_line_m: 0,
      attribution: { google: 'Google Maps', providers: place('closer').attributions }
    });
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(options.headers).toEqual({
      'Content-Type': 'application/json', 'X-Goog-Api-Key': providerEnv.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions'
    });
    expect(JSON.parse(options.body)).toEqual({
      includedTypes: ['pharmacy'], rankPreference: 'DISTANCE', maxResultCount: 5,
      locationRestriction: { circle: { center: { latitude: 12, longitude: 77 }, radius: 3000 } }
    });
    expect(JSON.stringify(candidates)).not.toMatch(/stock|openingHours|route|rating|phone/);
  });

  it.each([[91, 77, 100, 1], [12, 181, 100, 1], [NaN, 77, 100, 1],
    [12, 77, 99, 1], [12, 77, 10001, 1], [12, 77, 100, 0], [12, 77, 100, 21]])(
    'rejects invalid lookup input before fetch (%#)', async (lat, lon, radius, limit) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(googleMapsTransport(config).nearby(lat, lon, radius, limit)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('accepts boundary radius/count and distinguishes empty success from quota and authentication failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{"places":[]}'))
      .mockResolvedValueOnce(new Response('private quota body', { status: 429 }))
      .mockResolvedValueOnce(new Response('private auth body', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    const maps = googleMapsTransport(config);
    expect(await maps.nearby(-90, -180, 100, 1)).toEqual([]);
    expect(await maps.nearby(90, 180, 10000, 20)).toEqual([]);
    await expect(maps.nearby(12, 77, 3000, 5)).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'Maps quota unavailable' });
    await expect(maps.nearby(12, 77, 3000, 5)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Pharmacy search rejected' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([
    { places: null }, { places: [place('bad', 91)] },
    { places: [{ ...place('bad'), googleMapsUri: 'https://attacker.test/maps' }] },
    { places: [{ ...place('bad'), googleMapsUri: 'https://user:secret@maps.google.com/' }] },
    { places: [{ ...place('bad'), attributions: [{ providerUri: 'http://provider.example.test' }] }] },
    { places: Array.from({ length: 21 }, (_, i) => place(String(i))) },
    { error: { message: 'private provider error' } }
  ])('rejects malformed/hostile response rather than reporting empty results (%#)', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(googleMapsTransport(config).nearby(12, 77, 3000, 5))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Malformed pharmacy response' });
  });

  it('classifies a failed Places POST as a read without retry or sensitive exception leakage', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('private coordinates and key'));
    vi.stubGlobal('fetch', fetch);
    await expect(googleMapsTransport(config).nearby(12, 77, 3000, 5))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Pharmacy search failed' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('computes approximate great-circle distance including antimeridian cases', () => {
    expect(distanceMeters(12, 77, 12, 77)).toBe(0);
    expect(distanceMeters(0, 0, 1, 0)).toBeCloseTo(111194.9266, 3);
    expect(distanceMeters(0, 179, 0, -179)).toBeCloseTo(222389.8533, 3);
  });
});
