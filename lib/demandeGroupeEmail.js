function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const STRUCTURE_LABELS = {
  association: 'Association', club_sportif: 'Club sportif', entreprise: 'Entreprise',
  collectivite: 'Collectivité', famille: 'Famille / groupe privé', etablissement: 'Établissement',
  organisme_public: 'Organisme public', autre: 'Autre',
};
const FORMULE_LABELS = {
  pension_complete: 'Pension complète', demi_pension: 'Demi-pension', weekend: 'Forfait week-end', autre: 'Autre / sur devis',
};

export function buildDemandeGroupeSubject(structureNom) {
  return `Nouvelle demande Groupe Indépendant – ${structureNom}`;
}

export function buildDemandeGroupeHtml({ dossier, adminUrl }) {
  const row = (label, value) => (value ? `<p style="margin:0 0 6px;"><strong>${label} :</strong> ${escapeHtml(value)}</p>` : '');
  const totalPersonnes = (dossier.nb_adultes || 0) + (dossier.nb_enfants || 0);
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Nouvelle demande de devis — Groupe Indépendant</h2>
    <p>Dossier <strong>${escapeHtml(dossier.numero)}</strong>, créé automatiquement depuis le site.</p>
    <div style="background:#f6f1e7;border-radius:8px;padding:18px;margin:18px 0;">
      ${row('Structure', dossier.structure_nom)}
      ${row('Type', STRUCTURE_LABELS[dossier.structure_type] || dossier.structure_type)}
      ${row('Contact', [dossier.contact_prenom, dossier.contact_nom].filter(Boolean).join(' ') + (dossier.contact_fonction ? ` (${dossier.contact_fonction})` : ''))}
      ${row('Téléphone', dossier.contact_telephone)}
      ${row('E-mail', dossier.contact_email)}
      ${row('Arrivée souhaitée', dossier.demande_date_arrivee ? `${dossier.demande_date_arrivee} ${dossier.demande_heure_arrivee || ''}` : null)}
      ${row('Départ souhaité', dossier.demande_date_depart ? `${dossier.demande_date_depart} ${dossier.demande_heure_depart || ''}` : null)}
      ${row('Participants', totalPersonnes ? `${totalPersonnes} (${dossier.nb_adultes || 0} adultes, ${dossier.nb_enfants || 0} enfants)` : null)}
      ${row('Formule', FORMULE_LABELS[dossier.formule] || dossier.formule)}
      ${row('Repas', [dossier.premier_repas && 'Premier : ' + dossier.premier_repas, dossier.dernier_repas && 'Dernier : ' + dossier.dernier_repas, dossier.repas_supplementaires_nombre ? dossier.repas_supplementaires_nombre + ' repas supp.' : null, dossier.gouter_souhaite ? 'Goûter (' + (dossier.gouter_jours || 0) + ' j)' : null].filter(Boolean).join(' · '))}
      ${row('Salle de réunion souhaitée', dossier.salle_reunion ? 'Oui' : null)}
      ${row('Régimes / allergies', dossier.remarques_alimentaires)}
      ${row('Besoins particuliers', dossier.besoins_particuliers)}
      ${row('Estimation indicative', dossier.estimation_tarifaire)}
    </div>
    <p><a href="${adminUrl}" style="display:inline-block;background:#2d5a27;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Ouvrir cette demande dans l'espace Admin</a></p>
  </div>`;
}
