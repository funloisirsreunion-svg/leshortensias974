// Client Supabase pour le navigateur (espace-ecole/ et admin/).
// Chargé en ESM directement depuis un CDN pour rester cohérent avec le reste
// du site (aucune étape de build) — même approche que jsPDF dans inscription.js.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let clientPromise = null;

async function fetchConfig() {
  const res = await fetch('/api/public-config');
  if (!res.ok) throw new Error('Impossible de charger la configuration Supabase.');
  return res.json();
}

// Retourne toujours la même instance de client (promesse partagée).
export function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = fetchConfig().then(({ supabaseUrl, supabaseAnonKey, configured }) => {
      if (!configured) {
        throw new Error(
          'La plateforme Supabase n\'est pas encore configurée. Contactez l\'administrateur du site.'
        );
      }
      return createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    });
  }
  return clientPromise;
}
