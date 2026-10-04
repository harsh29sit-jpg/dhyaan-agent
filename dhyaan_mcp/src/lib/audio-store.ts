import { createHash, createHmac, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '../config.js';
import { ToolError } from './errors.js';
import { upstreamRequest } from './http.js';
import type { OwnedEvent } from '../tools/ownership.js';

export interface AudioObjectStore {
  put(key: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();

// PUBLIC_INTERFACE
export function privateObjectStore(config: Config): AudioObjectStore {
  /** Sign private path-style S3 requests; never create public ACLs or return signed URLs. */
  if (!config.services.audio.configured) throw new ToolError('NOT_CONFIGURED', 'Private audio storage unavailable');
  async function request(method: string, key: string, bytes: Buffer = Buffer.alloc(0), mediaType = 'application/octet-stream') {
    if (!/^dhyaan-audio\/[0-9a-f-]{36}$/.test(key)) throw new ToolError('INVALID_ARGUMENT', 'Invalid private audio key');
    const url = new URL(`/${config.audio.bucket}/${key}`, config.audio.endpoint);
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = timestamp.slice(0, 8), payloadHash = hash(bytes);
    const headers = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
    const names = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = `${method}\n${url.pathname}\n\n${headers}\n${names}\n${payloadHash}`;
    const scope = `${day}/${config.audio.region}/s3/aws4_request`;
    const signing = hmac(hmac(hmac(hmac(`AWS4${config.audio.secretKey}`, day), config.audio.region!), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signing).update(`AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).digest('hex');
    const response = await upstreamRequest(url, { method, headers: {
      'x-amz-date': timestamp, 'x-amz-content-sha256': payloadHash, 'Content-Type': mediaType,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.audio.accessKey}/${scope}, SignedHeaders=${names}, Signature=${signature}`
    }, body: method === 'PUT' ? new Uint8Array(bytes) : undefined }, config.upstreamTimeoutMs, 10 * 1024 * 1024);
    if (response.status < 200 || response.status >= 300) throw new ToolError('UPSTREAM_ERROR', 'Private audio storage failed');
    return response.bytes;
  }
  return {
    async put(key, bytes, mediaType) { await request('PUT', key, bytes, mediaType); },
    async get(key) { return request('GET', key); },
    async remove(key) { await request('DELETE', key); }
  };
}

export interface AudioReference {
  audio_ref: string; file_id: string | null; object_key: string | null;
  duration_seconds: number | null; media_type: string;
}

// PUBLIC_INTERFACE
export async function resolveAudio(client: pg.PoolClient, event: OwnedEvent, ref: string): Promise<AudioReference> {
  /** Resolve only a current owner-bound private reference from the same claimed source event. */
  const result = await client.query(`SELECT audio_ref,file_id,object_key,duration_seconds,media_type FROM private_audio
    WHERE audio_ref=$1 AND bot_id=$2 AND sender_id=$3 AND chat_id=$4 AND source_update_id=$5 AND expires_at>now()`,
  [ref, event.bot_id, event.sender_id, event.chat_id, event.update_id]);
  if (!result.rowCount) throw new ToolError('UNAUTHORIZED', 'Audio reference unavailable or expired');
  return result.rows[0] as AudioReference;
}

// PUBLIC_INTERFACE
export async function saveAudio(client: pg.PoolClient, event: OwnedEvent, bytes: Buffer, store: AudioObjectStore) {
  /** Store bounded binary WAV privately and issue a one-hour opaque reference; cleanup is separately verified at activation. */
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RIFF' ||
      bytes.subarray(8, 12).toString() !== 'WAVE') throw new ToolError('UPSTREAM_ERROR', 'Unsupported synthesized audio');
  const ref = randomUUID(), key = `dhyaan-audio/${ref}`;
  await store.put(key, bytes, 'audio/wav');
  await client.query(`INSERT INTO private_audio
    (audio_ref,bot_id,sender_id,chat_id,source_update_id,object_key,media_type,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,'audio/wav',now()+interval '1 hour')`,
  [ref, event.bot_id, event.sender_id, event.chat_id, event.update_id, key]);
  return { audio_ref: ref, expires_in_seconds: 3600 };
}
