-- Organisations (clients) : l'identité métier d'une école / d'un groupe n'est plus
-- portée par un compte utilisateur mais par une organisation.
--
--   auth.users / profiles  --(organization_users)-->  organizations  -->  dossiers
--
-- Un compte reste rattaché à ses dossiers via dossier_acces (statut d'invitation,
-- désactivation par dossier) ; l'appartenance à une organisation ajoute :
--   * un identifiant client stable qui survit au changement de contact ;
--   * la possibilité d'avoir plusieurs utilisateurs pour une même organisation
--     (chacun voit tous les dossiers de l'organisation).
-- Les colonies (colony_stays / colony_registrations) ne sont pas concernées.

-- ==========================================================
-- 1) Tables
-- ==========================================================

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  type text not null default 'school' check (type in ('school', 'group')),
  email_contact text,
  contact_nom text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organizations is 'Client (école / groupe) : propriétaire métier des dossiers. Indépendant de l''adresse e-mail du contact actuel.';

create table public.organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_org text not null default 'member' check (role_org in ('owner', 'member')),
  statut text not null default 'actif' check (statut in ('actif', 'desactive')),
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);
create index organization_users_profile_idx on public.organization_users (profile_id);

alter table public.dossiers add column organization_id uuid references public.organizations(id) on delete set null;
create index dossiers_organization_idx on public.dossiers (organization_id);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- ==========================================================
-- 2) Fonctions utilitaires
-- ==========================================================

create or replace function public.norm_org_name(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(lower(coalesce(t, '')), 'àâäáãéèêëíìîïóòôöõúùûüçñœ', 'aaaaaeeeeiiiiooooouuuucno'),
    '[^a-z0-9]+', ' ', 'g'
  );
$$;

-- Accès : un compte voit un dossier s'il y est rattaché (dossier_acces non désactivé)
-- OU s'il est membre actif de l'organisation du dossier (sauf désactivation explicite
-- de son accès à CE dossier).
create or replace function public.has_dossier_access(check_dossier_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.dossier_acces
      where dossier_id = check_dossier_id and profile_id = auth.uid() and statut != 'desactive'
    )
    or (
      exists (
        select 1
        from public.dossiers d
        join public.organization_users ou on ou.organization_id = d.organization_id
        where d.id = check_dossier_id and ou.profile_id = auth.uid() and ou.statut = 'actif'
      )
      and not exists (
        select 1 from public.dossier_acces
        where dossier_id = check_dossier_id and profile_id = auth.uid() and statut = 'desactive'
      )
    );
$$;

-- Un accès dossier crée automatiquement l'appartenance à l'organisation du dossier.
create or replace function public.sync_org_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  has_owner boolean;
begin
  select organization_id into org from public.dossiers where id = new.dossier_id;
  if org is null then return new; end if;
  select exists (select 1 from public.organization_users where organization_id = org and role_org = 'owner')
    into has_owner;
  insert into public.organization_users (organization_id, profile_id, role_org)
  values (org, new.profile_id, case when has_owner then 'member' else 'owner' end)
  on conflict (organization_id, profile_id) do nothing;
  return new;
end;
$$;

create trigger dossier_acces_sync_org after insert on public.dossier_acces
  for each row execute function public.sync_org_membership();

