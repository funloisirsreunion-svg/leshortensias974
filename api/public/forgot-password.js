import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { buildPasswordResetSubject, buildPasswordResetHtml } from '../../lib/passwordResetEmail.js';

// Endpoint public (mot de passe oublié). Construit son propre lien vers
// reinitialiser-mot-de-passe.html (token_hash + type), au lieu de compter sur
// le lien de redirection généré par Supabase (qui dépend du "Site URL" /
// "Redirect URLs" configurés dans le dashboard Supabase — jamais configuré
// pour un projet fraîchement provisionné, ce qui renvoyait vers localhost:3000).
// Toujours la même réponse générique, que le compte existe ou non (anti-énumération).

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function siteUrl() {
  return process.env.SITE_URL || 'https://leshortensias974.fr';
}

// Lien d'accès envoyé depuis l'Admin (api/admin/create-teacher.js) :
// reinitialiser-mot-de-passe.html?invitation=<jeton>. La page (et non un simple
// chargement du lien, que certains antivirus de messagerie font à l'avance)
// échange ici le jeton contre un code de connexion à usage unique, pour que
// l'enseignant définisse lui-même son mot de passe. Le jeton n'est jamais stocké
// en clair (empreinte SHA-256) ; il expire et devient inutilisable dès que le
// mot de passe est défini (trigger on_auth_password_changed).
async function exchangeInvitation(req, res) {
  const { token } = req.body || {};
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    return res.status(200).json({ status: 'invalid' });
  }
  const supabaseAdmin = getSupabaseAdmin();
  const hash = createHash('sha256').update(token).digest('hex');
  const { data: inv } = await supabaseAdmin.from('client_invitations')
    .select('id, profile_id, email, kind, statut, expires_at').eq('token_hash', hash).maybeSingle();
  if (!inv || inv.kind === 'information') return res.status(200).json({ status: 'invalid' });
  if (inv.statut === 'utilisee') return res.status(200).json({ status: 'already_active' });
  if (inv.statut !== 'envoyee') return res.status(200).json({ status: 'replaced' });
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    return res.status(200).json({ status: 'expired' });
  }
  const { data: profile } = await supabaseAdmin.from('profiles')
    .select('role, email').eq('id', inv.profile_id).maybeSingle();
  if (!profile || profile.role !== 'client') return res.status(200).json({ status: 'invalid' });
  const { data: generated, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery', email: profile.email || inv.email,
  });
  if (error || !generated?.properties?.hashed_token) return res.status(200).json({ status: 'error' });
  return res.status(200).json({ status: 'ok', kind: inv.kind, email: profile.email || inv.email, token_hash: generated.properties.hashed_token });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  if ((req.body || {}).action === 'invitation') {
    try { return await exchangeInvitation(req, res); }
    catch (error) { return res.status(200).json({ status: 'error' }); }
  }

  const genericResponse = () => res.status(200).json({ ok: true });

  const { email } = req.body || {};
  if (!isValidEmail(email)) {
    return genericResponse();
  }
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: generated, error: genError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
    });
    if (genError || !generated?.properties?.hashed_token) {
      return genericResponse();
    }

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.EMAIL_FROM
        || (process.env.RESEND_EMAIL_DOMAIN ? `Fun Loisirs Réunion <inscriptions@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Fun Loisirs Réunion <onboarding@resend.dev>');
      const link = `${siteUrl()}/reinitialiser-mot-de-passe.html?token_hash=${encodeURIComponent(generated.properties.hashed_token)}&type=recovery`;
      await resend.emails.send({
        from,
        to: normalizedEmail,
        subject: buildPasswordResetSubject(),
        html: buildPasswordResetHtml({ link }),
      });
    }
  } catch (error) {
    // Ne jamais révéler d'erreur précise côté client.
  }

  return genericResponse();
}
