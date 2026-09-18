-- Gestion multi-dossiers dans un même espace client.
-- Jusqu'ici, l'identité "client" reposait uniquement sur dossier_acces (compte <->
-- dossier) : rien ne regroupait explicitement les dossiers d'un même établissement,
-- et rien ne survivait à un changement de contact/e-mail. On introduit une entité
-- `organizations` (client_id stable, indépendant de l'e-mail) qui devient le
-- conteneur logique des dossiers d'un même établissement/structure, au fil des
-- années. dossier_acces reste inchangée (accès par dossier, déjà multi-dossiers) :
-- organizations sert à regrouper/afficher/rattacher, pas à piloter l'accès RLS.
-- Hors périmètre : colony_stays/colony_registrations (pas de compte client).

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.organizations is 'Identité client stable (établissement/structure), indépendante de l''e-mail de contact courant. Regroupe les dossiers d''un même client au fil des années (§1, §16 de la demande multi-dossiers).';
comment on column public.organizations.contact_email is 'E-mail de contact actuel, informatif uniquement — jamais utilisé comme clé d''identité (voir §16 : le contact peut changer sans perdre l''historique).';

-- Réutilise public.set_updated_at(), déjà défini en 0001_init.sql.
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.dossiers add column organization_id uuid references public.organizations(id);
comment on column public.dossiers.organization_id is 'Client/établissement auquel ce dossier est rattaché. Colonies (client_type=colony) n''ont pas de compte client et laissent cette colonne nulle.';

create index dossiers_organization_id_idx on public.dossiers(organization_id);

-- ==========================================================
-- RLS : admin voit/modifie tout ; un client ne voit que les organisations
-- auxquelles il a accès via au moins un dossier (dossier_acces actif).
-- ==========================================================

alter table public.organizations enable row level security;

create policy organizations_admin_all on public.organizations
  for all using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

create policy organizations_client_select on public.organizations
  for select using (
    exists (
      select 1 from public.dossiers d
      join public.dossier_acces da on da.dossier_id = d.id
      where d.organization_id = organizations.id
        and da.profile_id = auth.uid()
        and da.statut <> 'desactive'
    )
  );

-- ==========================================================
-- Backfill des dossiers existants (§20). École/groupe uniquement — les
-- colonies n'ont pas d'organisation. Ne fusionne que ce qui est certain :
-- 1) même e-mail de contact (normalisé) -> même organisation ;
-- 2) deux organisations reliées par un même compte client actif
--    (dossier_acces) -> fusionnées (preuve certaine que c'est le même client,
--    même si l'e-mail de contact du dossier a changé depuis) ;
-- 3) dossier sans e-mail exploitable -> organisation dédiée 1:1 (aucune
--    perte de dossier, aucune fusion incertaine).
-- ==========================================================

do $$
declare
  r record;
  new_org_id uuid;
  canonical_org_id uuid;
  merge_row record;
begin
  -- 1) Regroupement par e-mail de contact normalisé.
  for r in
    select lower(trim(contact_email)) as email_key,
           (array_agg(etablissement order by created_at asc))[1] as nom
    from public.dossiers
    where client_type in ('school', 'group')
      and organization_id is null
      and contact_email is not null
      and trim(contact_email) <> ''
    group by lower(trim(contact_email))
  loop
    insert into public.organizations (nom, contact_email)
    values (coalesce(r.nom, r.email_key), r.email_key)
    returning id into new_org_id;

    update public.dossiers
    set organization_id = new_org_id
    where client_type in ('school', 'group')
      and organization_id is null
      and lower(trim(contact_email)) = r.email_key;
  end loop;

  -- 2) Fusion des organisations reliées par un même compte client actif :
  -- pour chaque profil ayant un dossier_acces vers des dossiers de plusieurs
  -- organisations différentes, on ramène tout vers l'organisation la plus
  -- ancienne (canonique) et on supprime les organisations désormais vides.
  for r in
    select da.profile_id, min(o.created_at) as first_created
    from public.dossier_acces da
    join public.dossiers d on d.id = da.dossier_id
    join public.organizations o on o.id = d.organization_id
    where da.statut <> 'desactive'
    group by da.profile_id
    having count(distinct d.organization_id) > 1
  loop
    select d.organization_id into canonical_org_id
    from public.dossier_acces da
    join public.dossiers d on d.id = da.dossier_id
    join public.organizations o on o.id = d.organization_id
    where da.profile_id = r.profile_id and da.statut <> 'desactive'
    order by o.created_at asc
    limit 1;

    for merge_row in
      select distinct d.organization_id as org_id
      from public.dossier_acces da
      join public.dossiers d on d.id = da.dossier_id
      where da.profile_id = r.profile_id
        and da.statut <> 'desactive'
        and d.organization_id <> canonical_org_id
    loop
      update public.dossiers set organization_id = canonical_org_id where organization_id = merge_row.org_id;
      delete from public.organizations where id = merge_row.org_id;
    end loop;
  end loop;

  -- 3) Filet de sécurité : tout dossier école/groupe restant sans organisation
  -- (pas d'e-mail exploitable) reçoit une organisation dédiée, pour que la
  -- colonne soit systématiquement renseignée côté application.
  for r in
    select id, etablissement
    from public.dossiers
    where client_type in ('school', 'group') and organization_id is null
  loop
    insert into public.organizations (nom) values (coalesce(r.etablissement, 'Client sans nom')) returning id into new_org_id;
    update public.dossiers set organization_id = new_org_id where id = r.id;
  end loop;
end $$;
