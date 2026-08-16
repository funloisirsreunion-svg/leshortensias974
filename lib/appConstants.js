// Référentiels partagés entre l'espace Écoles et l'espace Admin.
// Module ES importé directement par le navigateur (pas de build).

export const STATUTS = [
  { value: 'demande_recue', label: 'Nouvelle demande' },
  { value: 'demande_validee', label: 'Demande validée' },
  { value: 'refusee', label: 'Refusée' },
  { value: 'archivee', label: 'Archivée' },
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

export const CLIENT_TYPES = [
  { value: 'school', label: 'Classe de découverte', badge: '🏫' },
  { value: 'group', label: 'Groupe indépendant', badge: '👥' },
  { value: 'colony', label: 'Colonie de vacances', badge: '🏕️' },
];

export const STRUCTURE_TYPES = [
  { value: 'association', label: 'Association' },
  { value: 'club_sportif', label: 'Club sportif' },
  { value: 'entreprise', label: 'Entreprise' },
  { value: 'collectivite', label: 'Collectivité' },
  { value: 'famille', label: 'Famille / groupe privé' },
  { value: 'etablissement', label: 'Établissement' },
  { value: 'organisme_public', label: 'Organisme public' },
  { value: 'autre', label: 'Autre' },
];

export const FORMULES = [
  { value: 'pension_complete', label: 'Pension complète' },
  { value: 'demi_pension', label: 'Demi-pension' },
  { value: 'weekend', label: 'Forfait week-end' },
  { value: 'autre', label: 'Autre / sur devis' },
];

export const DOCUMENTS_SCHOOL = [
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

export const DOCUMENTS_GROUP = [
  { value: 'devis', label: 'Devis' },
  { value: 'devis_signe', label: 'Devis signé' },
  { value: 'facture', label: 'Facture' },
  { value: 'facture_finale', label: 'Facture finale' },
  { value: 'autre_prise_en_charge', label: 'Attestation éventuelle' },
  { value: 'autre', label: 'Autre document' },
];

export const DOCUMENTS_COLONY = [
  { value: 'fiche_inscription_signee', label: 'Fiche d\'inscription signée' },
  { value: 'carnet_vaccination', label: 'Carnet de vaccination' },
  { value: 'justificatif_caf', label: 'Justificatif CAF/VACAF' },
  { value: 'fiche_generee', label: 'Fiche générée (PDF)' },
  { value: 'facture', label: 'Facture' },
  { value: 'autre', label: 'Autre document' },
];

export const DOCUMENTS_BY_TYPE = {
  school: DOCUMENTS_SCHOOL,
  group: DOCUMENTS_GROUP,
  colony: DOCUMENTS_COLONY,
};

export function documentsForType(clientType) {
  return DOCUMENTS_BY_TYPE[clientType] || DOCUMENTS_SCHOOL;
}

// Alias conservé pour compatibilité (équivalent à DOCUMENTS_SCHOOL).
export const DOCUMENTS = DOCUMENTS_SCHOOL;

// Tous les types de documents existants (union des 3 checklists + types
// "admin" ajoutables ponctuellement, hors checklist par défaut) — utilisé
// pour libeller n'importe quelle ligne réellement présente en base, y compris
// les documents ajoutés à la main par l'admin au-delà de la checklist type.
export const ALL_DOCUMENT_TYPES = [
  ...DOCUMENTS_SCHOOL,
  ...DOCUMENTS_GROUP.filter(d => !DOCUMENTS_SCHOOL.some(s => s.value === d.value)),
  ...DOCUMENTS_COLONY.filter(d => !DOCUMENTS_SCHOOL.some(s => s.value === d.value) && !DOCUMENTS_GROUP.some(g => g.value === d.value)),
  { value: 'programme_sejour', label: 'Programme du séjour' },
  { value: 'document_information', label: 'Document d\'information' },
  { value: 'autre_admin', label: 'Autre document administratif' },
];

export function labelForDocumentType(type) {
  return labelOf(ALL_DOCUMENT_TYPES, type);
}

export const DOCUMENT_SOURCES = [
  { value: 'admin', label: 'Fun Loisirs Réunion' },
  { value: 'client', label: 'Client' },
  { value: 'both', label: 'Les deux' },
];

export const DOC_STATUTS = [
  { value: 'a_fournir', label: 'À fournir', color: 'gray', dot: '⚪' },
  { value: 'recu', label: 'Reçu', color: 'orange', dot: '🟠' },
  { value: 'a_verifier', label: 'À vérifier', color: 'orange', dot: '🟠' },
  { value: 'valide', label: 'Validé', color: 'green', dot: '🟢' },
  { value: 'refuse', label: 'Refusé', color: 'red', dot: '🔴' },
  { value: 'non_requis', label: 'Non requis', color: 'gray', dot: '⚪' },
];

// Complétude d'un dossier : les documents "non_requis" sont totalement
// exclus des compteurs (jamais comptés comme manquants, jamais dans le
// dénominateur) — §13 à §18 de la demande.
export function docCompleteness(documentsList) {
  const required = (documentsList || []).filter(d => d.statut !== 'non_requis');
  const valides = required.filter(d => d.statut === 'valide').length;
  const aVerifier = required.filter(d => d.statut === 'a_verifier').length;
  const refuses = required.filter(d => d.statut === 'refuse').length;
  const manquants = required.filter(d => d.statut === 'a_fournir').length;
  return {
    total: required.length,
    valides, aVerifier, refuses, manquants,
    complete: required.length > 0 && valides === required.length,
  };
}

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

export const JOURNAL_LABELS = {
  demande_creee: 'Nouvelle demande reçue',
  dossier_cree: 'Dossier créé',
  demande_detail: 'Détails de la demande',
  notification_echec: 'Échec de l\'envoi de la notification',
  devis_prepare: 'Devis préparé',
  devis_envoye: 'Devis envoyé',
  demande_validee: 'Demande validée',
  demande_refusee: 'Demande refusée',
  demande_archivee: 'Demande archivée',
  date_proposee: 'Date proposée',
  date_confirmee: 'Date confirmée',
  document_depose: 'Document déposé',
  document_valide: 'Document validé',
  virement_signale: 'Virement signalé',
  paiement_enregistre: 'Paiement enregistré',
  acces_ajoute: 'Accès client ajouté',
  invitation_envoyee: 'Invitation envoyée',
  compte_active: 'Compte activé',
  acces_desactive: 'Accès désactivé',
  acces_reactive: 'Accès réactivé',
  relance_envoyee: 'Relance envoyée',
  document_ajoute: 'Document ajouté',
  document_remplace: 'Document remplacé',
  document_supprime: 'Document retiré',
  document_refuse: 'Document refusé',
  document_non_requis: 'Document marqué non requis',
  document_requis_again: 'Document redevenu requis',
  mail_document_envoye: 'E-mail document envoyé au client',
  mail_refus_envoye: 'E-mail de refus envoyé au client',
  dossier_archive: 'Dossier archivé',
  dossier_restaure: 'Dossier restauré',
  inscription_creee: 'Nouvelle inscription reçue (site public)',
  inscription_creee_admin: 'Fiche créée par l\'administrateur',
  statut_colonie_change: 'Statut de la fiche modifié',
  paiement_colonie_enregistre: 'Paiement enregistré',
  inscription_supprimee: 'Fiche supprimée définitivement',
  sejour_cree: 'Séjour créé',
  sejour_archive: 'Séjour archivé',
  sejour_restaure: 'Séjour restauré',
};

export const COLONY_STAY_STATUTS = [
  { value: 'brouillon', label: 'Brouillon', color: 'gray' },
  { value: 'ouvert', label: 'Ouvert aux inscriptions', color: 'green' },
  { value: 'ferme', label: 'Fermé aux inscriptions', color: 'orange' },
  { value: 'termine', label: 'Terminé', color: 'gray' },
  { value: 'annule', label: 'Annulé', color: 'red' },
];

export const COLONY_REGISTRATION_STATUTS = [
  { value: 'demande_recue', label: 'Demande reçue' },
  { value: 'a_verifier', label: 'À vérifier' },
  { value: 'dossier_incomplet', label: 'Dossier incomplet' },
  { value: 'dossier_complet', label: 'Dossier complet' },
  { value: 'paiement_partiel', label: 'Paiement partiel' },
  { value: 'paiement_complet', label: 'Paiement complet' },
  { value: 'confirmee', label: 'Inscription confirmée' },
  { value: 'annulee', label: 'Annulée' },
];

export const ACCESS_STATUTS = [
  { value: 'invitation_envoyee', label: 'Invitation envoyée', color: 'orange' },
  { value: 'compte_active', label: 'Compte activé', color: 'green' },
  { value: 'desactive', label: 'Accès désactivé', color: 'red' },
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

// ==========================================================
// Grille tarifaire Classes de découverte (Volcan / Nature) — source
// unique, réutilisée par le calcul Admin et toute future génération de
// devis. Ne jamais dupliquer ces valeurs ailleurs : les modifier ici
// suffit à mettre à jour tout le site.
// ==========================================================

// Tarif TTC par élève, selon programme et durée du séjour.
export const CLASS_PRICING = {
  volcan: { 3: 162, 4: 208, 5: 250 },
  nature: { 3: 156, 4: 200, 5: 240 },
};

// Les professeurs sont toujours gratuits (jamais de tarif appliqué).
export const CLASS_PROF_RATE = 0;

// Tarif accompagnateur = ce ratio × tarif élève, selon la durée du séjour.
export const CLASS_ACCOMPAGNATEUR_RATIO = { 3: 0.70, 4: 0.60, 5: 0.50 };

/**
 * Calcule l'estimation du devis Classe de découverte à partir des effectifs
 * prévisionnels. Retourne null si programme/durée/élèves ne sont pas
 * renseignés (pas assez d'informations pour une estimation).
 */
export function computeClassEstimate({ programme, duree, nbEleves, nbProfs, nbAccompagnateurs }) {
  const tarifsProgramme = CLASS_PRICING[programme];
  const ratio = CLASS_ACCOMPAGNATEUR_RATIO[duree];
  if (!tarifsProgramme || !duree || ratio === undefined || !nbEleves) return null;
  const tarifEleve = tarifsProgramme[duree];
  if (tarifEleve === undefined) return null;

  const eleves = Number(nbEleves) || 0;
  const profs = Number(nbProfs) || 0;
  const accompagnateurs = Number(nbAccompagnateurs) || 0;

  const tarifAccompagnateur = Math.round(tarifEleve * ratio * 100) / 100;
  const montantEleves = eleves * tarifEleve;
  const montantProfs = profs * CLASS_PROF_RATE;
  const montantAccompagnateurs = accompagnateurs * tarifAccompagnateur;
  const total = montantEleves + montantProfs + montantAccompagnateurs;

  return {
    programme, duree,
    nbEleves: eleves, nbProfs: profs, nbAccompagnateurs: accompagnateurs,
    tarifEleve, tarifProf: CLASS_PROF_RATE, tarifAccompagnateur,
    montantEleves, montantProfs, montantAccompagnateurs,
    total,
    calculeLe: new Date().toISOString(),
  };
}
