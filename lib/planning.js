// Planning & Réservations (Admin) — couche de lecture commune.
//
// Aucune donnée n'est stockée ici : le planning est une REPRÉSENTATION des
// dossiers existants (source de vérité unique). Ce module :
//   1) lit les dossiers Classes/Groupes (table `dossiers`) et les séjours
//      Colonies (table `colony_stays` + `colony_registrations`) pour une année
//      d'exploitation donnée ;
//   2) les normalise en "réservations" au même format, sans forcer les deux
//      modèles dans un seul schéma ;
//   3) fournit les calculs purs (année 01/10 → 30/09, présence par jour,
//      indicateurs, réservations validées à compléter) — testables sans base.
//
// Module ES importé directement par le navigateur (pas de build), comme
// appConstants.js.

import { STATUTS, COLONY_STAY_STATUTS, FORMULES, labelOf } from './appConstants.js';

// ==========================================================
// Statuts → groupes du planning
// ==========================================================

// Dossiers Classes / Groupes (enum dossier_statut). Une réservation est
// "validée" (séjour confirmé) à partir de `sejour_confirme` et pour toutes
// les étapes qui le suivent dans le workflow (dossier, séjour, facturation,
// clôture). Les étapes précédentes (demande validée, date proposée, devis,
// acompte…) restent "en attente" : le séjour n'est pas encore confirmé.
export const DOSSIER_STATUT_GROUPS = {
  demande_recue: 'nouvelle',
  demande_validee: 'en_attente',
  etude: 'en_attente',
  date_proposee: 'en_attente',
  date_validee: 'en_attente',
  devis_envoye: 'en_attente',
  devis_accepte: 'en_attente',
  acompte_attendu: 'en_attente',
  acompte_recu: 'en_attente',
  sejour_confirme: 'validee',
  dossier_incomplet: 'validee',
  dossier_complet: 'validee',
  sejour_en_cours: 'validee',
  sejour_termine: 'validee',
  facture_envoyee: 'validee',
  solde_attendu: 'validee',
  solde: 'validee',
  cloture: 'validee',
  refusee: 'refusee',
  annule: 'annulee',
  archivee: 'archivee',
};

// Séjours Colonies (enum colony_stay_statut) : un séjour ouvert, fermé aux
// inscriptions ou terminé est un séjour organisé par le centre (confirmé) ;
// un brouillon n'est pas encore décidé ; annulé = annulé.
export const COLONY_STATUT_GROUPS = {
  brouillon: 'en_attente',
  ouvert: 'validee',
  ferme: 'validee',
  termine: 'validee',
  annule: 'annulee',
};

export const VALIDATED_DOSSIER_STATUTS = Object.keys(DOSSIER_STATUT_GROUPS).filter(k => DOSSIER_STATUT_GROUPS[k] === 'validee');
export const VALIDATED_COLONY_STATUTS = Object.keys(COLONY_STATUT_GROUPS).filter(k => COLONY_STATUT_GROUPS[k] === 'validee');

// Filtre "Statut" du planning (le premier est celui par défaut).
export const STATUT_FILTERS = [
  { value: 'validee', label: 'Validées uniquement' },
  { value: 'en_attente', label: 'En attente' },
  { value: 'nouvelle', label: 'Nouvelles demandes' },
  { value: 'annulee', label: 'Annulées' },
  { value: 'refusee', label: 'Refusées' },
  { value: 'all', label: 'Toutes' },
];

export const STATUT_GROUP_LABELS = {
  validee: 'Réservation validée',
  en_attente: 'En attente',
  nouvelle: 'Nouvelle demande',
  annulee: 'Annulée',
  refusee: 'Refusée',
  archivee: 'Archivée',
};

// Types de séjours réellement présents dans le modèle de données.
// (Erasmus+ / Seniors n'existent pas encore comme type de dossier : il suffira
// d'ajouter une entrée ici le jour où le type sera créé.)
export const PLANNING_TYPES = [
  { value: 'school', label: 'Classe de découverte', short: 'Classe', plural: 'Classes', icon: '🏫', letter: 'C' },
  { value: 'group', label: 'Groupe indépendant', short: 'Groupe', plural: 'Groupes', icon: '👥', letter: 'G' },
  { value: 'colony', label: 'Colonie de vacances', short: 'Colonie', plural: 'Colonies', icon: '🏕️', letter: 'V' },
];

