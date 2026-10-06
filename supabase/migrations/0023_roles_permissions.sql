-- Rôles internes et permissions (Super Admin / Admin Opérations / Commercial
-- Réservations, extensible), appliqués en base — pas seulement dans l'interface.
--
-- Principe (rétrocompatible) :
--   * profiles.role reste 'admin' pour TOUT compte interne (le personnel) et
--     'client' pour les clients : toutes les policies existantes basées sur
--     current_role_is_admin() continuent de fonctionner à l'identique.
--   * profiles.staff_role précise le rôle interne ; les droits viennent de
--     role_permissions (jamais de l'adresse e-mail).
--   * Les restrictions sont ajoutées par des policies RESTRICTIVES (combinées en
--     ET avec les policies existantes) : elles ne peuvent que retirer des droits
--     à un membre du personnel qui n'a pas la permission, jamais en ajouter, et
--     n'ont aucun effet sur les clients, le formulaire public ou la clé service.
--   * Les comptes internes existants reçoivent 'super_admin' AVANT toute
--     restriction : aucun accès existant n'est perdu.

-- ==========================================================
-- 1) Catalogue des rôles et permissions
-- ==========================================================

create table if not exists public.staff_roles (
  code text primary key,
  label text not null,
  description text,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  code text primary key,
  label text not null,
  sort_order int not null default 100
);

create table if not exists public.role_permissions (
  role_code text not null references public.staff_roles(code) on delete cascade,
  permission text not null, -- code de public.permissions, ou '*' (toutes)
  primary key (role_code, permission)
);

insert into public.staff_roles (code, label, description, sort_order) values
  ('super_admin', 'Super Admin', 'Accès total, gestion des utilisateurs internes et des rôles.', 1),
  ('admin_operations', 'Admin / Opérations', 'Accès opérationnel complet (dossiers, colonies, planning), sans gestion des utilisateurs/rôles ni suppression définitive.', 2),
  ('commercial_reservations', 'Commercial / Réservations', 'Classes de découverte, groupes, devis, réservations, clients et planning. Aucun accès aux colonies.', 3)
on conflict (code) do nothing;

insert into public.permissions (code, label, sort_order) values
  ('classes.read', 'Classes : consulter', 10),
  ('classes.create', 'Classes : créer', 11),
  ('classes.edit', 'Classes : modifier', 12),
  ('classes.validate', 'Classes : valider une réservation', 13),
  ('groups.read', 'Groupes : consulter', 20),
  ('groups.create', 'Groupes : créer', 21),
  ('groups.edit', 'Groupes : modifier', 22),
  ('groups.validate', 'Groupes : valider une réservation', 23),
  ('planning.read', 'Planning : consulter', 30),
  ('clients.read', 'Clients : consulter', 40),
  ('clients.create', 'Clients : créer', 41),
  ('clients.edit', 'Clients : modifier', 42),
  ('clients.invite', 'Clients : créer/envoyer un accès', 43),
  ('documents.read', 'Documents : consulter', 50),
  ('documents.upload', 'Documents : ajouter', 51),
  ('colonies.read', 'Colonies : consulter (dossiers enfants)', 60),
  ('colonies.manage', 'Colonies : gérer', 61),
  ('dossiers.delete', 'Suppression définitive de dossiers', 70),
  ('users.manage', 'Utilisateurs internes : gérer', 80),
  ('roles.manage', 'Rôles : attribuer', 81),
  ('settings.manage', 'Paramètres techniques', 82)
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission) values ('super_admin', '*')
on conflict do nothing;

insert into public.role_permissions (role_code, permission)
select 'admin_operations', code from public.permissions
where code not in ('users.manage', 'roles.manage', 'dossiers.delete')
on conflict do nothing;

insert into public.role_permissions (role_code, permission)
select 'commercial_reservations', code from public.permissions
where code in (
  'classes.read', 'classes.create', 'classes.edit', 'classes.validate',
  'groups.read', 'groups.create', 'groups.edit', 'groups.validate',
  'planning.read',
  'clients.read', 'clients.create', 'clients.edit', 'clients.invite',
  'documents.read', 'documents.upload')
on conflict do nothing;

-- ==========================================================
-- 2) Profil interne : rôle, statut
-- ==========================================================

alter table public.profiles add column if not exists staff_role text references public.staff_roles(code);
alter table public.profiles add column if not exists staff_active boolean not null default true;
alter table public.profiles add column if not exists staff_deactivated_at timestamptz;
alter table public.profiles add column if not exists staff_invited_at timestamptz;

