// ================================================================
//  CONFIGURATION DES COLONIES
//  Pour ajouter un séjour : ajouter un objet dans ce tableau.
//  Le formulaire se met à jour automatiquement — aucune autre
//  modification du code n'est nécessaire.
// ================================================================
const COLONIES = [
  {
    id: 'colo-octobre-2026',
    nom: 'Colonie d\'Octobre 2026 — 11 au 22 oct.',
    ages: '6 – 14 ans',
    tarif: 600,
    tarifCAF: 180,
    duree: '12 jours (11 au 22 octobre 2026)',
    aides: 'Aide CAF jusqu\'à 420 € → reste à charge 180 € · Pass Colo · VACAF',
    description: '12 jours d\'aventure à La Plaine des Palmistes : Laser Game, Accro Roc, sortie au Zoo de Casela, Piscine, Parc du Colosse, randonnées et veillées animées.',
  },
  // ── Ajouter un nouveau séjour en copiant le bloc ci-dessous ──
  // {
  //   id: 'colo-ete-2027',             // identifiant unique (pas d'espaces)
  //   nom: 'Colonie Été 2027',          // nom affiché dans le formulaire
  //   ages: '6 – 14 ans',
  //   tarif: 600,                       // tarif public en euros
  //   tarifCAF: 180,                    // reste à charge avec aide CAF (optionnel)
  //   duree: '12 jours',
  //   aides: 'Aide CAF, Pass Colo et VACAF acceptés',
  //   description: 'Description du séjour...',
  // },
];
// ================================================================

