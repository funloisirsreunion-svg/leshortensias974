import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  let auth;
  try {
    auth = await requireAdmin(req);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const { dossierId, message } = req.body || {};
  if (!dossierId) return res.status(400).json({ error: 'dossierId manquant.' });

  const supabaseAdmin = getSupabaseAdmin();
  const { data: dossier, error: dossierError } = await supabaseAdmin
    .from('dossiers').select('*').eq('id', dossierId).single();
  if (dossierError || !dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
  if (!dossier.contact_email) return res.status(400).json({ error: 'Aucune adresse e-mail de contact sur ce dossier.' });

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY non configuré.' });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM
      || (process.env.RESEND_EMAIL_DOMAIN ? `Fun Loisirs Réunion <inscriptions@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Fun Loisirs Réunion <onboarding@resend.dev>');
    const html = `
      <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
        <h2 style="color:#2d5a27;">Les Hortensias — Relance</h2>
        <p>Bonjour${dossier.contact_prenom ? ' ' + esc(dossier.contact_prenom) : ''},</p>
        <p>Ce message concerne votre dossier <strong>${esc(dossier.numero)}</strong> (${esc(dossier.etablissement)}).</p>
        ${message ? `<p>${esc(message).replace(/\n/g, '<br/>')}</p>` : '<p>Merci de bien vouloir prendre contact avec nous ou de compléter les éléments manquants de votre dossier.</p>'}
        <p>Centre Les Hortensias<br/>Fun Loisirs Réunion<br/>06 92 36 58 38</p>
      </div>`;
    const { error: sendError } = await resend.emails.send({
      from,
      to: dossier.contact_email,
      subject: `Relance — Dossier ${dossier.numero}`,
      html,
    });
    if (sendError) throw new Error(sendError.message || JSON.stringify(sendError));
  } catch (error) {
    return res.status(502).json({ error: 'Échec de l\'envoi : ' + error.message });
  }

  await supabaseAdmin.from('dossier_journal').insert({
    dossier_id: dossierId,
    action: 'relance_envoyee',
    details: message || null,
    actor: auth.user.id,
  });

  return res.status(200).json({ ok: true });
}
