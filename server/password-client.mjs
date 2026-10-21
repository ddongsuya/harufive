const HASH_FORMAT = /^scrypt-v1\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{64}$/;

export function createPasswordService(namespace) {
  if (typeof namespace?.idFromName !== 'function' || typeof namespace?.get !== 'function') return null;
  async function call(action, password, encodedHash) {
    const stub = namespace.get(namespace.idFromName('harufive-password-budget-v1'));
    const response = await stub.fetch(new Request('https://password-hasher.internal/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, password, ...(action === 'verify' ? { encodedHash } : {}) }),
    }));
    if (!response.ok) throw new Error('PASSWORD_SERVICE_UNAVAILABLE');
    const { result } = await response.json();
    if (action === 'hash' ? (typeof result !== 'string' || !HASH_FORMAT.test(result)) : typeof result !== 'boolean') {
      throw new Error('PASSWORD_SERVICE_UNAVAILABLE');
    }
    return result;
  }
  return Object.freeze({ hash: password => call('hash', password), verify: (password, encodedHash) => call('verify', password, encodedHash) });
}

export async function clientAddressHash(request) {
  // Cloudflare supplies/overwrites this header at its edge. The preview entry
  // must not be deployed behind an untrusted proxy that can supply it itself.
  const address = request.headers.get('CF-Connecting-IP');
  if (!address || address.length > 64 || !/^[0-9a-fA-F:.]+$/.test(address)) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`harufive-local-auth-v1:${address}`));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
