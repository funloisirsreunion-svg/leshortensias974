import { createHash, randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requirePermission, hasPermission } from '../../lib/requireAdmin.js';
import { sejourDatesLabel } from '../../lib/appConstants.js';
import { INVITATION_VALIDITY_DAYS } from '../../lib/clientAccess.js';
import {
  CLIENT_ACCESS_SITE, buildClientAccessSubject, buildClientAccessHtml, buildClientAccessText,
} from '../../lib/teacherInviteEmail.js';

// Accès à l'espace client, envoyé à la demande depuis l'Admin (jamais en masse :
// un destinataire par appel, choisi par l'Admin après aperçu).
//
// action 'preview' : aucune écriture, aucun envoi — renvoie l'état du compte et
//   l'e-mail exact qui partira (le lien y est remplacé par un exemple).
// action 'send'    : crée ou rattache le compte puis envoie l'e-mail.
//
// Nouveau compte : compte Supabase Auth SANS mot de passe + lien d'activation
// personnel (jeton aléatoire, seule son empreinte est stockée) : l'enseignant
// définit lui-même son mot de passe. Compte existant non activé : nouveau lien,
// l'ancien devient inutilisable. Compte existant activé : aucun changement de
// mot de passe ni de rôle ; lien de réinitialisation uniquement si l'Admin le
// demande. Un même e-mail n'est jamais dupliqué ; deux établissements qui
// partagent une adresse gardent leurs fiches et leurs séjours séparés : seuls
// les séjours cochés sont ouverts au compte (dossier_acces).

