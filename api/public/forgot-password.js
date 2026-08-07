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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
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
