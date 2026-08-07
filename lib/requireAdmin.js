import { getSupabaseAdmin } from './supabaseAdmin.js';

// Vérifie que la requête porte un jeton Supabase valide ET que le profil
// associé a le rôle 'admin'. À utiliser en première ligne de chaque fonction
// dans /api/admin/*.js qui a besoin de la clé service_role (donc qui contourne RLS).
export async function requireAdmin(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    const err = new Error('Authentification requise.');
    err.status = 401;
    throw err;
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    const err = new Error('Session invalide ou expirée. Merci de vous reconnecter.');
    err.status = 401;
    throw err;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile || profile.role !== 'admin') {
    const err = new Error('Accès réservé à l\'administrateur.');
    err.status = 403;
    throw err;
  }

  return { user: userData.user, profile };
}
