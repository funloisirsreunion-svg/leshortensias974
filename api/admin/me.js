import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin, hasPermission } from '../../lib/requireAdmin.js';
import { buildStaffInviteSubject, buildStaffInviteHtml } from '../../lib/staffInviteEmail.js';

// GET  /api/admin/me                 → compte connecté (+ rôle et permissions).
// GET  /api/admin/me?scope=staff     → liste des utilisateurs internes (users.manage).
// POST /api/admin/me?scope=staff     → { action: invite | set_role | deactivate | reactivate | resend, ... }
//
// La gestion des utilisateurs internes est regroupée ici pour rester sous la
// limite de 12 fonctions serverless du plan Vercel Hobby. Les droits viennent
// TOUJOURS du rôle du profil (role_permissions), jamais de l'adresse e-mail.

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function siteUrl() {
  return process.env.SITE_URL || 'https://leshortensias974.fr';
}
function fail(res, status, error) {
  return res.status(status).json({ error });
}

async function findUserByEmail(supabaseAdmin, email) {
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => (u.email || '').toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function sendMail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, error: 'RESEND_API_KEY non configuré.' };
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM
      || (process.env.RESEND_EMAIL_DOMAIN ? `Fun Loisirs Réunion <inscriptions@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Fun Loisirs Réunion <onboarding@resend.dev>');
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return { sent: true, error: null };
  } catch (error) {
    return { sent: false, error: error.message };
  }
}

// Lien sécurisé à usage unique : la personne choisit elle-même son mot de passe
// (aucun mot de passe généré, stocké ou transmis par nous).
async function sendInviteLink(supabaseAdmin, { email, name, roleLabel, isNewUser }) {
  const { data: generated, error } = await supabaseAdmin.auth.admin.generateLink({
    type: isNewUser ? 'invite' : 'recovery',
    email,
    options: isNewUser ? { data: { full_name: name } } : undefined,
  });
  if (error || !generated?.properties?.hashed_token) {
    throw new Error('Impossible de générer le lien d\'accès : ' + (error?.message || 'inconnu'));
  }
  const type = isNewUser ? 'invite' : 'recovery';
  const link = `${siteUrl()}/reinitialiser-mot-de-passe.html?token_hash=${encodeURIComponent(generated.properties.hashed_token)}&type=${type}`;
  const mail = await sendMail({ to: email, subject: buildStaffInviteSubject(), html: buildStaffInviteHtml({ name, roleLabel, link }) });
  return { userId: generated.user?.id || null, mail };
}

async function listStaff(supabaseAdmin) {
  const [{ data: profiles, error }, { data: roles }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, full_name, email, staff_role, staff_active, staff_deactivated_at, staff_invited_at, created_at').eq('role', 'admin').order('created_at'),
    supabaseAdmin.from('staff_roles').select('code, label, description, sort_order').order('sort_order'),
  ]);
  if (error) throw error;
  const users = await Promise.all((profiles || []).map(async (p) => {
    const { data } = await supabaseAdmin.auth.admin.getUserById(p.id);
    const u = data?.user;
    return {
      ...p,
      last_sign_in_at: u?.last_sign_in_at || null,
      banned: !!(u?.banned_until && new Date(u.banned_until) > new Date()),
      pending_invite: !u?.last_sign_in_at,
    };
  }));
  return { users, roles: roles || [] };
}

async function handleStaff(req, res, auth) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!hasPermission(auth, 'users.manage')) return fail(res, 403, 'Gestion des utilisateurs internes réservée au Super Admin.');

  if (req.method === 'GET') {
    try { return res.status(200).json(await listStaff(supabaseAdmin)); }
    catch (error) { return fail(res, 500, error.message); }
  }

  const { action, userId, email, fullName, role } = req.body || {};
  const { data: roleRow } = role
    ? await supabaseAdmin.from('staff_roles').select('code, label').eq('code', role).maybeSingle()
    : { data: null };

  if (action === 'invite') {
    if (!isValidEmail(email)) return fail(res, 400, 'Adresse e-mail invalide.');
    if (!roleRow) return fail(res, 400, 'Rôle inconnu.');
    if (!hasPermission(auth, 'roles.manage')) return fail(res, 403, 'Attribution des rôles réservée au Super Admin.');
    const name = String(fullName || '').trim() || null;
    const normalizedEmail = email.trim().toLowerCase();

    let existing;
    try { existing = await findUserByEmail(supabaseAdmin, normalizedEmail); }
    catch (error) { return fail(res, 500, 'Recherche du compte impossible : ' + error.message); }

    if (existing) {
      // Jamais de doublon Auth. Un compte CLIENT rattaché à des séjours n'est pas
      // converti automatiquement (il perdrait son espace client) : décision manuelle.
      const { data: prof } = await supabaseAdmin.from('profiles').select('id, role, full_name').eq('id', existing.id).maybeSingle();
      if (prof && prof.role === 'client') {
        const { count } = await supabaseAdmin.from('dossier_acces').select('id', { count: 'exact', head: true }).eq('profile_id', existing.id);
        if (count) {
          return fail(res, 409, `Cette adresse est déjà un compte CLIENT rattaché à ${count} dossier(s). Utilisez une autre adresse pour l'accès interne, ou retirez d'abord ses accès client.`);
        }
      }
      if (prof && prof.role === 'admin') {
        return fail(res, 409, 'Cette adresse est déjà un compte interne : modifiez son rôle dans la liste.');
      }
      const { error: upErr } = await supabaseAdmin.from('profiles').upsert({
        id: existing.id, role: 'admin', staff_role: roleRow.code, staff_active: true,
        full_name: name || prof?.full_name || null, email: normalizedEmail,
        staff_invited_at: new Date().toISOString(), must_change_password: false,
      });
      if (upErr) return fail(res, 500, upErr.message);
      let mail = { sent: false, error: null };
      if (!existing.last_sign_in_at) {
        try { mail = (await sendInviteLink(supabaseAdmin, { email: normalizedEmail, name, roleLabel: roleRow.label, isNewUser: false })).mail; }
        catch (error) { mail = { sent: false, error: error.message }; }
      }
      return res.status(200).json({ ok: true, existingAccount: true, userId: existing.id, emailSent: mail.sent, emailError: mail.error });
    }

    let result;
    try { result = await sendInviteLink(supabaseAdmin, { email: normalizedEmail, name, roleLabel: roleRow.label, isNewUser: true }); }
    catch (error) { return fail(res, 500, error.message); }
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert({
      id: result.userId, role: 'admin', staff_role: roleRow.code, staff_active: true,
      full_name: name, email: normalizedEmail, staff_invited_at: new Date().toISOString(),
    });
    if (profErr) return fail(res, 500, 'Compte créé mais profil non enregistré : ' + profErr.message);
    return res.status(201).json({ ok: true, existingAccount: false, userId: result.userId, emailSent: result.mail.sent, emailError: result.mail.error });
  }

  // Actions sur un compte interne existant
  if (!userId || typeof userId !== 'string') return fail(res, 400, 'userId manquant.');
  if (userId === auth.user.id) return fail(res, 403, 'Vous ne pouvez pas modifier votre propre rôle ou statut.');
  const { data: target } = await supabaseAdmin.from('profiles').select('id, role, email, full_name, staff_role').eq('id', userId).maybeSingle();
  if (!target || target.role !== 'admin') return fail(res, 404, 'Utilisateur interne introuvable.');

  if (action === 'set_role') {
    if (!hasPermission(auth, 'roles.manage')) return fail(res, 403, 'Attribution des rôles réservée au Super Admin.');
    if (!roleRow) return fail(res, 400, 'Rôle inconnu.');
    const { error } = await supabaseAdmin.from('profiles').update({ staff_role: roleRow.code }).eq('id', userId);
    if (error) return fail(res, 500, error.message);
    return res.status(200).json({ ok: true });
  }
  if (action === 'deactivate' || action === 'reactivate') {
    const active = action === 'reactivate';
    // Double verrou : connexion bloquée (Auth) + droits coupés en base (staff_active).
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '87600h' });
    if (banErr) return fail(res, 500, banErr.message);
    const { error } = await supabaseAdmin.from('profiles')
      .update({ staff_active: active, staff_deactivated_at: active ? null : new Date().toISOString() }).eq('id', userId);
    if (error) return fail(res, 500, error.message);
    return res.status(200).json({ ok: true });
  }
  if (action === 'resend') {
    const { data: roleInfo } = await supabaseAdmin.from('staff_roles').select('label').eq('code', target.staff_role).maybeSingle();
    try {
      const { mail } = await sendInviteLink(supabaseAdmin, { email: target.email, name: target.full_name, roleLabel: roleInfo?.label || '', isNewUser: false });
      await supabaseAdmin.from('profiles').update({ staff_invited_at: new Date().toISOString() }).eq('id', userId);
      return res.status(200).json({ ok: true, emailSent: mail.sent, emailError: mail.error });
    } catch (error) {
      return fail(res, 500, error.message);
    }
  }
  return fail(res, 400, 'Action inconnue.');
}

export default async function handler(req, res) {
  let auth;
  try {
    auth = await requireAdmin(req);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  if ((req.query && req.query.scope) === 'staff') {
    if (!['GET', 'POST'].includes(req.method)) return fail(res, 405, 'Méthode non autorisée.');
    return handleStaff(req, res, auth);
  }

  if (req.method !== 'GET') {
    return fail(res, 405, 'Méthode non autorisée.');
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(auth.user.id);
  if (error) return res.status(500).json({ error: error.message });
  const { data: roleInfo } = auth.profile.staff_role
    ? await supabaseAdmin.from('staff_roles').select('label').eq('code', auth.profile.staff_role).maybeSingle()
    : { data: null };

  return res.status(200).json({
    id: auth.user.id,
    email: data.user.email,
    fullName: auth.profile.full_name,
    role: auth.profile.role,
    staffRole: auth.profile.staff_role,
    staffRoleLabel: roleInfo?.label || null,
    permissions: auth.permissions,
    lastSignInAt: data.user.last_sign_in_at,
    createdAt: data.user.created_at,
  });
}
