import { put } from '@vercel/blob';

function isValidSubmissionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{10,80}$/.test(id);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const data = request.body;

  if (!data || !isValidSubmissionId(data.submissionId)) {
    return response.status(400).json({ error: 'Identifiant de dossier invalide.' });
  }

  // Contrôle serveur des documents obligatoires (en plus du contrôle côté client)
  const files = Array.isArray(data.files) ? data.files : [];
  const hasFiche = files.some(f => f.docType === 'fiche' && f.pathname);
  const hasCarnet = files.some(f => f.docType === 'carnet' && f.pathname);
  const hasCaf = files.some(f => f.docType === 'caf' && f.pathname);

  if (!hasFiche) {
    return response.status(400).json({ error: 'La fiche d\'inscription signée est obligatoire.' });
  }
  if (!hasCarnet) {
    return response.status(400).json({ error: 'Le carnet de vaccination est obligatoire.' });
  }
  if (data.beneficiaireVacaf === true && !hasCaf) {
    return response.status(400).json({ error: 'Le justificatif CAF/VACAF est obligatoire pour les bénéficiaires.' });
  }

  const meta = {
    submissionId: data.submissionId,
    submittedAt: new Date().toISOString(),
    sejour: data.sejour || null,
    enfant: data.enfant || null,
    responsable: data.responsable || null,
    beneficiaireVacaf: data.beneficiaireVacaf === true,
    numeroAllocataire: data.numeroAllocataire || null,
    autorisationPartagePrive: data.autorisationPartagePrive || null,
    autorisationCommunicationPublique: data.autorisationCommunicationPublique || null,
    files: files.map(f => ({
      docType: f.docType,
      pathname: f.pathname,
      name: f.name,
      size: f.size,
    })),
  };

  try {
    await put(`submissions/${data.submissionId}/meta.json`, JSON.stringify(meta, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return response.status(200).json({ ok: true, submissionId: data.submissionId });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Échec de l\'enregistrement du dossier.' });
  }
}
