// The signature scheme real payment providers use: sign "<timestamp>.<raw body>"
// with a shared secret and send both parts in one header. Kept in its own module
// so importing it cannot start a server.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCE_SECONDS = 300;

export function sign(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

// Returns null when the request really came from the provider, or the reason it did not.
export function verify(rawBody, header, secret) {
  if (!header) return 'no signature header';
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return 'malformed signature header';
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return 'timestamp outside tolerance';
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest();
  let got;
  try { got = Buffer.from(parts.v1, 'hex'); } catch { return 'signature is not hex'; }
  // length first: timingSafeEqual throws when the buffers differ in size
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return 'signature does not match';
  return null;
}
