// Contexte du membre du personnel connecté (rôle + permissions) et menu Admin
// filtré selon ces permissions. Les permissions viennent de la base
// (rpc my_permissions → role_permissions), JAMAIS de l'adresse e-mail.
// Masquer un menu n'est qu'un confort : chaque accès est aussi refusé côté
// base (RLS) et côté API.

export const NAV_ITEMS = [
  { key: 'dashboard', href: 'dashboard.html', label: 'Tableau de bord' },
  { key: 'demandes', href: 'dashboard.html?filtre=nouvelles', label: 'Demandes', any: ['classes.read', 'groups.read'] },
  { key: 'classes', href: 'dashboard.html?type=school', label: 'Classes de découverte', any: ['classes.read'] },
  { key: 'groupes', href: 'dashboard.html?type=group', label: 'Groupes', any: ['groups.read'] },
  { key: 'colonies', href: 'dashboard.html#colonies', label: 'Colonies', any: ['colonies.read'] },
  { key: 'planning', href: 'planning.html', label: 'Planning / Réservations', any: ['planning.read'] },
  { key: 'clients', href: 'client.html', label: 'Clients', any: ['clients.read'] },
  { key: 'parametres', href: 'parametres.html', label: 'Paramètres' },
];

export async function loadStaffContext(supabase) {
  let permissions;
  const { data, error } = await supabase.rpc('my_permissions');
  if (error) {
    // Base pas encore migrée (rôles absents) : comportement historique, accès total.
    permissions = ['*'];
  } else {
    permissions = data || [];
  }
  const can = (p) => permissions.includes('*') || permissions.includes(p);
  const canAny = (list) => !list || list.some(can);
  return { permissions, can, canAny };
}

// Insère le menu sous la barre du haut et masque tout élément [data-perm]
// (liste séparée par des "|" : au moins une permission requise).
export function mountAdminNav(ctx, currentKey) {
  document.querySelectorAll('[data-perm]').forEach(el => {
    if (!ctx.canAny(el.dataset.perm.split('|'))) el.remove();
  });
  const topbar = document.querySelector('.app-topbar');
  if (!topbar || document.querySelector('.app-adminnav')) return;
  const nav = document.createElement('nav');
  nav.className = 'app-adminnav';
  nav.setAttribute('aria-label', 'Menu administration');
  nav.innerHTML = NAV_ITEMS.filter(i => ctx.canAny(i.any))
    .map(i => `<a href="${i.href}" class="${i.key === currentKey ? 'active' : ''}"${i.key === currentKey ? ' aria-current="page"' : ''}>${i.label}</a>`)
    .join('');
  topbar.insertAdjacentElement('afterend', nav);
}

// Garde de page : redirige vers le tableau de bord si la permission manque.
export function requirePagePermission(ctx, anyOf) {
  if (ctx.canAny(anyOf)) return true;
  document.body.innerHTML = `<div class="app-container narrow"><div class="app-card"><h2>Accès non autorisé</h2><p>Votre rôle ne donne pas accès à cette page.</p><p style="margin-top:14px;"><a class="app-btn" href="dashboard.html">Retour au tableau de bord</a></p></div></div>`;
  return false;
}
