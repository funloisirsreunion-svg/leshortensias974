// Référentiels partagés entre l'espace Écoles et l'espace Admin.
// Module ES importé directement par le navigateur (pas de build).

export const STATUTS = [
  { value: 'demande_recue', label: 'Demande reçue' },
  { value: 'etude', label: 'Étude' },
  { value: 'date_proposee', label: 'Date proposée' },
  { value: 'date_validee', label: 'Date validée' },
  { value: 'devis_envoye', label: 'Devis envoyé' },
  { value: 'devis_accepte', label: 'Devis accepté' },
  { value: 'acompte_attendu', label: 'Acompte attendu' },
  { value: 'acompte_recu', label: 'Acompte reçu' },
  { value: 'sejour_confirme', label: 'Séjour confirmé' },
  { value: 'dossier_incomplet', label: 'Dossier incomplet' },
  { value: 'dossier_complet', label: 'Dossier complet' },
  { value: 'sejour_en_cours', label: 'Séjour en cours' },
  { value: 'sejour_termine', label: 'Séjour terminé' },
  { value: 'facture_envoyee', label: 'Facture envoyée' },
  { value: 'solde_attendu', label: 'Solde attendu' },
  { value: 'solde', label: 'Soldé' },
  { value: 'cloture', label: 'Clôturé' },
  { value: 'annule', label: 'Annulé' },
];

export const DOCUMENTS = [
  { value: 'devis', label: 'Devis' },
  { value: 'devis_signe', label: 'Devis signé' },
  { value: 'attestation_mairie', label: 'Attestation part mairie' },
  { value: 'autre_prise_en_charge', label: 'Autre prise en charge' },
  { value: 'facture', label: 'Facture' },
  { value: 'facture_finale', label: 'Facture finale' },
  { value: 'effectif_definitif', label: 'Effectif définitif' },
  { value: 'regimes_alimentaires', label: 'Régimes alimentaires' },
  { value: 'transport', label: 'Transport' },
  { value: 'autre', label: 'Autre document' },
];

export const DOC_STATUTS = [
  { value: 'a_fournir', label: 'À fournir', color: 'gray', dot: '⚪' },
  { value: 'recu', label: 'Reçu', color: 'orange', dot: '🟠' },
  { value: 'a_verifier', label: 'À vérifier', color: 'orange', dot: '🟠' },
  { value: 'valide', label: 'Validé', color: 'green', dot: '🟢' },
  { value: 'non_requis', label: 'Non requis', color: 'gray', dot: '⚪' },
];

export const REGIMES = [
  { value: 'normal', label: 'Normal' },
  { value: 'sans_porc', label: 'Sans porc' },
  { value: 'vegetarien', label: 'Végétarien' },
  { value: 'sans_lactose', label: 'Sans lactose' },
  { value: 'sans_gluten', label: 'Sans gluten' },
  { value: 'allergies', label: 'Allergies alimentaires' },
  { value: 'autre', label: 'Autre' },
];

export const NIVEAUX = [
  { key: 'maternelle', label: 'Maternelle' },
  { key: 'cp', label: 'CP' },
  { key: 'ce1', label: 'CE1' },
  { key: 'ce2', label: 'CE2' },
  { key: 'cm1', label: 'CM1' },
  { key: 'cm2', label: 'CM2' },
  { key: 'autre', label: 'Autre' },
];

export function labelOf(list, value, key = 'value') {
  const found = list.find((item) => item[key] === value);
  return found ? found.label : value;
}

export function badgeClassForDocStatut(value) {
  const found = DOC_STATUTS.find((d) => d.value === value);
  const color = found ? found.color : 'gray';
  return `app-badge app-badge-${color}`;
}

export function formatDateFr(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function formatMontant(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
