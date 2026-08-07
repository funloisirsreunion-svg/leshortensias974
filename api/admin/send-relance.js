import { Resend } from 'resend';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin.js';
import { requireAdmin } from '../../lib/requireAdmin.js';
import { shouldEmailForDocument, buildDocumentAddedSubject, buildDocumentAddedHtml } from '../../lib/documentAddedEmail.js';

// Endpoint unique pour les e-mails déclenchés par l'admin depuis la fiche
// dossier : relance générique, document ajouté (devis/facture/facture finale
// uniquement — §10), document refusé (§21). Regroupés dans un seul fichier
// pour rester sous la limite de 12 fonctions serverless du plan Vercel Hobby.

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function siteUrl() {
  return process.env.SITE_URL || 'https://leshortensias974.fr';
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
    auth = await requireAdmin(req);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const { dossierId, message, kind, documentType, refusMotif } = req.body || {};
  if (!dossierId) return res.status(400).json({ error: 'dossierId manquant.' });

  const supabaseAdmin = getSupabaseAdmin();
  const { data: dossier, error: dossierError } = await supabaseAdmin
    .from('dossiers').select('*').eq('id', dossierId).single();
  if (dossierError || !dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
  if (!dossier.contact_email) return res.status(400).json({ error: 'Aucune adresse e-mail de contact sur ce dossier.' });

  let subject, html, journalAction, journalDetails;

  if (kind === 'document-added') {
    if (!documentType) return res.status(400).json({ error: 'documentType manquant.' });
    if (!shouldEmailForDocument(documentType)) {
      // Pas un type qui déclenche un mail automatique : rien à envoyer (§12).
      return res.status(200).json({ ok: true, emailSent: false, skipped: true });
    }
    subject = buildDocumentAddedSubject(documentType);
    html = buildDocumentAddedHtml({ dossier, documentType, espaceClientUrl: siteUrl() + '/espace-client/' });
    journalAction = 'mail_document_envoye';
    journalDetails = documentType;
  } else if (kind === 'document-refuse') {
    if (!refusMotif) return res.status(400).json({ error: 'Motif de refus manquant.' });
    subject = `Document à corriger — Dossier ${dossier.numero}`;
    html = `
      <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
        <h2 style="color:#2d5a27;">Les Hortensias</h2>
        <p>Bonjour${dossier.contact_prenom ? ' ' + esc(dossier.contact_prenom) : ''},</p>
        <p>Un document de votre dossier <strong>${esc(dossier.numero)}</strong> nécessite une correction :</p>
        <p><strong>Document :</strong> ${esc(documentType || '')}<br/><strong>Motif :</strong> ${esc(refusMotif)}</p>
        <p>Merci de déposer une nouvelle version depuis votre espace client.</p>
        <p><a href="${siteUrl()}/espace-client/" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Accéder à mon espace</a></p>
        <p style="margin-top:24px;">Centre Les Hortensias<br/>Fun Loisirs Réunion</p>
      </div>`;
    journalAction = 'mail_refus_envoye';
    journalDetails = `${documentType || ''} — ${refusMotif}`;
  } else {
    // kind par défaut / non fourni : relance générique (comportement historique).
    subject = `Relance — Dossier ${dossier.numero}`;
    html = `
      <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
        <h2 style="color:#2d5a27;">Les Hortensias — Relance</h2>
        <p>Bonjour${dossier.contact_prenom ? ' ' + esc(dossier.contact_prenom) : ''},</p>
        <p>Ce message concerne votre dossier <strong>${esc(dossier.numero)}</strong> (${esc(dossier.etablissement)}).</p>
        ${message ? `<p>${esc(message).replace(/\n/g, '<br/>')}</p>` : '<p>Merci de bien vouloir prendre contact avec nous ou de compléter les éléments manquants de votre dossier.</p>'}
        <p>Centre Les Hortensias<br/>Fun Loisirs Réunion<br/>06 92 36 58 38</p>
      </div>`;
    journalAction = 'relance_envoyee';
    journalDetails = message || null;
  }

  const mailResult = await sendMail({ to: dossier.contact_email, subject, html });
  if (!mailResult.sent) {
    return res.status(502).json({ error: 'Échec de l\'envoi : ' + mailResult.error });
  }

  await supabaseAdmin.from('dossier_journal').insert({
    dossier_id: dossierId,
    action: journalAction,
    details: journalDetails,
    actor: auth.user.id,
  });

  return res.status(200).json({ ok: true, emailSent: true });
}
