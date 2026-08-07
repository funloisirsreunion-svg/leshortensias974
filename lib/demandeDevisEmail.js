function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function buildDemandeDevisSubject(etablissement) {
  return `Nouvelle demande Classe Découverte – ${etablissement}`;
}

export function buildDemandeDevisHtml({ dossier, adminUrl }) {
  const row = (label, value) => (value ? `<p style="margin:0 0 6px;"><strong>${label} :</strong> ${esc(value)}</p>` : '');
  const programmeLabel = dossier.programme === 'volcan' ? 'Classe Volcan' : dossier.programme === 'nature' ? 'Classe Nature' : '—';
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Nouvelle demande de devis — Classe Découverte</h2>
    <p>Dossier <strong>${esc(dossier.numero)}</strong>, créé automatiquement depuis le site.</p>
    <div style="background:#f6f1e7;border-radius:8px;padding:18px;margin:18px 0;">
      ${row('École', dossier.etablissement)}
      ${row('Commune', dossier.commune)}
      ${row('Contact', [dossier.contact_prenom, dossier.contact_nom].filter(Boolean).join(' ') + (dossier.contact_fonction ? ` (${dossier.contact_fonction})` : ''))}
      ${row('Téléphone', dossier.contact_telephone)}
      ${row('E-mail', dossier.contact_email)}
      ${row('Programme', programmeLabel)}
      ${row('Durée', dossier.duree ? dossier.duree + ' jours' : null)}
      ${row('Période souhaitée', dossier.periode_souhaitee)}
      ${row('Élèves', dossier.effectif_prev_eleves)}
      ${row('Professeurs', dossier.effectif_prev_profs)}
      ${row('Accompagnateurs', dossier.effectif_prev_accompagnateurs)}
      ${row('Niveaux', Object.keys(dossier.niveaux || {}).filter(k => dossier.niveaux[k]).join(', '))}
      ${row('Estimation tarifaire', dossier.estimation_tarifaire)}
    </div>
    <p><a href="${adminUrl}" style="display:inline-block;background:#2d5a27;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Ouvrir cette demande dans l'espace Admin</a></p>
  </div>`;
}
