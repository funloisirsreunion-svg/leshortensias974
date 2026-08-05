import { put } from '@vercel/blob';
import { Resend } from 'resend';
import { assignDossierNumber } from '../lib/dossierNumber.js';
import { slugify } from '../lib/slugify.js';
import { buildAttachmentsOrLinks } from '../lib/attachments.js';
import { buildEmailSubject, buildEmailHtml } from '../lib/emailTemplate.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo par fichier (voir cahier des charges §9)

function isValidSubmissionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{10,80}$/.test(id);
}

const DOC_LABELS = {
  ficheGeneree: 'Fiche_generee',
  fiche: 'Fiche_signee',
  carnet: 'Vaccinations',
  caf: 'Attestation_CAF',
};

function attachmentFilename(dossierNumero, docType, ext, nomSlug, prenomSlug, index) {
  const label = DOC_LABELS[docType] || docType;
  const idx = index != null ? `_${index}` : '';
  return `${dossierNumero}_${label}${idx}_${nomSlug}_${prenomSlug}.${ext}`;
}

function extOf(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return (m ? m[1] : 'bin').toLowerCase();
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const data = request.body;

  if (!data || !isValidSubmissionId(data.submissionId)) {
    return response.status(400).json({ error: 'Identifiant de dossier invalide.' });
  }

  const files = Array.isArray(data.files) ? data.files : [];
  const oversized = files.find((f) => (f.size || 0) > MAX_FILE_BYTES);
  if (oversized) {
    return response.status(400).json({ error: `Le fichier "${oversized.name}" dépasse la taille maximale autorisée (10 Mo).` });
  }

  const hasFicheGeneree = files.some((f) => f.docType === 'ficheGeneree' && f.pathname);
  const hasFiche = files.some((f) => f.docType === 'fiche' && f.pathname);
  const carnetFiles = files.filter((f) => f.docType === 'carnet' && f.pathname);
  const hasCarnet = carnetFiles.length > 0;
  const cafFile = files.find((f) => f.docType === 'caf' && f.pathname);
  const hasCaf = !!cafFile;

  if (!hasFicheGeneree) {
    return response.status(400).json({ error: 'La fiche d\'inscription générée par le site est manquante. Cliquez sur « Générer ma fiche d\'inscription ».' });
  }
  if (!hasFiche) {
    return response.status(400).json({ error: 'La fiche d\'inscription signée est obligatoire.' });
  }
  if (!hasCarnet) {
    return response.status(400).json({ error: 'Le carnet de vaccination est obligatoire.' });
  }
  if (data.beneficiaireVacaf === true && !hasCaf) {
    return response.status(400).json({ error: 'Le justificatif CAF/VACAF est obligatoire pour les bénéficiaires.' });
  }

  let dossierNumero;
  try {
    dossierNumero = data.dossierNumero && /^COL-\d{4}-\d{3,}$/.test(data.dossierNumero)
      ? data.dossierNumero
      : await assignDossierNumber(data.submissionId);
  } catch (error) {
    return response.status(500).json({ error: 'Échec de l\'attribution du numéro de dossier : ' + (error.message || '') });
  }

  const meta = {
    submissionId: data.submissionId,
    dossierNumero,
    submittedAt: new Date().toISOString(),
    sejour: data.sejour || null,
    enfant: data.enfant || null,
    responsable: data.responsable || null,
    beneficiaireVacaf: data.beneficiaireVacaf === true,
    numeroAllocataire: data.numeroAllocataire || null,
    autorisationPartagePrive: data.autorisationPartagePrive === true,
    autorisationCommunicationPublique: data.autorisationCommunicationPublique === true,
    files: files.map((f) => ({ docType: f.docType, pathname: f.pathname, name: f.name, size: f.size })),
  };

  try {
    await put(`submissions/${data.submissionId}/meta.json`, JSON.stringify(meta, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (error) {
    return response.status(500).json({ error: 'Échec de l\'enregistrement du dossier : ' + (error.message || '') });
  }

  // ── Préparation des pièces jointes ──────────────────────
  const nomSlug = slugify(meta.enfant?.nom);
  const prenomSlug = slugify(meta.enfant?.prenom);

  const items = [];
  let carnetIdx = 0;
  for (const f of files) {
    if (!['ficheGeneree', 'fiche', 'carnet', 'caf'].includes(f.docType)) continue;
    const ext = extOf(f.name);
    const index = f.docType === 'carnet' ? ++carnetIdx : null;
    items.push({
      pathname: f.pathname,
      size: f.size || 0,
      filename: attachmentFilename(dossierNumero, f.docType, ext, nomSlug, prenomSlug, index),
    });
  }

  let attachments = [];
  let links = [];
  try {
    const built = await buildAttachmentsOrLinks(items);
    attachments = built.attachments;
    links = built.links;
  } catch (error) {
    return response.status(500).json({ error: 'Échec de la préparation des pièces jointes : ' + (error.message || '') });
  }

  const docsStatus = {
    ficheGeneree: hasFicheGeneree,
    fiche: hasFiche,
    carnet: hasCarnet,
    carnetCount: carnetFiles.length,
    caf: hasCaf,
    links,
  };

  // ── Envoi de l'e-mail (avec pièces jointes réelles) ──────
  if (!process.env.RESEND_API_KEY) {
    return response.status(500).json({
      error: 'Le service d\'envoi d\'e-mail n\'est pas configuré (RESEND_API_KEY manquant). Le dossier a été enregistré mais n\'a pas pu être transmis par e-mail.',
    });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: sendError } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Fun Loisirs Réunion <onboarding@resend.dev>',
      to: process.env.EMAIL_TO || 'contact.funloisirsreunion@gmail.com',
      subject: buildEmailSubject(meta),
      html: buildEmailHtml(meta, docsStatus),
      attachments: attachments.length ? attachments : undefined,
    });
    if (sendError) {
      throw new Error(sendError.message || JSON.stringify(sendError));
    }
  } catch (error) {
    return response.status(502).json({
      error: 'L\'envoi du dossier par e-mail a échoué. Aucune inscription n\'a été transmise à l\'association. Merci de réessayer. (' + (error.message || '') + ')',
    });
  }

  return response.status(200).json({
    ok: true,
    dossierNumero,
    docsStatus: {
      ficheGeneree: hasFicheGeneree,
      fiche: hasFiche,
      carnet: hasCarnet,
      carnetCount: carnetFiles.length,
      caf: hasCaf,
      cafRequired: meta.beneficiaireVacaf,
      links: links.map((l) => l.filename),
    },
  });
}
