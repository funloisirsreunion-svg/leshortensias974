import { assignDossierNumber } from '../lib/dossierNumber.js';

function isValidSubmissionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{10,80}$/.test(id);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }
  const { submissionId } = request.body || {};
  if (!isValidSubmissionId(submissionId)) {
    return response.status(400).json({ error: 'Identifiant de dossier invalide.' });
  }
  try {
    const dossierNumero = await assignDossierNumber(submissionId);
    return response.status(200).json({ dossierNumero });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Échec de l\'attribution du numéro de dossier.' });
  }
}
