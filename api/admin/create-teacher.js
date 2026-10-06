import { randomInt } from 'node:crypto';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requirePermission, hasPermission } from '../../lib/requireAdmin.js';
import {
  buildNewDossierLinkedSubject, buildNewDossierLinkedHtml,
  buildCredentialsSubject, buildCredentialsHtml,
} from '../../lib/teacherInviteEmail.js';

// Crée (ou raccroche) un accès client pour un dossier donné.
// Nouveau compte : compte Supabase Auth (identifiant = e-mail) + mot de passe
// provisoire aléatoire envoyé par e-mail, à remplacer obligatoirement à la
// première connexion (profiles.must_change_password, appliqué en RLS). Le mot
// de passe n'est jamais stocké dans les tables applicatives.
// Compte existant et activé : AUCUN nouveau mot de passe, le dossier est
// simplement rattaché (dossier_acces) et le client prévenu.
// Compte existant jamais activé (mot de passe provisoire jamais remplacé) :
// nouveau mot de passe provisoire (l'ancien devient inutilisable).
// Un même e-mail n'est jamais dupliqué.

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function siteUrl() {
  return process.env.SITE_URL || 'https://leshortensias974.fr';
}

// Mot de passe provisoire : 12 caractères tirés avec un générateur cryptographique,
// sans caractères ambigus (0/O, 1/l/I), avec au moins une majuscule, une minuscule,
// un chiffre et un symbole simple.
export function generateTemporaryPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '-_!?'];
  const all = sets.join('');
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function findUserByEmail(supabaseAdmin, email) {
  // L'API admin de Supabase (JS) ne permet pas de filtrer par e-mail côté serveur ;
  // à l'échelle de ce site (quelques dizaines/centaines de comptes), une pagination
  // simple suffit largement.
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  let auth;
  try {
    auth = await requirePermission(req, 'clients.invite');
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const { dossierId, email, fullName } = req.body || {};
  if (!dossierId || typeof dossierId !== 'string') {
    return res.status(400).json({ error: 'dossierId manquant.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const supabaseAdmin = getSupabaseAdmin();

  const { data: dossier, error: dossierError } = await supabaseAdmin
    .from('dossiers').select('*').eq('id', dossierId).single();
  if (dossierError || !dossier) {
    return res.status(404).json({ error: 'Dossier introuvable.' });
  }
  if (dossier.client_type === 'colony' && !hasPermission(auth, 'colonies.manage')) {
    return res.status(403).json({ error: 'Votre rôle ne permet pas d\'accéder aux dossiers Colonies.' });
  }

  let existingUser;
  try {
    existingUser = await findUserByEmail(supabaseAdmin, normalizedEmail);
  } catch (error) {
    return res.status(500).json({ error: 'Échec de la recherche du compte : ' + error.message });
  }

  let existingProfile = null;
  if (existingUser) {
    const { data } = await supabaseAdmin
      .from('profiles').select('role, full_name, must_change_password').eq('id', existingUser.id).maybeSingle();
    existingProfile = data;
    if (existingProfile && existingProfile.role === 'admin') {
      return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée par un compte administrateur.' });
    }
  }

  // Un compte existant n'est "activé" que si le client s'est déjà connecté ET a
  // remplacé son mot de passe provisoire.
  const existingActivated = !!(existingUser && existingUser.last_sign_in_at
    && !(existingProfile && existingProfile.must_change_password));
  const displayName = fullName || (existingProfile && existingProfile.full_name) || null;

  let userId, isNewAccount, temporaryPassword = null;

  if (existingUser) {
    userId = existingUser.id;
    isNewAccount = false;
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: userId, role: 'client', full_name: displayName, email: normalizedEmail,
    });
    if (profileError) return res.status(500).json({ error: 'Échec de mise à jour du profil : ' + profileError.message });

    if (!existingActivated) {
      temporaryPassword = generateTemporaryPassword();
      const { error: pwdError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: temporaryPassword, email_confirm: true,
      });
      if (pwdError) return res.status(500).json({ error: 'Échec de la génération du mot de passe provisoire : ' + pwdError.message });
      // APRÈS le changement de mot de passe : le trigger Auth lève le drapeau à
      // chaque changement, il doit donc être reposé ensuite.
      const { error: flagError } = await supabaseAdmin.from('profiles')
        .update({ must_change_password: true, password_changed_at: null }).eq('id', userId);
      if (flagError) return res.status(500).json({ error: 'Échec de l\'activation du changement obligatoire : ' + flagError.message });
    }
  } else {
    temporaryPassword = generateTemporaryPassword();
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName || null },
    });
    if (createError) return res.status(500).json({ error: 'Échec de la création du compte : ' + createError.message });
    userId = created.user.id;
    isNewAccount = true;
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: userId, role: 'client', full_name: fullName || null, email: normalizedEmail, must_change_password: true,
    });
    if (profileError) return res.status(500).json({ error: 'Compte créé mais échec de la création du profil : ' + profileError.message });
  }

  // L'identité métier est l'organisation, pas le compte : on s'assure que le dossier
  // en a une AVANT de créer l'accès (le trigger dossier_acces y ajoute alors le compte
  // comme membre). Le compte existant garde son mot de passe et ses autres dossiers.
  if (!dossier.organization_id) {
    // Compte existant rattaché à un seul client : le dossier rejoint ce client
    // (même si le nom de l'établissement est écrit différemment). Sinon, recherche
    // par nom + e-mail, ou création d'un nouveau client.
    let targetOrg = null;
    if (existingUser) {
      const { data: memberships } = await supabaseAdmin
        .from('organization_users').select('organization_id').eq('profile_id', userId).eq('statut', 'actif');
      if (memberships && memberships.length === 1) targetOrg = memberships[0].organization_id;
    }
    if (targetOrg) {
      const { error: attachError } = await supabaseAdmin.from('dossiers').update({ organization_id: targetOrg }).eq('id', dossierId);
      if (attachError) return res.status(500).json({ error: 'Échec du rattachement à l\'organisation : ' + attachError.message });
    } else {
      const { error: orgError } = await supabaseAdmin.rpc('ensure_dossier_organization', {
        p_dossier_id: dossierId, p_email: normalizedEmail,
      });
      if (orgError) return res.status(500).json({ error: 'Échec du rattachement à l\'organisation : ' + orgError.message });
    }
  }

  const { data: existingAccess } = await supabaseAdmin
    .from('dossier_acces').select('*').eq('dossier_id', dossierId).eq('profile_id', userId).maybeSingle();

  const alreadyLinked = !!existingAccess;
  if (!existingAccess) {
    const initialStatut = existingActivated ? 'compte_active' : 'invitation_envoyee';
    const { error: insErr } = await supabaseAdmin.from('dossier_acces').insert({
      dossier_id: dossierId,
      profile_id: userId,
      statut: initialStatut,
      activated_at: initialStatut === 'compte_active' ? new Date().toISOString() : null,
      last_actor: auth.user.id,
    });
    if (insErr) return res.status(500).json({ error: 'Échec de l\'association au dossier : ' + insErr.message });
  }

  // E-mail : identifiants provisoires (nouveau compte ou compte jamais activé),
  // sinon simple information "nouveau dossier ajouté" (aucun mot de passe).
  const loginUrl = siteUrl() + '/espace-client/';
  let subject, html;
  if (temporaryPassword) {
    const name = displayName || [dossier.contact_prenom, dossier.contact_nom].filter(Boolean).join(' ') || null;
    subject = buildCredentialsSubject();
    html = buildCredentialsHtml({ name, email: normalizedEmail, temporaryPassword, loginUrl, dossier });
  } else {
    subject = buildNewDossierLinkedSubject(dossier);
    html = buildNewDossierLinkedHtml({ dossier, loginUrl });
  }

  const mailResult = await sendMail({ to: normalizedEmail, subject, html });

  // Accès déjà existant : le renvoi est tracé avec son auteur (la création, elle,
  // l'est par le trigger de dossier_acces via last_actor).
  if (alreadyLinked && mailResult.sent) {
    await supabaseAdmin.from('dossier_journal').insert({
      dossier_id: dossierId, action: 'invitation_envoyee', details: 'Accès renvoyé à ' + normalizedEmail, actor: auth.user.id,
    });
  }

  return res.status(201).json({
    ok: true,
    isNewAccount,
    alreadyLinked,
    credentialsSent: !!temporaryPassword && mailResult.sent,
    emailSent: mailResult.sent,
    emailError: mailResult.error,
  });
}
