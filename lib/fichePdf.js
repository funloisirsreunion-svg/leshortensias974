// PDF de la fiche opérationnelle (navigateur). Réutilise jsPDF, déjà utilisé par
// le site (inscription.js) et chargé par le même CDN : aucune nouvelle dépendance.
// Le contenu vient de ficheSections() : identique à l'aperçu et à l'e-mail.
import { ficheSections } from './ficheOperationnelle.js';

const VERT = [45, 90, 39], OR = [200, 168, 75], BEIGE = [245, 240, 232], ROUGE = [165, 35, 14], ROUGE_BG = [251, 226, 226], GRIS = [90, 90, 90];

// Les polices standard PDF ne couvrent que le jeu Latin-1 étendu.
function safe(s) {
  return String(s ?? '').replace(/œ/g, 'oe').replace(/Œ/g, 'Oe').replace(/[—–]/g, '-').replace(/[→]/g, '->').replace(/[⚠]/g, '!').replace(/[^\x00-\xFF’]/g, '');
}

async function loadLogo() {
  try {
    const res = await fetch('../images/logo-les-hortensias.jpg');
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
    const dims = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => resolve(null); i.src = dataUrl; });
    return dims ? { dataUrl, ...dims } : null;
  } catch { return null; }
}

export async function buildFichePdf(fiche, { generatedAt = new Date(), isUpdate = false } = {}) {
  if (!window.jspdf) throw new Error('Générateur PDF indisponible (jsPDF non chargé).');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 16, CW = W - 2 * M, BOTTOM = 282;
  let y = 14;

  // En-tête
  doc.setFillColor(...VERT); doc.rect(0, 0, W, 30, 'F');
  const logo = await loadLogo();
  let tx = M;
  if (logo) {
    const h = 20, w = Math.min(30, logo.w * h / logo.h);
    doc.addImage(logo.dataUrl, 'JPEG', M, 5, w, h);
    tx = M + w + 6;
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('LES HORTENSIAS', tx, 12);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(safe('FICHE OPÉRATIONNELLE DE SÉJOUR'), tx, 21);
  y = 38;
  if (isUpdate) {
    doc.setFillColor(...OR); doc.roundedRect(M, y - 5, CW, 9, 2, 2, 'F');
    doc.setTextColor(44, 44, 44); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(safe('MISE À JOUR — cette fiche remplace la version précédemment transmise'), M + 3, y + 1);
    y += 10;
  }

  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 18; } };
  // Bloc à fond coloré ; x/w permettent deux blocs côte à côte (draw = false : mesure seule).
  const box = (title, rows, { important = false, x = M, w = CW, draw = true, minH = 0 } = {}) => {
    // rows : [{ text, bold?, size?, color? }]
    const wrapped = rows.map(r => { doc.setFontSize(r.size || 10.5); doc.setFont('helvetica', r.bold ? 'bold' : 'normal'); return { ...r, parts: doc.splitTextToSize(safe(r.text), w - 8) }; });
    const h = Math.max(minH, 9 + wrapped.reduce((s, r) => s + r.parts.length * ((r.size || 10.5) * 0.45), 0) + 2);
    if (!draw) return h;
    doc.setFillColor(...(important ? ROUGE_BG : BEIGE)); doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
    if (important) { doc.setFillColor(...ROUGE); doc.rect(x, y, 1.6, h, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...(important ? ROUGE : VERT));
    doc.text(safe(title.toUpperCase()), x + 4, y + 5.5);
    let yy = y + 11;
    wrapped.forEach(r => {
      doc.setFont('helvetica', r.bold ? 'bold' : 'normal'); doc.setFontSize(r.size || 10.5); doc.setTextColor(...(r.color || [44, 44, 44]));
      r.parts.forEach(p => { doc.text(p, x + 4, yy); yy += (r.size || 10.5) * 0.45; });
    });
    return h;
  };
  const fullBox = (title, rows, opts = {}) => {
    const h = box(title, rows, { ...opts, draw: false });
    ensure(h);
    box(title, rows, opts);
    y += h + 3.5;
  };

  const secs = ficheSections(fiche);
  // Établissement et Contact côte à côte.
  const etab = secs.find(s => s.title === 'Établissement');
  const contact = secs.find(s => s.title === 'Contact');
  const half = (CW - 4) / 2;
  const etabRows = etab.lines.map((l, i) => ({ text: l, bold: i === 0, size: i === 0 ? 12.5 : 10.5 }));
  const contactRows = contact.lines.map((l, i) => ({ text: l, bold: i === 0 }));
  const hTop = Math.max(box('Établissement', etabRows, { w: half, draw: false }), box('Contact', contactRows, { w: half, draw: false }));
  box('Établissement', etabRows, { w: half, minH: hTop });
  box('Contact', contactRows, { x: M + half + 4, w: half, minH: hTop });
  y += hTop + 3.5;

  secs.filter(s => s !== etab && s !== contact).forEach(s => {
    if (s.effectifs) {
      const rows = [];
      s.effectifs.forEach(x => rows.push({ text: `${x.label} : ${x.value}   (${x.sub})`, bold: true, size: 11 }));
      s.totals.forEach(x => rows.push({ text: `${x.label} : ${x.value}`, bold: !!x.strong || true, size: x.strong ? 13 : 10.5, color: x.strong ? VERT : undefined }));
      if (s.note) rows.push({ text: s.note, size: 8.5, color: GRIS });
      fullBox(s.title, rows);
    } else if (s.couchages) {
      fullBox('Pour les couchages', s.couchages.map(c => ({ text: `${c.label} : ${c.value}`, bold: true, size: 12 })));
    } else {
      const important = s.important && (fiche.allergies.length || fiche.allergiesNonDetaillees);
      const rows = s.lines.map(l => ({ text: l, bold: !!important, size: important ? 11.5 : 10.5 }));
      if (s.extra) rows.push({ text: s.extra, color: GRIS });
      fullBox(s.title, rows, { important });
    }
  });

  // Pied de page
  const pages = doc.getNumberOfPages();
  const gen = generatedAt.toLocaleString('fr-FR', { timeZone: 'Indian/Reunion', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ');
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(safe(`Fiche générée le ${gen}${fiche.numero ? ' · Dossier ' + fiche.numero : ''} · Document interne — informations nécessaires à l'organisation du séjour`), M, 290);
    doc.text(`${p}/${pages}`, W - M, 290, { align: 'right' });
  }

  const dataUri = doc.output('datauristring');
  return { doc, base64: dataUri.split(',')[1], blob: doc.output('blob') };
}