export function typeInfo(value) {
  return PLANNING_TYPES.find(t => t.value === value) || { value, label: value, short: value, plural: value, icon: '•', letter: '?' };
}

// ==========================================================
// Dates (chaînes ISO AAAA-MM-JJ, calculs en UTC : jamais de décalage horaire)
// ==========================================================

export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * 86400000);
}
export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}
export function isValidIso(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUTC(v));
}
export function todayIso(now = new Date()) {
  // Heure de La Réunion : la "journée" de l'Admin.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
// 0 = lundi … 6 = dimanche
export function weekdayMon(iso) {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}
export function daysInMonth(year, month0) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
export function monthStart(year, month0) {
  return fromUTC(Date.UTC(year, month0, 1));
}
export function monthEnd(year, month0) {
  return fromUTC(Date.UTC(year, month0, daysInMonth(year, month0)));
}

export function formatShort(iso, withYear = true) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return withYear ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`;
}
export function formatLong(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_FR[m - 1]} ${y}`;
}
// "26 → 30 avril" / "30 avril → 4 mai" / "28 déc. 2026 → 2 janv. 2027"
export function formatRange(debut, fin) {
  if (!debut || !fin) return debut ? `${formatLong(debut)} → ?` : fin ? `? → ${formatLong(fin)}` : 'Dates non renseignées';
  const [y1, m1, d1] = debut.split('-').map(Number);
  const [y2, m2, d2] = fin.split('-').map(Number);
  if (y1 !== y2) return `${d1} ${MONTHS_FR[m1 - 1]} ${y1} → ${d2} ${MONTHS_FR[m2 - 1]} ${y2}`;
  if (m1 === m2) return `${d1} → ${d2} ${MONTHS_FR[m2 - 1]}`;
  return `${d1} ${MONTHS_FR[m1 - 1]} → ${d2} ${MONTHS_FR[m2 - 1]}`;
}

// ==========================================================
// Année d'exploitation : 01/10/N → 30/09/N+1 (générée, jamais codée en dur)
// ==========================================================

export function operatingYear(startYear) {
  const y = Number(startYear);
  const months = [];
  for (let i = 0; i < 12; i++) {
    const month0 = (9 + i) % 12;
    const year = i < 3 ? y : y + 1;
    months.push({ index: i, year, month0, label: MONTHS_FR[month0], key: `${year}-${String(month0 + 1).padStart(2, '0')}` });
  }
  return { startYear: y, label: `${y}-${y + 1}`, start: `${y}-10-01`, end: `${y + 1}-09-30`, months };
}

// Année d'exploitation contenant une date (octobre → année N, sinon N-1).
export function operatingYearOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= 10 ? y : y - 1;
}

// ==========================================================
// Effectifs
// ==========================================================

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function sumKnown(values) {
  const known = values.filter(v => v !== null);
  return known.length ? known.reduce((s, v) => s + v, 0) : null;
}

// Dernière version VALIDÉE du bloc Effectifs (fiche Classe) : jamais une somme
// des versions, toujours la plus récente qui porte des données validées.
export function latestValidatedEffectifs(versions) {
  const valid = (versions || []).filter(v => v && v.donnees_validees && v.admin_validated_at);
  if (!valid.length) return null;
  return valid.reduce((best, v) => (v.version > best.version ? v : best));
}

function schoolCounts(src) {
  const def = { eleves: num(src.effectif_def_eleves), profs: num(src.effectif_def_profs), accompagnateurs: num(src.effectif_def_accompagnateurs) };
  if (def.eleves !== null || def.profs !== null || def.accompagnateurs !== null) return { ...def, kind: 'definitif' };
  const prev = { eleves: num(src.effectif_prev_eleves), profs: num(src.effectif_prev_profs), accompagnateurs: num(src.effectif_prev_accompagnateurs) };
  if (prev.eleves !== null || prev.profs !== null || prev.accompagnateurs !== null) return { ...prev, kind: 'previsionnel' };
  return null;
}

