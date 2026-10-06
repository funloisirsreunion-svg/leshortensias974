// Envoi de la fiche opérationnelle (côté serveur, appelé par api/admin/send-relance.js).
// La fiche est RECALCULÉE ici depuis la base : l'empreinte envoyée par le
// navigateur doit correspondre (sinon le dossier a changé entre l'aperçu et
// l'envoi). Jamais d'envoi automatique : uniquement sur action d'un Admin.
import {
  buildFiche, ficheHash, ficheIssues, ficheSubject, ficheEmailHtml, ficheFileName, DEFAULT_FICHE_RECIPIENT,
} from './ficheOperationnelle.js';
import { hasPermission, dossierPermission } from './requireAdmin.js';

const MAX_PDF_BYTES = 3 * 1024 * 1024;

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function loadFicheData(supabaseAdmin, dossier) {
  const [versions, blocs, regimes, allergies] = await Promise.all([
    supabaseAdmin.from('dossier_bloc_versions').select('bloc, version, donnees_validees, admin_validated_at').eq('dossier_id', dossier.id),
    supabaseAdmin.from('dossier_blocs').select('bloc, statut, version').eq('dossier_id', dossier.id),
    supabaseAdmin.from('regimes_alimentaires').select('type, nombre, precisions').eq('dossier_id', dossier.id),
    supabaseAdmin.from('dossier_allergies').select('allergene, nombre, precisions').eq('dossier_id', dossier.id),
  ]);
  for (const r of [versions, blocs, regimes, allergies]) if (r.error) throw r.error;
  return buildFiche({ dossier, blocVersions: versions.data, blocs: blocs.data, regimes: regimes.data, allergies: allergies.data });
}

export async function handleFicheOperationnelle({ req, res, auth, dossier, supabaseAdmin, sendMail }) {
  if (!hasPermission(auth, 'operational_sheet.send') || !hasPermission(auth, dossierPermission(dossier.client_type, 'read'))) {
    return res.status(403).json({ error: 'Votre rôle ne permet pas d\'envoyer la fiche opérationnelle de ce dossier.' });
  }
  if (!['school', 'group'].includes(dossier.client_type)) {
    return res.status(400).json({ error: 'La fiche opérationnelle concerne les Classes de découverte et les Groupes.' });
  }
  const { pdfBase64, snapshotHash, force } = req.body || {};
  const recipient = String(req.body?.recipient || process.env.OPERATIONAL_SHEET_EMAIL || DEFAULT_FICHE_RECIPIENT).trim().toLowerCase();
  if (!isValidEmail(recipient)) return res.status(400).json({ error: 'Adresse du destinataire invalide.' });

  let fiche;
  try { fiche = await loadFicheData(supabaseAdmin, dossier); }
  catch (error) { return res.status(500).json({ error: 'Lecture du dossier impossible : ' + error.message }); }

  const hash = ficheHash(fiche);
  if (snapshotHash !== hash) {
    return res.status(409).json({ error: 'Le dossier a été modifié depuis l\'aperçu. Rechargez la fiche avant de l\'envoyer.', code: 'stale' });
  }
  const issues = ficheIssues(fiche);
  const blocking = issues.filter(i => i.blocking);
  if (blocking.length) return res.status(400).json({ error: 'Fiche incomplète : ' + blocking.map(i => i.text).join(' '), issues });
  // PDF généré par le navigateur à partir de la même fiche (contrôlé : vrai PDF, taille raisonnable).
  let pdf = null;
  if (pdfBase64) {
    pdf = Buffer.from(String(pdfBase64), 'base64');
    if (pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ error: 'PDF invalide.' });
    }
  }
  if (issues.length && !force) return res.status(409).json({ error: 'Informations incomplètes.', issues, code: 'confirm' });


  const { data: previous } = await supabaseAdmin.from('fiches_operationnelles')
    .select('id').eq('dossier_id', dossier.id).limit(1);
  const isUpdate = !!(previous && previous.length);
  const sentAt = new Date();
  const fileName = ficheFileName(fiche);

  // Archive du PDF transmis (stockage privé du dossier), jamais écrasée.
  let storagePath = null;
  if (pdf) {
    storagePath = `${dossier.id}/fiche_operationnelle/${sentAt.getTime()}_${fileName}`;
    const { error: upErr } = await supabaseAdmin.storage.from('documents-dossiers')
      .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
    if (upErr) storagePath = null;
  }

  const mail = await sendMail({
    to: recipient,
    subject: ficheSubject(fiche, isUpdate),
    html: ficheEmailHtml(fiche, { isUpdate, generatedAt: sentAt }),
    attachments: pdf ? [{ filename: fileName, content: pdf.toString('base64') }] : undefined,
  });
  if (!mail.sent) return res.status(502).json({ error: 'Échec de l\'envoi : ' + mail.error });

  const { error: insErr } = await supabaseAdmin.from('fiches_operationnelles').insert({
    dossier_id: dossier.id, sent_at: sentAt.toISOString(), sent_by: auth.user.id, recipient, is_update: isUpdate,
    snapshot: fiche, snapshot_hash: hash, effectifs_version: fiche.effectifsVersion, regimes_version: fiche.regimesVersion,
    storage_path: storagePath, email_id: mail.id || null,
  });
  await supabaseAdmin.from('dossier_journal').insert({
    dossier_id: dossier.id,
    action: isUpdate ? 'fiche_operationnelle_maj' : 'fiche_operationnelle_envoyee',
    details: `Destinataire : ${recipient} · Effectifs : ${fiche.effectifsVersion ? 'V' + fiche.effectifsVersion : 'non validés'} · Régimes : ${fiche.regimesVersion ? 'V' + fiche.regimesVersion : 'non validés'}${storagePath ? ' · PDF archivé' : ''}`,
    actor: auth.user.id,
  });

  return res.status(200).json({ ok: true, isUpdate, recipient, sentAt: sentAt.toISOString(), historyError: insErr ? insErr.message : null });
}
