import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';

// Renvoie les infos de compte de l'admin connecté, y compris last_sign_in_at
// (disponible uniquement via l'API admin, pas dans la session côté client).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  let auth;
  try {
    auth = await requireAdmin(req);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(auth.user.id);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    id: auth.user.id,
    email: data.user.email,
    fullName: auth.profile.full_name,
    role: auth.profile.role,
    lastSignInAt: data.user.last_sign_in_at,
    createdAt: data.user.created_at,
  });
}