comment on column public.profiles.staff_role is 'Rôle interne (personnel uniquement, role = admin). Les permissions viennent de role_permissions.';
comment on column public.profiles.staff_active is 'false = compte interne désactivé (accès coupé, historique conservé).';

-- Reprise : tous les comptes internes existants gardent un accès total.
update public.profiles set staff_role = 'super_admin'
where role = 'admin' and staff_role is null;

-- ==========================================================
-- 3) Fonctions de droits
-- ==========================================================

-- Compte interne actif (le personnel). Un compte désactivé n'est plus "admin".
create or replace function public.current_role_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(auth.role() = 'service_role', false)
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin' and staff_active
    );
$$;

create or replace function public.is_staff()
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select
    coalesce(auth.role() = 'service_role', false)
    or exists (
      select 1
      from public.profiles pr
      join public.role_permissions rp on rp.role_code = pr.staff_role
      where pr.id = auth.uid() and pr.role = 'admin' and pr.staff_active
        and (rp.permission = p_permission or rp.permission = '*')
    );
$$;

-- Vrai uniquement pour un membre du personnel connecté SANS la permission.
-- Toujours faux pour un client, un visiteur anonyme ou la clé service : les
-- policies restrictives qui l'utilisent n'affectent donc que le personnel.
create or replace function public.staff_lacks(p_permission text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select auth.uid() is not null and public.is_staff() and not public.has_permission(p_permission);
$$;

-- Permission requise par type de dossier.
create or replace function public.dossier_permission(p_client_type text, p_action text)
returns text
language sql immutable
as $$
  select case p_client_type
    when 'school' then 'classes.' || p_action
    when 'group' then 'groups.' || p_action
    when 'colony' then case when p_action = 'read' then 'colonies.read' else 'colonies.manage' end
    else 'classes.' || p_action
  end;
$$;

-- Le personnel connecté peut-il lire ce dossier ? (toujours vrai hors personnel :
-- l'accès client reste régi par les policies existantes)
create or replace function public.staff_can_read_dossier(p_dossier_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select not public.staff_lacks(public.dossier_permission(
    (select client_type::text from public.dossiers where id = p_dossier_id), 'read'));
$$;

-- Le dossier de stockage (1er niveau du chemin) appartient-il aux colonies ?
create or replace function public.is_colony_folder(p_folder text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (select 1 from public.colony_registrations where id::text = p_folder)
      or exists (select 1 from public.dossiers where id::text = p_folder and client_type = 'colony');
$$;

-- Liste des permissions de l'utilisateur connecté (pour l'interface).
create or replace function public.my_permissions()
returns text[]
language sql security definer set search_path = public stable
as $$
  select coalesce(array_agg(distinct p.code order by p.code), '{}')
  from public.permissions p
  where public.has_permission(p.code);
$$;

-- Statuts qui correspondent à une réservation validée (séjour confirmé et suite).
create or replace function public.statut_is_validated(p_statut text)
returns boolean
language sql immutable
as $$
  select p_statut in ('sejour_confirme', 'dossier_incomplet', 'dossier_complet', 'sejour_en_cours',
                      'sejour_termine', 'facture_envoyee', 'solde_attendu', 'solde', 'cloture');
$$;

grant execute on function public.is_staff() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.my_permissions() to authenticated;

-- ==========================================================
-- 4) RLS : catalogue lisible par le personnel, modifiable par roles.manage
-- ==========================================================

alter table public.staff_roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists staff_roles_select on public.staff_roles;
create policy staff_roles_select on public.staff_roles for select using (public.current_role_is_admin());
drop policy if exists staff_roles_write on public.staff_roles;
create policy staff_roles_write on public.staff_roles for all using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select using (public.current_role_is_admin());

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select using (public.current_role_is_admin());
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));

-- ==========================================================
-- 5) Profils : personne ne s'attribue de droits
-- ==========================================================

create or replace function public.enforce_profile_role_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Migrations et clé service (aucun utilisateur connecté) : non concernées.
  if auth.uid() is null then return new; end if;

  if new.role is distinct from old.role
     or new.staff_role is distinct from old.staff_role
     or new.staff_active is distinct from old.staff_active then
    if not public.has_permission('roles.manage') then
      raise exception 'Modification des rôles et accès internes réservée au Super Admin.';
    end if;
    if new.id = auth.uid() then
      raise exception 'Vous ne pouvez pas modifier votre propre rôle ou statut.';
    end if;
  end if;

  -- Fiche d'un autre membre du personnel : réservée à la gestion des utilisateurs.
  if old.role = 'admin' and old.id <> auth.uid() and not public.has_permission('users.manage') then
    raise exception 'Modification des comptes internes réservée au Super Admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_role_changes on public.profiles;
