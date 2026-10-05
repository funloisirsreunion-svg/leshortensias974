// Panneau de détail d'un dossier, montable dans n'importe quel conteneur DOM.
// Utilisé à la fois par dossier.html (une seule instance, toujours dépliée)
// et par dashboard.html (une instance par accordéon "Mes séjours", montée à
// la demande au premier dépli — plusieurs instances peuvent coexister sur la
// même page, donc tout est scopé au conteneur, jamais à des id globaux).

import {
  STATUTS, DOC_STATUTS, REGIMES, NIVEAUX,
  labelForDocumentType, labelOf, badgeClassForDocStatut, formatDateFr, formatMontant,
  docCompleteness, buildTodoList, resteAPayer,
} from '../lib/appConstants.js';
import {
  blocState, isLockedForClient, renderBlocStatusPanel, renderBlocHistory, renderDocumentHistory,
  renderDocumentDates, formatDateTimeFr,
} from '../lib/blocValidation.js';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export async function mountDossierPanel({ container, supabase, dossierId, onChange }) {
  let dossier, regimes, documents;
  let blocs = [], blocVersions = [], blocEvents = [], docVersions = [];
  let flash = null; // message à réafficher après rechargement : { bloc, text, type }

  function showMsg(el, text, type = 'error') {
    if (!el) return;
    el.innerHTML = `<div class="app-msg app-msg-${type}">${esc(text)}</div>`;
  }

  async function loadAll() {
    if (!dossier) container.innerHTML = `<div class="app-loading">Chargement du dossier…</div>`;
    const keepHeight = container.offsetHeight;
    if (keepHeight) container.style.minHeight = keepHeight + 'px';
    const [{ data: d, error: dErr }, { data: r }, { data: docs }, { data: bl }, { data: bv }, { data: be }, { data: dv }] = await Promise.all([
      supabase.from('dossiers').select('*').eq('id', dossierId).maybeSingle(),
      supabase.from('regimes_alimentaires').select('*').eq('dossier_id', dossierId).order('type'),
      supabase.from('documents').select('*').eq('dossier_id', dossierId),
      supabase.from('dossier_blocs').select('*').eq('dossier_id', dossierId),
      supabase.from('dossier_bloc_versions').select('*').eq('dossier_id', dossierId).order('version'),
      supabase.from('dossier_bloc_events').select('*').eq('dossier_id', dossierId).order('created_at'),
      supabase.from('document_versions').select('*').eq('dossier_id', dossierId).order('archived_at'),
    ]);
    container.style.minHeight = '';
    if (dErr || !d) {
      container.innerHTML = `<div class="app-msg app-msg-error">Ce dossier n'existe pas ou vous n'y avez pas accès.</div>`;
      return;
    }
    dossier = d; regimes = r || []; documents = docs || [];
    blocs = bl || []; blocVersions = bv || []; blocEvents = be || []; docVersions = dv || [];
    dossier._blocs = blocs;
    render();
    if (flash) {
      showMsg(container.querySelector(`.js-msg-${flash.bloc}`), flash.text, flash.type);
      flash = null;
    }
    if (onChange) onChange(dossier, documents);
  }

  const isSchool = () => dossier.client_type === 'school';
  const bState = (bloc) => blocState(blocs, bloc);
  const locked = (bloc) => isSchool() && isLockedForClient(bState(bloc));
  const ro = (bloc) => (locked(bloc) ? 'readonly' : '');

  const CONFIRM_LABELS = {
    coordonnees: 'Confirmer mes coordonnées',
    effectifs: 'Confirmer mes effectifs',
    regimes: 'Confirmer les régimes alimentaires',
  };

  // Statut, dates, actions et historique d'un bloc (Classes de découverte uniquement).
  function clientBlocSection(bloc) {
    if (!isSchool()) return '';
    return `
      ${renderBlocStatusPanel(bloc, bState(bloc), 'client')}
      ${renderBlocHistory(bloc, blocVersions, blocEvents)}`;
  }

  function blocActionsHtml(bloc) {
    if (!isSchool()) return '';
    const st = bState(bloc);
    if (st.statut === 'draft' || st.statut === 'reopened') {
      const label = st.statut === 'reopened' ? 'Confirmer les modifications' : CONFIRM_LABELS[bloc];
      return `<button type="button" class="app-btn" data-bloc-confirm="${bloc}">${label}</button>`;
    }
    if (!st.modification_requested_at) {
      return `<button type="button" class="app-btn app-btn-sm app-btn-outline" data-bloc-request="${bloc}">Demander une modification</button>`;
    }
    return '';
  }

  function renderSummaryCard() {
    if (dossier.client_type === 'group') {
      return `
        <div class="app-grid-3">
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1rem;">${dossier.nb_adultes || dossier.nb_enfants ? (Number(dossier.nb_adultes || 0) + Number(dossier.nb_enfants || 0)) + ' pers.' : '—'}</div><div class="app-kpi-label">Participants</div></div>
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:.95rem;">${dossier.formule ? labelOf([{ value: 'pension_complete', label: 'Pension complète' }, { value: 'demi_pension', label: 'Demi-pension' }, { value: 'weekend', label: 'Forfait week-end' }, { value: 'autre', label: 'Autre' }], dossier.formule) : '—'}</div><div class="app-kpi-label">Formule</div></div>
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1rem;">${labelOf(STATUTS, dossier.statut)}</div><div class="app-kpi-label">Statut</div></div>
        </div>
        <div style="margin-top:16px;font-size:.92rem;">
          <p><strong>Dates confirmées :</strong> ${dossier.date_confirmee_debut ? `du ${formatDateFr(dossier.date_confirmee_debut)} au ${formatDateFr(dossier.date_confirmee_fin)}` : 'pas encore fixées'}</p>
          <p style="color:var(--texte-clair);font-size:.82rem;margin-top:6px;">Seule Fun Loisirs Réunion confirme la date de votre séjour.</p>
        </div>`;
    }
    return `
        <div class="app-grid-3">
          <div class="app-kpi"><div class="app-kpi-num">${dossier.programme === 'volcan' ? 'Volcan' : dossier.programme === 'nature' ? 'Nature' : '—'}</div><div class="app-kpi-label">Programme</div></div>
          <div class="app-kpi"><div class="app-kpi-num">${dossier.duree ? dossier.duree + 'j' : '—'}</div><div class="app-kpi-label">Durée</div></div>
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1rem;">${labelOf(STATUTS, dossier.statut)}</div><div class="app-kpi-label">Statut</div></div>
        </div>
        <div style="margin-top:16px;font-size:.92rem;">
          ${dossier.date_confirmee_debut ? '' : `<p><strong>Date proposée :</strong> ${formatDateFr(dossier.date_proposee)}</p>`}
          <p><strong>Dates confirmées :</strong> ${dossier.date_confirmee_debut ? `du ${formatDateFr(dossier.date_confirmee_debut)} au ${formatDateFr(dossier.date_confirmee_fin)}` : 'pas encore fixées'}</p>
          <p style="color:var(--texte-clair);font-size:.82rem;margin-top:6px;">Seule Fun Loisirs Réunion peut modifier la date ou le statut du séjour.</p>
        </div>`;
  }

  function render() {
    const todo = buildTodoList(dossier, documents);
    const reste = resteAPayer(dossier);

    container.innerHTML = `
      <div class="app-panel-section">${renderSummaryCard()}</div>

      ${todo.length ? `
      <div class="app-panel-section">
        <h3>À faire maintenant</h3>
        <ul class="app-todo-list">
          ${todo.map(t => `<li><span class="app-todo-dot"></span>${esc(t)}</li>`).join('')}
        </ul>
      </div>` : `<div class="app-msg app-msg-success">Votre dossier est à jour, rien ne vous attend pour le moment. 🎉</div>`}

      ${isSchool() ? `
      <div class="app-panel-section">
        <h3>Coordonnées de l'établissement</h3>
        ${clientBlocSection('coordonnees')}
        <div class="js-msg-coordonnees"></div>
        <form class="js-coordonnees-form">
          <div class="app-field"><label>Établissement</label><input type="text" name="etablissement" value="${esc(dossier.etablissement)}" required ${ro('coordonnees')} /></div>
          <div class="app-field"><label>Adresse</label><input type="text" name="adresse" value="${esc(dossier.adresse)}" ${ro('coordonnees')} /></div>
          <div class="app-grid-2">
            <div class="app-field"><label>Code postal</label><input type="text" name="code_postal" value="${esc(dossier.code_postal)}" inputmode="numeric" maxlength="10" ${ro('coordonnees')} /></div>
            <div class="app-field"><label>Commune</label><input type="text" name="commune" value="${esc(dossier.commune)}" ${ro('coordonnees')} /></div>
          </div>
          <div class="app-field"><label>Contact</label><input type="text" name="contact_nom" value="${esc(dossier.contact_nom)}" ${ro('coordonnees')} /></div>
          <div class="app-grid-2">
            <div class="app-field"><label>E-mail</label><input type="email" name="contact_email" value="${esc(dossier.contact_email)}" ${ro('coordonnees')} /></div>
            <div class="app-field"><label>Téléphone</label><input type="text" name="contact_telephone" value="${esc(dossier.contact_telephone)}" ${ro('coordonnees')} /></div>
          </div>
          <div class="app-bloc-actions">
            ${locked('coordonnees') ? '' : '<button type="submit" class="app-btn app-btn-outline">Enregistrer</button>'}
            ${blocActionsHtml('coordonnees')}
          </div>
        </form>
      </div>` : ''}

      <div class="app-panel-section">
        <h3>Finances</h3>
        ${isSchool() ? (() => {
          const st = bState('devis');
          const dv = documents.find(d => d.type === 'devis');
          if (st.statut !== 'validated') return '';
          return `<div class="app-msg app-msg-success">🟢 <strong>Devis validé</strong> 🔒<br/>Devis : ${esc(dv && dv.file_name ? dv.file_name : '—')}<br/>Validé le : ${formatDateTimeFr(st.admin_validated_at)}</div>`;
        })() : ''}
        <div class="app-grid-3">
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1.1rem;">${formatMontant(dossier.montant_devis)}</div><div class="app-kpi-label">Devis</div></div>
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1.1rem;">${formatMontant(dossier.acompte_attendu)}</div><div class="app-kpi-label">Acompte attendu</div></div>
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1.1rem;">${formatMontant(dossier.acompte_recu)}</div><div class="app-kpi-label">Acompte reçu</div></div>
        </div>
        <div class="app-grid-3" style="margin-top:12px;">
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1.1rem;">${formatMontant(dossier.montant_facture)}</div><div class="app-kpi-label">Facturé</div></div>
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1.1rem;">${formatMontant(dossier.montant_paye)}</div><div class="app-kpi-label">Total payé</div></div>
          <div class="app-kpi"><div class="app-kpi-num" style="font-size:1.1rem;">${reste != null ? formatMontant(reste) : '—'}</div><div class="app-kpi-label">Reste à payer</div></div>
        </div>
      </div>

      ${dossier.client_type === 'school' ? `
      <div class="app-panel-section">
        <h3>Effectifs prévisionnels</h3>
        ${clientBlocSection('effectifs')}
        <div class="js-msg-effectifs"></div>
        <form class="js-effectifs-form">
          <h4>Effectifs prévisionnels</h4>
          <div class="app-grid-3">
            <div class="app-field"><label>Élèves</label><input type="number" min="0" name="effectif_prev_eleves" value="${dossier.effectif_prev_eleves ?? ''}" ${ro('effectifs')} /></div>
            <div class="app-field"><label>Professeurs</label><input type="number" min="0" name="effectif_prev_profs" value="${dossier.effectif_prev_profs ?? ''}" ${ro('effectifs')} /></div>
            <div class="app-field"><label>Accompagnateurs</label><input type="number" min="0" name="effectif_prev_accompagnateurs" value="${dossier.effectif_prev_accompagnateurs ?? ''}" ${ro('effectifs')} /></div>
          </div>
          <h4>Niveaux scolaires (nombre d'élèves)</h4>
          <div class="app-grid-3">
            ${NIVEAUX.map(n => `
              <div class="app-field">
                <label>${n.label}</label>
                <input type="number" min="0" name="niveau_${n.key}" value="${(dossier.niveaux && dossier.niveaux[n.key]) || 0}" ${ro('effectifs')} />
              </div>`).join('')}
          </div>
          <h4>Effectifs définitifs</h4>
          <div class="app-grid-3">
            <div class="app-field"><label>Élèves</label><input type="number" min="0" name="effectif_def_eleves" value="${dossier.effectif_def_eleves ?? ''}" ${ro('effectifs')} /></div>
            <div class="app-field"><label>Professeurs</label><input type="number" min="0" name="effectif_def_profs" value="${dossier.effectif_def_profs ?? ''}" ${ro('effectifs')} /></div>
            <div class="app-field"><label>Accompagnateurs</label><input type="number" min="0" name="effectif_def_accompagnateurs" value="${dossier.effectif_def_accompagnateurs ?? ''}" ${ro('effectifs')} /></div>
          </div>
          <div class="app-bloc-actions">
            ${locked('effectifs') ? '' : '<button type="submit" class="app-btn app-btn-outline">Enregistrer</button>'}
            ${blocActionsHtml('effectifs')}
          </div>
        </form>
      </div>` : ''}

      ${dossier.client_type === 'group' ? `
      <div class="app-panel-section">
        <h3>Effectifs &amp; besoins</h3>
        <div class="js-msg-effectifs"></div>
        <form class="js-effectifs-form">
          <div class="app-grid-2">
            <div class="app-field"><label>Nombre d'adultes</label><input type="number" min="0" name="nb_adultes" value="${dossier.nb_adultes ?? ''}" /></div>
            <div class="app-field"><label>Nombre d'enfants</label><input type="number" min="0" name="nb_enfants" value="${dossier.nb_enfants ?? ''}" /></div>
          </div>
          <div class="app-field"><label>Besoins particuliers</label><textarea name="besoins_particuliers" rows="2">${esc(dossier.besoins_particuliers)}</textarea></div>
          <div class="app-field"><label>Régimes alimentaires / allergies</label><textarea name="remarques_alimentaires" rows="2">${esc(dossier.remarques_alimentaires)}</textarea></div>
          <button type="submit" class="app-btn">Enregistrer</button>
        </form>
      </div>` : ''}

      ${dossier.client_type !== 'colony' ? `
      <div class="app-panel-section">
        <h3>Régimes alimentaires</h3>
        ${clientBlocSection('regimes')}
        <div class="js-msg-regimes"></div>
        <form class="js-regimes-form">
          <div class="app-grid-3">
            ${REGIMES.map(r => {
              const row = regimes.find(x => x.type === r.value);
              return `<div class="app-field"><label>${r.label}</label><input type="number" min="0" name="regime_${r.value}" value="${row ? row.nombre : 0}" ${ro('regimes')} /></div>`;
            }).join('')}
          </div>
          ${isSchool() ? `<div class="app-field"><label>Remarques alimentaires / allergies</label><textarea name="remarques_alimentaires" rows="3" ${ro('regimes')}>${esc(dossier.remarques_alimentaires)}</textarea></div>` : ''}
          <div class="app-bloc-actions">
            ${locked('regimes') ? '' : `<button type="submit" class="app-btn${isSchool() ? ' app-btn-outline' : ''}">Enregistrer les régimes</button>`}
            ${blocActionsHtml('regimes')}
          </div>
        </form>
      </div>` : ''}

      <div class="app-panel-section">
        <h3>Documents</h3>
        ${isSchool() ? `<p style="font-size:.82rem;color:var(--texte-clair);margin-bottom:10px;">Les documents transmis sont conservés et ne peuvent pas être supprimés. Tant qu'un document n'est pas validé, vous pouvez en déposer une nouvelle version (l'ancienne reste dans l'historique).</p>` : ''}
        ${(() => { const c = docCompleteness(documents); return c.total ? `<p style="color:var(--texte-clair);font-size:.88rem;margin-bottom:14px;">${c.complete ? '✅' : '⚠️'} ${c.valides}/${c.total} documents requis validés</p>` : ''; })()}
        <div class="js-msg-docs"></div>
        ${documents.filter(d => d.statut !== 'non_requis').sort((a, b) => a.type.localeCompare(b.type)).map(doc => {
          // Un document transmis ne peut jamais être supprimé par le client ; il peut
          // être remplacé tant qu'il n'est pas validé (l'ancienne version est archivée).
          const devisFige = isSchool() && ['devis', 'devis_signe'].includes(doc.type) && bState('devis').statut === 'validated';
          const canEdit = doc.document_source !== 'admin' && doc.statut !== 'valide' && !devisFige;
          return `
          <div class="app-doc-row">
            <span class="app-doc-name">
              ${esc(labelForDocumentType(doc.type))}
              ${doc.commentaire ? `<br/><span style="font-size:.78rem;color:var(--texte-clair);font-weight:400;">${esc(doc.commentaire)}</span>` : ''}
              ${doc.statut === 'refuse' && doc.refus_motif ? `<br/><span style="font-size:.78rem;color:#c0392b;font-weight:400;">Motif du refus : ${esc(doc.refus_motif)}</span>` : ''}
              ${renderDocumentDates(doc)}
              ${doc.statut === 'valide' ? '<span class="app-doc-dates">🟢 Document validé — verrouillé 🔒</span>' : ''}
              ${renderDocumentHistory(doc, docVersions, blocEvents)}
            </span>
            <span class="${badgeClassForDocStatut(doc.statut)}">${DOC_STATUTS.find(s => s.value === doc.statut)?.dot || ''} ${labelOf(DOC_STATUTS, doc.statut)}</span>
            ${doc.file_name ? (doc.storage_path ? `<a href="#" data-download="${doc.storage_path}" style="font-size:.8rem;color:var(--vert-fonce);">${esc(doc.file_name)}</a>` : `<span style="font-size:.8rem;color:var(--texte-clair);">${esc(doc.file_name)}</span>`) : ''}
            ${canEdit ? `
            <label class="app-btn app-btn-sm app-btn-outline" style="cursor:pointer;">
              ${doc.file_name ? 'Remplacer' : 'Déposer'}
              <input type="file" data-doctype="${doc.type}" style="display:none;" />
            </label>
            ${doc.file_name && !isSchool() ? `<button type="button" class="app-btn app-btn-sm app-btn-outline" data-remove-doc="${doc.type}">Retirer</button>` : ''}
            ` : (doc.document_source === 'admin' ? '<span style="font-size:.78rem;color:var(--texte-clair);">Fourni par Les Hortensias</span>' : '')}
          </div>`;
        }).join('') || '<p style="color:var(--texte-clair);font-size:.85rem;">Aucun document pour le moment.</p>'}
      </div>

      <div class="app-panel-section">
        <h3>Signaler un virement</h3>
        <p style="font-size:.85rem;color:var(--texte-clair);margin-bottom:12px;">
          Vous avez effectué un virement ? Signalez-le ici, Fun Loisirs Réunion le rapprochera de votre dossier.
        </p>
        <div class="js-msg-virement"></div>
        <form class="js-virement-form">
          <div class="app-grid-2">
            <div class="app-field"><label>Montant (€)</label><input type="number" min="0" step="0.01" name="montant" required /></div>
            <div class="app-field"><label>Date du virement</label><input type="date" name="date_virement" required /></div>
          </div>
          <div class="app-field"><label>Note (optionnel)</label><input type="text" name="note" placeholder="Ex : acompte, part mairie…" /></div>
          <button type="submit" class="app-btn">Signaler</button>
        </form>
      </div>
    `;

    bindSave('effectifs', 'Enregistré.');
    bindSave('regimes', 'Régimes alimentaires enregistrés.');
    bindSave('coordonnees', 'Coordonnées enregistrées.');
    container.querySelectorAll('[data-bloc-confirm]').forEach(btn => btn.addEventListener('click', onConfirmBloc));
    container.querySelectorAll('[data-bloc-request]').forEach(btn => btn.addEventListener('click', onRequestModification));
    container.querySelector('.js-virement-form').addEventListener('submit', onSignalerVirement);
    container.querySelectorAll('input[type=file][data-doctype]').forEach(input => {
      input.addEventListener('change', onUploadDocument);
    });
    container.querySelectorAll('[data-remove-doc]').forEach(btn => {
      btn.addEventListener('click', onRemoveDocument);
    });
    container.querySelectorAll('[data-download]').forEach(a => {
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        const path = a.dataset.download;
        if (!path) return;
        const { data, error } = await supabase.storage.from('documents-dossiers').createSignedUrl(path, 60);
        if (error) { showMsg(container.querySelector('.js-msg-docs'), error.message); return; }
        window.open(data.signedUrl, '_blank');
      });
    });
  }

  // Enregistrements (brouillon). Renvoient une erreur ou null — réutilisés par
  // les boutons "Confirmer", qui enregistrent d'abord la saisie en cours.
  async function saveEffectifs(form) {
    const fd = new FormData(form);
    let payload;
    if (dossier.client_type === 'group') {
      payload = {
        nb_adultes: fd.get('nb_adultes') ? Number(fd.get('nb_adultes')) : null,
        nb_enfants: fd.get('nb_enfants') ? Number(fd.get('nb_enfants')) : null,
        besoins_particuliers: fd.get('besoins_particuliers') || null,
        remarques_alimentaires: fd.get('remarques_alimentaires') || null,
      };
    } else {
      const niveaux = {};
      NIVEAUX.forEach(n => { niveaux[n.key] = Number(fd.get(`niveau_${n.key}`)) || 0; });
      payload = {
        niveaux,
        effectif_prev_eleves: fd.get('effectif_prev_eleves') ? Number(fd.get('effectif_prev_eleves')) : null,
        effectif_prev_profs: fd.get('effectif_prev_profs') ? Number(fd.get('effectif_prev_profs')) : null,
        effectif_prev_accompagnateurs: fd.get('effectif_prev_accompagnateurs') ? Number(fd.get('effectif_prev_accompagnateurs')) : null,
        effectif_def_eleves: fd.get('effectif_def_eleves') ? Number(fd.get('effectif_def_eleves')) : null,
        effectif_def_profs: fd.get('effectif_def_profs') ? Number(fd.get('effectif_def_profs')) : null,
        effectif_def_accompagnateurs: fd.get('effectif_def_accompagnateurs') ? Number(fd.get('effectif_def_accompagnateurs')) : null,
      };
    }
    const { error } = await supabase.from('dossiers').update(payload).eq('id', dossier.id);
    return error;
  }

  async function saveRegimes(form) {
    const fd = new FormData(form);
    for (const r of REGIMES) {
      const nombre = Number(fd.get(`regime_${r.value}`)) || 0;
      const current = regimes.find(x => x.type === r.value);
      if (current && current.nombre === nombre) continue;
      const { error } = await supabase.from('regimes_alimentaires')
        .update({ nombre }).eq('dossier_id', dossier.id).eq('type', r.value);
      if (error) return error;
    }
    if (fd.has('remarques_alimentaires')) {
      const { error } = await supabase.from('dossiers')
        .update({ remarques_alimentaires: fd.get('remarques_alimentaires') || null }).eq('id', dossier.id);
      if (error) return error;
    }
    return null;
  }

  async function saveCoordonnees(form) {
    const fd = new FormData(form);
    const g = (k) => (fd.get(k) || '').trim() || null;
    if (!g('etablissement')) return new Error('Le nom de l\'établissement est obligatoire.');
    const { error } = await supabase.from('dossiers').update({
      etablissement: g('etablissement'), adresse: g('adresse'), code_postal: g('code_postal'),
      commune: g('commune'), contact_nom: g('contact_nom'), contact_email: g('contact_email'),
      contact_telephone: g('contact_telephone'),
    }).eq('id', dossier.id);
    return error;
  }

  const SAVERS = { effectifs: saveEffectifs, regimes: saveRegimes, coordonnees: saveCoordonnees };

  function bindSave(bloc, successText) {
    const form = container.querySelector(`.js-${bloc}-form`);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const error = await SAVERS[bloc](form);
      if (error) { showMsg(container.querySelector(`.js-msg-${bloc}`), error.message); return; }
      flash = { bloc, text: successText, type: 'success' };
      await loadAll();
    });
  }

  async function onConfirmBloc(e) {
    const bloc = e.currentTarget.dataset.blocConfirm;
    const msgEl = container.querySelector(`.js-msg-${bloc}`);
    const form = container.querySelector(`.js-${bloc}-form`);
    if (form && !form.reportValidity()) return;
    const question = {
      coordonnees: 'Confirmer ces coordonnées ? Elles seront transmises à Les Hortensias et verrouillées pendant la vérification.',
      effectifs: 'Confirmer ces effectifs ? Ils seront transmis à Les Hortensias et verrouillés pendant la vérification.',
      regimes: 'Confirmer ces informations alimentaires ? Elles seront transmises à Les Hortensias et verrouillées pendant la vérification.',
    }[bloc];
    if (!window.confirm(question)) return;
    e.currentTarget.disabled = true;
    if (form) {
      const saveError = await SAVERS[bloc](form);
      if (saveError) { showMsg(msgEl, saveError.message); e.currentTarget.disabled = false; return; }
    }
    const { error } = await supabase.rpc('bloc_confirm_client', { p_dossier_id: dossier.id, p_bloc: bloc });
    if (error) { showMsg(msgEl, error.message); e.currentTarget.disabled = false; return; }
    flash = { bloc, text: 'Merci ! Vos informations ont été transmises à Les Hortensias.', type: 'success' };
    await loadAll();
  }

  async function onRequestModification(e) {
    const bloc = e.currentTarget.dataset.blocRequest;
    const message = window.prompt('Quelle modification souhaitez-vous apporter ? (Les Hortensias rouvrira ces informations si nécessaire)');
    if (message === null) return;
    const { error } = await supabase.rpc('bloc_request_modification', { p_dossier_id: dossier.id, p_bloc: bloc, p_message: message });
    if (error) { showMsg(container.querySelector(`.js-msg-${bloc}`), error.message); return; }
    flash = { bloc, text: 'Votre demande a été transmise à Les Hortensias.', type: 'success' };
    await loadAll();
  }

  async function onUploadDocument(e) {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;
    const doctype = input.dataset.doctype;
    const msgEl = container.querySelector('.js-msg-docs');
    if (file.size > 10 * 1024 * 1024) { showMsg(msgEl, 'Fichier trop volumineux (10 Mo max).'); return; }
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${dossier.id}/${doctype}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from('documents-dossiers').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { error: docErr } = await supabase.from('documents')
        .update({ storage_path: path, file_name: file.name, statut: 'recu' })
        .eq('dossier_id', dossier.id).eq('type', doctype);
      if (docErr) throw docErr;
      showMsg(msgEl, 'Document déposé.', 'success');
      await loadAll();
    } catch (error) {
      showMsg(msgEl, error.message || 'Échec du dépôt du document.');
    }
  }

  async function onRemoveDocument(e) {
    const type = e.target.dataset.removeDoc;
    if (!window.confirm('Retirer ce document ? Vous pourrez en déposer un nouveau ensuite.')) return;
    const msgEl = container.querySelector('.js-msg-docs');
    try {
      const { error } = await supabase.from('documents')
        .update({ storage_path: null, file_name: null, statut: 'a_fournir' })
        .eq('dossier_id', dossier.id).eq('type', type);
      if (error) throw error;
      showMsg(msgEl, 'Document retiré.', 'success');
      await loadAll();
    } catch (error) {
      showMsg(msgEl, error.message || 'Échec du retrait (le document est peut-être déjà validé).');
    }
  }

  async function onSignalerVirement(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { data: { session } } = await supabase.auth.getSession();
    const payload = {
      dossier_id: dossier.id,
      montant: Number(fd.get('montant')),
      date_virement: fd.get('date_virement'),
      note: fd.get('note') || null,
      signale_par: session.user.id,
    };
    const msgEl = container.querySelector('.js-msg-virement');
    const { error } = await supabase.from('signalements_paiement').insert(payload);
    if (error) { showMsg(msgEl, error.message); return; }
    showMsg(msgEl, 'Virement signalé, merci ! Il sera vérifié par Fun Loisirs Réunion.', 'success');
    e.target.reset();
  }

  await loadAll();
  return { refresh: loadAll };
}
