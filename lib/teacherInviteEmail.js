function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function shell(bodyHtml) {
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Les Hortensias — Espace Écoles</h2>
    ${bodyHtml}
    <p style="margin-top:24px;">Centre Les Hortensias<br/>Fun Loisirs Réunion</p>
  </div>`;
}

// Nouveau compte : lien d'invitation sécurisé (aucun mot de passe envoyé par e-mail).
export function buildInviteSubject() {
  return 'Votre espace Les Hortensias est disponible';
}

export function buildInviteHtml({ dossier, actionLink }) {
  return shell(`
    <p>Bonjour${dossier.contact_prenom ? ' ' + escapeHtml(dossier.contact_prenom) : ''},</p>
    <p>Votre demande de séjour pour <strong>${escapeHtml(dossier.etablissement)}</strong> a été prise en compte par Fun Loisirs Réunion.</p>
    <p>Un espace privé a été créé afin de vous permettre de suivre votre dossier et de transmettre les informations nécessaires à l'organisation du séjour.</p>
    <p><strong>Dossier :</strong> ${escapeHtml(dossier.numero)}<br/>
       <strong>Programme :</strong> ${dossier.programme === 'volcan' ? 'Classe Volcan' : dossier.programme === 'nature' ? 'Classe Nature' : ''}</p>
    <p><a href="${actionLink}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Activer mon espace</a></p>
    <p style="font-size:13px;color:#666;">Ce lien vous permet de définir votre mot de passe et d'accéder directement à votre espace. Il est personnel et sécurisé.</p>
    <p>Vous pourrez ensuite suivre l'avancement du dossier, consulter les documents et compléter les éléments nécessaires (effectifs, niveaux, régimes alimentaires).</p>
  `);
}

// Compte déjà existant (autre séjour) : un nouveau dossier vient d'être ajouté à son espace.
export function buildNewDossierLinkedSubject(dossier) {
  return `Nouveau séjour ajouté à votre espace — ${dossier.numero}`;
}

export function buildNewDossierLinkedHtml({ dossier, loginUrl }) {
  return shell(`
    <p>Bonjour${dossier.contact_prenom ? ' ' + escapeHtml(dossier.contact_prenom) : ''},</p>
    <p>Un nouveau dossier a été ajouté à votre espace école Les Hortensias.</p>
    <p><strong>Établissement :</strong> ${escapeHtml(dossier.etablissement)}<br/>
       <strong>Dossier :</strong> ${escapeHtml(dossier.numero)}</p>
    <p><a href="${loginUrl}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Accéder à mon espace</a></p>
    <p style="font-size:13px;color:#666;">Connectez-vous avec votre adresse e-mail et votre mot de passe habituel. Vous retrouverez la liste de tous vos séjours dans "Mes séjours".</p>
  `);
}

// Ré-invitation d'un compte non encore activé.
export function buildResendInviteSubject() {
  return 'Rappel — Votre espace Les Hortensias vous attend';
}

export function buildResendInviteHtml({ dossier, actionLink }) {
  return shell(`
    <p>Bonjour${dossier.contact_prenom ? ' ' + escapeHtml(dossier.contact_prenom) : ''},</p>
    <p>Pour rappel, votre espace de suivi du dossier <strong>${escapeHtml(dossier.numero)}</strong> (${escapeHtml(dossier.etablissement)}) vous attend.</p>
    <p><a href="${actionLink}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Activer mon espace</a></p>
    <p style="font-size:13px;color:#666;">Ce lien vous permet de définir votre mot de passe et d'accéder directement à votre espace.</p>
  `);
}
