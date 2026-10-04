import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from './errors.js';

export interface MimePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string };
  parts?: MimePart[];
}

function decodeBase64Url(data: string): string {
  if (data.length > 1400000 || !/^[A-Za-z0-9_-]*={0,2}$/.test(data)) {
    throw new ToolError('INVALID_ARGUMENT', 'Invalid or oversized MIME data');
  }
  return Buffer.from(data, 'base64url').toString('utf8');
}

// PUBLIC_INTERFACE
export function decodePlainText(payload: MimePart, maxBytes = 100000): string {
  /** Extract plain text only; do not execute HTML, download attachments, or treat mail as instructions. */
  const texts: string[] = [];
  let nodes = 0, bytes = 0;
  const visit = (part: MimePart, depth: number) => {
    if (++nodes > 100 || depth > 20) throw new ToolError('INVALID_ARGUMENT', 'MIME tree exceeds bounds');
    if (part.filename || part.body?.attachmentId) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      const text = decodeBase64Url(part.body.data);
      bytes += Buffer.byteLength(text);
      if (bytes > maxBytes) throw new ToolError('INVALID_ARGUMENT', 'Message text exceeds bound');
      texts.push(text);
    }
    if (part.mimeType === 'multipart/alternative') {
      // Prefer one plain-text branch, avoiding duplicate HTML/plain representations.
      const plain = part.parts?.find(child => child.mimeType === 'text/plain');
      if (plain) { visit(plain, depth + 1); return; }
    }
    for (const child of part.parts ?? []) visit(child, depth + 1);
  };
  visit(payload, 0);
  return texts.join('\n');
}

// PUBLIC_INTERFACE
export function composeMail(input: { to: string; subject: string; bodyText: string; operationKey: string; messageDomain: string }) {
  /** Compose RFC mail with a deterministic Message-ID for Sent reconciliation, never exactly-once delivery. */
  z.string().email().max(254).parse(input.to);
  z.string().min(1).max(998).regex(/^[^\r\n]*$/).parse(input.subject);
  z.string().min(1).max(8000).parse(input.bodyText);
  z.string().min(1).max(160).parse(input.operationKey);
  z.string().max(253).regex(/^[a-zA-Z0-9.-]+$/).parse(input.messageDomain);
  const digest = createHash('sha256').update(input.operationKey).digest('hex');
  const messageId = `<dhyaan.${digest}@${input.messageDomain}>`;
  // Encode all subjects to avoid interpreting unicode/control text as RFC header syntax.
  const subject = Buffer.from(input.subject).toString('base64');
  const encodedBody = Buffer.from(input.bodyText).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  const mime = [`To: ${input.to}`, `Subject: =?UTF-8?B?${subject}?=`, `Message-ID: ${messageId}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
    '', encodedBody].join('\r\n');
  return { raw: Buffer.from(mime).toString('base64url'), messageId };
}
