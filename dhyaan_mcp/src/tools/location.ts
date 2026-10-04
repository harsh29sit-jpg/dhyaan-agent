import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { MapsTransport } from '../adapters/google-maps.js';
import { ToolError } from '../lib/errors.js';
import { ownedEvent, transaction } from './ownership.js';

// PUBLIC_INTERFACE
export async function nearbyPharmacies(pool: pg.Pool, bot: string, args: Record<string, unknown>, maps: MapsTransport) {
  /** Resolve current same-event consent, return candidates only, and purge search coordinates on success or failure. */
  let resolved = false;
  try {
    return await transaction(pool, async client => {
      const event = await ownedEvent(client, bot, args);
      const found = await client.query(`SELECT latitude,longitude,expires_at FROM telegram_locations
        WHERE location_ref=$1 AND bot_id=$2 AND sender_id=$3 AND chat_id=$4 AND update_id=$5
        AND NOT revoked AND expires_at>now() AND latitude IS NOT NULL AND longitude IS NOT NULL FOR UPDATE`,
      [args.location_ref, bot, event.sender_id, event.chat_id, event.update_id]);
      if (!found.rowCount || event.location_ref !== args.location_ref) throw new ToolError('LOCATION_UNAVAILABLE', 'Current purpose-bound location share required');
      resolved = true;
      const location = found.rows[0];
      const candidates = await maps.nearby(location.latitude, location.longitude, Number(args.radius_m), Number(args.limit));
      const lookup = randomUUID();
      // No raw response, address, or coordinate cache. Only IDs usable for a timely local selection.
      await client.query(`INSERT INTO pharmacy_lookups
        (lookup_ref,bot_id,sender_id,chat_id,source_update_id,place_ids,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [lookup, bot, event.sender_id, event.chat_id, event.update_id, candidates.map(p => p.place_id), location.expires_at]);
      await client.query('UPDATE telegram_locations SET latitude=NULL,longitude=NULL WHERE location_ref=$1', [args.location_ref]);
      return { lookup_ref: lookup, candidates, stock_verified: false, fulfillment_verified: false };
    });
  } finally {
    // Also purge after provider failure; a failed read cannot silently extend consent.
    if (resolved) await pool.query(`UPDATE telegram_locations SET latitude=NULL,longitude=NULL
      WHERE location_ref=$1 AND bot_id=$2`, [args.location_ref, bot]);
  }
}
