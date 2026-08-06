const entries = new Map();

export async function cached(key, ttlMilliseconds, loader) {
  const now = Date.now();
  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;

  const promise = Promise.resolve().then(loader);
  entries.set(key, { promise, expiresAt: now + ttlMilliseconds });
  try {
    return await promise;
  } catch (error) {
    if (entries.get(key)?.promise === promise) entries.delete(key);
    throw error;
  }
}

export function invalidateCache(...prefixes) {
  for (const key of entries.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) entries.delete(key);
  }
}