create trigger profiles_enforce_role_changes
  before update on public.profiles
  for each row execute function public.enforce_profile_role_changes();

-- ==========================================================
-- 6) Dossiers : droits par type (classes / groupes / colonies)
-- ==========================================================

drop policy if exists dossiers_staff_perm_select on public.dossiers;
create policy dossiers_staff_perm_select on public.dossiers as restrictive
  for select using (not public.staff_lacks(public.dossier_permission(client_type::text, 'read')));

drop policy if exists dossiers_staff_perm_insert on public.dossiers;
create policy dossiers_staff_perm_insert on public.dossiers as restrictive
  for insert with check (not public.staff_lacks(public.dossier_permission(client_type::text, 'create')));

drop policy if exists dossiers_staff_perm_update on public.dossiers;
create policy dossiers_staff_perm_update on public.dossiers as restrictive
  for update using (not public.staff_lacks(public.dossier_permission(client_type::text, 'edit')))
  with check (not public.staff_lacks(public.dossier_permission(client_type::text, 'edit')));

-- Suppression définitive : Super Admin (dossiers.delete) uniquement.
drop policy if exists dossiers_staff_perm_delete on public.dossiers;
create policy dossiers_staff_perm_delete on public.dossiers as restrictive
  for delete using (not public.staff_lacks('dossiers.delete'));

-- Validation d'une réservation (passage à "Séjour confirmé" ou suite) : permission
-- *.validate du type de dossier.
create or replace function public.enforce_reservation_validation()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.statut is distinct from old.statut
     and public.statut_is_validated(new.statut::text)
     and not public.statut_is_validated(old.statut::text)
     and public.staff_lacks(public.dossier_permission(new.client_type::text, 'validate')) then
    raise exception 'Vous n''avez pas le droit de valider cette réservation.';
  end if;
  return new;
end;
$$;

drop trigger if exists dossiers_enforce_reservation_validation on public.dossiers;
create trigger dossiers_enforce_reservation_validation
  before update on public.dossiers
  for each row execute function public.enforce_reservation_validation();

-- ==========================================================
-- 7) Colonies : aucun accès pour le personnel sans colonies.read
--    (séjours, fiches enfants, et toutes les lignes rattachées)
-- ==========================================================

drop policy if exists colony_stays_staff_perm on public.colony_stays;
create policy colony_stays_staff_perm on public.colony_stays as restrictive
  for all using (not public.staff_lacks('colonies.read'))
  with check (not public.staff_lacks('colonies.manage'));

drop policy if exists colony_registrations_staff_perm on public.colony_registrations;
create policy colony_registrations_staff_perm on public.colony_registrations as restrictive
  for all using (not public.staff_lacks('colonies.read'))
  with check (not public.staff_lacks('colonies.manage'));

-- Tables enfants : une ligne n'est visible/modifiable par le personnel que s'il
-- peut lire le dossier parent (selon son type) ou, pour une fiche colonie, s'il a
-- colonies.read. Appliqué à toutes les tables portant dossier_id et/ou
-- colony_registration_id.
do $$
declare
  t record;
  has_dossier boolean;
  has_colony boolean;
  expr text;
begin
  for t in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name in ('dossier_id', 'colony_registration_id')
      and c.table_name not in ('profiles', 'dossiers', 'colony_registrations', 'colony_stays')
  loop
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.table_name and column_name = 'dossier_id') into has_dossier;
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.table_name and column_name = 'colony_registration_id') into has_colony;
    expr := 'true';
    if has_dossier then
      expr := expr || ' and (dossier_id is null or public.staff_can_read_dossier(dossier_id))';
    end if;
    if has_colony then
      expr := expr || ' and (colony_registration_id is null or not public.staff_lacks(''colonies.read''))';
    end if;
    execute format('alter table public.%I enable row level security', t.table_name);
    execute format('drop policy if exists %I on public.%I', t.table_name || '_staff_perm', t.table_name);
    execute format('create policy %I on public.%I as restrictive for all using (%s) with check (%s)',
      t.table_name || '_staff_perm', t.table_name, expr, expr);
  end loop;
end $$;

-- ==========================================================
-- 8) Stockage : fichiers colonies + suppression définitive
-- ==========================================================

