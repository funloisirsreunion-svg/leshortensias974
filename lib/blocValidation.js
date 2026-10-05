// Validation par blocs de la fiche Classe de découverte (statuts, dates,
// historique des versions). Partagé entre l'espace Admin et l'Espace Client.
// Toute la sécurité (verrous, droits) est en base (migration 0021) : ce
// module ne fait que de l'affichage.

import { NIVEAUX, REGIMES, labelOf, labelForDocumentType, DOC_STATUTS } from './appConstants.js';

export const BLOCS = [
  { value: 'coordonnees', label: 'Coordonnées' },
  { value: 'devis', label: 'Devis' },
  { value: 'effectifs', label: 'Effectifs' },
  { value: 'regimes', label: 'Régimes alimentaires' },
];

// Texte toujours affiché à côté de la pastille (jamais la couleur seule).
export const BLOC_STATUTS = {
  draft: { dot: '⚪', label: 'À compléter', color: 'gray' },
  client_confirmed: { dot: '🔵', label: 'Confirmé par le client', color: 'blue' },
  validated: { dot: '🟢', label: 'Validé et verrouillé 🔒', color: 'green' },
  reopened: { dot: '🟠', label: 'À mettre à jour', color: 'orange' },
};

export function blocLabel(bloc) {
  return labelOf(BLOCS, bloc);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// "05/10/2026 à 15:42", toujours à l'heure de La Réunion.
export function formatDateTimeFr(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const date = d.toLocaleDateString('fr-FR', { timeZone: 'Indian/Reunion', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { timeZone: 'Indian/Reunion', hour: '2-digit', minute: '2-digit' });
  return `${date} à ${time}`;
}

export function formatDateShortFr(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR', { timeZone: 'Indian/Reunion', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// État d'un bloc (une ligne absente = brouillon, version 1).
export function blocState(blocs, bloc) {
  const row = (blocs || []).find(b => b.bloc === bloc);
  return row || { bloc, statut: 'draft', version: 1 };
}

export function isLockedForClient(state) {
  return state.statut === 'client_confirmed' || state.statut === 'validated';
}

export function isLockedForAdmin(state) {
  return state.statut === 'validated';
}

// Libellé de statut adapté au bloc ("Effectifs validés", "Coordonnées confirmées"...).
export function blocStatusText(bloc, state) {
  const lab = blocLabel(bloc);
  if (state.statut === 'validated') return `${lab} — validé(e)s et verrouillé(e)s`;
  if (state.statut === 'client_confirmed') return `${lab} — confirmé(e)s par le client`;
  if (state.statut === 'reopened') return `${lab} — rouvert(e)s, à mettre à jour`;
  return `${lab} — à compléter`;
}

export function blocBadge(state) {
  const s = BLOC_STATUTS[state.statut] || BLOC_STATUTS.draft;
  return `<span class="app-badge app-badge-${s.color}">${s.dot} ${s.label}</span>`;
}

// Résumé lisible des données d'une version (pour l'historique).
export function summarizeBlocData(bloc, data) {
  if (!data) return '';
  if (bloc === 'effectifs') {
    const prev = `${data.effectif_prev_eleves ?? '—'} élèves / ${data.effectif_prev_profs ?? '—'} professeurs / ${data.effectif_prev_accompagnateurs ?? '—'} accompagnateurs`;
    const hasDef = data.effectif_def_eleves != null || data.effectif_def_profs != null || data.effectif_def_accompagnateurs != null;
    const def = hasDef ? ` · définitifs : ${data.effectif_def_eleves ?? '—'} / ${data.effectif_def_profs ?? '—'} / ${data.effectif_def_accompagnateurs ?? '—'}` : '';
    const niv = data.niveaux && typeof data.niveaux === 'object'
      ? NIVEAUX.filter(n => Number(data.niveaux[n.key]) > 0).map(n => `${n.label} ${data.niveaux[n.key]}`).join(', ')
      : '';
    return prev + def + (niv ? ` · niveaux : ${niv}` : '');
  }
  if (bloc === 'regimes') {
    const r = data.regimes || {};
    const parts = REGIMES.filter(x => Number(r[x.value]) > 0).map(x => `${x.label} : ${r[x.value]}`);
    const txt = parts.length ? parts.join(' · ') : 'aucun régime particulier';
    return txt + (data.remarques_alimentaires ? ` · remarques : « ${data.remarques_alimentaires} »` : '');
  }
  if (bloc === 'coordonnees') {
    return [data.etablissement, data.adresse, [data.code_postal, data.commune].filter(Boolean).join(' '), data.contact_nom, data.contact_email, data.contact_telephone]
      .filter(Boolean).join(' · ');
  }
  if (bloc === 'devis') {
    const m = data.montant_devis != null ? Number(data.montant_devis).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : 'montant non renseigné';
    return `${data.devis_file || 'aucun fichier devis'} · ${m}${data.devis_signe_file ? ` · signé : ${data.devis_signe_file}` : ''}`;
  }
  return '';
}

// Bloc "Statut + dates" sous le titre d'une partie de la fiche.
// audience : 'admin' | 'client'
export function renderBlocStatusPanel(bloc, state, audience) {
  const lines = [];
  const fromClientLabel = audience === 'client' ? 'Vous avez confirmé ces informations' : 'Confirmé(e)s par le client';
  const validLabel = audience === 'client' ? 'Validation Les Hortensias' : 'Validé(e)s par l\'administration';
  if (state.client_confirmed_at) lines.push(`<div>${fromClientLabel} : <strong>${formatDateTimeFr(state.client_confirmed_at)}</strong></div>`);
  if (state.admin_validated_at) lines.push(`<div>${validLabel} : <strong>${formatDateTimeFr(state.admin_validated_at)}</strong></div>`);
  if (state.statut === 'reopened' && state.reopened_at) lines.push(`<div>Rouvert(e)s pour modification : <strong>${formatDateTimeFr(state.reopened_at)}</strong> (version ${state.version})</div>`);
  if (state.modification_requested_at) {
    lines.push(`<div style="color:#c0392b;">🔴 Modification demandée le <strong>${formatDateTimeFr(state.modification_requested_at)}</strong>${state.modification_request_message ? ` : « ${esc(state.modification_request_message)} »` : ''}</div>`);
  }
  let note = '';
  if (audience === 'client') {
    if (state.statut === 'validated') note = 'Les champs sont maintenant verrouillés. Si une modification est nécessaire, contactez Les Hortensias.';
    else if (state.statut === 'client_confirmed') note = 'Informations transmises : en attente de validation par Les Hortensias. Les champs sont verrouillés pendant la vérification.';
    else if (state.statut === 'reopened') note = 'Les Hortensias vous permet de modifier ces informations. Pensez à confirmer une fois les modifications faites.';
  } else if (state.statut === 'reopened') {
    note = 'Version précédente conservée dans l\'historique. Le client peut modifier puis confirmer.';
  }
  return `
    <div class="app-bloc-status app-bloc-status-${state.statut}">
      <div class="app-bloc-status-head">${blocBadge(state)}${state.version > 1 ? ` <span class="app-bloc-version">Version ${state.version}</span>` : ''}</div>
      ${lines.length ? `<div class="app-bloc-status-dates">${lines.join('')}</div>` : ''}
      ${note ? `<p class="app-bloc-status-note">${note}</p>` : ''}
    </div>`;
}

// Historique d'un bloc : versions (données + dates propres à chacune) +
// événements (demandes de modification). Rendu dans un <details> replié.
export function renderBlocHistory(bloc, versions, events) {
  const vs = (versions || []).filter(v => v.bloc === bloc).sort((a, b) => a.version - b.version);
  const evs = (events || []).filter(e => e.bloc === bloc);
  if (!vs.length && !evs.length) {
    return `<details class="app-bloc-history"><summary>Voir l'historique</summary><p class="app-bloc-history-empty">Aucun historique pour le moment.</p></details>`;
  }
  const versionsHtml = vs.map(v => {
    const items = [];
    if (v.client_confirmed_at) items.push({ ts: v.client_confirmed_at, html: `Confirmée par le client${v.donnees_client ? ` : ${esc(summarizeBlocData(bloc, v.donnees_client))}` : ''}` });
    if (v.admin_validated_at) {
      const differs = v.donnees_validees && v.donnees_client && JSON.stringify(v.donnees_validees) !== JSON.stringify(v.donnees_client);
      items.push({ ts: v.admin_validated_at, html: `Validée par l'administration${(!v.donnees_client || differs) && v.donnees_validees ? ` : ${esc(summarizeBlocData(bloc, v.donnees_validees))}` : ''}` });
    }
    evs.filter(e => e.version === v.version && e.action === 'modification_requested').forEach(e => {
      items.push({ ts: e.created_at, html: `Modification demandée par le client${e.message ? ` : « ${esc(e.message)} »` : ''}` });
    });
    if (v.reopened_at) items.push({ ts: v.reopened_at, html: 'Rouverte par l\'administration' });
    items.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    return `
      <div class="app-bloc-history-version">
        <div class="app-bloc-history-title">Version ${v.version}${v.reopened_at ? ' <span class="app-bloc-history-old">(ancienne version)</span>' : ''}</div>
        <ul>${items.map(i => `<li><span class="app-bloc-history-date">${formatDateTimeFr(i.ts)}</span> ${i.html}</li>`).join('') || '<li>Version en cours de saisie.</li>'}</ul>
      </div>`;
  }).join('');
  return `
    <details class="app-bloc-history">
      <summary>Voir l'historique</summary>
      <div class="app-bloc-history-body">
        <div class="app-bloc-history-heading">Historique — ${esc(blocLabel(bloc))}</div>
        ${versionsHtml}
      </div>
    </details>`;
}

// Historique d'un document : versions archivées (remplacées / supprimées)
// + réouvertures, puis la version actuelle.
export function renderDocumentHistory(doc, docVersions, events, { withDownload = false } = {}) {
  const old = (docVersions || []).filter(v => v.document_id === doc.id || (!v.document_id && v.type === doc.type))
    .sort((a, b) => new Date(a.archived_at) - new Date(b.archived_at));
  const reopenings = (events || []).filter(e => e.bloc === 'documents' && e.action === 'document_reouvert' && e.donnees && e.donnees.type === doc.type);
  if (!old.length && !reopenings.length) return '';
  const items = [];
  old.forEach(v => {
    const fileHtml = withDownload && v.storage_path
      ? `<a href="#" data-download="${esc(v.storage_path)}">${esc(v.file_name || 'fichier')}</a>`
      : esc(v.file_name || 'fichier');
    items.push({ ts: v.uploaded_at || v.archived_at, html: `Déposé : ${fileHtml}` });
    if (v.validated_at) items.push({ ts: v.validated_at, html: `Validé (${esc(v.file_name || '')})` });
    items.push({ ts: v.archived_at, html: v.motif === 'suppression_admin' ? `Document supprimé par l'administration (${esc(v.file_name || '')}) — archivé, non détruit` : v.motif === 'retrait_client' ? `Retiré par le client (${esc(v.file_name || '')})` : `Remplacé par une nouvelle version (${esc(labelOf(DOC_STATUTS, v.statut_final))} au moment du remplacement)` });
  });
  reopenings.forEach(e => items.push({ ts: e.created_at, html: `Rouvert par l'administration (validé le ${formatDateTimeFr(e.donnees.validated_at)})` }));
  items.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return `
    <details class="app-bloc-history app-doc-history">
      <summary>Historique (${old.length} ancienne${old.length > 1 ? 's' : ''} version${old.length > 1 ? 's' : ''})</summary>
      <div class="app-bloc-history-body">
        <div class="app-bloc-history-heading">Historique — ${esc(labelForDocumentType(doc.type))}</div>
        <ul>${items.map(i => `<li><span class="app-bloc-history-date">${formatDateTimeFr(i.ts)}</span> ${i.html}</li>`).join('')}</ul>
      </div>
    </details>`;
}

// Dates d'un document (premier dépôt, dernière version, validation).
export function renderDocumentDates(doc) {
  const parts = [];
  if (doc.first_uploaded_at) parts.push(`Premier dépôt : ${formatDateTimeFr(doc.first_uploaded_at)}`);
  if (doc.uploaded_at && doc.first_uploaded_at && Math.abs(new Date(doc.uploaded_at) - new Date(doc.first_uploaded_at)) > 1000) {
    parts.push(`Dernière version : ${formatDateTimeFr(doc.uploaded_at)}`);
  } else if (doc.uploaded_at && !doc.first_uploaded_at) {
    parts.push(`Déposé : ${formatDateTimeFr(doc.uploaded_at)}`);
  }
  if (doc.statut === 'valide' && doc.validated_at) parts.push(`Validé : ${formatDateTimeFr(doc.validated_at)}`);
  if (doc.reopened_at && doc.statut !== 'valide') parts.push(`Rouvert : ${formatDateTimeFr(doc.reopened_at)}`);
  if (doc.deleted_at && !doc.storage_path) parts.push(`Supprimé par l'administration : ${formatDateTimeFr(doc.deleted_at)}`);
  return parts.length ? `<span class="app-doc-dates">${parts.map(esc).join(' · ')}</span>` : '';
}

// Synthèse documents pour la vue d'ensemble ("4 validés / 1 à vérifier").
export function documentsSummary(documents) {
  const req = (documents || []).filter(d => d.statut !== 'non_requis');
  const valides = req.filter(d => d.statut === 'valide').length;
  const aVerifier = req.filter(d => d.statut === 'recu' || d.statut === 'a_verifier').length;
  const refuses = req.filter(d => d.statut === 'refuse').length;
  const manquants = req.filter(d => d.statut === 'a_fournir').length;
  let dot = '⚪';
  if (req.length && valides === req.length) dot = '🟢';
  else if (refuses) dot = '🔴';
  else if (aVerifier) dot = '🟠';
  const parts = [`${valides} validé${valides > 1 ? 's' : ''}`];
  if (aVerifier) parts.push(`${aVerifier} à vérifier`);
  if (refuses) parts.push(`${refuses} refusé${refuses > 1 ? 's' : ''}`);
  if (manquants) parts.push(`${manquants} à fournir`);
  return { dot, text: parts.join(' / '), total: req.length };
}
