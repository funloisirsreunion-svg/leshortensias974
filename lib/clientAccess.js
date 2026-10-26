// Statuts calculés pour le suivi des accès clients et des informations
// demandées aux enseignants (Classes de découverte). Fonctions pures, partagées
// entre le navigateur (Admin) et les tests : aucune dépendance.

export const INVITATION_VALIDITY_DAYS = { activation: 30, reinitialisation: 7 };

export const ACCESS_STATUS = {
  aucun: { label: 'Aucun accès envoyé', color: 'gray' },
  preparation: { label: 'Invitation en préparation', color: 'orange' },
  envoyee: { label: 'Invitation envoyée', color: 'blue' },
  activee: { label: 'Compte activé', color: 'green' },
  expiree: { label: 'Invitation expirée', color: 'red' },
  desactive: { label: 'Accès désactivé', color: 'gray' },
};

const time = (v) => (v ? new Date(v).getTime() : 0);
const latest = (rows, key) => rows.slice().sort((a, b) => time(b[key]) - time(a[key]))[0] || null;

// acces : lignes dossier_acces du dossier ; invitations : lignes
// client_invitations dont dossier_ids contient le dossier ; org : sa fiche
// établissement (acces_a_preparer). « Compte activé » uniquement quand
// l'enseignant a défini son mot de passe (dossier_acces.statut), jamais du
// simple fait qu'un e-mail est parti.
export function accessStatus({ acces = [], invitations = [], org = null, now = Date.now() } = {}) {
  const sent = invitations.filter(i => ['envoyee', 'utilisee'].includes(i.statut) && i.sent_at);
  const lastSent = latest(sent, 'sent_at');
  const pending = acces.filter(a => a.statut === 'invitation_envoyee');
  const legacySentAt = pending.length ? latest(pending, 'created_at').created_at : null;
  const base = {
    lastSentAt: lastSent ? lastSent.sent_at : legacySentAt,
    lastSentBy: lastSent ? lastSent.created_by_name : null,
    lastEmail: lastSent ? lastSent.email : null,
    activatedAt: null,
    error: null,
  };
  const result = (key, extra = {}) => ({ key, ...ACCESS_STATUS[key], ...base, ...extra });

  const active = acces.filter(a => a.statut === 'compte_active');
  if (active.length) return result('activee', { activatedAt: latest(active, 'activated_at').activated_at });

  const lastAttempt = latest(invitations.filter(i => i.statut !== 'remplacee'), 'created_at');
  if (pending.length) {
    if (lastAttempt && ['echec', 'preparee'].includes(lastAttempt.statut)) {
      return result('preparation', { error: lastAttempt.error || null });
    }
    if (lastSent && lastSent.statut === 'envoyee' && lastSent.kind === 'activation'
        && lastSent.expires_at && time(lastSent.expires_at) < now) {
      return result('expiree', { expiresAt: lastSent.expires_at });
    }
    return result('envoyee', { expiresAt: lastSent ? lastSent.expires_at : null });
  }
  if (acces.length && acces.every(a => a.statut === 'desactive')) return result('desactive');
  if (lastAttempt && ['echec', 'preparee'].includes(lastAttempt.statut)) {
    return result('preparation', { error: lastAttempt.error || null });
  }
  if (org && org.acces_a_preparer) return result('preparation');
  return result('aucun');
}

// ----------------------------------------------------------
// Informations demandées à l'enseignant
// ----------------------------------------------------------
export const INFO_STATUS = {
  effectifs: {
    non_renseigne: { label: 'Non renseigné', color: 'gray' },
    en_cours: { label: 'En cours', color: 'orange' },
    attente: { label: 'En attente de validation', color: 'blue' },
    valide: { label: 'Validé', color: 'green' },
  },
  couchage: {
    a_completer: { label: 'À compléter', color: 'orange' },
    complete: { label: 'Complétée', color: 'green' },
  },
  regimes: {
    non_renseignees: { label: 'Non renseignées', color: 'orange' },
    renseignees: { label: 'Renseignées', color: 'green' },
  },
};

const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const blocStatut = (blocs, bloc) => ((blocs || []).find(b => b.bloc === bloc) || {}).statut || 'draft';

function effectifsPrev(d) {
  return {
    eleves: n(d.effectif_prev_eleves), profs: n(d.effectif_prev_profs), accomp: n(d.effectif_prev_accompagnateurs),
    filles: n(d.effectif_filles), garcons: n(d.effectif_garcons),
    profsF: n(d.effectif_profs_femmes), profsH: n(d.effectif_profs_hommes),
    accF: n(d.effectif_accomp_femmes), accH: n(d.effectif_accomp_hommes),
  };
}

// Répartition complète : chaque catégorie présente (élèves, professeurs,
// accompagnateurs) est entièrement répartie et la somme correspond au total.
export function couchageComplete(d) {
  const e = effectifsPrev(d);
  if (!e.eleves) return false;
  const pair = (a, b, total) => (total ? a !== null && b !== null && a + b === total : (a || 0) + (b || 0) === 0);
  return pair(e.filles, e.garcons, e.eleves) && pair(e.profsF, e.profsH, e.profs) && pair(e.accF, e.accH, e.accomp);
}

export function infoStatuses({ dossier: d, blocs = [], regimes = [], allergies = [] }) {
  const out = {};
  const e = effectifsPrev(d);
  const effSt = blocStatut(blocs, 'effectifs');
  const niveaux = Object.values(d.niveaux || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  let eff;
  if (effSt === 'validated') eff = 'valide';
  else if (effSt === 'client_confirmed') eff = 'attente';
  else if ([e.eleves, e.profs, e.accomp, e.filles, e.garcons].some(v => v) || niveaux > 0) eff = 'en_cours';
  else eff = 'non_renseigne';
  out.effectifs = { key: eff, ...INFO_STATUS.effectifs[eff] };

  const cou = couchageComplete(d) ? 'complete' : 'a_completer';
  out.couchage = { key: cou, ...INFO_STATUS.couchage[cou] };

  const regSt = blocStatut(blocs, 'regimes');
  const hasData = regimes.some(r => Number(r.nombre) > 0) || allergies.length > 0 || !!(d.remarques_alimentaires || '').trim();
  const confirmed = ['client_confirmed', 'validated'].includes(regSt);
  const reg = confirmed || hasData ? 'renseignees' : 'non_renseignees';
  out.regimes = { key: reg, ...INFO_STATUS.regimes[reg] };
  if (confirmed && !hasData) out.regimes.detail = 'aucune restriction';
  else if (hasData && !confirmed) out.regimes.detail = 'non confirmées';

  out.complet = eff !== 'non_renseigne' && eff !== 'en_cours' && cou === 'complete' && reg === 'renseignees';
  return out;
}

// À relancer : accès jamais envoyé / expiré / non activé, ou informations
// encore incomplètes alors que le compte est activé.
export function needsFollowUp(access, info) {
  if (['aucun', 'preparation', 'expiree'].includes(access.key)) return true;
  if (access.key === 'envoyee') return true;
  if (access.key === 'activee') return !info.complet;
  return false;
}