drop policy if exists storage_documents_staff_colonies on storage.objects;
create policy storage_documents_staff_colonies on storage.objects as restrictive
  for all using (
    bucket_id <> 'documents-dossiers'
    or not public.staff_lacks('colonies.read')
    or not public.is_colony_folder((storage.foldername(name))[1])
  )
  with check (
    bucket_id <> 'documents-dossiers'
    or not public.staff_lacks('colonies.read')
    or not public.is_colony_folder((storage.foldername(name))[1])
  );

-- Les fichiers ne sont jamais détruits par le parcours normal (ils sont archivés) :
-- la destruction ne sert qu'à la suppression définitive d'un dossier (dossiers.delete)
-- ou d'une fiche colonie (colonies.manage).
drop policy if exists storage_documents_staff_delete on storage.objects;
create policy storage_documents_staff_delete on storage.objects as restrictive
  for delete using (
    bucket_id <> 'documents-dossiers'
    or not public.staff_lacks('dossiers.delete')
    or (public.is_colony_folder((storage.foldername(name))[1]) and not public.staff_lacks('colonies.manage'))
  );

-- ==========================================================
-- 9) Traçabilité : nom de l'auteur figé dans l'historique
-- ==========================================================

alter table public.dossier_journal add column if not exists actor_name text;
alter table public.dossier_journal add column if not exists changes jsonb;
alter table public.statuts_historique add column if not exists changed_by_name text;
alter table public.dossier_acces add column if not exists last_actor uuid references auth.users(id) on delete set null;

comment on column public.dossier_journal.actor_name is 'Nom affiché de l''auteur au moment de l''action (conservé même si le compte est désactivé).';
comment on column public.dossier_journal.changes is 'Anciennes / nouvelles valeurs : {"champ": {"avant": ..., "apres": ...}}';

create or replace function public.fill_actor_name()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'dossier_journal' then
    if new.actor is null then new.actor := auth.uid(); end if;
    if new.actor_name is null and new.actor is not null then
      select coalesce(nullif(full_name, ''), email) into new.actor_name from public.profiles where id = new.actor;
    end if;
  elsif tg_table_name = 'statuts_historique' then
    if new.changed_by_name is null and new.changed_by is not null then
      select coalesce(nullif(full_name, ''), email) into new.changed_by_name from public.profiles where id = new.changed_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dossier_journal_fill_actor on public.dossier_journal;
create trigger dossier_journal_fill_actor
  before insert on public.dossier_journal
  for each row execute function public.fill_actor_name();

drop trigger if exists statuts_historique_fill_actor on public.statuts_historique;
create trigger statuts_historique_fill_actor
  before insert on public.statuts_historique
  for each row execute function public.fill_actor_name();

-- Reprise de l'historique existant (lecture seule des profils).
update public.dossier_journal j set actor_name = coalesce(nullif(p.full_name, ''), p.email)
from public.profiles p where p.id = j.actor and j.actor_name is null;
update public.statuts_historique h set changed_by_name = coalesce(nullif(p.full_name, ''), p.email)
from public.profiles p where p.id = h.changed_by and h.changed_by_name is null;

-- Création de dossier : auteur = utilisateur connecté, ou created_by quand le
-- dossier est créé par l'API serveur pour le compte d'un membre du personnel.
create or replace function public.on_dossier_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.source = 'public' then
    perform public.log_journal(new.id, 'demande_creee', 'Nouvelle demande reçue via le site public');
    perform public.notify('nouvelle_demande', new.id, 'Nouvelle demande : ' || new.etablissement);
  else
    insert into public.dossier_journal (dossier_id, action, details, actor)
    values (new.id, 'dossier_cree', 'Créé manuellement dans l''Admin', coalesce(auth.uid(), new.created_by));
  end if;
  return new;
end;
$$;

create or replace function public.log_statut_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and new.statut is distinct from old.statut) then
    insert into public.statuts_historique (dossier_id, ancien_statut, nouveau_statut, changed_by)
    values (new.id, old.statut, new.statut, auth.uid());
  elsif (tg_op = 'INSERT') then
    insert into public.statuts_historique (dossier_id, ancien_statut, nouveau_statut, changed_by)
    values (new.id, null, new.statut, coalesce(auth.uid(), new.created_by));
  end if;
  return new;
end;
$$;

