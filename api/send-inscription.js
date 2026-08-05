import { formidable } from 'formidable';
import fs from 'node:fs';
import { Resend } from 'resend';
import { assignDossierNumber } from '../lib/dossierNumber.js';
import { slugify } from '../lib/slugify.js';
import { buildEmailSubject, buildEmailHtml } from '../lib/emailTemplate.js';

// Un seul endpoint, simple et robuste : reçoit le formulaire en multipart/form-data
// (texte + fichiers), envoie directement l'e-mail avec les vraies pièces jointes.
// Aucune dépendance à un stockage externe (Vercel Blob) dans ce parcours : si Resend
// ou la numérotation de dossier a un problème, seul cet appel échoue proprement —
// rien d'autre à faire réussir avant.

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

    if (!process.env.RESEND_API_KEY) {
      return response.status(500).json({ error: 'Le service d\'envoi d\'e-mail n\'est pas configuré (RESEND_API_KEY manquant). Merci de réessayer plus tard.' });
    }

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
      return response.status(502).json({
        error: 'L\'envoi du dossier a échoué. Vos informations ont été conservées sur cette page. Merci de réessayer dans quelques instants. (' + (error.message || '') + ')',
      });
    }

    return response.status(200).json({ ok: true, dossierNumero, docsStatus });
  } finally {
    allFiles.forEach((f) => { try { fs.unlinkSync(f.filepath); } catch { /* fichier temporaire déjà nettoyé */ } });
  }
}
