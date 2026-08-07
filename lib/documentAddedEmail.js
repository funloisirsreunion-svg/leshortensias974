function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const SUBJECTS = {
  devis: 'Votre devis Les Hortensias est disponible',
  facture: 'Nouvelle facture disponible – Les Hortensias',
  facture_finale: 'Votre facture finale est disponible – Les Hortensias',
};

const LABELS = {
  devis: 'Devis',
  facture: 'Facture',
  facture_finale: 'Facture finale',
};

// Seuls ces 3 types de documents déclenchent un e-mail automatique (§10).
// Les autres documents (déposés par le client ou ajoutés par l'admin) ne
// génèrent qu'une notification interne, jamais de mail systématique.
export function shouldEmailForDocument(documentType) {
  return Object.prototype.hasOwnProperty.call(SUBJECTS, documentType);
}

export function buildDocumentAddedSubject(documentType) {
  return SUBJECTS[documentType] || 'Nouveau document disponible – Les Hortensias';
}

export function buildDocumentAddedHtml({ dossier, documentType, espaceClientUrl }) {
  const label = LABELS[documentType] || documentType;
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Les Hortensias</h2>
    <p>Bonjour${dossier.contact_prenom ? ' ' + escapeHtml(dossier.contact_prenom) : ''},</p>
    <p>Un nouveau document a été ajouté à votre espace client concernant votre séjour.</p>
    <p><strong>Dossier :</strong> ${escapeHtml(dossier.numero)}<br/>
       <strong>Document :</strong> ${escapeHtml(label)}</p>
    <p>Vous pouvez le consulter depuis votre espace client.</p>
    <p><a href="${espaceClientUrl}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Accéder à mon espace</a></p>
    <p style="margin-top:24px;">Centre Les Hortensias<br/>Fun Loisirs Réunion</p>
  </div>`;
}