-- Trouve ou crée l'organisation d'un dossier école/groupe.
-- Règle "certain" : même nom d'établissement normalisé ET même e-mail de contact.
-- Réservé à l'admin / service_role (les demandes publiques ne rejoignent jamais
-- automatiquement l'organisation d'un client existant).
create or replace function public.ensure_dossier_organization(p_dossier_id uuid, p_email text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.dossiers%rowtype;
  v_email text;
  v_name text;
  org uuid;
begin
  if not public.current_role_is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  select * into d from public.dossiers where id = p_dossier_id;
  if not found then raise exception 'Dossier introuvable.'; end if;
  if d.client_type not in ('school', 'group') then return null; end if;
  if d.organization_id is not null then return d.organization_id; end if;

  v_email := nullif(lower(trim(coalesce(p_email, d.contact_email))), '');
  v_name := coalesce(nullif(trim(d.structure_nom), ''), d.etablissement);

  if v_email is not null then
    select id into org from public.organizations
    where archived_at is null and email_contact = v_email
      and public.norm_org_name(nom) = public.norm_org_name(v_name)
    limit 1;
  end if;

  if org is null then
    insert into public.organizations (nom, type, email_contact, contact_nom)
    values (v_name, d.client_type::text, v_email, d.contact_nom)
    returning id into org;
  end if;

  update public.dossiers set organization_id = org where id = p_dossier_id;
  -- Les comptes déjà rattachés à ce dossier deviennent membres de l'organisation.
  insert into public.organization_users (organization_id, profile_id, role_org)
  select org, da.profile_id, 'member' from public.dossier_acces da where da.dossier_id = p_dossier_id
  on conflict do nothing;
  return org;
end;
$$;

-- Rattachement manuel d'un dossier à une organisation existante (admin).
create or replace function public.attach_dossier_to_organization(p_dossier_id uuid, p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_role_is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'Organisation introuvable.';
  end if;
  update public.dossiers set organization_id = p_org_id where id = p_dossier_id;
  insert into public.dossier_journal (dossier_id, action, details, actor)
  values (p_dossier_id, 'rattache_organisation', 'Dossier rattaché à une organisation existante.', auth.uid());
  insert into public.organization_users (organization_id, profile_id, role_org)
  select p_org_id, da.profile_id, 'member' from public.dossier_acces da where da.dossier_id = p_dossier_id
  on conflict do nothing;
end;
$$;

-- Fusion de deux organisations (admin) : déplace dossiers et utilisateurs.
create or replace function public.merge_organizations(p_source uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_role_is_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  if p_source = p_target then raise exception 'Organisations identiques.'; end if;
  update public.dossiers set organization_id = p_target where organization_id = p_source;
  insert into public.organization_users (organization_id, profile_id, role_org, statut)
  select p_target, profile_id, 'member', statut from public.organization_users where organization_id = p_source
  on conflict (organization_id, profile_id) do nothing;
  delete from public.organizations where id = p_source;
end;
$$;

revoke all on function public.ensure_dossier_organization(uuid, text) from public, anon;
revoke all on function public.attach_dossier_to_organization(uuid, uuid) from public, anon;
revoke all on function public.merge_organizations(uuid, uuid) from public, anon;
grant execute on function public.ensure_dossier_organization(uuid, text) to authenticated, service_role;
grant execute on function public.attach_dossier_to_organization(uuid, uuid) to authenticated, service_role;
grant execute on function public.merge_organizations(uuid, uuid) to authenticated, service_role;

-- ==========================================================
-- 3) RLS
-- ==========================================================

alter table public.organizations enable row level security;
alter table public.organization_users enable row level security;

create policy organizations_select on public.organizations
  for select using (
    public.current_role_is_admin()
    or exists (select 1 from public.organization_users ou
               where ou.organization_id = organizations.id and ou.profile_id = auth.uid() and ou.statut = 'actif')
  );
create policy organizations_admin_write on public.organizations
  for all using (public.current_role_is_admin()) with check (public.current_role_is_admin());

create policy organization_users_select on public.organization_users
  for select using (public.current_role_is_admin() or profile_id = auth.uid());
create policy organization_users_admin_write on public.organization_users
  for all using (public.current_role_is_admin()) with check (public.current_role_is_admin());

-- Le client ne peut pas changer l'organisation d'un dossier (colonne verrouillée).
create or replace function public.lock_dossier_organization()
returns trigger
language plpgsql
as $$
begin
  -- auth.uid() null = session serveur/migration (pas un utilisateur du site) : autorisé.
  if new.organization_id is distinct from old.organization_id
     and auth.uid() is not null and not public.current_role_is_admin() then
    raise exception 'Modification de l''organisation réservée à l''administrateur.';
  end if;
  return new;
end;
$$;
create trigger dossiers_lock_organization before update on public.dossiers
  for each row execute function public.lock_dossier_organization();

-- ==========================================================
-- 4) Reprise des dossiers existants (uniquement les rattachements certains)
-- ==========================================================
-- Clé d'identité : e-mail du compte rattaché s'il existe, sinon e-mail de contact du
-- dossier ; + nom d'établissement normalisé. Pas d'e-mail => une organisation par dossier.
-- Ambiguïté (même compte mais noms différents) => organisations séparées, rien de fusionné :
-- l'admin utilisera « Rattacher à un client existant ».

do $$
declare
  d record;
  v_email text;
  v_name text;
  org uuid;
begin
  for d in
    select * from public.dossiers
    where client_type in ('school', 'group') and organization_id is null
    order by created_at
  loop
    select lower(p.email) into v_email
    from public.dossier_acces da join public.profiles p on p.id = da.profile_id
    where da.dossier_id = d.id order by da.created_at limit 1;
    v_email := nullif(coalesce(v_email, lower(trim(d.contact_email))), '');
    v_name := coalesce(nullif(trim(d.structure_nom), ''), d.etablissement);
    org := null;

    if v_email is not null then
      select id into org from public.organizations
      where email_contact = v_email and public.norm_org_name(nom) = public.norm_org_name(v_name)
      limit 1;
    end if;
    if org is null then
      insert into public.organizations (nom, type, email_contact, contact_nom)
      values (v_name, d.client_type::text, v_email, d.contact_nom)
      returning id into org;
    end if;

    update public.dossiers set organization_id = org where id = d.id;
    insert into public.organization_users (organization_id, profile_id, role_org)
    select org, da.profile_id,
      case when exists (select 1 from public.organization_users x where x.organization_id = org and x.role_org = 'owner')
           then 'member' else 'owner' end
    from public.dossier_acces da where da.dossier_id = d.id
    on conflict do nothing;
  end loop;
end $$;
