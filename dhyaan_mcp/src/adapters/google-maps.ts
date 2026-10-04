import { z } from 'zod';
import type { Config } from '../config.js';
import { ToolError } from '../lib/errors.js';
import { upstreamRequest } from '../lib/http.js';

const position = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) });
const place = z.object({
  id: z.string().min(1).max(160), displayName: z.object({ text: z.string().min(1).max(500) }),
  formattedAddress: z.string().max(1000), location: position,
  googleMapsUri: z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['maps.google.com', 'www.google.com', 'maps.app.goo.gl'].includes(url.hostname);
  }),
  attributions: z.array(z.object({ provider: z.string().max(500).optional(),
    providerUri: z.string().url().max(2048).refine(value => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    }).optional() })).max(20).optional()
});
export interface PharmacyCandidate {
  place_id: string; name: string; address: string; maps_link: string;
  approximate_straight_line_m: number; attribution: unknown;
}
export interface MapsTransport {
  nearby(latitude: number, longitude: number, radius: number, limit: number): Promise<PharmacyCandidate[]>;
}

// PUBLIC_INTERFACE
export function distanceMeters(a: number, b: number, c: number, d: number): number {
  /** Compute approximate great-circle distance, not driving distance or a route estimate. */
  const rad = Math.PI / 180;
  const h = Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

// PUBLIC_INTERFACE
export function googleMapsTransport(config: Config): MapsTransport {
  /** Use pharmacy-only Places API (New); no consent resolution or ordering occurs inside the adapter. */
  if (!config.services.maps.configured || !config.services.maps.enabled) throw new ToolError('NOT_CONFIGURED', 'Maps is disabled');
  return {
    async nearby(latitude, longitude, radius, limit) {
      position.parse({ latitude, longitude });
      z.number().int().min(100).max(10000).parse(radius);
      z.number().int().min(1).max(20).parse(limit);
      let response;
      try {
        response = await upstreamRequest(new URL('https://places.googleapis.com/v1/places:searchNearby'), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.maps.key!,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions' },
          body: JSON.stringify({ includedTypes: ['pharmacy'], rankPreference: 'DISTANCE', maxResultCount: limit,
            locationRestriction: { circle: { center: { latitude, longitude }, radius } } })
        }, config.upstreamTimeoutMs);
      } catch {
        // This fixed POST is a read. Generic POST action uncertainty remains unchanged.
        throw new ToolError('UPSTREAM_ERROR', 'Pharmacy search failed');
      }
      if (response.status === 429) throw new ToolError('RATE_LIMITED', 'Maps quota unavailable');
      if (response.status !== 200) throw new ToolError('UPSTREAM_ERROR', 'Pharmacy search rejected');
      let parsed;
      try { parsed = z.object({ places: z.array(place).max(20).default([]) }).strict().parse(JSON.parse(response.bytes.toString())); }
      catch { throw new ToolError('UPSTREAM_ERROR', 'Malformed pharmacy response'); }
      return parsed.places.map(p => ({
        place_id: p.id, name: p.displayName.text, address: p.formattedAddress, maps_link: p.googleMapsUri,
        approximate_straight_line_m: Math.round(distanceMeters(latitude, longitude, p.location.latitude, p.location.longitude)),
        attribution: { google: 'Google Maps', providers: p.attributions ?? [] }
      })).filter(p => p.approximate_straight_line_m <= radius)
        .sort((a, b) => a.approximate_straight_line_m - b.approximate_straight_line_m || a.place_id.localeCompare(b.place_id));
    }
  };
}
