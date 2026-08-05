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
    ageMin: 6,
    ageMax: 14,
    publicAccueilli: 'Enfants et adolescents de 6 à 14 ans',
    tarif: 600,
    tarifCAF: 180,
    duree: '12 jours (11 au 22 octobre 2026)',
    dateDebut: '2026-10-11',
    dateFin: '2026-10-22',
    aides: 'Aide CAF jusqu\'à 420 € → reste à charge 180 € · Pass Colo · VACAF',
    description: '12 jours d\'aventure à La Plaine-des-Palmistes : Laser Game, Accro Roc, sortie au zoo, Piscine, Parc du Colosse, randonnées et veillées animées.',
  },
  // ── Ajouter un nouveau séjour en copiant le bloc ci-dessous ──
  // {
  //   id: 'colo-ete-2027',             // identifiant unique (pas d'espaces)
  //   nom: 'Colonie Été 2027',          // nom affiché dans le formulaire
  //   ages: '6 – 14 ans',
  //   ageMin: 6,
  //   ageMax: 14,
  //   publicAccueilli: 'Enfants et adolescents de 6 à 14 ans',
  //   tarif: 600,                       // tarif public en euros
  //   tarifCAF: 180,                    // reste à charge avec aide CAF (optionnel)
  //   duree: '12 jours',
  //   dateDebut: '2027-07-05',          // AAAA-MM-JJ — utilisé pour le calcul d'âge et le PDF
  //   dateFin: '2027-07-17',
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

  // ── Identifiant unique de dossier ─────────────────────────
  const submissionId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'dossier-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);

  // ── État des documents déposés ────────────────────────────
  const uploadState = { fiche: null, caf: null, carnet: [], ficheGeneree: null };

  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  const MAX_SIZE = 10 * 1024 * 1024;

  let blobUploadFnPromise = null;
  function getBlobUpload() {
    if (!blobUploadFnPromise) {
      blobUploadFnPromise = import('https://esm.sh/@vercel/blob@2.6.1/client').then(mod => mod.upload);
    }
    return blobUploadFnPromise;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    return bytes > 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' Mo' : Math.round(bytes / 1024) + ' Ko';
  }

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

  // ── Aide CAF / VACAF : affichage conditionnel ─────────────
  function vacafAnswer() {
    const r = document.querySelector('input[name="Aide CAF-VACAF"]:checked');
    return r ? r.value : null;
  }

  function updateVacafUI() {
    const ans = vacafAnswer();
    $('vacafNumeroBlock').style.display = ans === 'Oui' ? 'block' : 'none';
    const cafTitle = $('cafTitle'), cafIntro = $('cafIntro'), cafSub = $('cafSub');
    if (ans === 'Oui') {
      cafTitle.innerHTML = 'Attestation ou justificatif CAF / VACAF <span class="req">*</span> — obligatoire';
      cafIntro.textContent = 'Document obligatoire compte tenu de votre réponse à l\'étape précédente. Formats acceptés : PDF, JPG, JPEG, PNG.';
      cafSub.textContent = 'PDF, JPG, JPEG ou PNG — 10 Mo max — obligatoire';
    } else {
      cafTitle.textContent = 'Attestation ou justificatif CAF / VACAF (facultatif)';
      cafIntro.textContent = 'Vous avez indiqué ne pas bénéficier d\'une aide CAF/VACAF : ce document n\'est pas nécessaire. Formats acceptés : PDF, JPG, JPEG, PNG.';
      cafSub.textContent = 'Facultatif';
    }
  }
  document.querySelectorAll('input[name="Aide CAF-VACAF"]').forEach(r => r.addEventListener('change', updateVacafUI));
  updateVacafUI();

  // ── Téléversement des documents (Vercel Blob, dépôt privé) ──
  async function uploadDoc(file, docType) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { status: 'error', name: file.name, message: 'Format non accepté (PDF, JPG ou PNG uniquement).' };
    }
    if (file.size > MAX_SIZE) {
      return { status: 'error', name: file.name, message: 'Fichier trop volumineux (10 Mo maximum).' };
    }
    try {
      const uploadFn = await getBlobUpload();
      const safeName = file.name.normalize('NFKD').replace(/[^\w.\-]/g, '_').slice(0, 80);
      const pathname = `submissions/${submissionId}/${docType}__${Date.now()}_${Math.random().toString(36).slice(2,8)}__${safeName}`;
      const blob = await uploadFn(pathname, file, {
        access: 'private',
        handleUploadUrl: '/api/upload',
      });
      return { status: 'ok', name: file.name, size: file.size, pathname: blob.pathname };
    } catch (err) {
      return { status: 'error', name: file.name, message: 'Échec du téléversement (connexion interrompue). Réessayez.' };
    }
  }

  function removeUploadedFile(pathname) {
    if (!pathname) return;
    fetch('/api/remove-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname }),
    }).catch(() => {});
  }

  // ── Bloc fichier unique (fiche signée / justificatif CAF) ──
  function wireSingleUpload(inputId, previewId, itemId, docType, stateKey) {
    const input = $(inputId);
    const preview = $(previewId);
    const item = $(itemId);

    function render() {
      const entry = uploadState[stateKey];
      if (!entry) { preview.innerHTML = ''; item.classList.remove('has-file', 'input-error'); return; }
      if (entry.status === 'busy') {
        preview.innerHTML = `<div class="uploaded-file-row"><span class="uploaded-file-name">${escapeHtml(entry.name)}</span><span class="uploaded-file-status busy">Envoi en cours…</span></div>`;
        return;
      }
      if (entry.status === 'error') {
        preview.innerHTML = `<div class="uploaded-file-row"><span class="uploaded-file-name">${escapeHtml(entry.name)}</span><span class="uploaded-file-status err">⚠ ${escapeHtml(entry.message)}</span></div>`;
        return;
      }
      item.classList.add('has-file');
      preview.innerHTML = `<div class="uploaded-file-row">
        <span><span class="uploaded-file-name">${escapeHtml(entry.name)}</span><span class="uploaded-file-size">(${formatSize(entry.size)})</span> <span class="uploaded-file-status ok">✓ Déposé</span></span>
        <button type="button" class="file-remove-btn">Supprimer</button>
      </div>`;
    }

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      uploadState[stateKey] = { status: 'busy', name: file.name };
      render();
      const result = await uploadDoc(file, docType);
      uploadState[stateKey] = result.status === 'ok' ? result : null;
      if (result.status === 'error') uploadState[stateKey] = { status: 'error', name: result.name, message: result.message };
      render();
    });

    preview.addEventListener('click', e => {
      if (!e.target.matches('.file-remove-btn')) return;
      const entry = uploadState[stateKey];
      uploadState[stateKey] = null;
      render();
      if (entry) removeUploadedFile(entry.pathname);
    });

    render();
  }

  wireSingleUpload('fileFiche', 'previewFiche', 'itemFiche', 'fiche', 'fiche');
  wireSingleUpload('fileCaf', 'previewCaf', 'itemCaf', 'caf', 'caf');

  // ── Bloc carnet de vaccination (fichiers multiples) ───────
  const fileCarnet    = $('fileCarnet');
  const previewCarnet = $('previewCarnet');
  const itemCarnet    = $('itemCarnet');

  function renderCarnetPreview() {
    if (!uploadState.carnet.length) { previewCarnet.innerHTML = ''; itemCarnet.classList.remove('has-file'); return; }
    itemCarnet.classList.toggle('has-file', uploadState.carnet.some(f => f.status === 'ok'));
    previewCarnet.innerHTML = uploadState.carnet.map(f => {
      if (f.status === 'busy') return `<div class="uploaded-file-row"><span class="uploaded-file-name">${escapeHtml(f.name)}</span><span class="uploaded-file-status busy">Envoi en cours…</span></div>`;
      if (f.status === 'error') return `<div class="uploaded-file-row"><span class="uploaded-file-name">${escapeHtml(f.name)}</span><span class="uploaded-file-status err">⚠ ${escapeHtml(f.message)}</span></div>`;
      return `<div class="uploaded-file-row">
        <span><span class="uploaded-file-name">${escapeHtml(f.name)}</span><span class="uploaded-file-size">(${formatSize(f.size)})</span> <span class="uploaded-file-status ok">✓</span></span>
        <button type="button" class="file-remove-btn" data-tmp="${f.tempId}">Supprimer</button>
      </div>`;
    }).join('');
  }

  fileCarnet.addEventListener('change', async () => {
    const files = Array.from(fileCarnet.files);
    fileCarnet.value = '';
    for (const file of files) {
      const tempId = 'tmp' + Math.random().toString(36).slice(2);
      uploadState.carnet.push({ tempId, status: 'busy', name: file.name });
      renderCarnetPreview();
      const result = await uploadDoc(file, 'carnet');
      const idx = uploadState.carnet.findIndex(f => f.tempId === tempId);
      if (idx !== -1) {
        uploadState.carnet[idx] = result.status === 'ok'
          ? Object.assign({ tempId }, result)
          : { tempId, status: 'error', name: result.name, message: result.message };
      }
      renderCarnetPreview();
    }
  });

  previewCarnet.addEventListener('click', e => {
    const tmp = e.target.dataset.tmp;
    if (!tmp) return;
    const idx = uploadState.carnet.findIndex(f => f.tempId === tmp);
    if (idx === -1) return;
    const entry = uploadState.carnet[idx];
    uploadState.carnet.splice(idx, 1);
    renderCarnetPreview();
    if (entry) removeUploadedFile(entry.pathname);
  });

  // ── Génération de la fiche d'inscription PDF ──────────────
  // ── Utilitaires dates / âge / nom de fichier ──────────────
  function calcAgeAt(ddnIso, refIso) {
    if (!ddnIso || !refIso) return null;
    const ddn = new Date(ddnIso + 'T00:00:00');
    const ref = new Date(refIso + 'T00:00:00');
    if (isNaN(ddn) || isNaN(ref)) return null;
    let age = ref.getFullYear() - ddn.getFullYear();
    if (ref.getMonth() < ddn.getMonth() || (ref.getMonth() === ddn.getMonth() && ref.getDate() < ddn.getDate())) age--;
    return age;
  }
  function formatDateFR(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('fr-FR');
  }
  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  function formatDateRangeFR(startIso, endIso) {
    if (!startIso || !endIso) return '—';
    const s = new Date(startIso + 'T00:00:00'), e = new Date(endIso + 'T00:00:00');
    if (isNaN(s) || isNaN(e)) return '—';
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
      return `du ${s.getDate()} au ${e.getDate()} ${MOIS_FR[e.getMonth()]} ${e.getFullYear()}`;
    }
    return `du ${s.getDate()} ${MOIS_FR[s.getMonth()]} ${s.getFullYear()} au ${e.getDate()} ${MOIS_FR[e.getMonth()]} ${e.getFullYear()}`;
  }
  function slugify(str) {
    var map = { à:'a', â:'a', ä:'a', á:'a', ã:'a', ç:'c', é:'e', è:'e', ê:'e', ë:'e', î:'i', ï:'i', ì:'i', í:'i', ô:'o', ö:'o', ò:'o', ó:'o', õ:'o', ù:'u', û:'u', ü:'u', ú:'u', ñ:'n', ý:'y', ÿ:'y' };
    return String(str || '').split('').map(function (ch) {
      var low = ch.toLowerCase();
      return map[low] || ch;
    }).join('').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';
  }

  // ── Numéro de dossier (attribué côté serveur, une seule fois par dossier) ──
  let dossierNumero = null;
  async function ensureDossierNumero() {
    if (dossierNumero) return dossierNumero;
    const res = await fetch('/api/dossier-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Échec de l\'attribution du numéro de dossier.');
    dossierNumero = data.dossierNumero;
    return dossierNumero;
  }

  // ── Logos (chargés une seule fois, convertis en data URL pour jsPDF) ──
  function loadImageAsDataUrl(url) {
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error('logo introuvable : ' + url); return r.blob(); })
      .then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          const img = new Image();
          img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error('image invalide : ' + url));
          img.src = dataUrl;
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }));
  }
  let logosPromise = null;
  function getLogos() {
    if (!logosPromise) {
      logosPromise = Promise.allSettled([
        loadImageAsDataUrl('images/logo-les-hortensias.jpg'),
        loadImageAsDataUrl('images/logo-fun-loisirs.jpg'),
      ]).then(([hRes, fRes]) => ({
        hortensias: hRes.status === 'fulfilled' ? hRes.value : null,
        funloisirs: fRes.status === 'fulfilled' ? fRes.value : null,
      }));
    }
    return logosPromise;
  }
  function fitInBox(w, h, maxW, maxH) {
    const ratio = Math.min(maxW / w, maxH / h);
    return { w: w * ratio, h: h * ratio };
  }

  // ── Génération de la fiche d'inscription PDF ──────────────
  async function generateFichePDF(dossierNum) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const logos = await getLogos();

    const c = COLONIES.find(x => x.id === colonieSelect.value);
    const sex = (document.querySelector('input[name="Sexe"]:checked') || {}).value || '—';
    const vacaf = vacafAnswer();
    const numAlloc = $('vacafNumero').value || '—';
    const autoPrive = (document.querySelector('input[name="Autorisation partage privé familles"]:checked') || {}).value || null;
    const autoPublic = (document.querySelector('input[name="Autorisation communication publique"]:checked') || {}).value || null;
    const respNomComplet = $('respNomPrenom').value || '—';
    const enfantNomComplet = (($('enfantPrenom').value || '') + ' ' + ($('enfantNom').value || '')).trim() || '—';
    const ageAtStay = (c && c.dateDebut) ? calcAgeAt($('enfantDdn').value, c.dateDebut) : null;

    const PAGE_W = 210, PAGE_H = 297;
    const MARGIN_L = 18, MARGIN_R = 18, MARGIN_TOP = 20, MARGIN_BOTTOM = 26;
    const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
    let y = MARGIN_TOP;

    function addPageHeader() {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
      doc.text('FICHE D\'INSCRIPTION – COLONIE DE VACANCES (suite)', PAGE_W / 2, 12, { align: 'center' });
      doc.setTextColor(25, 25, 25); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    }
    function checkPageBreak(requiredHeight) {
      if (y + requiredHeight > PAGE_H - MARGIN_BOTTOM) {
        doc.addPage();
        y = MARGIN_TOP;
        addPageHeader();
      }
    }
    function sectionTitle(title) {
      checkPageBreak(13);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(45, 90, 39);
      doc.text(title, MARGIN_L, y);
      y += 2;
      doc.setDrawColor(45, 90, 39); doc.setLineWidth(0.4);
      doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y);
      y += 6;
      doc.setTextColor(25, 25, 25); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    }
    function fieldLine(label, value) {
      const text = String(value == null || value === '' ? '—' : value);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
      const labelText = label + ' : ';
      const labelW = doc.getTextWidth(labelText);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(text, CONTENT_W - labelW);
      const lineH = 5.4;
      checkPageBreak(lines.length * lineH + 1.5);
      doc.setFont('helvetica', 'bold');
      doc.text(labelText, MARGIN_L, y);
      doc.setFont('helvetica', 'normal');
      doc.text(lines[0] || '—', MARGIN_L + labelW, y);
      for (let i = 1; i < lines.length; i++) {
        y += lineH;
        doc.text(lines[i], MARGIN_L + 6, y);
      }
      y += lineH + 1.6;
    }
    function drawCheckbox(x, baselineY, checked) {
      const s = 3.6;
      const top = baselineY - 3.0;
      doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.35);
      doc.rect(x, top, s, s);
      if (checked) {
        doc.setLineWidth(0.5);
        doc.line(x + 0.6, top + 0.6, x + s - 0.6, top + s - 0.6);
        doc.line(x + s - 0.6, top + 0.6, x + 0.6, top + s - 0.6);
      }
    }
    function checkboxLine(label, checked) {
      const s = 3.6, gap = 3;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      const lines = doc.splitTextToSize(label, CONTENT_W - s - gap);
      const lineH = 5.4;
      checkPageBreak(Math.max(lineH, lines.length * lineH) + 1.5);
      drawCheckbox(MARGIN_L, y, checked);
      doc.text(lines, MARGIN_L + s + gap, y);
      y += lines.length * lineH + 2.6;
    }
    function paragraph(text, opts) {
      opts = opts || {};
      doc.setFont('helvetica', opts.italic ? 'italic' : 'normal');
      doc.setFontSize(opts.size || 10.5);
      if (opts.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
      const lines = doc.splitTextToSize(text, CONTENT_W);
      const lineH = opts.lineH || 5.4;
      checkPageBreak(lines.length * lineH + 1.5);
      doc.text(lines, MARGIN_L, y);
      y += lines.length * lineH + (opts.after != null ? opts.after : 3);
      doc.setTextColor(25, 25, 25); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    }
    function blankLine(label) {
      checkPageBreak(7);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
      const labelText = label + ' : ';
      const labelW = doc.getTextWidth(labelText);
      doc.text(labelText, MARGIN_L, y);
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
      doc.line(MARGIN_L + labelW, y + 0.8, PAGE_W - MARGIN_R, y + 0.8);
      y += 8;
    }

    // ── En-tête avec logos ───────────────────────────────
    const HEADER_TOP = 13;
    const LOGO_MAX_W = 28, LOGO_MAX_H = 20;
    if (logos.hortensias) {
      const fit = fitInBox(logos.hortensias.width, logos.hortensias.height, LOGO_MAX_W, LOGO_MAX_H);
      doc.addImage(logos.hortensias.dataUrl, 'JPEG', MARGIN_L, HEADER_TOP, fit.w, fit.h);
    }
    if (logos.funloisirs) {
      const fit = fitInBox(logos.funloisirs.width, logos.funloisirs.height, LOGO_MAX_W, LOGO_MAX_H);
      doc.addImage(logos.funloisirs.dataUrl, 'JPEG', PAGE_W - MARGIN_R - fit.w, HEADER_TOP, fit.w, fit.h);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(45, 90, 39);
    doc.text('FICHE D\'INSCRIPTION', PAGE_W / 2, HEADER_TOP + 8, { align: 'center' });
    doc.text('COLONIE DE VACANCES', PAGE_W / 2, HEADER_TOP + 15, { align: 'center' });

    y = HEADER_TOP + LOGO_MAX_H + 6;
    doc.setFontSize(11); doc.setTextColor(25, 25, 25);
    doc.setFont('helvetica', 'bold');
    doc.text('Centre Les Hortensias', PAGE_W / 2, y, { align: 'center' }); y += 5.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Organisé par Fun Loisirs Réunion', PAGE_W / 2, y, { align: 'center' }); y += 6.5;
    doc.setFontSize(9); doc.setTextColor(90, 90, 90);
    doc.text('41 rue des Mimosas, 97431 La Plaine-des-Palmistes, La Réunion', PAGE_W / 2, y, { align: 'center' }); y += 4.3;
    doc.text('Téléphone : 06 92 36 58 38', PAGE_W / 2, y, { align: 'center' }); y += 4.3;
    doc.text('E-mail : contact.funloisirsreunion@gmail.com', PAGE_W / 2, y, { align: 'center' }); y += 6;
    doc.setDrawColor(45, 90, 39); doc.setLineWidth(0.6);
    doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y); y += 7;
    doc.setTextColor(25, 25, 25); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);

    // ── Numéro de dossier + informations sur le séjour ───
    fieldLine('Numéro de dossier', dossierNum);
    fieldLine('Nom du séjour', c ? c.nom : '—');
    fieldLine('Dates', c && c.dateDebut ? formatDateRangeFR(c.dateDebut, c.dateFin) : (c ? c.duree : '—'));
    fieldLine('Public accueilli', c ? (c.publicAccueilli || c.ages) : '—');
    fieldLine('Tarif du séjour', c ? c.tarif + ' €' : '—');
    y += 2;

    // ── Informations sur l'enfant ────────────────────────
    sectionTitle('INFORMATIONS SUR L\'ENFANT');
    fieldLine('Nom', $('enfantNom').value);
    fieldLine('Prénom', $('enfantPrenom').value);
    fieldLine('Date de naissance', formatDateFR($('enfantDdn').value));
    fieldLine('Âge au moment du séjour', ageAtStay != null ? (ageAtStay + ' an' + (ageAtStay > 1 ? 's' : '')) : (valAge.value || '—'));
    fieldLine('Sexe', sex);
    fieldLine('Adresse complète', `${$('enfantAdresse').value}, ${$('enfantCP').value} ${$('enfantVille').value}`);
    fieldLine('Établissement scolaire fréquenté', $('enfantEcole').value);
    y += 2;

    // ── Responsable légal ────────────────────────────────
    sectionTitle('INFORMATIONS DU RESPONSABLE LÉGAL');
    fieldLine('Nom et prénom', $('respNomPrenom').value);
    fieldLine('Lien avec l\'enfant', $('respLien').value);
    fieldLine('Téléphone', $('respTel').value);
    fieldLine('Adresse e-mail', $('respEmail').value);
    y += 2;

    // ── CAF / VACAF ───────────────────────────────────────
    sectionTitle('PARTICIPATION CAF / VACAF');
    checkboxLine('Oui, mon enfant bénéficie d\'une aide CAF / VACAF.', vacaf === 'Oui');
    checkboxLine('Non, mon enfant ne bénéficie pas d\'une aide CAF / VACAF.', vacaf === 'Non');
    if (vacaf === 'Oui') fieldLine('Numéro allocataire', numAlloc);
    y += 1;
    paragraph('En cas de demande d\'aide CAF / VACAF, l\'attestation correspondante doit être jointe au dossier.', { italic: true, size: 9.5, color: [80, 80, 80], lineH: 4.6, after: 2 });

    // Page 2 : autorisations, pièces à fournir, signature (nouvelle page si tout tient encore page 1)
    if (doc.internal.getNumberOfPages() === 1) {
      doc.addPage();
      y = MARGIN_TOP;
      addPageHeader();
    }

    // ── Autorisation parentale ───────────────────────────
    sectionTitle('AUTORISATION PARENTALE');
    paragraph(
      `Je soussigné(e), ${respNomComplet}, responsable légal de l'enfant ${enfantNomComplet}, autorise sa participation au séjour de colonie de vacances organisé par Fun Loisirs Réunion au Centre Les Hortensias – Plaine-des-Palmistes.`,
      { after: 5 }
    );
    blankLine('Fait à');
    blankLine('Le');
    checkPageBreak(6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('Signature du responsable légal :', MARGIN_L, y);
    y += 8;
    doc.setFont('helvetica', 'normal');

    // ── Droit à l'image ───────────────────────────────────
    sectionTitle('AUTORISATION CONCERNANT LES PHOTOS ET VIDÉOS');
    checkPageBreak(6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('Partage privé auprès des familles du séjour', MARGIN_L, y); y += 6;
    doc.setFont('helvetica', 'normal');
    checkboxLine('J\'autorise.', autoPrive === 'J\'autorise');
    checkboxLine('Je n\'autorise pas.', autoPrive === 'Je n\'autorise pas');
    y += 3;

    checkPageBreak(6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('Communication publique de Fun Loisirs Réunion', MARGIN_L, y); y += 6;
    paragraph('Supports concernés : site internet, réseaux sociaux, supports de présentation des activités de l\'association.', { italic: true, size: 9.5, color: [80, 80, 80], lineH: 4.6, after: 2 });
    checkboxLine('J\'autorise.', autoPublic === 'J\'autorise');
    checkboxLine('Je n\'autorise pas.', autoPublic === 'Je n\'autorise pas');
    y += 2;

    // ── Pièces à fournir ──────────────────────────────────
    sectionTitle('PIÈCES À FOURNIR');
    checkboxLine('Fiche d\'inscription complétée et signée (obligatoire).', false);
    checkboxLine('Copie des pages de vaccination du carnet de santé (obligatoire).', false);
    checkboxLine('Attestation CAF / VACAF' + (vacaf === 'Oui' ? ' (obligatoire, aide déclarée).' : ' (non requise, aucune aide déclarée).'), false);
    checkboxLine('Autres documents éventuellement demandés par l\'organisateur.', false);
    y += 2;

    // ── Zone de signature finale ─────────────────────────
    sectionTitle('SIGNATURE');
    blankLine('Fait à');
    blankLine('Le');
    fieldLine('Nom du responsable légal', $('respNomPrenom').value);
    checkPageBreak(45);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('Signature du responsable légal :', MARGIN_L, y);
    y += 5;
    doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.4);
    doc.rect(MARGIN_L, y, 90, 36);
    y += 40;

    // ── Pied de page (dossier + numérotation) ─────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(130, 130, 130);
      doc.text('Centre Les Hortensias – Fun Loisirs Réunion', MARGIN_L, PAGE_H - 16);
      doc.text('41 rue des Mimosas, 97431 La Plaine-des-Palmistes – 06 92 36 58 38 – contact.funloisirsreunion@gmail.com', MARGIN_L, PAGE_H - 12);
      doc.text(`Dossier : ${dossierNum}`, PAGE_W - MARGIN_R, PAGE_H - 16, { align: 'right' });
      doc.text(`Page ${i}/${totalPages}`, PAGE_W - MARGIN_R, PAGE_H - 12, { align: 'right' });
    }

    return doc;
  }

  function ficheGenereeFilename(dossierNum) {
    return `${dossierNum}_Fiche_generee_${slugify($('enfantNom').value)}_${slugify($('enfantPrenom').value)}.pdf`;
  }

  function renderFicheGenereePreview() {
    const prev = $('previewFicheGeneree');
    const entry = uploadState.ficheGeneree;
    if (!entry) { prev.innerHTML = ''; return; }
    if (entry.status === 'busy') {
      prev.innerHTML = `<div class="uploaded-file-row"><span class="uploaded-file-name">${escapeHtml(entry.name)}</span><span class="uploaded-file-status busy">Enregistrement du dossier…</span></div>`;
      return;
    }
    if (entry.status === 'error') {
      prev.innerHTML = `<div class="uploaded-file-row"><span class="uploaded-file-name">${escapeHtml(entry.name)}</span><span class="uploaded-file-status err">⚠ ${escapeHtml(entry.message)}</span></div>`;
      return;
    }
    prev.innerHTML = `<div class="uploaded-file-row"><span><span class="uploaded-file-name">${escapeHtml(entry.name)}</span><span class="uploaded-file-size">(${formatSize(entry.size)})</span> <span class="uploaded-file-status ok">✓ Générée et enregistrée dans le dossier</span></span></div>`;
  }

  $('btnGenFiche').addEventListener('click', async () => {
    const btn = $('btnGenFiche');
    if (!window.jspdf) { $('genFicheStatus').textContent = 'Générateur PDF indisponible pour le moment.'; return; }

    const c = COLONIES.find(x => x.id === colonieSelect.value);
    const ddn = $('enfantDdn').value;
    if (c && c.dateDebut && ddn) {
      const ageAtStayCheck = calcAgeAt(ddn, c.dateDebut);
      if (ageAtStayCheck != null && (ageAtStayCheck < c.ageMin || ageAtStayCheck > c.ageMax)) {
        const continuer = confirm(
          `Attention : au début du séjour (${formatDateFR(c.dateDebut)}), l'enfant aura ${ageAtStayCheck} an(s), ` +
          `en dehors de la tranche d'âge autorisée pour ce séjour (${c.ageMin}-${c.ageMax} ans).\n\n` +
          `Générer quand même la fiche d'inscription ?`
        );
        if (!continuer) {
          $('genFicheStatus').textContent = 'Génération annulée — vérifiez la date de naissance ou le séjour choisi.';
          return;
        }
      }
    }

    btn.disabled = true;
    $('genFicheStatus').textContent = 'Attribution du numéro de dossier…';

    try {
      const numero = await ensureDossierNumero();
      $('genFicheStatus').textContent = 'Génération du PDF…';

      const doc = await generateFichePDF(numero);
      const filename = ficheGenereeFilename(numero);
      const pdfBlob = doc.output('blob');

      // Téléchargement pour la famille
      const dlUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = dlUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(dlUrl);

      // Conservation automatique dans le dossier (jointe au mail à l'étape 5)
      uploadState.ficheGeneree = { status: 'busy', name: filename };
      renderFicheGenereePreview();
      $('genFicheStatus').textContent = `Fiche téléchargée ✓ — dossier ${numero}. Enregistrement en cours…`;

      const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
      const result = await uploadDoc(pdfFile, 'ficheGeneree');
      uploadState.ficheGeneree = result.status === 'ok'
        ? result
        : { status: 'error', name: filename, message: result.message };
      renderFicheGenereePreview();

      if (result.status === 'ok') {
        $('genFicheStatus').textContent = `Fiche téléchargée ✓ — dossier ${numero}. Vérifiez-la, signez-la, puis déposez la version signée ci-dessous.`;
      } else {
        $('genFicheStatus').textContent = `Fiche téléchargée, mais son enregistrement dans le dossier a échoué (${result.message}). Réessayez.`;
      }
    } catch (err) {
      $('genFicheStatus').textContent = 'Erreur : ' + (err.message || 'échec de la génération du PDF.');
    } finally {
      btn.disabled = false;
    }
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

    // Groupes radio (ex : Sexe, CAF/VACAF, autorisations image)
    const groups = {};
    el.querySelectorAll('input[type=radio]').forEach(r => {
      groups[r.name] = groups[r.name] || [];
      groups[r.name].push(r);
    });
    Object.values(groups).forEach(radios => {
      if (!radios.some(r => r.checked)) {
        const wrap = radios[0].closest('.radio-cards') || radios[0].parentElement;
        addError(wrap, 'Merci d\'indiquer votre choix avant de continuer.');
        ok = false;
      }
    });

    return ok;
  }

  function validateStep4() {
    const el = $('step-4');
    clearErrors(el);
    let ok = true;

    if (!uploadState.ficheGeneree || uploadState.ficheGeneree.status !== 'ok') {
      $('genFicheStatus').textContent = 'Merci de générer votre fiche d\'inscription avant de continuer.';
      addError($('btnGenFiche').parentElement, 'Étape obligatoire : générez votre fiche d\'inscription.');
      ok = false;
    }
    if (!uploadState.fiche || uploadState.fiche.status !== 'ok') {
      showFileBlockError('itemFiche', 'previewFiche', 'Document obligatoire manquant.');
      ok = false;
    }
    if (!uploadState.carnet.some(f => f.status === 'ok')) {
      showFileBlockError('itemCarnet', 'previewCarnet', 'Document obligatoire manquant.');
      ok = false;
    }
    if (vacafAnswer() === 'Oui' && (!uploadState.caf || uploadState.caf.status !== 'ok')) {
      showFileBlockError('itemCaf', 'previewCaf', 'Document obligatoire compte tenu de votre réponse à l\'étape précédente.');
      ok = false;
    }
    // Upload en cours : on empêche de continuer tant que ce n'est pas terminé
    if (uploadState.ficheGeneree && uploadState.ficheGeneree.status === 'busy') ok = false;
    if (uploadState.fiche && uploadState.fiche.status === 'busy') ok = false;
    if (uploadState.caf && uploadState.caf.status === 'busy') ok = false;
    if (uploadState.carnet.some(f => f.status === 'busy')) ok = false;

    return ok;
  }

  function showFileBlockError(itemId, previewId, msg) {
    const item = $(itemId);
    item.classList.add('input-error');
    const span = document.createElement('span');
    span.className = 'file-error-msg';
    span.textContent = msg;
    $(previewId).appendChild(span);
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

  // ── Checklist documents (étape 5) ─────────────────────────
  function renderChecklist() {
    const box = $('docChecklist');
    const vacaf = vacafAnswer();
    const rows = [
      { label: 'Fiche PDF générée', ok: !!(uploadState.ficheGeneree && uploadState.ficheGeneree.status === 'ok') },
      { label: 'Fiche d\'inscription signée déposée', ok: !!(uploadState.fiche && uploadState.fiche.status === 'ok') },
      { label: 'Carnet de vaccination déposé', ok: uploadState.carnet.some(f => f.status === 'ok') },
    ];
    if (vacaf === 'Oui') {
      rows.push({ label: 'Attestation CAF / VACAF déposée', ok: !!(uploadState.caf && uploadState.caf.status === 'ok') });
    } else {
      rows.push({ label: 'Attestation CAF / VACAF', ok: true, note: 'Non requise' });
    }
    box.innerHTML = '<h4 style="margin-bottom:4px;padding-bottom:8px;border-bottom:1px solid var(--beige-fonce);color:var(--vert-fonce);font-size:.97rem;">📋 Documents</h4>' +
      rows.map(r => `<div class="checklist-row"><span class="${r.ok ? 'ok' : 'miss'}">${r.ok ? '✓' : '✗'}</span><span>${r.label}${r.note ? ' — ' + r.note : ''}</span></div>`).join('');
    const allOk = rows.every(r => r.ok);
    $('submitBtn').disabled = !allOk;
    return allOk;
  }

  // ── Génération du récapitulatif ───────────────────────────
  function genRecap() {
    const c   = COLONIES.find(x => x.id === colonieSelect.value);
    const v   = id => $(id) ? $(id).value || '—' : '—';
    const sex = (document.querySelector('input[name="Sexe"]:checked') || {}).value || '—';
    const vacaf = vacafAnswer() || '—';
    const autoPrive = (document.querySelector('input[name="Autorisation partage privé familles"]:checked') || {}).value || '—';
    const autoPublic = (document.querySelector('input[name="Autorisation communication publique"]:checked') || {}).value || '—';

    const r = (label, val) => `<div class="recap-row"><span>${label}</span><strong>${val}</strong></div>`;

    recapBox.innerHTML = `
      ${dossierNumero ? `<div class="recap-section"><h4>🗂️ Dossier</h4>${r('Numéro de dossier', dossierNumero)}</div>` : ''}
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
        <h4>💶 Aide CAF / VACAF</h4>
        ${r('Bénéficiaire', vacaf)}
        ${vacaf === 'Oui' ? r('N° allocataire', v('vacafNumero')) : ''}
      </div>
      <div class="recap-section">
        <h4>📸 Autorisations image</h4>
        ${r('Partage privé (familles)', autoPrive)}
        ${r('Communication publique', autoPublic)}
      </div>
      <div class="recap-section">
        <h4>🔒 Documents</h4>
        ${r('Fiche PDF générée', uploadState.ficheGeneree && uploadState.ficheGeneree.status === 'ok' ? uploadState.ficheGeneree.name : 'Non générée')}
        ${r('Fiche signée', uploadState.fiche && uploadState.fiche.status === 'ok' ? uploadState.fiche.name : 'Non déposée')}
        ${r('Carnet de vaccination', uploadState.carnet.filter(f => f.status === 'ok').length + ' fichier(s)')}
        ${r('Justificatif CAF', uploadState.caf && uploadState.caf.status === 'ok' ? uploadState.caf.name : (vacaf === 'Oui' ? 'Non déposé' : 'Non requis'))}
      </div>`;
  }

  // ── Navigation ────────────────────────────────────────────
  btnNext.addEventListener('click', () => {
    const stepOk = step === 4 ? validateStep4() : validateStep(step);
    if (!stepOk) {
      const first = document.querySelector('#step-' + step + ' .field-error, #step-' + step + ' .input-error, #step-' + step + ' .file-error-msg');
      if (first) first.scrollIntoView({ behavior:'smooth', block:'center' });
      return;
    }
    if (step < TOTAL) {
      step++;
      if (step === TOTAL) { genRecap(); renderChecklist(); }
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
  form.addEventListener('submit', async e => {
    e.preventDefault();

    if (!certCheck.checked) {
      const parent = certCheck.closest('.certification-group');
      parent.querySelectorAll('.field-error').forEach(el => el.remove());
      addError(parent, 'Vous devez certifier être le/la responsable légal(e) pour envoyer la demande.');
      certCheck.scrollIntoView({ behavior:'smooth', block:'center' });
      return;
    }

    if (!renderChecklist()) {
      $('docChecklist').scrollIntoView({ behavior:'smooth', block:'center' });
      return;
    }

    const btn = $('submitBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Envoi en cours…';

    const vacaf = vacafAnswer();
    const filesPayload = [];
    if (uploadState.ficheGeneree && uploadState.ficheGeneree.status === 'ok') {
      filesPayload.push({ docType: 'ficheGeneree', pathname: uploadState.ficheGeneree.pathname, name: uploadState.ficheGeneree.name, size: uploadState.ficheGeneree.size });
    }
    if (uploadState.fiche && uploadState.fiche.status === 'ok') {
      filesPayload.push({ docType: 'fiche', pathname: uploadState.fiche.pathname, name: uploadState.fiche.name, size: uploadState.fiche.size });
    }
    uploadState.carnet.forEach(f => {
      if (f.status === 'ok') filesPayload.push({ docType: 'carnet', pathname: f.pathname, name: f.name, size: f.size });
    });
    if (uploadState.caf && uploadState.caf.status === 'ok') {
      filesPayload.push({ docType: 'caf', pathname: uploadState.caf.pathname, name: uploadState.caf.name, size: uploadState.caf.size });
    }

    const autoPrive = (document.querySelector('input[name="Autorisation partage privé familles"]:checked') || {}).value;
    const autoPublic = (document.querySelector('input[name="Autorisation communication publique"]:checked') || {}).value;
    const c = COLONIES.find(x => x.id === colonieSelect.value);

    const payload = {
      submissionId,
      dossierNumero,
      beneficiaireVacaf: vacaf === 'Oui',
      numeroAllocataire: $('vacafNumero').value || null,
      autorisationPartagePrive: autoPrive === 'J\'autorise',
      autorisationCommunicationPublique: autoPublic === 'J\'autorise',
      sejour: c ? { id: c.id, nom: c.nom, duree: c.duree } : null,
      enfant: {
        prenom: $('enfantPrenom').value,
        nom: $('enfantNom').value,
        ddn: $('enfantDdn').value,
        age: valAge.value,
        sexe: (document.querySelector('input[name="Sexe"]:checked') || {}).value || null,
        adresse: $('enfantAdresse').value,
        cp: $('enfantCP').value,
        ville: $('enfantVille').value,
        ecole: $('enfantEcole').value,
      },
      responsable: {
        identite: $('respNomPrenom').value,
        lien: $('respLien').value,
        telephone: $('respTel').value,
        email: $('respEmail').value,
      },
      files: filesPayload,
    };

    try {
      const res = await fetch('/api/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec de l\'envoi du dossier.');

      const docs = data.docsStatus || {};
      const docsParam = [
        'ficheGeneree:' + (docs.ficheGeneree ? 'ok' : 'ko'),
        'fiche:' + (docs.fiche ? 'ok' : 'ko'),
        'carnet:' + (docs.carnet ? 'ok' : 'ko'),
        'caf:' + (docs.caf ? 'ok' : (docs.cafRequired ? 'ko' : 'nr')),
      ].join(',');

      window.location.href = 'inscription-confirmee.html?dossier=' + encodeURIComponent(data.dossierNumero) + '&docs=' + encodeURIComponent(docsParam);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = originalText;
      const parent = certCheck.closest('.certification-group');
      parent.querySelectorAll('.field-error').forEach(el => el.remove());
      addError(parent, 'L\'envoi du dossier a échoué. Aucune inscription n\'a été enregistrée. ' + (err.message || '') + ' Merci de réessayer — vos informations saisies sont conservées.');
      parent.scrollIntoView({ behavior:'smooth', block:'center' });
    }
  });

})();
