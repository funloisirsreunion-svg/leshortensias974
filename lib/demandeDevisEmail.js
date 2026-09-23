import { computeClassEstimate, formatMontant } from './appConstants.js';
import { section, layout } from './quoteEmailLayout.js';

const NIVEAUX = { maternelle: 'Maternelle', cp: 'CP', ce1: 'CE1', ce2: 'CE2', cm1: 'CM1', cm2: 'CM2', autre: 'Autre' };

export function buildDemandeDevisSubject(etablissement) {
  return `Nouvelle demande de devis – Classe de découverte – ${etablissement}`;
}

export function buildDemandeDevisHtml({ dossier, adminUrl, nbClasses }) {
  const programmeLabel = dossier.programme === 'volcan' ? 'Classe Volcan' : dossier.programme === 'nature' ? 'Classe Nature' : null;
  const contact = [dossier.contact_prenom, dossier.contact_nom].filter(Boolean).join(' ')
    + (dossier.contact_fonction ? ` (${dossier.contact_fonction})` : '');
  const niveaux = Object.keys(dossier.niveaux || {}).filter((k) => dossier.niveaux[k]).map((k) => NIVEAUX[k] || k).join(', ');

  // Même fonction de calcul que l'Admin (lib/appConstants.js) — jamais de montant inventé.
  const est = computeClassEstimate({
    programme: dossier.programme,
    duree: dossier.duree,
    nbEleves: dossier.effectif_prev_eleves,
    nbProfs: dossier.effectif_prev_profs,
    nbAccompagnateurs: dossier.effectif_prev_accompagnateurs,
  });

  const blocs = [
    section('ÉTABLISSEMENT', [
      ['Nom', dossier.etablissement], ['Commune', dossier.commune], ['Code postal', dossier.code_postal],
    ]),
    section('CONTACT', [
      ['Nom', contact], ['E-mail', dossier.contact_email], ['Téléphone', dossier.contact_telephone],
    ]),
    section('SÉJOUR', [
      ['Programme', programmeLabel],
      ['Durée', dossier.duree ? `${dossier.duree} jours` : null],
      ['Période souhaitée', dossier.periode_souhaitee],
      ['Niveaux', niveaux],
    ]),
    section('EFFECTIFS PRÉVISIONNELS', [
      ['Élèves', dossier.effectif_prev_eleves],
      ['Professeurs', dossier.effectif_prev_profs],
      ['Accompagnateurs', dossier.effectif_prev_accompagnateurs],
      ['Nombre de classes', nbClasses],
    ]),
    est ? section('ESTIMATION', [['Montant prévisionnel', `${formatMontant(est.total)} TTC`]]) : '',
  ].join('');

  return layout({
    titre: 'NOUVELLE DEMANDE DE DEVIS',
    sousTitre: 'Classe de découverte',
    numero: dossier.numero,
    blocs,
    adminUrl,
  });
}
