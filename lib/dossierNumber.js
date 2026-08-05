import { Redis } from '@upstash/redis';

let redisClient = null;
function getRedis() {
  if (redisClient) return redisClient;

  // La variable Upstash/Vercel peut être injectée sous différents noms selon
  // l'intégration (Upstash natif vs ex-Vercel KV) : on essaie les deux.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error('Service de numérotation indisponible (Redis non configuré).');
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

function fallbackNumero() {
  // Repli non séquentiel mais unique, utilisé uniquement si Redis est indisponible :
  // la numérotation d'un dossier ne doit jamais bloquer une inscription.
  const year = new Date().getFullYear();
  return `COL-${year}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

// Attribution atomique et idempotente d'un numéro de dossier (format COL-AAAA-NNN).
// Idempotent par submissionId : un même dossier (même famille, mêmes données)
// ne consomme jamais deux numéros, même si l'endpoint est appelé plusieurs fois
// (double-clic, régénération de la fiche, nouvelle tentative après échec réseau).
//
// Ne lève jamais d'exception : si Redis est indisponible, retourne un numéro de
// repli plutôt que de bloquer la génération de la fiche ou l'envoi du dossier.
export async function assignDossierNumber(submissionId) {
  try {
    const redis = getRedis();
    const mapKey = `dossier:map:${submissionId}`;

    const existing = await redis.get(mapKey);
    if (existing) return existing;

    const year = new Date().getFullYear();
    const seq = await redis.incr(`dossier:counter:${year}`);
    const numero = `COL-${year}-${String(seq).padStart(3, '0')}`;

    // NX : si un appel concurrent a déjà posé le mapping entre le get() et ici,
    // on garde le numéro déjà attribué plutôt que d'en laisser deux en circulation.
    const setOk = await redis.set(mapKey, numero, { nx: true });
    if (!setOk) {
      return (await redis.get(mapKey)) || fallbackNumero();
    }
    return numero;
  } catch (error) {
    return fallbackNumero();
  }
}

export async function getDossierNumber(submissionId) {
  const redis = getRedis();
  return await redis.get(`dossier:map:${submissionId}`);
}
