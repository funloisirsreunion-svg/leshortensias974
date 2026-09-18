// Requêtes Supabase directes (RLS admin), sans passer par une fonction
// serverless dédiée — même pattern que admin/colonie.html (le projet est à
// 12/12 fonctions Vercel Hobby, voir lib/appConstants.js). Utilisé par
// admin/clients.html, admin/client.html, admin/dossier.html et
// admin/nouveau-dossier.html pour la recherche/le rattachement de clients.

/**
 * Recherche des organisations par nom/e-mail (match direct) ou via un dossier
 * dont l'établissement/structure/e-mail correspond (utile si l'organisation a
 * été nommée différemment de son dossier le plus récent — §15).
 */
export async function searchOrganizations(supabase, term) {
  const q = (term || '').trim();
  if (!q) {
    const { data, error } = await supabase.from('organizations').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(40);
    if (error) throw error;
    return data || [];
  }
  const like = `%${q.replace(/[%,]/g, '')}%`;
  const [{ data: byOrg, error: e1 }, { data: byDossier, error: e2 }] = await Promise.all([
    supabase.from('organizations').select('*').or(`nom.ilike.${like},contact_email.ilike.${like}`).limit(40),
    supabase.from('dossiers').select('organization_id')
      .or(`etablissement.ilike.${like},contact_email.ilike.${like},structure_nom.ilike.${like}`)
      .not('organization_id', 'is', null).limit(80),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const byId = new Map((byOrg || []).map((o) => [o.id, o]));
  const extraIds = [...new Set((byDossier || []).map((d) => d.organization_id))].filter((id) => !byId.has(id));
  if (extraIds.length) {
    const { data, error } = await supabase.from('organizations').select('*').in('id', extraIds);
    if (error) throw error;
    (data || []).forEach((o) => byId.set(o.id, o));
  }
  return [...byId.values()];
}

/** Organisation + tous ses dossiers (école/groupe — les colonies n'ont pas de compte client). */
export async function getOrganizationDetail(supabase, organizationId) {
  const [{ data: organization, error: orgErr }, { data: dossiers, error: dErr }] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', organizationId).single(),
    supabase.from('dossiers').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }),
  ]);
  if (orgErr) throw orgErr;
  if (dErr) throw dErr;
  const dossierIds = (dossiers || []).map((d) => d.id);
  let acces = [];
  if (dossierIds.length) {
    const { data, error } = await supabase.from('dossier_acces').select('*, profiles(*)').in('dossier_id', dossierIds);
    if (error) throw error;
    acces = data || [];
  }
  return { organization, dossiers: dossiers || [], acces };
}

/** Rattache un dossier existant à une organisation (§15), avec trace dans le journal. */
export async function attachDossierToOrganization(supabase, dossierId, organizationId, actorId) {
  const { error } = await supabase.from('dossiers').update({ organization_id: organizationId }).eq('id', dossierId);
  if (error) throw error;
  await supabase.from('dossier_journal').insert({
    dossier_id: dossierId,
    action: 'dossier_rattache',
    details: 'Rattaché manuellement à un autre client par l\'administrateur',
    actor: actorId || null,
  });
}

/** Dossiers école/groupe non archivés, pour peupler le sélecteur de rattachement manuel (exclut ceux déjà dans l'organisation cible). */
export async function searchAttachableDossiers(supabase, term, excludeOrganizationId) {
  const q = (term || '').trim();
  let query = supabase.from('dossiers').select('id, numero, etablissement, structure_nom, contact_email, client_type, organization_id')
    .in('client_type', ['school', 'group']).is('archived_at', null).limit(30);
  if (q) {
    const like = `%${q.replace(/[%,]/g, '')}%`;
    query = query.or(`numero.ilike.${like},etablissement.ilike.${like},structure_nom.ilike.${like},contact_email.ilike.${like}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter((d) => d.organization_id !== excludeOrganizationId);
}

/** Synthèse financière multi-dossiers (§19) : total devis/facturé/payé/reste sur toute l'organisation. */
export function financeSummary(dossiers) {
  const sum = (key) => (dossiers || []).reduce((s, d) => s + (Number(d[key]) || 0), 0);
  const devis = sum('montant_devis');
  const facture = sum('montant_facture');
  const paye = sum('montant_paye');
  return { devis, facture, paye, reste: facture - paye };
}
