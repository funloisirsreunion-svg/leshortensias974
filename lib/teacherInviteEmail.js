function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function buildTeacherInviteSubject(dossier) {
  return `Votre espace école Les Hortensias — dossier ${dossier.numero}`;
}

export function buildTeacherInviteHtml({ dossier, email, tempPassword, loginUrl, isNewAccount }) {
  const intro = isNewAccount
    ? 'Un espace privé de suivi a été créé pour votre séjour classe découverte.'
    : 'Votre accès à l\'espace école a été mis à jour.';
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Les Hortensias — Espace Écoles</h2>
    <p>Bonjour,</p>
    <p>${intro}</p>
    <p><strong>Établissement :</strong> ${escapeHtml(dossier.etablissement)}<br/>
       <strong>Numéro de dossier :</strong> ${escapeHtml(dossier.numero)}</p>
    <div style="background:#f6f1e7;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0 0 8px;"><strong>Identifiants de connexion</strong></p>
      <p style="margin:0;">Adresse : ${escapeHtml(email)}<br/>
      Mot de passe temporaire : <code style="background:#fff;padding:2px 6px;border-radius:4px;">${escapeHtml(tempPassword)}</code></p>
    </div>
    <p><a href="${loginUrl}" style="display:inline-block;background:#2d5a27;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Se connecter à l'espace école</a></p>
    <p style="font-size:13px;color:#666;">Merci de changer ce mot de passe dès votre première connexion, dans les paramètres de votre compte.</p>
    <p style="font-size:13px;color:#666;">Vous pourrez y suivre l'avancement de votre dossier, compléter les effectifs et niveaux, déclarer vos régimes alimentaires et déposer vos documents.</p>
    <p>Association Fun Loisirs Réunion — Centre Les Hortensias</p>
  </div>`;
}