// Priorité : 1) derniers effectifs validés par l'Admin (bloc Effectifs),
// 2) effectif définitif du dossier, 3) effectif prévisionnel du dossier.
export function schoolEffectif(dossier, effectifVersions) {
  const v = latestValidatedEffectifs(effectifVersions);
  if (v) {
    const c = schoolCounts(v.donnees_validees);
    if (c) {
      return {
        total: sumKnown([c.eleves, c.profs, c.accompagnateurs]),
        details: [
          c.eleves !== null && { label: 'élèves', n: c.eleves },
          c.profs !== null && { label: 'professeurs', n: c.profs },
          c.accompagnateurs !== null && { label: 'accompagnateurs', n: c.accompagnateurs },
        ].filter(Boolean),
        source: `Effectifs validés par l'Admin (version ${v.version})`,
        sourceKind: 'valide',
      };
    }
  }
  const c = schoolCounts(dossier);
  if (!c) return { total: null, details: [], source: 'Effectif non renseigné', sourceKind: 'manquant' };
  return {
    total: sumKnown([c.eleves, c.profs, c.accompagnateurs]),
    details: [
      c.eleves !== null && { label: 'élèves', n: c.eleves },
      c.profs !== null && { label: 'professeurs', n: c.profs },
      c.accompagnateurs !== null && { label: 'accompagnateurs', n: c.accompagnateurs },
    ].filter(Boolean),
    source: c.kind === 'definitif' ? 'Effectif définitif du dossier' : 'Effectif prévisionnel du dossier',
    sourceKind: c.kind,
  };
}

export function groupEffectif(dossier) {
  const adultes = num(dossier.nb_adultes);
  const enfants = num(dossier.nb_enfants);
  const total = sumKnown([adultes, enfants]);
  if (total === null || total === 0) return { total: null, details: [], source: 'Effectif non renseigné', sourceKind: 'manquant' };
  return {
    total,
    details: [adultes !== null && { label: 'adultes', n: adultes }, enfants !== null && { label: 'enfants', n: enfants }].filter(Boolean),
    source: 'Effectif du dossier',
    sourceKind: 'dossier',
  };
}

// Colonie : seules les inscriptions CONFIRMÉES comptent dans l'effectif ;
// les inscriptions en cours sont indiquées à titre d'information.
export function colonyEffectif(registrations) {
  const regs = (registrations || []).filter(r => !r.archived_at);
  const confirmees = regs.filter(r => r.statut === 'confirmee').length;
  const enCours = regs.filter(r => r.statut !== 'confirmee' && r.statut !== 'annulee').length;
  return {
    total: confirmees,
    details: [{ label: 'enfants (inscriptions confirmées)', n: confirmees }, ...(enCours ? [{ label: 'inscriptions en cours (non comptées)', n: enCours }] : [])],
    source: 'Inscriptions confirmées du séjour (encadrement non compté)',
    sourceKind: 'inscriptions',
  };
}

// ==========================================================
// Normalisation → réservation commune
// ==========================================================

function schoolProgramme(d) {
  const p = d.programme === 'volcan' ? 'Classe Volcan' : d.programme === 'nature' ? 'Classe Nature' : 'Classe de découverte';
  return d.duree ? `${p} · ${d.duree} jours` : p;
}

// Dates retenues pour une réservation issue d'un dossier.
// Réservation validée : UNIQUEMENT les dates confirmées (dates actives du
// dossier). Autres statuts : dates confirmées si présentes, sinon dates
// indicatives (date proposée / dates demandées), marquées comme telles.
export function dossierDates(d) {
  const group = DOSSIER_STATUT_GROUPS[d.statut] || 'en_attente';
  const debut = isValidIso(d.date_confirmee_debut) ? d.date_confirmee_debut : null;
  const fin = isValidIso(d.date_confirmee_fin) ? d.date_confirmee_fin : null;
  if (group === 'validee') return { debut, fin, indicatives: false };
  if (debut && fin) return { debut, fin, indicatives: false };
  if (debut) return { debut, fin: d.duree ? addDays(debut, Number(d.duree) - 1) : debut, indicatives: true };
  if (isValidIso(d.date_proposee)) {
    return { debut: d.date_proposee, fin: d.duree ? addDays(d.date_proposee, Number(d.duree) - 1) : d.date_proposee, indicatives: true };
  }
  if (isValidIso(d.demande_date_arrivee)) {
    return { debut: d.demande_date_arrivee, fin: isValidIso(d.demande_date_depart) ? d.demande_date_depart : d.demande_date_arrivee, indicatives: true };
  }
  return { debut: null, fin: null, indicatives: false };
}

