// E-mail d'invitation d'un membre de l'équipe (accès Administration).
// Le lien est à usage unique : la personne choisit elle-même son mot de passe.

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function buildStaffInviteSubject() {
  return 'Votre accès Les Hortensias est disponible';
}

export function buildStaffInviteHtml({ name, roleLabel, link }) {
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Les Hortensias — Administration</h2>
    <p>Bonjour${name ? ' ' + esc(name) : ''},</p>
    <p>Votre accès à l'espace d'administration des Hortensias est disponible${roleLabel ? ` (rôle : <strong>${esc(roleLabel)}</strong>)` : ''}.</p>
    <p>Pour l'activer, choisissez vous-même votre mot de passe :</p>
    <p><a href="${link}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Activer mon accès</a></p>
    <p style="font-size:13px;color:#666;">Ce lien est personnel et à usage unique. S'il a expiré, demandez un nouvel envoi à l'administrateur.</p>
  </div>`;
}
