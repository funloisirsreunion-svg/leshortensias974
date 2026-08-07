import crypto from 'node:crypto';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { buildTeacherInviteSubject, buildTeacherInviteHtml } from '../../lib/teacherInviteEmail.js';

// Crée (ou raccroche) un compte enseignant pour un dossier donné, et lui
// envoie ses identifiants par e-mail. Action réservée à l'admin : c'est ici,
// et seulement ici, que l'accès enseignant naît (jamais d'auto-inscription).

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64url'); // ~12 caractères lisibles
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

  const supabaseAdmin = getSupabaseAdmin();

  const { data: dossier, error: dossierError } = await supabaseAdmin
    .from('dossiers')
    .select('id, numero, etablissement')
    .eq('id', dossierId)
    .single();
  if (dossierError || !dossier) {
    return res.status(404).json({ error: 'Dossier introuvable.' });
  }

  const tempPassword = generateTempPassword();
  const normalizedEmail = email.trim().toLowerCase();

  let userId;
  let isNewAccount = true;

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName || null },
  });

  if (createError) {
    // Compte déjà existant : on le récupère pour le rattacher à ce dossier
    // (cas d'un enseignant qui gère déjà un autre séjour, ou d'un ré-envoi).
    const alreadyExists = /already been registered|already registered|already exists/i.test(createError.message || '');
    if (!alreadyExists) {
      return res.status(500).json({ error: createError.message || 'Échec de la création du compte.' });
    }
    isNewAccount = false;
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listError) {
      return res.status(500).json({ error: 'Compte existant, mais impossible de le retrouver : ' + listError.message });
    }
    const existingUser = list.users.find((u) => (u.email || '').toLowerCase() === normalizedEmail);
    if (!existingUser) {
      return res.status(500).json({ error: 'Compte signalé comme existant mais introuvable.' });
    }
    userId = existingUser.id;
    // Réinitialise le mot de passe pour permettre une nouvelle connexion immédiate.
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });
    if (updateError) {
      return res.status(500).json({ error: 'Échec de la réinitialisation du mot de passe : ' + updateError.message });
    }
  } else {
    userId = created.user.id;
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: userId,
      role: 'enseignant',
      full_name: fullName || null,
      email: normalizedEmail,
      dossier_id: dossierId,
    });
  if (profileError) {
    return res.status(500).json({ error: 'Compte créé mais échec de l\'association au dossier : ' + profileError.message });
  }

  let emailSent = false;
  let emailError = null;
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.EMAIL_FROM
        || (process.env.RESEND_EMAIL_DOMAIN ? `Fun Loisirs Réunion <inscriptions@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Fun Loisirs Réunion <onboarding@resend.dev>');
      const loginUrl = (process.env.SITE_URL || 'https://leshortensias974.fr') + '/espace-ecole/';
      const { error: sendError } = await resend.emails.send({
        from,
        to: normalizedEmail,
        subject: buildTeacherInviteSubject(dossier),
        html: buildTeacherInviteHtml({ dossier, email: normalizedEmail, tempPassword, loginUrl, isNewAccount }),
      });
      if (sendError) throw new Error(sendError.message || JSON.stringify(sendError));
      emailSent = true;
    } catch (error) {
      emailError = error.message;
    }
  } else {
    emailError = 'RESEND_API_KEY non configuré.';
  }

  return res.status(201).json({
    ok: true,
    userId,
    isNewAccount,
    emailSent,
    emailError,
    // Repli affiché à l'admin dans l'interface si l'e-mail n'a pas pu partir,
    // pour qu'il puisse transmettre les identifiants lui-même.
    tempPassword: emailSent ? undefined : tempPassword,
  });
}
