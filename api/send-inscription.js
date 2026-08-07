import { formidable } from 'formidable';
import fs from 'node:fs';
import { Resend } from 'resend';
import { assignDossierNumber } from '../lib/dossierNumber.js';
import { slugify } from '../lib/slugify.js';
import { buildEmailSubject, buildEmailHtml } from '../lib/emailTemplate.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

// Reçoit le formulaire colonie en multipart/form-data (texte + fichiers).
// Enregistre d'abord le dossier et les documents dans Supabase (source de vérité,
// visible dans l'espace Admin) puis tente l'e-mail de notification avec les
// pièces jointes réelles. Un échec d'e-mail ne fait jamais perdre la demande,
// déjà enregistrée en base à ce stade — cohérent avec le principe appliqué au
// reste du site (demande-devis, demande-groupe).

function isValidSubmissionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{10,80}$/.test(id);
}
function fieldStr(fields, key) {
  const v = fields[key];
  return Array.isArray(v) ? (v[0] || '') : (v || '');
}
function toFileArray(files, key) {
  const v = files[key];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}
function extOf(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return (m ? m[1] : 'bin').toLowerCase();
}

// Upload brut dans le stockage privé, sans toucher à la table documents
// (utilisé pour les pages supplémentaires d'un carnet de vaccination multi-fichiers :
// la ligne documents ne peut référencer qu'un seul storage_path par type).
async function uploadRaw(supabaseAdmin, dossierId, docType, file) {
  try {
    const safeName = (file.originalFilename || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${dossierId}/${docType}/${Date.now()}_${safeName}`;
    const buffer = fs.readFileSync(file.filepath);
    await supabaseAdmin.storage.from('documents-dossiers').upload(path, buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: true,
    });
  } catch {
    // Non bloquant : l'e-mail contient de toute façon la pièce jointe réelle.
  }
}

// Upload + rattachement à la ligne documents (statut passe à "reçu").
async function uploadDoc(supabaseAdmin, dossierId, docType, file, label) {
  try {
    const safeName = (file.originalFilename || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${dossierId}/${docType}/${Date.now()}_${safeName}`;
    const buffer = fs.readFileSync(file.filepath);
    const { error: upErr } = await supabaseAdmin.storage.from('documents-dossiers').upload(path, buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: true,
    });
    if (upErr) throw upErr;
    await supabaseAdmin.from('documents').update({
      storage_path: path,
      file_name: label || file.originalFilename,
      statut: 'recu',
      uploaded_at: new Date().toISOString(),
    }).eq('dossier_id', dossierId).eq('type', docType);
  } catch {
    // Non bloquant : l'e-mail contient de toute façon la pièce jointe réelle.
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }

  let fields, files;
  try {
    const form = formidable({ multiples: true, maxFileSize: 4 * 1024 * 1024 });
    [fields, files] = await form.parse(request);
  } catch (error) {
    return response.status(400).json({ error: 'Fichiers trop volumineux ou requête invalide. Réduisez la taille des documents et réessayez.' });
  }

  const allFiles = [
    ...toFileArray(files, 'ficheGeneree'),
    ...toFileArray(files, 'fiche'),
    ...toFileArray(files, 'carnet'),
    ...toFileArray(files, 'caf'),
  ];

  try {
    const submissionId = fieldStr(fields, 'submissionId');
    if (!isValidSubmissionId(submissionId)) {
      return response.status(400).json({ error: 'Identifiant de dossier invalide.' });
    }

    const ficheGenereeFiles = toFileArray(files, 'ficheGeneree');
    const ficheFiles = toFileArray(files, 'fiche');
    const carnetFiles = toFileArray(files, 'carnet');
    const cafFiles = toFileArray(files, 'caf');
    const beneficiaireVacaf = fieldStr(fields, 'beneficiaireVacaf') === 'true';

    if (!ficheFiles.length) {
      return response.status(400).json({ error: 'La fiche d\'inscription signée est obligatoire.' });
    }
    if (!carnetFiles.length) {
      return response.status(400).json({ error: 'Le carnet de vaccination est obligatoire.' });
    }
    if (beneficiaireVacaf && !cafFiles.length) {
      return response.status(400).json({ error: 'Le justificatif CAF/VACAF est obligatoire pour les bénéficiaires.' });
    }
    if (fieldStr(fields, 'certification') !== 'true') {
      return response.status(400).json({ error: 'La certification du responsable légal est obligatoire.' });
    }

    let dossierNumero = fieldStr(fields, 'dossierNumero');
    if (!/^COL-\d{4}-/.test(dossierNumero)) {
      dossierNumero = await assignDossierNumber(submissionId);
    }

    const meta = {
      submissionId,
      dossierNumero,
      submittedAt: new Date().toISOString(),
      sejour: safeJson(fieldStr(fields, 'sejour')),
      enfant: safeJson(fieldStr(fields, 'enfant')),
      responsable: safeJson(fieldStr(fields, 'responsable')),
      beneficiaireVacaf,
      numeroAllocataire: fieldStr(fields, 'numeroAllocataire') || null,
      autorisationPartagePrive: fieldStr(fields, 'autorisationPartagePrive') === 'true',
      autorisationCommunicationPublique: fieldStr(fields, 'autorisationCommunicationPublique') === 'true',
    };

    // ── Enregistrement Supabase (source de vérité, visible dans l'espace Admin) ──
    const supabaseAdmin = getSupabaseAdmin();
    let dossier = null;
    try {
      const { data: existing } = await supabaseAdmin.from('dossiers').select('*').eq('numero', dossierNumero).maybeSingle();
      if (existing) {
        dossier = existing;
      } else {
        const { data: inserted, error: insErr } = await supabaseAdmin.from('dossiers').insert({
          numero: dossierNumero,
          source: 'public',
          client_type: 'colony',
          etablissement: `${meta.enfant?.prenom || ''} ${meta.enfant?.nom || ''}`.trim() || 'Colonie',
          enfant_nom: meta.enfant?.nom || null,
          enfant_prenom: meta.enfant?.prenom || null,
          enfant_date_naissance: meta.enfant?.ddn || null,
          enfant_sexe: meta.enfant?.sexe || null,
          colonie_nom: meta.sejour?.nom || null,
          contact_nom: meta.responsable?.identite || null,
          contact_telephone: meta.responsable?.telephone || null,
          contact_email: meta.responsable?.email || null,
          beneficiaire_vacaf: beneficiaireVacaf,
          numero_allocataire: meta.numeroAllocataire,
          autorisation_partage_prive: meta.autorisationPartagePrive,
          autorisation_communication_publique: meta.autorisationCommunicationPublique,
        }).select().single();
        if (insErr) throw insErr;
        dossier = inserted;
      }
    } catch (error) {
      return response.status(500).json({ error: 'Échec de l\'enregistrement du dossier. Merci de réessayer ou de nous contacter directement.' });
    }

    // Documents : uploadés dans le stockage privé et rattachés au dossier (non bloquant).
    if (ficheFiles[0]) await uploadDoc(supabaseAdmin, dossier.id, 'fiche_inscription_signee', ficheFiles[0]);
    if (carnetFiles[0]) {
      await uploadDoc(supabaseAdmin, dossier.id, 'carnet_vaccination', carnetFiles[0], carnetFiles.length > 1 ? `${carnetFiles.length} fichiers déposés` : undefined);
      for (let i = 1; i < carnetFiles.length; i++) {
        await uploadRaw(supabaseAdmin, dossier.id, 'carnet_vaccination', carnetFiles[i]);
      }
    }
    if (cafFiles[0]) await uploadDoc(supabaseAdmin, dossier.id, 'justificatif_caf', cafFiles[0]);
    if (ficheGenereeFiles[0]) await uploadDoc(supabaseAdmin, dossier.id, 'fiche_generee', ficheGenereeFiles[0]);

    const nomSlug = slugify(meta.enfant?.nom);
    const prenomSlug = slugify(meta.enfant?.prenom);
    const buildAttachment = (f, filename) => ({ filename, content: fs.readFileSync(f.filepath) });

    const attachments = [];
    if (ficheGenereeFiles[0]) {
      attachments.push(buildAttachment(ficheGenereeFiles[0], `${dossierNumero}_Fiche_generee_${nomSlug}_${prenomSlug}.${extOf(ficheGenereeFiles[0].originalFilename)}`));
    }
    attachments.push(buildAttachment(ficheFiles[0], `${dossierNumero}_Fiche_signee_${nomSlug}_${prenomSlug}.${extOf(ficheFiles[0].originalFilename)}`));
    carnetFiles.forEach((f, i) => {
      attachments.push(buildAttachment(f, `${dossierNumero}_Vaccinations_${i + 1}_${nomSlug}_${prenomSlug}.${extOf(f.originalFilename)}`));
    });
    if (cafFiles[0]) {
      attachments.push(buildAttachment(cafFiles[0], `${dossierNumero}_Attestation_CAF_${nomSlug}_${prenomSlug}.${extOf(cafFiles[0].originalFilename)}`));
    }

    const docsStatus = {
      ficheGeneree: !!ficheGenereeFiles.length,
      fiche: true,
      carnet: true,
      carnetCount: carnetFiles.length,
      caf: !!cafFiles.length,
      cafRequired: beneficiaireVacaf,
      links: [],
    };

    let emailError = null;
    if (!process.env.RESEND_API_KEY) {
      emailError = 'RESEND_API_KEY manquant.';
    } else {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const from = process.env.EMAIL_FROM
          || (process.env.RESEND_EMAIL_DOMAIN ? `Fun Loisirs Réunion <inscriptions@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Fun Loisirs Réunion <onboarding@resend.dev>');
        const { error: sendError } = await resend.emails.send({
          from,
          to: process.env.EMAIL_TO || 'contact.funloisirsreunion@gmail.com',
          subject: buildEmailSubject(meta),
          html: buildEmailHtml(meta, docsStatus),
          attachments,
        });
        if (sendError) throw new Error(sendError.message || JSON.stringify(sendError));
      } catch (error) {
        emailError = error.message;
      }
    }

    if (emailError) {
      try {
        await supabaseAdmin.from('dossier_journal').insert({
          dossier_id: dossier.id,
          action: 'notification_echec',
          details: 'Échec de l\'envoi de la notification e-mail : ' + emailError,
        });
      } catch { /* non bloquant */ }
    }

    // Le dossier et les documents sont enregistrés : on ne fait jamais échouer
    // la confirmation famille à cause d'un problème d'e-mail interne.
    return response.status(200).json({ ok: true, dossierNumero, docsStatus });
  } finally {
    allFiles.forEach((f) => { try { fs.unlinkSync(f.filepath); } catch { /* fichier temporaire déjà nettoyé */ } });
  }
}
