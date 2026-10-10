// E-mails d'accès d'un membre de l'équipe (espace Administration).
// Le lien est personnel, temporaire et à usage unique : la personne choisit
// elle-même son mot de passe (aucun mot de passe généré ni transmis par nous).

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const ROLE_SUBJECTS = {
  commercial_reservations: 'Votre accès commercial — Centre Les Hortensias',
};

export function buildStaffInviteSubject({ roleCode, kind = 'invite' } = {}) {
  if (kind === 'reset') return 'Réinitialisation de votre mot de passe — Centre Les Hortensias';
  return ROLE_SUBJECTS[roleCode] || 'Votre accès Administration — Centre Les Hortensias';
}

const BTN = 'display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;';

export function buildStaffInviteHtml({ name, email, roleLabel, link, loginUrl, kind = 'invite' }) {
  const reset = kind === 'reset';
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;line-height:1.5;">
    <h2 style="color:#2d5a27;">Centre Les Hortensias — Administration</h2>
    <p>Bonjour${name ? ' ' + esc(name) : ''},</p>
    ${reset
      ? `<p>Un lien de réinitialisation de votre mot de passe a été demandé pour votre accès à l'espace d'administration du Centre Les Hortensias.</p>`
      : `<p>Bienvenue dans l'équipe ! Votre accès à l'espace d'administration du Centre Les Hortensias a été créé${roleLabel ? ` avec le rôle <strong>${esc(roleLabel)}</strong>` : ''}.</p>`}
    <table style="border-collapse:collapse;margin:16px 0;font-size:15px;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Identifiant</td><td style="padding:4px 0;"><strong>${esc(email)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Page de connexion</td><td style="padding:4px 0;"><a href="${loginUrl}" style="color:#2d5a27;">${esc(loginUrl)}</a></td></tr>
    </table>
    <p><strong>${reset ? 'Pour choisir un nouveau mot de passe' : 'Pour votre première connexion'} :</strong></p>
    <ol style="padding-left:20px;">
      <li>Cliquez sur le bouton ci-dessous (lien personnel et sécurisé).</li>
      <li>Choisissez votre mot de passe (8 caractères minimum) et confirmez-le.</li>
      <li>Vous êtes alors connecté(e) automatiquement à l'espace Administration.</li>
      <li>Ensuite, connectez-vous normalement depuis la page de connexion avec votre identifiant et ce mot de passe.</li>
    </ol>
    <p style="margin:24px 0;"><a href="${link}" style="${BTN}">${reset ? 'Choisir un nouveau mot de passe' : 'Définir mon mot de passe'}</a></p>
    <p style="font-size:13px;color:#666;">Ce lien est personnel, temporaire et utilisable une seule fois : ne le transférez pas. S'il a expiré, utilisez « Mot de passe oublié ? » sur la page de connexion, ou demandez un nouvel envoi à l'administrateur.</p>
    ${reset ? `<p style="font-size:13px;color:#666;">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste valable.</p>` : ''}
  </div>`;
}