export function normalizeDossier(d, { effectifVersions = [], cancelledAt = null } = {}) {
  const statutGroup = DOSSIER_STATUT_GROUPS[d.statut] || 'en_attente';
  const dates = dossierDates(d);
  const isGroup = d.client_type === 'group';
  const effectif = isGroup ? groupEffectif(d) : schoolEffectif(d, effectifVersions);
  const contact = [d.contact_prenom, d.contact_nom].filter(Boolean).join(' ');
  return {
    key: `d:${d.id}`,
    source: 'dossier',
    id: d.id,
    numero: d.numero || '',
    type: isGroup ? 'group' : 'school',
    nom: (isGroup ? d.structure_nom || d.etablissement : d.etablissement) || 'Sans nom',
    programme: isGroup ? (d.formule ? labelOf(FORMULES, d.formule) : 'Formule non précisée') : schoolProgramme(d),
    debut: dates.debut,
    fin: dates.fin,
    datesIndicatives: dates.indicatives,
    heureArrivee: isGroup ? d.demande_heure_arrivee || null : null,
    heureDepart: isGroup ? d.demande_heure_depart || null : null,
    effectif,
    statut: d.statut,
    statutLabel: labelOf(STATUTS, d.statut),
    statutGroup,
    archived: !!d.archived_at,
    cancelledAt: statutGroup === 'annulee' ? cancelledAt : null,
    contact,
    contactEmail: d.contact_email || '',
    contactTel: d.contact_telephone || '',
    commune: d.commune || '',
    url: `dossier.html?id=${encodeURIComponent(d.id)}`,
  };
}

export function normalizeColonyStay(s, registrations = []) {
  const statutGroup = COLONY_STATUT_GROUPS[s.statut] || 'en_attente';
  return {
    key: `c:${s.id}`,
    source: 'colony_stay',
    id: s.id,
    numero: '',
    type: 'colony',
    nom: s.nom || 'Séjour colonie',
    programme: [s.duree_texte, s.age_min && s.age_max ? `${s.age_min}-${s.age_max} ans` : ''].filter(Boolean).join(' · ') || 'Colonie de vacances',
    debut: isValidIso(s.date_debut) ? s.date_debut : null,
    fin: isValidIso(s.date_fin) ? s.date_fin : null,
    datesIndicatives: false,
    heureArrivee: null,
    heureDepart: null,
    effectif: colonyEffectif(registrations),
    statut: s.statut,
    statutLabel: labelOf(COLONY_STAY_STATUTS, s.statut),
    statutGroup,
    archived: !!s.archived_at,
    // Pas d'historique de statut pour les séjours colonie : date de dernière
    // modification, présentée comme telle.
    cancelledAt: statutGroup === 'annulee' ? s.updated_at || null : null,
    cancelledAtApprox: statutGroup === 'annulee',
    contact: '',
    contactEmail: '',
    contactTel: '',
    commune: '',
    url: `colonie.html?id=${encodeURIComponent(s.id)}`,
  };
}

// ==========================================================
// Contrôles de complétude (réservations VALIDÉES uniquement)
// ==========================================================

export function reservationIssues(r) {
  const issues = [];
  if (!r.debut && !r.fin) issues.push({ level: 'dates', text: 'Dates d\'arrivée et de départ manquantes' });
  else if (!r.debut) issues.push({ level: 'dates', text: 'Date d\'arrivée manquante' });
  else if (!r.fin) issues.push({ level: 'dates', text: 'Date de départ manquante' });
  else if (diffDays(r.debut, r.fin) < 0) issues.push({ level: 'dates', text: 'Date de départ antérieure à la date d\'arrivée' });
  if (r.effectif.total === null) issues.push({ level: 'effectif', text: 'Effectif non renseigné' });
  return issues;
}

// Une réservation est plaçable sur le calendrier si ses deux dates existent et
// sont cohérentes.
export function isPlaceable(r) {
  return !!(r.debut && r.fin && diffDays(r.debut, r.fin) >= 0);
}

export function overlaps(r, start, end) {
  return isPlaceable(r) && r.debut <= end && r.fin >= start;
}

// ==========================================================
// Filtres
// ==========================================================

