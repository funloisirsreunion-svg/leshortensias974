function esc(v) {
  return String(v == null || v === '' ? '—' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function buildEmailSubject(meta) {
  const nomComplet = `${meta.enfant?.nom || ''} ${meta.enfant?.prenom || ''}`.trim();
  return `Nouvelle inscription colonie – ${nomComplet || 'Dossier'} – ${meta.dossierNumero}`;
}

export function buildEmailHtml(meta, docsStatus) {
  const e = meta.enfant || {};
  const r = meta.responsable || {};
  const row = (label, val) => `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${esc(label)}</td><td style="padding:4px 0;font-weight:600;color:#222;">${esc(val)}</td></tr>`;
  const docRow = (label, ok, note) => `<li style="margin-bottom:4px;">${ok ? '✓' : '✗'} ${esc(label)}${note ? ' — ' + esc(note) : ''}</li>`;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#222;">
    <h2 style="color:#2d5a27;margin-bottom:4px;">🏕️ Nouvelle demande d'inscription</h2>
    <p style="color:#666;margin-top:0;">Dossier <strong>${esc(meta.dossierNumero)}</strong> — reçu le ${esc(new Date(meta.submittedAt).toLocaleString('fr-FR'))}</p>

    <h3 style="color:#2d5a27;border-bottom:1px solid #ddd;padding-bottom:4px;">Informations du dossier</h3>
    <table cellspacing="0" cellpadding="0">
      ${row('Numéro de dossier', meta.dossierNumero)}
      ${row('Séjour', meta.sejour ? meta.sejour.nom : '—')}
      ${row("Nom de l'enfant", e.nom)}
      ${row("Prénom de l'enfant", e.prenom)}
      ${row('Date de naissance', e.ddn)}
      ${row('Âge au moment du séjour', e.age)}
      ${row('Responsable légal', r.identite)}
      ${row('Lien avec l\'enfant', r.lien)}
      ${row('Téléphone', r.telephone)}
      ${row('E-mail', r.email)}
      ${row('Bénéficiaire CAF / VACAF', meta.beneficiaireVacaf ? 'Oui' : 'Non')}
      ${meta.beneficiaireVacaf ? row('N° allocataire', meta.numeroAllocataire) : ''}
      ${row('Autorisation photos privées (familles)', meta.autorisationPartagePrive ? 'Oui' : 'Non')}
      ${row('Autorisation communication publique', meta.autorisationCommunicationPublique ? 'Oui' : 'Non')}
    </table>

    <h3 style="color:#2d5a27;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:24px;">Documents reçus</h3>
    <ul style="padding-left:18px;">
      ${docRow('Fiche PDF générée', docsStatus.ficheGeneree)}
      ${docRow('Fiche signée', docsStatus.fiche)}
      ${docRow('Carnet de vaccination', docsStatus.carnet, docsStatus.carnetCount ? docsStatus.carnetCount + ' fichier(s)' : '')}
      ${docRow('Attestation CAF/VACAF', docsStatus.caf, meta.beneficiaireVacaf ? '' : 'non requise')}
    </ul>

    ${docsStatus.links && docsStatus.links.length ? `
    <h3 style="color:#c0392b;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:24px;">Documents volumineux (lien temporaire, 72h)</h3>
    <p style="font-size:13px;color:#666;">Ces fichiers dépassent la taille autorisée en pièce jointe et sont accessibles via un lien sécurisé et temporaire ci-dessous.</p>
    <ul style="padding-left:18px;">
      ${docsStatus.links.map((l) => `<li><a href="${l.url}">${esc(l.filename)}</a></li>`).join('')}
    </ul>` : ''}

    <p style="margin-top:28px;font-size:13px;color:#999;">E-mail généré automatiquement par le formulaire d'inscription — leshortensias974.fr</p>
  </div>`;
}
