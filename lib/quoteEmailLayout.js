// Mise en page commune des e-mails de notification de devis (Classes + Groupes).
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function section(title, rows) {
  const content = rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:5px 0;color:#6b665e;font-size:13px;width:38%;vertical-align:top;">${esc(label)}</td>
        <td style="padding:5px 0;color:#2d2a26;font-size:15px;font-weight:600;vertical-align:top;">${esc(value)}</td>
      </tr>`).join('');
  if (!content) return '';
  return `
    <div style="margin:0 0 8px;padding:14px 16px;background:#f6f1e7;border-radius:8px;">
      <div style="font-size:12px;letter-spacing:1px;font-weight:700;color:#2d5a27;margin-bottom:6px;">${esc(title)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${content}</table>
    </div>`;
}

export function layout({ titre, sousTitre, numero, blocs, adminUrl }) {
  return `
  <div style="background:#ffffff;font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <div style="background:#2d5a27;color:#ffffff;padding:18px 20px;border-radius:8px 8px 0 0;">
      <div style="font-size:12px;letter-spacing:1px;opacity:.85;">${esc(titre)}</div>
      <div style="font-size:20px;font-weight:700;margin-top:2px;">${esc(sousTitre)}</div>
      <div style="font-size:12px;opacity:.85;margin-top:4px;">Dossier ${esc(numero)}</div>
    </div>
    <div style="padding:14px 0;">${blocs}</div>
    <p style="text-align:center;margin:18px 0 8px;">
      <a href="${esc(adminUrl)}" style="display:inline-block;background:#2d5a27;color:#ffffff;padding:13px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">VOIR LA DEMANDE DANS L'ESPACE ADMIN</a>
    </p>
    <p style="text-align:center;font-size:11px;color:#8a857c;margin:0;">Connexion administrateur requise. Centre Les Hortensias · Fun Loisirs Réunion</p>
  </div>`;
}

export function adminLink(siteUrl, dossierId) {
  return `${siteUrl}/admin/dossier.html?id=${encodeURIComponent(dossierId)}`;
}
