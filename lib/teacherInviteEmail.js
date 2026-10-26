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
  return `Nouveau dossier ajouté à votre espace client — ${dossier.numero}`;
}

export function buildNewDossierLinkedHtml({ dossier, loginUrl }) {
  return shell(`
    <p>Bonjour${dossier.contact_prenom ? ' ' + escapeHtml(dossier.contact_prenom) : ''},</p>
    <p>Un nouveau dossier a été ajouté à votre espace client Les Hortensias.</p>
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

// Nouveau compte (ou compte jamais activé) : identifiant + mot de passe provisoire.
// Le mot de passe n'est stocké nulle part ailleurs que dans Supabase Auth (haché) ;
// il doit obligatoirement être remplacé à la première connexion.
export function buildCredentialsSubject() {
  return 'Votre espace client Les Hortensias est disponible';
}

export function buildCredentialsHtml({ name, email, temporaryPassword, loginUrl, dossier }) {
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2a26;">
    <h2 style="color:#2d5a27;">Les Hortensias — Espace Client</h2>
    <p>Bonjour${name ? ' ' + escapeHtml(name) : ''},</p>
    <p>Votre espace client Les Hortensias est disponible.</p>
    ${dossier && dossier.numero ? `<p style="font-size:14px;color:#555;">Dossier : <strong>${escapeHtml(dossier.numero)}</strong>${dossier.etablissement ? ' — ' + escapeHtml(dossier.etablissement) : ''}</p>` : ''}
    <table style="border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Identifiant :</td><td style="padding:6px 0;"><strong>${escapeHtml(email)}</strong></td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Mot de passe provisoire :</td><td style="padding:6px 0;"><strong style="font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:1px;">${escapeHtml(temporaryPassword)}</strong></td></tr>
    </table>
    <p><a href="${loginUrl}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Accéder à mon espace client</a></p>
    <p>Lors de votre première connexion, vous devrez personnaliser votre mot de passe.</p>
    <p style="margin-top:24px;">Centre Les Hortensias<br/>Fun Loisirs Réunion</p>
  </div>`;
}

// ==========================================================
// Invitation à l'espace client envoyée depuis l'Admin (bouton « Envoyer
// l'accès à l'espace client »). Même modèle pour l'aperçu Admin et l'envoi.
// mode : 'activation' (compte à activer : l'enseignant définit son mot de
// passe via le lien), 'reinitialisation' (compte déjà activé + lien de
// réinitialisation), 'information' (compte déjà activé, connexion habituelle).
// Aucun mot de passe, aucune clé, aucun lien d'administration dans ce mail.
// ==========================================================
export const CLIENT_ACCESS_SITE = 'https://www.leshortensias974.fr/';

export function buildClientAccessSubject() {
  return 'Votre espace client est disponible – Préparation de votre séjour aux Hortensias';
}

function accessLines({ mode, email, link, validityDays }) {
  const lines = [
    { label: 'Site', value: CLIENT_ACCESS_SITE, href: CLIENT_ACCESS_SITE },
    { label: 'Identifiant', value: email },
  ];
  if (mode === 'activation') {
    lines.push({ label: 'Activation', value: link, href: link, button: 'Activer mon espace client',
      hint: `Ce lien personnel vous permet de définir vous-même votre mot de passe${validityDays ? ` (valable ${validityDays} jours)` : ''}.` });
  } else if (mode === 'reinitialisation') {
    lines.push({ label: 'Mot de passe', value: 'celui que vous avez déjà défini' });
    lines.push({ label: 'Réinitialisation', value: link, href: link, button: 'Choisir un nouveau mot de passe',
      hint: `Ce lien personnel vous permet de définir un nouveau mot de passe si vous ne vous souvenez plus du vôtre${validityDays ? ` (valable ${validityDays} jours)` : ''}.` });
  } else {
    lines.push({ label: 'Mot de passe', value: 'celui que vous avez déjà défini (lien « Mot de passe oublié ? » sur la page de connexion si besoin)' });
  }
  return lines;
}

export function buildClientAccessHtml({ mode = 'activation', email, link, validityDays, etablissement, sejours = [] }) {
  const lines = accessLines({ mode, email, link, validityDays });
  const button = lines.find(l => l.button);
  const loginUrl = CLIENT_ACCESS_SITE + 'espace-client/';
  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:600px;margin:0 auto;color:#2d2a26;line-height:1.55;">
    <h2 style="color:#2d5a27;font-family:Georgia,serif;">Centre Les Hortensias — Espace client</h2>
    <p>Bonjour,</p>
    <p>Dans le cadre de la préparation de votre prochain séjour de classe de découverte au Centre Les Hortensias, nous vous informons que votre espace client est désormais disponible.</p>
    <p>Cet espace vous permettra de préparer votre séjour et de centraliser les informations et documents nécessaires à son organisation.</p>
    ${etablissement || sejours.length ? `<p style="background:#f6f3ea;border-radius:6px;padding:10px 14px;">
      ${etablissement ? `<strong>Établissement :</strong> ${escapeHtml(etablissement)}<br/>` : ''}
      ${sejours.length ? `<strong>${sejours.length > 1 ? 'Séjours' : 'Séjour'} :</strong> ${sejours.map(s => escapeHtml(s)).join('<br/>')}` : ''}
    </p>` : ''}
    <p style="margin-bottom:6px;"><strong>Accès à votre espace client :</strong></p>
    <table style="border-collapse:collapse;margin:0 0 12px;">
      ${lines.map(l => `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;white-space:nowrap;">${escapeHtml(l.label)} :</td><td style="padding:4px 0;word-break:break-all;">${l.href ? `<a href="${escapeHtml(l.href)}" style="color:#2d5a27;">${escapeHtml(l.button && l.href !== CLIENT_ACCESS_SITE ? 'Lien sécurisé (bouton ci-dessous)' : l.value)}</a>` : `<strong>${escapeHtml(l.value)}</strong>`}</td></tr>`).join('')}
    </table>
    ${button ? `<p><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">${escapeHtml(button.button)}</a></p>
    <p style="font-size:13px;color:#666;">${escapeHtml(button.hint)} Il est strictement personnel : merci de ne pas le transférer.</p>`
    : `<p><a href="${loginUrl}" style="display:inline-block;background:#2d5a27;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Accéder à mon espace client</a></p>`}
    <p style="margin-bottom:6px;"><strong>Informations à compléter en priorité :</strong></p>
    <ol style="margin-top:0;">
      <li>Les effectifs prévisionnels, avec la répartition filles/garçons, les enseignants et les accompagnateurs.</li>
      <li>La répartition prévisionnelle pour le couchage.</li>
      <li>Les restrictions alimentaires, notamment les régimes particuliers et allergies.</li>
    </ol>
    <p>Ces informations permettront à notre équipe de préparer l'hébergement, les repas et l'accueil de votre groupe.</p>
    <p>Votre espace client vous permettra également de retrouver les documents relatifs à votre séjour, de transmettre les informations nécessaires et de faciliter les échanges avec notre équipe.</p>
    <p>Nous vous remercions de bien vouloir compléter ces renseignements dans les meilleurs délais.</p>
    <p style="margin-top:24px;">Bien cordialement,</p>
    <p>L'équipe du Centre Les Hortensias<br/>Fun Loisirs Réunion<br/><a href="${CLIENT_ACCESS_SITE}" style="color:#2d5a27;">${CLIENT_ACCESS_SITE}</a></p>
  </div>`;
}

export function buildClientAccessText({ mode = 'activation', email, link, validityDays, etablissement, sejours = [] }) {
  const lines = accessLines({ mode, email, link, validityDays });
  return [
    'Bonjour,', '',
    'Dans le cadre de la préparation de votre prochain séjour de classe de découverte au Centre Les Hortensias, nous vous informons que votre espace client est désormais disponible.', '',
    'Cet espace vous permettra de préparer votre séjour et de centraliser les informations et documents nécessaires à son organisation.', '',
    ...(etablissement ? [`Établissement : ${etablissement}`] : []),
    ...(sejours.length ? [`${sejours.length > 1 ? 'Séjours' : 'Séjour'} : ${sejours.join(' ; ')}`, ''] : []),
    'Accès à votre espace client :', '',
    ...lines.map(l => `${l.label} : ${l.value}`),
    ...(lines.find(l => l.hint) ? ['', lines.find(l => l.hint).hint + ' Il est strictement personnel : merci de ne pas le transférer.'] : []),
    '', 'Informations à compléter en priorité :', '',
    '1. Les effectifs prévisionnels, avec la répartition filles/garçons, les enseignants et les accompagnateurs.',
    '2. La répartition prévisionnelle pour le couchage.',
    '3. Les restrictions alimentaires, notamment les régimes particuliers et allergies.', '',
    'Ces informations permettront à notre équipe de préparer l\'hébergement, les repas et l\'accueil de votre groupe.', '',
    'Votre espace client vous permettra également de retrouver les documents relatifs à votre séjour, de transmettre les informations nécessaires et de faciliter les échanges avec notre équipe.', '',
    'Nous vous remercions de bien vouloir compléter ces renseignements dans les meilleurs délais.', '',
    'Bien cordialement,', '',
    'L\'équipe du Centre Les Hortensias', 'Fun Loisirs Réunion', CLIENT_ACCESS_SITE,
  ].join('\n');
}
