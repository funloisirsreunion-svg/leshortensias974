export function buildPasswordResetSubject() {
  return 'Réinitialisation de votre mot de passe — Les Hortensias';
}

export function buildPasswordResetHtml({ link }) {
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Les Hortensias</h2>
    <p>Une demande de réinitialisation de mot de passe a été effectuée pour votre compte.</p>
    <p><a href="${link}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Choisir un nouveau mot de passe</a></p>
    <p style="font-size:13px;color:#666;">Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail sans risque.</p>
  </div>`;
}
