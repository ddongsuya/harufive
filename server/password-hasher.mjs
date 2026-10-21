import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

// OWASP's scrypt N=2^16,r=8,p=2 profile: 64 MiB, 32-byte result.
// Run exclusively in a SQLite-backed Durable Object (not a 10ms Free Worker).
const PREFIX = 'scrypt-v1$65536$8$2$';
const FORMAT = /^scrypt-v1\$65536\$8\$2\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const OPTIONS = Object.freeze({ N: 65536, r: 8, p: 2, maxmem: 80 * 1024 * 1024 });
// New passwords follow the signup limit; verification accepts the earlier
// maximum so an existing account never loses access after this policy change.
const passwordValid = (value, maximum = 128) => typeof value === 'string' && value.length >= 8 && value.length <= maximum;

export function hashPassword(password) {
  if (!passwordValid(password, 16)) throw new Error('PASSWORD_FORMAT');
  const salt = randomBytes(16);
  const result = scryptSync(password, salt, 32, OPTIONS);
  return `${PREFIX}${salt.toString('hex')}$${result.toString('hex')}`;
}

export function verifyPassword(password, encodedHash) {
  if (!passwordValid(password) || typeof encodedHash !== 'string') return false;
  const match = FORMAT.exec(encodedHash);
  if (!match) return false;
  const result = scryptSync(password, Buffer.from(match[1], 'hex'), 32, OPTIONS);
  return timingSafeEqual(result, Buffer.from(match[2], 'hex'));
}

// No public URL reaches this class. Its namespace is passed only after the
// preview access gate. Storage contains counters only, never credentials.
export class PasswordHasher {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS hash_budget (kind TEXT PRIMARY KEY, period INTEGER NOT NULL, count INTEGER NOT NULL)');
  }

  takeBudget(now) {
    const limits = [['minute', Math.floor(now / 60_000), 60], ['day', Math.floor(now / 86_400_000), 5000]];
    // All SQL and hashing are synchronous. A request cannot interleave here.
    for (const [kind, period, limit] of limits) {
      const row = [...this.sql.exec('SELECT period, count FROM hash_budget WHERE kind = ?', kind)][0];
      if (row?.period === period && row.count >= limit) return false;
    }
    for (const [kind, period] of limits) {
      this.sql.exec(`INSERT INTO hash_budget(kind,period,count) VALUES(?,?,1)
        ON CONFLICT(kind) DO UPDATE SET period=excluded.period,
        count=CASE WHEN hash_budget.period=excluded.period THEN hash_budget.count+1 ELSE 1 END`, kind, period);
    }
    return true;
  }

  async fetch(request) {
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
    try {
      // Bound allocation even if another server-side caller misuses the binding.
      const reader = request.body?.getReader();
      if (!reader) return new Response(null, { status: 400, headers });
      let length = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!data || !passwordValid(data.password, data.action === 'hash' ? 16 : 128) || !['hash', 'verify'].includes(data.action) ||
          (data.action === 'verify' && (typeof data.encodedHash !== 'string' || !FORMAT.test(data.encodedHash)))) {
        return new Response(null, { status: 400, headers });
      }
      if (!this.takeBudget(Date.now())) return new Response(null, { status: 429, headers });
      const result = data.action === 'hash' ? hashPassword(data.password) : verifyPassword(data.password, data.encodedHash);
      return Response.json({ result }, { headers });
    } catch { return new Response(null, { status: 503, headers }); }
  }
}