(function () {
  'use strict';

  let step = 1;
  const TOTAL = 5;

  const $ = id => document.getElementById(id);

  const form         = $('inscriptionForm');
  const btnNext      = $('btnNext');
  const btnPrev      = $('btnPrev');
  const stepCounter  = $('stepCounter');
  const progressFill = $('progressLineFill');
  const colonieSelect= $('colonieSelect');
  const colonieInfo  = $('colonieInfoBox');
  const enfantDdn    = $('enfantDdn');
  const ageCalc      = $('ageCalc');
  const valAge       = $('valAge');
  const recapBox     = $('recapBox');
  const certCheck    = $('certCheck');

  // ── Peupler la liste des colonies ─────────────────────────
  COLONIES.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nom;
    colonieSelect.appendChild(opt);
  });

  // ── Info colonie dynamique ─────────────────────────────────
  colonieSelect.addEventListener('change', () => {
    const c = COLONIES.find(x => x.id === colonieSelect.value);
    if (!c) { colonieInfo.style.display = 'none'; return; }
    colonieInfo.innerHTML = `
      <div class="colonie-info-box">
        <div class="ci-row"><span>👦</span><div><strong>Âge</strong><span>${c.ages}</span></div></div>
        <div class="ci-row"><span>📅</span><div><strong>Durée</strong><span>${c.duree}</span></div></div>
        <div class="ci-row"><span>💰</span><div><strong>Tarif public</strong><span>${c.tarif} €</span></div></div>
        ${c.tarifCAF ? `<div class="ci-row"><span>🎉</span><div><strong>Avec aide CAF/VACAF</strong><span style="color:var(--vert-fonce);font-weight:700;">${c.tarifCAF} € reste à charge</span></div></div>` : ''}
        <div class="ci-row"><span>✅</span><div><strong>Aides acceptées</strong><span>${c.aides}</span></div></div>
        <p class="ci-desc">${c.description}</p>
      </div>`;
    colonieInfo.style.display = 'block';
  });

  // ── Calcul automatique de l'âge ───────────────────────────
  enfantDdn.addEventListener('change', () => {
    if (!enfantDdn.value) { ageCalc.textContent = ''; valAge.value = ''; return; }
    const ddn = new Date(enfantDdn.value);
    const auj = new Date();
    let age = auj.getFullYear() - ddn.getFullYear();
    if (auj.getMonth() < ddn.getMonth() ||
       (auj.getMonth() === ddn.getMonth() && auj.getDate() < ddn.getDate())) age--;
    if (age < 0 || age > 20) { ageCalc.textContent = ''; valAge.value = ''; return; }
    const texte = age + ' an' + (age > 1 ? 's' : '') + ' aujourd\'hui';
    ageCalc.textContent = texte;
    valAge.value = texte;
  });

  // ── Validation d'une étape ────────────────────────────────
  function validateStep(n) {
    const el = $('step-' + n);
    clearErrors(el);
    let ok = true;

    // Champs texte / select / date / email / tel
    el.querySelectorAll('input[required]:not([type=radio]):not([type=checkbox]):not([type=file]), select[required]').forEach(f => {
      if (!f.value.trim()) { markError(f, 'Champ obligatoire'); ok = false; }
    });

    // Groupes radio (ex : Sexe)
    const groups = {};
    el.querySelectorAll('input[type=radio]').forEach(r => {
      groups[r.name] = groups[r.name] || [];
      groups[r.name].push(r);
    });
    Object.values(groups).forEach(radios => {
      if (!radios.some(r => r.checked)) {
        const wrap = radios[0].closest('.radio-cards') || radios[0].parentElement;
        addError(wrap, 'Veuillez faire un choix');
        ok = false;
      }
    });

    // Fichiers obligatoires
    el.querySelectorAll('input[type=file][required]').forEach(f => {
      if (!f.files || !f.files.length) {
        const item = f.closest('.file-upload-item');
        const prev = item.querySelector('.file-preview');
        prev.innerHTML = '<span class="file-error-msg">⚠ Fichier requis</span>';
        ok = false;
      }
    });

    return ok;
  }

  function clearErrors(el) {
    el.querySelectorAll('.field-error').forEach(e => e.remove());
    el.querySelectorAll('.input-error').forEach(e => e.classList.remove('input-error'));
    el.querySelectorAll('.file-error-msg').forEach(e => e.remove());
  }

  function markError(field, msg) {
    field.classList.add('input-error');
    addError(field.closest('.form-group') || field.parentElement, msg);
  }

  function addError(parent, msg) {
    if (parent.querySelector('.field-error')) return;
    const span = document.createElement('span');
    span.className = 'field-error';
    span.textContent = msg;
    parent.appendChild(span);
  }

  // ── Génération du récapitulatif ───────────────────────────
  function genRecap() {
    const c   = COLONIES.find(x => x.id === colonieSelect.value);
    const v   = id => $(id) ? $(id).value || '—' : '—';
    const sex = (document.querySelector('input[name="Sexe"]:checked') || {}).value || '—';

    const r = (label, val) => `<div class="recap-row"><span>${label}</span><strong>${val}</strong></div>`;

    recapBox.innerHTML = `
      <div class="recap-section">
        <h4>🏕️ Séjour</h4>
        ${r('Colonie', c ? c.nom : '—')}
        ${r('Tarif', c ? c.tarif + ' €' : '—')}
        ${r('Durée', c ? c.duree : '—')}
      </div>
      <div class="recap-section">
        <h4>👶 L'enfant</h4>
        ${r('Nom complet', v('enfantPrenom') + ' ' + v('enfantNom'))}
        ${r('Date de naissance', v('enfantDdn'))}
        ${r('Âge', valAge.value || '—')}
        ${r('Sexe', sex)}
        ${r('Adresse', v('enfantAdresse') + ', ' + v('enfantCP') + ' ' + v('enfantVille'))}
        ${r('École', v('enfantEcole'))}
      </div>
      <div class="recap-section">
        <h4>👨‍👩‍👧 Responsable légal</h4>
        ${r('Identité', v('respNomPrenom'))}
        ${r('Lien', v('respLien'))}
        ${r('Téléphone', v('respTel'))}
        ${r('Email', v('respEmail'))}
      </div>
      <div class="recap-section">
        <h4>🔒 Documents</h4>
        ${r('Transmission', 'Après confirmation de la place')}
      </div>`;
  }

  // ── Navigation ────────────────────────────────────────────
  btnNext.addEventListener('click', () => {
    if (!validateStep(step)) {
      const first = document.querySelector('#step-' + step + ' .field-error, #step-' + step + ' .input-error, #step-' + step + ' .file-error-msg');
      if (first) first.scrollIntoView({ behavior:'smooth', block:'center' });
      return;
    }
    if (step < TOTAL) {
      step++;
      if (step === TOTAL) genRecap();
      updateUI();
    }
  });

  btnPrev.addEventListener('click', () => {
    if (step > 1) { step--; updateUI(); }
  });

  function updateUI() {
    document.querySelectorAll('.insc-step').forEach((el, i) => {
      el.classList.toggle('active', i + 1 === step);
    });
    document.querySelectorAll('.prog-step').forEach((el, i) => {
      const n = i + 1;
      el.classList.toggle('active', n === step);
      el.classList.toggle('done',   n < step);
    });

    progressFill.style.width = ((step - 1) / (TOTAL - 1) * 100) + '%';
    btnPrev.style.visibility = step === 1 ? 'hidden' : 'visible';
    btnNext.style.display    = step === TOTAL ? 'none' : 'inline-flex';
    stepCounter.textContent  = 'Étape ' + step + ' / ' + TOTAL;

    $('inscProgress').scrollIntoView({ behavior:'smooth', block:'start' });
  }

  // ── Soumission ────────────────────────────────────────────
  form.addEventListener('submit', e => {
    if (!certCheck.checked) {
      e.preventDefault();
      const parent = certCheck.closest('.certification-group');
      parent.querySelectorAll('.field-error').forEach(el => el.remove());
      addError(parent, 'Vous devez certifier être le/la responsable légal(e) pour envoyer la demande.');
      certCheck.scrollIntoView({ behavior:'smooth', block:'center' });
      return;
    }
    const btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Envoi en cours…';
  });

})();
