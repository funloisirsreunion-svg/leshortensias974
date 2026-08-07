import { Redis } from '@upstash/redis';

let redisClient = null;
function getRedis() {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error('Service de numérotation indisponible (Redis non configuré).');
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

function fallbackNumero() {
  const year = new Date().getFullYear();
  return `GRP-${year}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

// Numérotation des dossiers "groupe indépendant" : GRP-AAAA-NNN.
// Compteur Redis distinct de ceux des colonies (dossier:counter:*) et des
// classes découverte (cls-dossier:counter:*).
export async function assignGrpNumber() {
  try {
    const redis = getRedis();
    const year = new Date().getFullYear();
    const seq = await redis.incr(`grp-dossier:counter:${year}`);
    return `GRP-${year}-${String(seq).padStart(3, '0')}`;
  } catch (error) {
    return fallbackNumero();
  }
}
