import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';
import {
  buildInviteSubject, buildInviteHtml,
  buildNewDossierLinkedSubject, buildNewDossierLinkedHtml,
  buildResendInviteSubject, buildResendInviteHtml,
} from '../../lib/teacherInviteEmail.js';

// Crée (ou raccroche) un accès enseignant pour un dossier donné.
// Jamais de mot de passe en clair envoyé par e-mail : toujours un lien
// d'invitation sécurisé (Supabase generateLink) ou un simple lien de connexion
// si le compte existe déjà et est actif. Un même e-mail n'est jamais dupliqué :
// un compte existant est simplement rattaché au nouveau dossier (dossier_acces).

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function siteUrl() {
  return process.env.SITE_URL || 'https://leshortensias974.fr';
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

  try {
    await requireAdmin(req);
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

  let existingUser;
  try {
    existingUser = await findUserByEmail(supabaseAdmin, normalizedEmail);
  } catch (error) {
    return res.status(500).json({ error: 'Échec de la recherche du compte : ' + error.message });
  }

  if (existingUser) {
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles').select('role, full_name').eq('id', existingUser.id).maybeSingle();
    if (existingProfile && existingProfile.role === 'admin') {
      return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée par un compte administrateur.' });
    }
  }

  let userId, isNewAccount, actionLink = null;
  const redirectTo = siteUrl() + '/reinitialiser-mot-de-passe.html';

  if (existingUser) {
    userId = existingUser.id;
    isNewAccount = false;
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: userId, role: 'enseignant', full_name: fullName || null, email: normalizedEmail,
    });
    if (profileError) return res.status(500).json({ error: 'Échec de mise à jour du profil : ' + profileError.message });
  } else {
    const { data: generated, error: genError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: normalizedEmail,
      options: { redirectTo, data: { full_name: fullName || null } },
    });
    if (genError) return res.status(500).json({ error: 'Échec de la génération du lien d\'invitation : ' + genError.message });
    userId = generated.user.id;
    actionLink = generated.properties.action_link;
    isNewAccount = true;
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: userId, role: 'enseignant', full_name: fullName || null, email: normalizedEmail,
    });
    if (profileError) return res.status(500).json({ error: 'Compte créé mais échec de la création du profil : ' + profileError.message });
  }

  const { data: existingAccess } = await supabaseAdmin
    .from('dossier_acces').select('*').eq('dossier_id', dossierId).eq('profile_id', userId).maybeSingle();

  let accessRow = existingAccess;
  let alreadyLinked = !!existingAccess;
  if (!existingAccess) {
    const initialStatut = (!isNewAccount && existingUser.last_sign_in_at) ? 'compte_active' : 'invitation_envoyee';
    const { data: inserted, error: insErr } = await supabaseAdmin.from('dossier_acces').insert({
      dossier_id: dossierId,
      profile_id: userId,
      statut: initialStatut,
      activated_at: initialStatut === 'compte_active' ? new Date().toISOString() : null,
    }).select().single();
    if (insErr) return res.status(500).json({ error: 'Échec de l\'association au dossier : ' + insErr.message });
    accessRow = inserted;
  }

  // Détermine l'e-mail à envoyer selon le cas de figure.
  let subject, html;
  if (actionLink) {
    // Compte tout juste créé.
    subject = buildInviteSubject();
    html = buildInviteHtml({ dossier, actionLink });
  } else if (accessRow.statut === 'invitation_envoyee') {
    // Compte existant mais jamais activé (première invitation restée sans suite) : on relance.
    const { data: relink, error: relinkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite', email: normalizedEmail, options: { redirectTo },
    });
    if (relinkError) {
      return res.status(500).json({ error: 'Échec de la régénération du lien d\'invitation : ' + relinkError.message });
    }
    subject = buildResendInviteSubject();
    html = buildResendInviteHtml({ dossier, actionLink: relink.properties.action_link });
  } else {
    // Compte déjà actif : simple rattachement à un nouveau dossier (ou rappel d'accès).
    subject = buildNewDossierLinkedSubject(dossier);
    html = buildNewDossierLinkedHtml({ dossier, loginUrl: siteUrl() + '/espace-ecole/' });
  }

  const mailResult = await sendMail({ to: normalizedEmail, subject, html });

  return res.status(201).json({
    ok: true,
    isNewAccount,
    alreadyLinked,
    emailSent: mailResult.sent,
    emailError: mailResult.error,
  });
}
