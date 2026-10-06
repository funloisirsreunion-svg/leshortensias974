import { getSupabaseAdmin } from './supabaseAdmin.js';

// Vérifie que la requête porte un jeton Supabase valide ET que le profil
// associé est un compte interne ACTIF (role = 'admin', staff_active). À utiliser
// en première ligne de chaque fonction dans /api/admin/*.js qui a besoin de la
// clé service_role (donc qui contourne RLS) — les droits fins se vérifient
// ensuite avec requirePermission / hasPermission (jamais d'après l'e-mail).
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

  let { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, email, staff_role, staff_active')
    .eq('id', userData.user.id)
    .single();
  // Base pas encore migrée (0023 : rôles internes) : comportement historique,
  // tout compte admin garde un accès total.
  let legacy = false;
  if (profileError && /staff_role|staff_active/.test(profileError.message || '')) {
    ({ data: profile, error: profileError } = await supabaseAdmin
      .from('profiles').select('id, role, full_name, email').eq('id', userData.user.id).single());
    legacy = true;
  }

  if (profileError || !profile || profile.role !== 'admin' || profile.staff_active === false) {
    const err = new Error('Accès réservé à l\'administration.');
    err.status = 403;
    throw err;
  }

  let permissions = legacy ? ['*'] : [];
  if (!legacy && profile.staff_role) {
    const { data: rows } = await supabaseAdmin
      .from('role_permissions').select('permission').eq('role_code', profile.staff_role);
    permissions = (rows || []).map(r => r.permission);
  }

  return { user: userData.user, profile, permissions };
}

export function hasPermission(auth, permission) {
  return !!auth && (auth.permissions.includes('*') || auth.permissions.includes(permission));
}

// Exige au moins une des permissions données.
export async function requirePermission(req, ...anyOf) {
  const auth = await requireAdmin(req);
  if (!anyOf.some(p => hasPermission(auth, p))) {
    const err = new Error('Votre rôle ne permet pas cette action.');
    err.status = 403;
    throw err;
  }
  return auth;
}

// Permission requise pour une action sur un dossier selon son type.
export function dossierPermission(clientType, action) {
  if (clientType === 'group') return `groups.${action}`;
  if (clientType === 'colony') return action === 'read' ? 'colonies.read' : 'colonies.manage';
  return `classes.${action}`;
}