function normText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function matchesFilters(r, { statut = 'validee', type = 'all', search = '' } = {}) {
  if (statut !== 'all' && r.statutGroup !== statut) return false;
  if (type !== 'all' && r.type !== type) return false;
  const q = normText(search).trim();
  if (q) {
    const hay = normText([r.nom, r.contact, r.contactEmail, r.contactTel, r.commune, r.numero, r.programme].join(' '));
    if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

export function sortByArrival(list) {
  return [...list].sort((a, b) => (a.debut || '9999').localeCompare(b.debut || '9999') || (a.fin || '').localeCompare(b.fin || '') || a.nom.localeCompare(b.nom, 'fr'));
}

// ==========================================================
// Présence jour par jour (chevauchements = plusieurs groupes, jamais une erreur)
// ==========================================================

// Map iso → { reservations: [...], total, unknown } sur [start, end].
// Le jour de départ compte (le groupe est présent le matin).
export function dailyPresence(reservations, start, end) {
  const map = new Map();
  for (const r of reservations) {
    if (!overlaps(r, start, end)) continue;
    let day = r.debut < start ? start : r.debut;
    const last = r.fin > end ? end : r.fin;
    while (day <= last) {
      let cell = map.get(day);
      if (!cell) { cell = { reservations: [], total: 0, unknown: 0 }; map.set(day, cell); }
      cell.reservations.push(r);
      if (r.effectif.total === null) cell.unknown += 1; else cell.total += r.effectif.total;
      day = addDays(day, 1);
    }
  }
  return map;
}

// ==========================================================
// Indicateurs de l'année
// ==========================================================

export function yearStats(reservations, year) {
  const list = reservations.filter(r => overlaps(r, year.start, year.end));
  const byType = {};
  PLANNING_TYPES.forEach(t => { byType[t.value] = 0; });
  let personnes = 0, sansEffectif = 0, nuits = 0, nuitees = 0;
  for (const r of list) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    // Nuits comptées dans l'année seulement (séjour à cheval sur deux années).
    const from = r.debut < year.start ? year.start : r.debut;
    const to = r.fin > year.end ? addDays(year.end, 1) : r.fin;
    const n = Math.max(0, diffDays(from, to));
    nuits += n;
    if (r.effectif.total === null) sansEffectif += 1;
    else { personnes += r.effectif.total; nuitees += n * r.effectif.total; }
  }
  return { count: list.length, byType, personnes, sansEffectif, nuits, nuitees };
}

// ==========================================================
// Calendrier mensuel : semaines (lundi → dimanche) + couloirs des séjours
// ==========================================================

// Retourne les semaines d'un mois : chaque semaine = 7 jours (iso, inMonth)
// + segments { r, startCol, span, lane, continuesBefore, continuesAfter }.
export function monthWeeks(year, month0, reservations) {
  const first = monthStart(year, month0);
  const last = monthEnd(year, month0);
  let cursor = addDays(first, -weekdayMon(first));
  const weeks = [];
  while (cursor <= last) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(cursor, i);
      days.push({ iso, inMonth: iso >= first && iso <= last, day: Number(iso.slice(8)) });
    }
    const wStart = days[0].iso;
    const wEnd = days[6].iso;
    const segs = sortByArrival(reservations.filter(r => overlaps(r, wStart, wEnd)))
      .sort((a, b) => (a.debut.localeCompare(b.debut)) || (diffDays(b.debut, b.fin) - diffDays(a.debut, a.fin)))
      .map(r => {
        const s = r.debut < wStart ? wStart : r.debut;
        const e = r.fin > wEnd ? wEnd : r.fin;
        return { r, startCol: diffDays(wStart, s), span: diffDays(s, e) + 1, continuesBefore: r.debut < wStart, continuesAfter: r.fin > wEnd };
      });
    const lanes = [];
    for (const seg of segs) {
      let lane = lanes.findIndex(endCol => endCol < seg.startCol);
      if (lane === -1) { lane = lanes.length; lanes.push(-1); }
      lanes[lane] = seg.startCol + seg.span - 1;
      seg.lane = lane;
    }
    weeks.push({ days, segments: segs, laneCount: lanes.length });
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

// ==========================================================
// Chargement (Supabase) — uniquement l'année demandée
// ==========================================================

const DOSSIER_COLUMNS = [
  'id', 'numero', 'client_type', 'statut', 'archived_at', 'updated_at',
  'etablissement', 'structure_nom', 'commune', 'contact_nom', 'contact_prenom', 'contact_email', 'contact_telephone',
  'programme', 'duree', 'formule',
  'date_proposee', 'date_confirmee_debut', 'date_confirmee_fin',
  'demande_date_arrivee', 'demande_date_depart', 'demande_heure_arrivee', 'demande_heure_depart',
  'effectif_prev_eleves', 'effectif_prev_profs', 'effectif_prev_accompagnateurs',
  'effectif_def_eleves', 'effectif_def_profs', 'effectif_def_accompagnateurs',
  'nb_adultes', 'nb_enfants',
].join(',');

function byKey(rows, key) {
  const out = {};
  (rows || []).forEach(r => { (out[r[key]] = out[r[key]] || []).push(r); });
  return out;
}

function check(res) {
  if (res.error) throw res.error;
  return res.data || [];
}

// Charge et normalise toutes les réservations d'une année d'exploitation
// (tous statuts : le filtrage par statut se fait ensuite, sans recharger),
// + les réservations VALIDÉES sans dates exploitables (toutes années),
// qui ne peuvent pas être placées sur un calendrier mais ne doivent jamais
// disparaître silencieusement.
export async function loadPlanning(supabase, year) {
  const { start, end } = year;
  const startIndicatif = addDays(start, -7);

  const [dossiersInYear, dossiersUndated, staysInYear, staysUndated] = await Promise.all([
    supabase.from('dossiers').select(DOSSIER_COLUMNS)
      .neq('client_type', 'colony')
      .or([
        `and(date_confirmee_debut.lte.${end},date_confirmee_fin.gte.${start})`,
        `and(date_confirmee_debut.gte.${start},date_confirmee_debut.lte.${end})`,
        `and(date_confirmee_debut.is.null,date_proposee.gte.${startIndicatif},date_proposee.lte.${end})`,
        `and(date_confirmee_debut.is.null,demande_date_arrivee.gte.${startIndicatif},demande_date_arrivee.lte.${end})`,
      ].join(','))
      .then(check),
    supabase.from('dossiers').select(DOSSIER_COLUMNS)
      .neq('client_type', 'colony')
      .in('statut', VALIDATED_DOSSIER_STATUTS)
      .or('date_confirmee_debut.is.null,date_confirmee_fin.is.null')
      .then(check),
    supabase.from('colony_stays').select('*')
      .or(`and(date_debut.lte.${end},date_fin.gte.${start}),and(date_debut.gte.${start},date_debut.lte.${end})`)
      .then(check),
    supabase.from('colony_stays').select('*')
      .in('statut', VALIDATED_COLONY_STATUTS)
      .or('date_debut.is.null,date_fin.is.null')
      .then(check),
  ]);

  const dossiers = uniqueById([...dossiersInYear, ...dossiersUndated]);
  const stays = uniqueById([...staysInYear, ...staysUndated]);

  const schoolIds = dossiers.filter(d => d.client_type === 'school').map(d => d.id);
  const cancelledIds = dossiers.filter(d => d.statut === 'annule').map(d => d.id);
  const stayIds = stays.map(s => s.id);

  const [versions, cancels, regs] = await Promise.all([
    schoolIds.length
      ? supabase.from('dossier_bloc_versions').select('dossier_id, version, donnees_validees, admin_validated_at')
        .eq('bloc', 'effectifs').in('dossier_id', schoolIds).not('admin_validated_at', 'is', null).then(check)
      : [],
    cancelledIds.length
      ? supabase.from('statuts_historique').select('dossier_id, changed_at')
        .eq('nouveau_statut', 'annule').in('dossier_id', cancelledIds).order('changed_at', { ascending: false }).then(check)
      : [],
    stayIds.length
      ? supabase.from('colony_registrations').select('stay_id, statut, archived_at').in('stay_id', stayIds).then(check)
      : [],
  ]);

  const versionsByDossier = byKey(versions, 'dossier_id');
  const cancelByDossier = {};
  cancels.forEach(c => { if (!cancelByDossier[c.dossier_id]) cancelByDossier[c.dossier_id] = c.changed_at; });
  const regsByStay = byKey(regs, 'stay_id');

  return [
    ...dossiers.map(d => normalizeDossier(d, { effectifVersions: versionsByDossier[d.id] || [], cancelledAt: cancelByDossier[d.id] || null })),
    ...stays.map(s => normalizeColonyStay(s, regsByStay[s.id] || [])),
  ];
}

function uniqueById(rows) {
  const seen = new Map();
  rows.forEach(r => seen.set(r.id, r));
  return [...seen.values()];
}
