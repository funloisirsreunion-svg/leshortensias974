import { formidable } from 'formidable';
import fs from 'node:fs';
import { Resend } from 'resend';
import { assignDossierNumber } from '../lib/dossierNumber.js';
import { slugify } from '../lib/slugify.js';
import { buildEmailSubject, buildEmailHtml } from '../lib/emailTemplate.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

// Reçoit le formulaire colonie en multipart/form-data (texte + fichiers).
// Enregistre d'abord la fiche participant (rattachée au séjour colony_stays
// concerné) et les documents dans Supabase (source de vérité, visible dans
// l'espace Admin) puis tente l'e-mail de notification avec les pièces
// jointes réelles. Un échec d'e-mail ne fait jamais perdre l'inscription,
// déjà enregistrée en base à ce stade.

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
function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Upload brut dans le stockage privé, sans toucher à la table documents
// (utilisé pour les pages supplémentaires d'un carnet de vaccination multi-fichiers :
// la ligne documents ne peut référencer qu'un seul storage_path par type).
async function uploadRaw(supabaseAdmin, registrationId, docType, file) {
  try {
    const safeName = (file.originalFilename || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${registrationId}/${docType}/${Date.now()}_${safeName}`;
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
async function uploadDoc(supabaseAdmin, registrationId, docType, file, label) {
  try {
    const safeName = (file.originalFilename || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${registrationId}/${docType}/${Date.now()}_${safeName}`;
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
    }).eq('colony_registration_id', registrationId).eq('type', docType);
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

    const stayId = meta.sejour && meta.sejour.id;
    if (!isUuid(stayId)) {
      return response.status(400).json({ error: 'Séjour sélectionné invalide. Merci de recharger la page et de réessayer.' });
    }

    // ── Enregistrement Supabase (source de vérité, visible dans l'espace Admin) ──
    const supabaseAdmin = getSupabaseAdmin();
    let registration = null;
    try {
      const { data: stay, error: stayErr } = await supabaseAdmin
        .from('colony_stays')
        .select('id, nom, tarif_public, public_registration_open, statut, archived_at')
        .eq('id', stayId)
        .maybeSingle();
      if (stayErr) throw stayErr;
      if (!stay || !stay.public_registration_open || stay.statut === 'annule' || stay.archived_at) {
        return response.status(400).json({ error: 'Ce séjour n\'accepte plus d\'inscriptions pour le moment. Merci de rafraîchir la page.' });
      }

      const { data: existing } = await supabaseAdmin.from('colony_registrations').select('*').eq('numero', dossierNumero).maybeSingle();
      if (existing) {
        registration = existing;
      } else {
        const { data: inserted, error: insErr } = await supabaseAdmin.from('colony_registrations').insert({
          numero: dossierNumero,
          stay_id: stay.id,
          source: 'public',
          enfant_nom: meta.enfant?.nom || null,
          enfant_prenom: meta.enfant?.prenom || null,
          enfant_date_naissance: meta.enfant?.ddn || null,
          enfant_sexe: meta.enfant?.sexe || null,
          contact_nom: meta.responsable?.identite || null,
          contact_telephone: meta.responsable?.telephone || null,
          contact_email: meta.responsable?.email || null,
          beneficiaire_vacaf: beneficiaireVacaf,
          numero_allocataire: meta.numeroAllocataire,
          autorisation_partage_prive: meta.autorisationPartagePrive,
          autorisation_communication_publique: meta.autorisationCommunicationPublique,
          tarif_sejour: stay.tarif_public ?? null,
          montant_du: stay.tarif_public ?? null,
        }).select().single();
        if (insErr) throw insErr;
        registration = inserted;
      }
    } catch (error) {
      return response.status(500).json({ error: 'Échec de l\'enregistrement de l\'inscription. Merci de réessayer ou de nous contacter directement.' });
    }

    // Documents : uploadés dans le stockage privé et rattachés à la fiche (non bloquant).
    if (ficheFiles[0]) await uploadDoc(supabaseAdmin, registration.id, 'fiche_inscription_signee', ficheFiles[0]);
    if (carnetFiles[0]) {
      await uploadDoc(supabaseAdmin, registration.id, 'carnet_vaccination', carnetFiles[0], carnetFiles.length > 1 ? `${carnetFiles.length} fichiers déposés` : undefined);
      for (let i = 1; i < carnetFiles.length; i++) {
        await uploadRaw(supabaseAdmin, registration.id, 'carnet_vaccination', carnetFiles[i]);
      }
    }
    if (cafFiles[0]) await uploadDoc(supabaseAdmin, registration.id, 'justificatif_caf', cafFiles[0]);
    if (ficheGenereeFiles[0]) await uploadDoc(supabaseAdmin, registration.id, 'fiche_generee', ficheGenereeFiles[0]);

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
      const enfantLabel = `${meta.enfant?.prenom || ''} ${meta.enfant?.nom || ''}`.trim() || dossierNumero;
      try {
        await supabaseAdmin.from('dossier_journal').insert({
          colony_registration_id: registration.id,
          action: 'notification_echec',
          details: 'Échec de l\'envoi de la notification e-mail : ' + emailError,
        });
      } catch { /* non bloquant */ }
      try {
        await supabaseAdmin.from('notifications').insert({
          type: 'echec_envoi_mail',
          colony_registration_id: registration.id,
          audience: 'admin',
          message: `Échec de l'envoi du mail — ${enfantLabel} (${meta.sejour?.nom || 'séjour'})`,
        });
      } catch { /* non bloquant */ }
    }

    // La fiche et les documents sont enregistrés : on ne fait jamais échouer
    // la confirmation famille à cause d'un problème d'e-mail interne.
    return response.status(200).json({ ok: true, dossierNumero, docsStatus });
  } finally {
    allFiles.forEach((f) => { try { fs.unlinkSync(f.filepath); } catch { /* fichier temporaire déjà nettoyé */ } });
  }
}
