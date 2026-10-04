import { createHash, createHmac } from 'node:crypto';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// PUBLIC_INTERFACE
export function argumentDigest(value: unknown): string {
  /** Stable payload identity for durable conflicts; not a public log of arguments. */
  return createHash('sha256').update(canonical(value)).digest('hex');
}

// PUBLIC_INTERFACE
export function auditDigest(value: unknown, key: string): string {
  /** Keyed fingerprint prevents guessing sensitive low-entropy inputs from public audit logs. */
  return createHmac('sha256', key).update(canonical(value)).digest('hex');
}