-- Accès client : auteur = utilisateur connecté ou last_actor posé par l'API.
create or replace function public.on_dossier_acces_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.last_actor);
begin
  if tg_op = 'INSERT' then
    if new.statut = 'compte_active' then
      insert into public.dossier_journal (dossier_id, action, details, actor) values (new.dossier_id, 'acces_ajoute', 'Accès ajouté (compte existant)', v_actor);
    else
      insert into public.dossier_journal (dossier_id, action, details, actor) values (new.dossier_id, 'invitation_envoyee', null, v_actor);
    end if;
  elsif tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    if new.statut = 'compte_active' then
      perform public.log_journal(new.dossier_id, 'compte_active', null);
      perform public.notify('compte_active', new.dossier_id, 'Un enseignant a activé son compte');
    elsif new.statut = 'desactive' then
      insert into public.dossier_journal (dossier_id, action, details, actor) values (new.dossier_id, 'acces_desactive', null, v_actor);
    elsif old.statut = 'desactive' then
      insert into public.dossier_journal (dossier_id, action, details, actor) values (new.dossier_id, 'acces_reactive', null, v_actor);
    end if;
  end if;
  return new;
end;
$$;

-- Modifications importantes d'un dossier : anciennes et nouvelles valeurs.
create or replace function public.on_dossier_audit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_labels text[] := '{}';
  f text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_fields text[][] := array[
    ['date_confirmee_debut', 'Arrivée confirmée'], ['date_confirmee_fin', 'Départ confirmé'],
    ['date_proposee', 'Date proposée'], ['programme', 'Programme'], ['duree', 'Durée'],
    ['formule', 'Formule'], ['periode_souhaitee', 'Période souhaitée'],
    ['demande_date_arrivee', 'Arrivée demandée'], ['demande_date_depart', 'Départ demandé'],
    ['demande_heure_arrivee', 'Heure d''arrivée'], ['demande_heure_depart', 'Heure de départ'],
    ['effectif_prev_eleves', 'Élèves (prév.)'], ['effectif_prev_profs', 'Professeurs (prév.)'],
    ['effectif_prev_accompagnateurs', 'Accompagnateurs (prév.)'],
    ['effectif_def_eleves', 'Élèves (déf.)'], ['effectif_def_profs', 'Professeurs (déf.)'],
    ['effectif_def_accompagnateurs', 'Accompagnateurs (déf.)'],
    ['nb_adultes', 'Adultes'], ['nb_enfants', 'Enfants'],
    ['montant_devis', 'Montant du devis'], ['acompte_attendu', 'Acompte attendu'],
    ['etablissement', 'Établissement'], ['structure_nom', 'Structure'],
    ['contact_nom', 'Contact'], ['contact_email', 'E-mail contact'], ['contact_telephone', 'Téléphone contact']
  ];
  i int;
begin
  for i in 1 .. array_length(v_fields, 1) loop
    f := v_fields[i][1];
    if (v_old -> f) is distinct from (v_new -> f) then
      -- Premières saisies déjà tracées par on_dossier_key_changes (date proposée,
      -- dates confirmées, devis) : pas de doublon.
      if (v_old -> f) = 'null'::jsonb and f in ('date_proposee', 'date_confirmee_debut', 'date_confirmee_fin', 'montant_devis') then
        continue;
      end if;
      v_changes := v_changes || jsonb_build_object(f, jsonb_build_object('avant', v_old -> f, 'apres', v_new -> f, 'label', v_fields[i][2]));
      v_labels := v_labels || (v_fields[i][2] || ' : ' || coalesce(v_old ->> f, '—') || ' → ' || coalesce(v_new ->> f, '—'));
    end if;
  end loop;

  if v_changes <> '{}'::jsonb then
    insert into public.dossier_journal (dossier_id, action, details, changes, actor)
    values (new.id,
      case when (v_changes ? 'date_confirmee_debut') or (v_changes ? 'date_confirmee_fin') then 'dates_modifiees'
           when exists (select 1 from jsonb_object_keys(v_changes) k where k like 'effectif_%' or k in ('nb_adultes', 'nb_enfants')) then 'effectifs_modifies'
           else 'champs_modifies' end,
      array_to_string(v_labels, ' ; '), v_changes, auth.uid());
  end if;

  if new.statut is distinct from old.statut
     and public.statut_is_validated(new.statut::text) and not public.statut_is_validated(old.statut::text) then
    insert into public.dossier_journal (dossier_id, action, details, actor)
    values (new.id, 'reservation_validee',
      coalesce(to_char(new.date_confirmee_debut, 'DD/MM/YYYY') || ' → ' || to_char(new.date_confirmee_fin, 'DD/MM/YYYY'), 'dates à compléter'),
      auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists dossiers_on_audit on public.dossiers;
create trigger dossiers_on_audit
  after update on public.dossiers
  for each row execute function public.on_dossier_audit();
