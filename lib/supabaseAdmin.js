// Client Supabase côté serveur (clé service_role — ne jamais exposer au navigateur).
// Utilisé uniquement par les fonctions dans /api/admin/*.js pour des opérations
// qui doivent contourner RLS (ex : création de compte enseignant).
import { createClient } from '@supabase/supabase-js';

let adminClient = null;

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants côté serveur.');
  }

  if (!adminClient) {
    adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}