const MAX_DOSSIERS = 12;
const MIN_SECONDS_BETWEEN_SENDS = 60;

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function findUserByEmail(supabaseAdmin, email) {
  // L'API admin de Supabase (JS) ne filtre pas par e-mail : pagination simple,
  // suffisante à l'échelle du site.
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

async function sendMail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, id: null, error: 'RESEND_API_KEY non configuré.' };
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM
      || (process.env.RESEND_EMAIL_DOMAIN ? `Centre Les Hortensias <inscriptions@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Centre Les Hortensias <onboarding@resend.dev>');
    const replyTo = process.env.EMAIL_REPLY_TO || 'contact.funloisirsreunion@gmail.com';
    const { data, error } = await resend.emails.send({ from, to, subject, html, text, replyTo });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return { sent: true, id: data && data.id, error: null };
  } catch (error) {
    return { sent: false, id: null, error: error.message };
  }
}

function sejourLine(d) {
  const prog = d.programme === 'volcan' ? 'Classe Volcan' : d.programme === 'nature' ? 'Classe Nature' : d.client_type === 'group' ? 'Séjour de groupe' : 'Classe découverte';
  return `${prog} — ${sejourDatesLabel(d)}${d.numero ? ` (dossier ${d.numero})` : ''}`;
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

  const { action = 'send', dossierId, dossierIds = [], email, fullName, includeReset = false } = req.body || {};
  if (!['preview', 'send'].includes(action)) return res.status(400).json({ error: 'Action inconnue.' });
  if (!dossierId || typeof dossierId !== 'string') return res.status(400).json({ error: 'dossierId manquant.' });
  if (!Array.isArray(dossierIds)) return res.status(400).json({ error: 'dossierIds invalide.' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  const ids = [...new Set([dossierId, ...dossierIds.filter(x => typeof x === 'string')])];
  if (ids.length > MAX_DOSSIERS) return res.status(400).json({ error: 'Trop de séjours sélectionnés.' });
  const normalizedEmail = email.trim().toLowerCase();
  const supabaseAdmin = getSupabaseAdmin();

  // ---- Séjours : tous du même établissement que le dossier ouvert
  const { data: dossiers, error: dErr } = await supabaseAdmin.from('dossiers').select('*').in('id', ids);
  if (dErr) return res.status(500).json({ error: 'Lecture des dossiers impossible : ' + dErr.message });
  const primary = (dossiers || []).find(d => d.id === dossierId);
  if (!primary) return res.status(404).json({ error: 'Dossier introuvable.' });
  if ((dossiers || []).length !== ids.length) return res.status(404).json({ error: 'Un des séjours sélectionnés est introuvable.' });
  if (dossiers.some(d => d.client_type === 'colony')) {
    return res.status(400).json({ error: 'Les colonies n\'ont pas d\'espace client.' });
  }
  if (ids.length > 1 && (!primary.organization_id || dossiers.some(d => d.organization_id !== primary.organization_id))) {
    return res.status(400).json({ error: 'Les séjours sélectionnés doivent appartenir au même établissement.' });
  }
  for (const d of dossiers) {
    const p = d.client_type === 'group' ? 'groups.read' : 'classes.read';
    if (!hasPermission(auth, p)) return res.status(403).json({ error: 'Votre rôle ne permet pas d\'accéder à ces dossiers.' });
  }
  const ordered = ids.map(id => dossiers.find(d => d.id === id));

  // ---- Compte : jamais de doublon, jamais de compte interne
  let existingUser;
  try {
    existingUser = await findUserByEmail(supabaseAdmin, normalizedEmail);
  } catch (error) {
    return res.status(500).json({ error: 'Échec de la recherche du compte : ' + error.message });
  }
  let existingProfile = null;
  if (existingUser) {
    const { data } = await supabaseAdmin.from('profiles')
      .select('id, role, full_name, must_change_password').eq('id', existingUser.id).maybeSingle();
    existingProfile = data;
    if (existingProfile && existingProfile.role === 'admin') {
      return res.status(409).json({ error: 'Cette adresse e-mail est celle d\'un compte de l\'équipe interne : elle ne peut pas servir d\'accès client.' });
    }
  }
  // Activé = l'enseignant a défini son mot de passe et s'est déjà connecté.
  const activated = !!(existingUser && existingProfile && !existingProfile.must_change_password && existingUser.last_sign_in_at);
  const mode = activated ? (includeReset ? 'reinitialisation' : 'information') : 'activation';

  const { data: accesRows } = existingUser
    ? await supabaseAdmin.from('dossier_acces').select('dossier_id, statut').eq('profile_id', existingUser.id)
    : { data: [] };
  const accesByDossier = Object.fromEntries((accesRows || []).map(a => [a.dossier_id, a.statut]));
  const disabled = ordered.filter(d => accesByDossier[d.id] === 'desactive');
  const sendable = ordered.filter(d => accesByDossier[d.id] !== 'desactive');
  const otherDossierIds = (accesRows || []).map(a => a.dossier_id).filter(id => !ids.includes(id));

  const emailParams = {
    mode,
    email: normalizedEmail,
    validityDays: INVITATION_VALIDITY_DAYS[mode] || null,
    etablissement: primary.etablissement || primary.structure_nom || null,
    sejours: sendable.map(sejourLine),
  };

  if (action === 'preview') {
    const sample = mode === 'information' ? null : CLIENT_ACCESS_SITE + 'reinitialiser-mot-de-passe.html?invitation=…';
    return res.status(200).json({
      ok: true,
      mode,
      account: existingUser ? (activated ? 'activated' : 'pending') : 'new',
      otherDossiersCount: otherDossierIds.length,
      disabled: disabled.map(d => ({ id: d.id, numero: d.numero })),
      subject: buildClientAccessSubject(),
      html: buildClientAccessHtml({ ...emailParams, link: sample }),
    });
  }

  if (!sendable.length) {
    return res.status(409).json({ error: 'L\'accès de ce compte a été désactivé pour ce séjour : réactivez-le d\'abord.' });
  }

  // Double clic / envoi répété : un seul e-mail par minute et par adresse.
  const { data: recent } = await supabaseAdmin.from('client_invitations')
    .select('id').eq('email', normalizedEmail).eq('statut', 'envoyee')
    .gte('sent_at', new Date(Date.now() - MIN_SECONDS_BETWEEN_SENDS * 1000).toISOString()).limit(1);
  if (recent && recent.length) {
    return res.status(429).json({ error: 'Un e-mail vient déjà d\'être envoyé à cette adresse. Patientez une minute avant de renvoyer.' });
  }

  // ---- Création / mise à jour du compte
  let userId, isNewAccount = false;
  const displayName = (fullName && String(fullName).trim()) || null;
  if (existingUser) {
    userId = existingUser.id;
    if (!existingProfile) {
      const { error } = await supabaseAdmin.from('profiles').insert({
        id: userId, role: 'client', full_name: displayName, email: normalizedEmail, must_change_password: !activated,
      });
      if (error) return res.status(500).json({ error: 'Échec de création du profil : ' + error.message });
    } else {
      const patch = {};
      if (!existingProfile.full_name && displayName) patch.full_name = displayName;
      if (!activated && !existingProfile.must_change_password) patch.must_change_password = true;
      if (Object.keys(patch).length) {
        const { error } = await supabaseAdmin.from('profiles').update(patch).eq('id', userId);
        if (error) return res.status(500).json({ error: 'Échec de mise à jour du profil : ' + error.message });
      }
    }
  } else {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (createError) return res.status(500).json({ error: 'Échec de la création du compte : ' + createError.message });
    userId = created.user.id;
    isNewAccount = true;
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: userId, role: 'client', full_name: displayName, email: normalizedEmail, must_change_password: true,
    });
    if (profileError) return res.status(500).json({ error: 'Compte créé mais échec de la création du profil : ' + profileError.message });
  }

  // ---- Fiche établissement : celle du dossier, jamais celle d'un autre
  // établissement qui partagerait la même adresse e-mail.
  if (!primary.organization_id) {
    const { data: orgId, error: orgError } = await supabaseAdmin.rpc('ensure_dossier_organization', {
      p_dossier_id: primary.id, p_email: normalizedEmail,
    });
    if (orgError) return res.status(500).json({ error: 'Échec du rattachement à l\'établissement : ' + orgError.message });
    primary.organization_id = orgId || primary.organization_id;
  }

  // ---- Rattachements explicites : uniquement les séjours cochés
  const linked = [];
  for (const d of sendable) {
    if (accesByDossier[d.id]) continue;
    const statut = activated ? 'compte_active' : 'invitation_envoyee';
    const { error } = await supabaseAdmin.from('dossier_acces').insert({
      dossier_id: d.id, profile_id: userId, statut,
      activated_at: statut === 'compte_active' ? new Date().toISOString() : null,
      last_actor: auth.user.id,
    });
    if (error) return res.status(500).json({ error: 'Échec de l\'ouverture du séjour ' + (d.numero || '') + ' : ' + error.message });
    linked.push(d.id);
  }

  // ---- Lien personnel (empreinte seule en base)
  let link = null, tokenHash = null, expiresAt = null;
  if (mode !== 'information') {
    const raw = randomBytes(32).toString('base64url');
    tokenHash = sha256(raw);
    expiresAt = new Date(Date.now() + INVITATION_VALIDITY_DAYS[mode] * 86400000).toISOString();
    link = `${CLIENT_ACCESS_SITE}reinitialiser-mot-de-passe.html?invitation=${raw}`;
    await supabaseAdmin.from('client_invitations').update({ statut: 'remplacee' })
      .eq('profile_id', userId).in('statut', ['envoyee', 'preparee']).not('token_hash', 'is', null);
  }

  const { data: inv, error: invErr } = await supabaseAdmin.from('client_invitations').insert({
    profile_id: userId,
    email: normalizedEmail,
    organization_id: primary.organization_id || null,
    dossier_ids: sendable.map(d => d.id),
    kind: mode,
    token_hash: tokenHash,
    expires_at: expiresAt,
    statut: 'preparee',
    created_by: auth.user.id,
    created_by_name: auth.profile.full_name || auth.profile.email,
  }).select('id').single();
  if (invErr) return res.status(500).json({ error: 'Échec de la préparation de l\'invitation : ' + invErr.message });

  const mail = await sendMail({
    to: normalizedEmail,
    subject: buildClientAccessSubject(),
    html: buildClientAccessHtml({ ...emailParams, link }),
    text: buildClientAccessText({ ...emailParams, link }),
  });
  const sentAt = new Date().toISOString();
  await supabaseAdmin.from('client_invitations').update(mail.sent
    ? { statut: 'envoyee', sent_at: sentAt, resend_id: mail.id, error: null }
    : { statut: 'echec', error: mail.error }).eq('id', inv.id);

  if (mail.sent) {
    const label = { activation: 'lien d\'activation', reinitialisation: 'lien de réinitialisation', information: 'information de connexion' }[mode];
    await supabaseAdmin.from('dossier_journal').insert(sendable.map(d => ({
      dossier_id: d.id, action: 'invitation_envoyee', actor: auth.user.id,
      details: `Accès à l'espace client envoyé à ${normalizedEmail} (${label})`,
    })));
  }

  return res.status(201).json({
    ok: true,
    mode,
    isNewAccount,
    linked,
    skipped: disabled.map(d => ({ id: d.id, numero: d.numero, reason: 'desactive' })),
    invitationId: inv.id,
    emailSent: mail.sent,
    emailError: mail.error,
    // Compatibilité avec l'ancien affichage.
    alreadyLinked: linked.length === 0,
    credentialsSent: false,
  });
}
