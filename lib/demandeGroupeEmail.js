import { section, layout } from './quoteEmailLayout.js';

const STRUCTURE_LABELS = {
  association: 'Association', club_sportif: 'Club sportif', entreprise: 'Entreprise',
  collectivite: 'Collectivité', famille: 'Famille / groupe privé', etablissement: 'Établissement',
  organisme_public: 'Organisme public', autre: 'Autre',
};
const FORMULE_LABELS = {
  pension_complete: 'Pension complète', demi_pension: 'Demi-pension', weekend: 'Forfait week-end', autre: 'Autre / sur devis',
};

function dateFr(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function buildDemandeGroupeSubject(structureNom) {
  return `Nouvelle demande de devis – Groupe – ${structureNom}`;
}

export function buildDemandeGroupeHtml({ dossier, adminUrl }) {
  const contact = [dossier.contact_prenom, dossier.contact_nom].filter(Boolean).join(' ')
    + (dossier.contact_fonction ? ` (${dossier.contact_fonction})` : '');
  const total = (dossier.nb_adultes || 0) + (dossier.nb_enfants || 0);
  const repas = [
    dossier.premier_repas && `Premier : ${dossier.premier_repas}`,
    dossier.dernier_repas && `Dernier : ${dossier.dernier_repas}`,
    dossier.repas_supplementaires_nombre ? `${dossier.repas_supplementaires_nombre} repas supplémentaire(s)` : null,
    dossier.gouter_souhaite ? `Goûter (${dossier.gouter_jours || 0} j)` : null,
  ].filter(Boolean).join(' · ');

  const blocs = [
    section('STRUCTURE', [['Nom', dossier.structure_nom], ['Type', STRUCTURE_LABELS[dossier.structure_type] || dossier.structure_type]]),
    section('CONTACT', [['Nom', contact], ['E-mail', dossier.contact_email], ['Téléphone', dossier.contact_telephone]]),
    section('SÉJOUR', [
      ["Date d'arrivée", dateFr(dossier.demande_date_arrivee)],
      ["Heure d'arrivée", dossier.demande_heure_arrivee],
      ['Date de départ', dateFr(dossier.demande_date_depart)],
      ['Heure de départ', dossier.demande_heure_depart],
      ['Nombre de personnes', total ? `${total} (${dossier.nb_adultes || 0} adultes, ${dossier.nb_enfants || 0} enfants)` : null],
    ]),
    section('FORMULE', [
      ['Formule', FORMULE_LABELS[dossier.formule] || dossier.formule],
      ['Repas', repas],
      ['Salle de réunion', dossier.salle_reunion ? 'Souhaitée' : null],
      ['Régimes / allergies', dossier.remarques_alimentaires],
      ['Besoins particuliers', dossier.besoins_particuliers],
      ['Estimation indicative', dossier.estimation_tarifaire],
    ]),
  ].join('');

  return layout({ titre: 'NOUVELLE DEMANDE DE DEVIS', sousTitre: 'Groupe indépendant', numero: dossier.numero, blocs, adminUrl });
}
