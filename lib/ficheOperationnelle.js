// Fiche opérationnelle de séjour — calcul, contrôles, rendu HTML et e-mail.
//
// La fiche n'est jamais stockée comme une donnée à part : elle est CALCULÉE
// depuis le dossier (source de vérité), en utilisant en priorité les dernières
// versions VALIDÉES des blocs Effectifs et Régimes (jamais un mélange de versions).
// Module ES pur : utilisé à l'identique par l'Admin (aperçu + PDF) et par
// l'API serveur (e-mail, empreinte, historique) pour garantir le même contenu.
//
// Contenu volontairement limité à l'organisation du séjour : aucune donnée
// financière, commerciale ou administrative (§21).

export const DEFAULT_FICHE_RECIPIENT = 'leshortensias97431@gmail.com';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const REGIME_LABELS = {
  sans_porc: 'Sans porc', vegetarien: 'Végétarien', sans_lactose: 'Sans lactose',
  sans_gluten: 'Sans gluten', allergies: 'Allergies alimentaires', autre: 'Autre régime spécifique',
};
const FORMULE_LABELS = { pension_complete: 'Pension complète', demi_pension: 'Demi-pension', weekend: 'Forfait week-end', autre: 'Autre / sur devis' };

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function sumKnown(...vals) {
  const k = vals.filter(v => v !== null);
  return k.length ? k.reduce((s, v) => s + v, 0) : null;
}
function isIso(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function utc(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// « lundi 15 mars 2027 »
export function formatJourLong(iso) {
  if (!isIso(iso)) return null;
  const d = new Date(utc(iso));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
// « 10h00 »
export function formatHeure(h) {
  if (!h || !/^\d{1,2}:\d{2}/.test(h)) return null;
  const [hh, mm] = h.split(':');
  return `${String(Number(hh))}h${mm.slice(0, 2)}`;
}
export function formatDateFr(iso) {
  if (!isIso(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
// « 26 au 30 avril 2027 » / « 30 avril au 4 mai 2027 » / « 28 décembre 2026 au 2 janvier 2027 »
export function formatPlage(debut, fin) {
  if (!isIso(debut) || !isIso(fin)) return isIso(debut) ? `à partir du ${formatDateFr(debut)}` : 'dates à confirmer';
  const [y1, m1, d1] = debut.split('-').map(Number);
  const [y2, m2, d2] = fin.split('-').map(Number);
  if (y1 !== y2) return `${d1} ${MONTHS[m1 - 1]} ${y1} au ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (m1 === m2) return `${d1} au ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} ${MONTHS[m1 - 1]} au ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Dernière version VALIDÉE d'un bloc (jamais une somme ni un mélange).
export function latestValidated(versions, bloc) {
  const valid = (versions || []).filter(v => v && v.bloc === bloc && v.donnees_validees && v.admin_validated_at);
  if (!valid.length) return null;
  return valid.reduce((best, v) => (v.version > best.version ? v : best));
}

// ==========================================================
// Effectifs (classe) : retenu = définitif s'il est renseigné, sinon prévisionnel
// ==========================================================

export function effectifsFrom(src) {
  const useDef = [src.effectif_def_eleves, src.effectif_def_profs, src.effectif_def_accompagnateurs].some(v => num(v) !== null);
  const p = useDef ? 'effectif_def_' : 'effectif_prev_';
  const e = {
    base: useDef ? 'definitif' : 'previsionnel',
    eleves: num(src[p + 'eleves']), profs: num(src[p + 'profs']), accomp: num(src[p + 'accompagnateurs']),
    filles: num(src.effectif_filles), garcons: num(src.effectif_garcons),
    profsF: num(src.effectif_profs_femmes), profsH: num(src.effectif_profs_hommes),
    accF: num(src.effectif_accomp_femmes), accH: num(src.effectif_accomp_hommes),
  };
  e.totalEnfants = e.eleves;
  e.totalAdultes = sumKnown(e.profs, e.accomp);
  e.total = sumKnown(e.eleves, e.profs, e.accomp);
  e.femmesAdultes = (e.profsF !== null || e.accF !== null) ? sumKnown(e.profsF, e.accF) : null;
  e.hommesAdultes = (e.profsH !== null || e.accH !== null) ? sumKnown(e.profsH, e.accH) : null;
  return e;
}

// Contrôles de cohérence (mêmes règles que la base : effectifs_coherence_errors).
export function coherenceErrors(e) {
  const errs = [];
  const check = (a, b, total, msg) => {
    if (a === null && b === null) return;
    if ((a || 0) + (b || 0) !== (total || 0)) errs.push(msg);
  };
  check(e.filles, e.garcons, e.eleves, 'La répartition filles/garçons ne correspond pas au nombre total d\'élèves.');
  check(e.profsF, e.profsH, e.profs, 'La répartition femmes/hommes ne correspond pas au nombre total de professeurs.');
  check(e.accF, e.accH, e.accomp, 'La répartition femmes/hommes ne correspond pas au nombre total d\'accompagnateurs.');
  return errs;
}

// ==========================================================
// Calcul de la fiche
// ==========================================================

// { dossier, blocVersions, blocs, regimes, allergies } → modèle de fiche.
export function buildFiche({ dossier: d, blocVersions = [], blocs = [], regimes = [], allergies = [] }) {
  const isGroup = d.client_type === 'group';
  const notes = [];

  // --- Effectifs
  let effectifs, effectifsVersion = null;
  if (isGroup) {
    const adultes = num(d.nb_adultes), enfants = num(d.nb_enfants);
    effectifs = { base: 'dossier', totalEnfants: enfants, totalAdultes: adultes, total: sumKnown(adultes, enfants) };
  } else {
    const v = latestValidated(blocVersions, 'effectifs');
    effectifs = effectifsFrom(v ? v.donnees_validees : d);
    if (v) { effectifsVersion = v.version; effectifs.base = `valide_v${v.version}`; }
    const st = (blocs.find(b => b.bloc === 'effectifs') || {}).statut;
    if (v && st && st !== 'validated') notes.push(`Effectifs : une version plus récente est en cours (${st === 'client_confirmed' ? 'confirmée par le client, à valider' : 'rouverte'}) — la fiche utilise la version validée V${v.version}.`);
    if (!v) notes.push('Effectifs non encore validés par l\'administration : données actuelles du dossier.');
  }

  // --- Régimes et allergies
  let regimeMap, precisions = {}, allergieLines, remarques, regimesVersion = null;
  const rv = isGroup ? null : latestValidated(blocVersions, 'regimes');
  if (rv) {
    regimesVersion = rv.version;
    regimeMap = rv.donnees_validees.regimes || {};
    precisions = rv.donnees_validees.precisions || {};
    allergieLines = Array.isArray(rv.donnees_validees.allergies) ? rv.donnees_validees.allergies : [];
    remarques = rv.donnees_validees.remarques_alimentaires || null;
    const st = (blocs.find(b => b.bloc === 'regimes') || {}).statut;
    if (st && st !== 'validated') notes.push(`Régimes : une version plus récente est en cours — la fiche utilise la version validée V${rv.version}.`);
  } else {
    regimeMap = Object.fromEntries((regimes || []).map(r => [r.type, r.nombre]));
    (regimes || []).forEach(r => { if (r.precisions) precisions[r.type] = r.precisions; });
    allergieLines = (allergies || []).map(a => ({ allergene: a.allergene, nombre: a.nombre, precisions: a.precisions }));
    remarques = d.remarques_alimentaires || null;
    if (!isGroup) notes.push('Régimes alimentaires non encore validés par l\'administration : données actuelles du dossier.');
  }
  const regimesList = Object.entries(regimeMap)
    .filter(([type, n]) => type !== 'normal' && Number(n) > 0)
    .filter(([type]) => !(type === 'allergies' && allergieLines.length)) // détaillées plus bas
    .map(([type, n]) => ({ type, label: REGIME_LABELS[type] || cap(type.replace(/_/g, ' ')), nombre: Number(n), precisions: precisions[type] || null }))
    .sort((a, b) => b.nombre - a.nombre || a.label.localeCompare(b.label, 'fr'));
  const allergiesList = allergieLines
    .map(a => ({ allergene: String(a.allergene || '').trim(), nombre: Number(a.nombre) || 1, precisions: a.precisions || null }))
    .filter(a => a.allergene)
    .sort((a, b) => a.allergene.localeCompare(b.allergene, 'fr'));
  const allergiesNonDetaillees = !allergiesList.length && Number(regimeMap.allergies) > 0 ? Number(regimeMap.allergies) : 0;

  // --- Séjour
  const debut = isIso(d.date_confirmee_debut) ? d.date_confirmee_debut : null;
  const fin = isIso(d.date_confirmee_fin) ? d.date_confirmee_fin : null;
  const nuits = debut && fin ? Math.round((utc(fin) - utc(debut)) / 86400000) : null;
  const programme = isGroup
    ? `Groupe indépendant${d.formule ? ' — ' + (FORMULE_LABELS[d.formule] || d.formule) : ''}`
    : (d.programme === 'volcan' ? 'Classe Volcan' : d.programme === 'nature' ? 'Classe Nature' : 'Classe de découverte');

  return {
    type: isGroup ? 'group' : 'school',
    numero: d.numero || null,
    etablissement: (isGroup ? d.structure_nom || d.etablissement : d.etablissement) || '—',
    commune: d.commune || null,
    contact: {
      nom: [d.contact_prenom, d.contact_nom].filter(Boolean).join(' ') || null,
      telephone: d.contact_telephone || null,
      email: d.contact_email || null,
    },
    programme,
    arrivee: { date: debut, heure: d.heure_arrivee || (isGroup ? d.demande_heure_arrivee : null) || null },
    depart: { date: fin, heure: d.heure_depart || (isGroup ? d.demande_heure_depart : null) || null },
    jours: nuits !== null && nuits >= 0 ? nuits + 1 : null,
    nuits: nuits !== null && nuits >= 0 ? nuits : null,
    effectifs,
    effectifsVersion,
    regimes: regimesList,
    allergies: allergiesList,
    allergiesNonDetaillees,
    remarques,
    regimesVersion,
    notes,
  };
}

// ==========================================================
// Contrôles avant envoi
// ==========================================================

// [{ text, blocking }] — bloquant : la fiche serait inexploitable ou contradictoire.
export function ficheIssues(f) {
  const out = [];
  const add = (text, blocking = false) => out.push({ text, blocking });
  if (!f.arrivee.date) add('Date d\'arrivée confirmée non renseignée.', true);
  if (!f.depart.date) add('Date de départ confirmée non renseignée.', true);
  if (f.arrivee.date && f.depart.date && f.nuits === null) add('La date de départ est antérieure à la date d\'arrivée.', true);
  if (!f.arrivee.heure) add('Heure d\'arrivée non renseignée.');
  if (!f.depart.heure) add('Heure de départ non renseignée.');
  const e = f.effectifs;
  if (e.total === null || e.total === 0) add('Effectif non renseigné.', true);
  if (f.type === 'school') {
    coherenceErrors(e).forEach(msg => add(msg, true));
    if (e.eleves && e.filles === null && e.garcons === null) add('Répartition filles/garçons non renseignée.');
    if ((e.profs || e.accomp) && e.femmesAdultes === null && e.hommesAdultes === null) add('Répartition femmes/hommes des adultes non renseignée.');
    if (f.regimesVersion === null) add('Régimes alimentaires non validés par l\'administration.');
  }
  if (f.allergiesNonDetaillees) add(`${f.allergiesNonDetaillees} personne(s) avec allergie alimentaire sans précision de l'allergène.`);
  return out;
}

// ==========================================================
// Empreinte et comparaison (fiche obsolète après envoi ?)
// ==========================================================

function sections(f) {
  return {
    'Établissement / contact': [f.etablissement, f.commune, f.contact.nom, f.contact.telephone, f.contact.email],
    'Programme': [f.programme],
    'Dates et horaires': [f.arrivee.date, f.arrivee.heure, f.depart.date, f.depart.heure],
    'Effectifs': [f.effectifs.eleves, f.effectifs.filles, f.effectifs.garcons, f.effectifs.profs, f.effectifs.profsF, f.effectifs.profsH,
      f.effectifs.accomp, f.effectifs.accF, f.effectifs.accH, f.effectifs.totalEnfants, f.effectifs.totalAdultes, f.effectifs.total],
    'Régimes alimentaires': [f.regimes.map(r => `${r.type}:${r.nombre}:${r.precisions || ''}`).join('|'), f.remarques || ''],
    'Allergies': [f.allergies.map(a => `${a.allergene}:${a.nombre}:${a.precisions || ''}`).join('|'), f.allergiesNonDetaillees],
  };
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function ficheHash(f) {
  return fnv1a(JSON.stringify(sections(f)));
}

// Sections modifiées entre la fiche envoyée et la fiche actuelle.
export function ficheDiff(sent, current) {
  if (!sent) return [];
  const a = sections(sent), b = sections(current);
  return Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

// ==========================================================
// Rendu
// ==========================================================

export function ficheFileName(f) {
  const name = String(f.etablissement || 'groupe')
    .replace(/^(école|ecole|écoles|groupe scolaire|collège|college|lycée|lycee)\s+/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'groupe';
  const date = f.arrivee.date ? f.arrivee.date.split('-').reverse().join('-') : 'dates-a-confirmer';
  return `Fiche-sejour-${name}-${date}.pdf`;
}

export function ficheSubject(f, isUpdate) {
  return `${isUpdate ? 'MISE À JOUR – ' : ''}Fiche séjour – ${f.etablissement} – ${formatPlage(f.arrivee.date, f.depart.date)}`;
}

function quand(part) {
  const j = formatJourLong(part.date);
  if (!j) return 'à confirmer';
  const h = formatHeure(part.heure);
  return `${cap(j)}${h ? ' à ' + h : ' (heure à confirmer)'}`;
}
function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

// Lignes structurées communes au HTML et au PDF.
export function ficheSections(f) {
  const e = f.effectifs;
  const out = [];
  out.push({ title: 'Établissement', lines: [f.etablissement, f.commune ? `Commune : ${f.commune}` : null].filter(Boolean) });
  out.push({ title: 'Séjour', lines: [
    f.programme,
    `Arrivée : ${quand(f.arrivee)}`,
    `Départ : ${quand(f.depart)}`,
    f.jours !== null ? `${plural(f.nuits, 'nuit', 'nuits')} / ${plural(f.jours, 'jour', 'jours')}` : null,
  ].filter(Boolean) });
  out.push({ title: 'Contact', lines: [f.contact.nom, f.contact.telephone, f.contact.email].filter(Boolean).length
    ? [f.contact.nom, f.contact.telephone, f.contact.email].filter(Boolean) : ['Non renseigné'] });

  const eff = [];
  if (f.type === 'school') {
    const split = (a, b, la, lb) => (a !== null || b !== null) ? `${a ?? '?'} ${la} · ${b ?? '?'} ${lb}` : 'répartition non renseignée';
    eff.push({ label: 'Élèves', value: e.eleves ?? '—', sub: split(e.filles, e.garcons, e.filles > 1 ? 'filles' : 'fille', e.garcons > 1 ? 'garçons' : 'garçon') });
    eff.push({ label: 'Professeurs', value: e.profs ?? '—', sub: split(e.profsF, e.profsH, e.profsF > 1 ? 'femmes' : 'femme', e.profsH > 1 ? 'hommes' : 'homme') });
    eff.push({ label: 'Accompagnateurs', value: e.accomp ?? '—', sub: split(e.accF, e.accH, e.accF > 1 ? 'femmes' : 'femme', e.accH > 1 ? 'hommes' : 'homme') });
  }
  out.push({
    title: 'Effectifs', effectifs: eff,
    totals: [
      { label: 'Total groupe', value: e.total !== null ? plural(e.total, 'personne', 'personnes') : '—', strong: true },
      { label: 'Total enfants', value: e.totalEnfants ?? '—' },
      { label: 'Total adultes', value: e.totalAdultes ?? '—' },
    ],
    note: f.type === 'school' ? (f.effectifsVersion ? `Effectifs validés — version V${f.effectifsVersion}` : 'Effectifs non encore validés') + (e.base === 'previsionnel' ? ' (prévisionnels)' : '') : null,
  });
  if (f.type === 'school') {
    out.push({ title: 'Couchages', couchages: [
      { label: 'Enfants', value: (e.filles !== null || e.garcons !== null) ? `${e.filles ?? '?'} filles · ${e.garcons ?? '?'} garçons` : 'répartition non renseignée' },
      { label: 'Adultes', value: (e.femmesAdultes !== null || e.hommesAdultes !== null) ? `${e.femmesAdultes ?? '?'} femmes · ${e.hommesAdultes ?? '?'} hommes` : 'répartition non renseignée' },
    ] });
  }
  out.push({ title: 'Allergies / informations alimentaires importantes', important: true, lines: f.allergies.length
    ? f.allergies.map(a => `${cap(a.allergene)} : ${plural(a.nombre, 'personne', 'personnes')}${a.precisions ? ' — ' + a.precisions : ''}`)
    : (f.allergiesNonDetaillees ? [`${plural(f.allergiesNonDetaillees, 'personne allergique', 'personnes allergiques')} — allergène non précisé`] : ['Aucune allergie signalée']) });
  out.push({ title: 'Régimes alimentaires', lines: f.regimes.length
    ? f.regimes.map(r => `${r.label} : ${r.nombre}${r.precisions ? ' (' + r.precisions + ')' : ''}`)
    : ['Aucun régime particulier signalé'], extra: f.remarques ? `Remarques : ${f.remarques}` : null });
  return out;
}

const C = { vert: '#2d5a27', or: '#c8a84b', beige: '#f5f0e8', rouge: '#a5230e', rougeBg: '#fbe2e2', gris: '#5a5a5a' };

// Fiche complète en HTML (styles en ligne : aperçu Admin ET corps d'e-mail).
export function ficheHtml(f, { generatedAt = new Date(), isUpdate = false } = {}) {
  const secs = ficheSections(f);
  const box = (title, inner, important = false) => `
    <div style="margin:0 0 14px;padding:14px 16px;border-radius:10px;background:${important ? C.rougeBg : C.beige};${important ? `border-left:5px solid ${C.rouge};` : ''}">
      <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:${important ? C.rouge : C.vert};margin-bottom:8px;">${important ? '⚠ ' : ''}${esc(title)}</div>${inner}</div>`;
  const lines = (arr) => arr.map(l => `<div style="margin:2px 0;">${esc(l)}</div>`).join('');
  const body = secs.map(s => {
    if (s.effectifs) {
      const rows = s.effectifs.map(x => `<tr><td style="padding:4px 0;font-weight:700;">${esc(x.label)}</td><td style="padding:4px 8px;font-weight:700;font-size:16px;">${esc(x.value)}</td><td style="padding:4px 0;color:${C.gris};">${esc(x.sub)}</td></tr>`).join('');
      const tot = s.totals.map(x => `<tr><td style="padding:4px 0;${x.strong ? 'font-weight:700;color:' + C.vert + ';' : ''}">${esc(x.label)}</td><td colspan="2" style="padding:4px 8px;${x.strong ? 'font-weight:700;font-size:17px;color:' + C.vert + ';' : 'font-weight:700;'}">${esc(x.value)}</td></tr>`).join('');
      return box(s.title, `<table style="border-collapse:collapse;width:100%;font-size:14px;">${rows}${rows ? `<tr><td colspan="3" style="border-top:1px solid #e8dfc8;padding:0;"></td></tr>` : ''}${tot}</table>${s.note ? `<div style="font-size:12px;color:${C.gris};margin-top:6px;">${esc(s.note)}</div>` : ''}`);
    }
    if (s.couchages) {
      return box('Pour les couchages', s.couchages.map(c => `<div style="margin:3px 0;font-size:15px;"><strong>${esc(c.label)} :</strong> ${esc(c.value)}</div>`).join(''));
    }
    return box(s.title, lines(s.lines) + (s.extra ? `<div style="margin-top:6px;color:${C.gris};">${esc(s.extra)}</div>` : ''), s.important && (f.allergies.length || f.allergiesNonDetaillees));
  }).join('');
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2c2c2c;font-size:14px;line-height:1.45;">
    <div style="background:${C.vert};color:#fff;padding:16px 18px;border-radius:10px 10px 0 0;">
      <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">Les Hortensias</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:21px;font-weight:700;">Fiche opérationnelle de séjour</div>
      ${isUpdate ? `<div style="margin-top:6px;background:${C.or};color:#2c2c2c;display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;">MISE À JOUR — remplace la version précédente</div>` : ''}
    </div>
    <div style="border:1px solid #e8dfc8;border-top:none;border-radius:0 0 10px 10px;padding:16px 16px 6px;">
      ${body}
      <div style="font-size:12px;color:${C.gris};margin:6px 0 10px;">Fiche générée le ${esc(generatedAt.toLocaleString('fr-FR', { timeZone: 'Indian/Reunion', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à '))}${f.numero ? ' · Dossier ' + esc(f.numero) : ''}</div>
    </div>
  </div>`;
}

// Corps de l'e-mail : l'essentiel en tête, puis la fiche complète (PDF joint).
export function ficheEmailHtml(f, { isUpdate = false, generatedAt = new Date() } = {}) {
  const essentiel = [
    ['Établissement', f.etablissement],
    ['Séjour', f.programme],
    ['Arrivée', quand(f.arrivee)],
    ['Départ', quand(f.depart)],
    ['Effectif total', f.effectifs.total !== null ? plural(f.effectifs.total, 'personne', 'personnes') : 'non renseigné'],
  ].map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:${C.gris};">${k}</td><td style="padding:3px 0;font-weight:700;">${esc(v)}</td></tr>`).join('');
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2c2c2c;font-size:14px;">
    <p>Bonjour,</p>
    ${isUpdate ? `<p style="background:#fbeedd;border-left:4px solid ${C.or};padding:10px 12px;"><strong>Cette fiche remplace la version précédemment transmise.</strong></p>` : ''}
    <p>Voici la fiche opérationnelle du groupe suivant :</p>
    <table style="border-collapse:collapse;margin:8px 0 16px;">${essentiel}</table>
    <p>La fiche détaillée est ci-dessous et en pièce jointe (PDF).</p>
    ${ficheHtml(f, { generatedAt, isUpdate })}
    <p style="margin-top:18px;">Cordialement,<br/>Les Hortensias</p>
  </div>`;
}
