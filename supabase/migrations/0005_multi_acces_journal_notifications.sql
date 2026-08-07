-- Passage d'un accès enseignant "1 compte = 1 dossier" à "1 compte = N dossiers"
-- (une école peut avoir plusieurs séjours au fil des années, un même compte ne
-- doit jamais être dupliqué), + journal d'actions générique par dossier,
-- + notifications internes pour l'admin.

-- ==========================================================
-- 1) Table dossier_acces (remplace profiles.dossier_id)
-- ==========================================================

create table public.dossier_acces (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  statut text not null default 'invitation_envoyee' check (statut in ('invitation_envoyee', 'compte_active', 'desactive')),
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dossier_id, profile_id)
);

comment on table public.dossier_acces is 'Lien N-N entre un compte enseignant et ses dossiers. statut pilote à la fois l''accès RLS et l''affichage admin.';

-- Migration des données existantes depuis profiles.dossier_id
insert into public.dossier_acces (dossier_id, profile_id, statut, activated_at)
select dossier_id, id, 'compte_active', now()
from public.profiles
where dossier_id is not null
on conflict do nothing;

-- ==========================================================
-- 2) Nouvelle fonction d'accès + policies dépendantes à réécrire
-- ==========================================================

create or replace function public.has_dossier_access(check_dossier_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.dossier_acces
    where dossier_id = check_dossier_id and profile_id = auth.uid() and statut != 'desactive'
  );
$$;

-- Policies qui utilisaient current_dossier_id() -> réécrites avec has_dossier_access()
drop policy if exists dossiers_select on public.dossiers;
create policy dossiers_select on public.dossiers
  for select using (public.current_role_is_admin() or public.has_dossier_access(id));

drop policy if exists dossiers_update on public.dossiers;
create policy dossiers_update on public.dossiers
  for update using (public.current_role_is_admin() or public.has_dossier_access(id))
  with check (public.current_role_is_admin() or public.has_dossier_access(id));

drop policy if exists regimes_select on public.regimes_alimentaires;
create policy regimes_select on public.regimes_alimentaires
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

drop policy if exists regimes_update on public.regimes_alimentaires;
create policy regimes_update on public.regimes_alimentaires
  for update using (public.current_role_is_admin() or public.has_dossier_access(dossier_id))
  with check (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update using (public.current_role_is_admin() or public.has_dossier_access(dossier_id))
  with check (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

drop policy if exists statuts_historique_select on public.statuts_historique;
create policy statuts_historique_select on public.statuts_historique
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

drop policy if exists taches_select on public.taches;
create policy taches_select on public.taches
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

drop policy if exists signalements_select on public.signalements_paiement;
create policy signalements_select on public.signalements_paiement
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

drop policy if exists signalements_insert on public.signalements_paiement;
create policy signalements_insert on public.signalements_paiement
  for insert with check (
    (public.current_role_is_admin() or public.has_dossier_access(dossier_id))
    and signale_par = auth.uid()
  );

drop policy if exists storage_documents_select on storage.objects;
create policy storage_documents_select on storage.objects
  for select using (
    bucket_id = 'documents-dossiers'
    and (
      public.current_role_is_admin()
      or public.has_dossier_access(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists storage_documents_insert on storage.objects;
create policy storage_documents_insert on storage.objects
  for insert with check (
    bucket_id = 'documents-dossiers'
    and (
      public.current_role_is_admin()
      or public.has_dossier_access(((storage.foldername(name))[1])::uuid)
    )
  );

-- profiles.dossier_id n'est plus la source de vérité de l'accès
alter table public.profiles drop column if exists dossier_id;
drop function if exists public.current_dossier_id();

-- ==========================================================
-- 3) RLS sur dossier_acces
-- ==========================================================

alter table public.dossier_acces enable row level security;

create policy dossier_acces_select on public.dossier_acces
  for select using (public.current_role_is_admin() or profile_id = auth.uid());

create policy dossier_acces_admin_write on public.dossier_acces
  for all using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

-- Un enseignant ne peut faire évoluer QUE le statut de son propre accès, et
-- uniquement dans le sens invitation_envoyee -> compte_active (première connexion
-- après avoir défini son mot de passe). Toute autre transition reste admin-only
-- (la policy ci-dessus couvre déjà l'admin ; celle-ci ajoute la seule exception self-service).
create policy dossier_acces_self_activate on public.dossier_acces
  for update using (profile_id = auth.uid() and statut = 'invitation_envoyee')
  with check (profile_id = auth.uid() and statut = 'compte_active');

-- ==========================================================
-- 4) Journal d'actions par dossier (au-delà des seuls changements de statut)
-- ==========================================================

create table public.dossier_journal (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  action text not null,
  details text,
  actor uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.dossier_journal enable row level security;

create policy dossier_journal_select on public.dossier_journal
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

create policy dossier_journal_admin_insert on public.dossier_journal
  for insert with check (public.current_role_is_admin());

create or replace function public.log_journal(p_dossier_id uuid, p_action text, p_details text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.dossier_journal (dossier_id, action, details, actor)
  values (p_dossier_id, p_action, p_details, auth.uid());
end;
$$;

-- ==========================================================
-- 5) Notifications internes admin
-- ==========================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  dossier_id uuid references public.dossiers(id) on delete cascade,
  message text not null,
  lu boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy notifications_admin_only on public.notifications
  for all using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

create or replace function public.notify(p_type text, p_dossier_id uuid, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (type, dossier_id, message) values (p_type, p_dossier_id, p_message);
end;
$$;

-- ==========================================================
-- 6) Triggers : alimentation automatique du journal + des notifications
-- ==========================================================

-- Nouvelle demande publique
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
    perform public.log_journal(new.id, 'dossier_cree', 'Dossier créé par l''administrateur');
  end if;
  return new;
end;
$$;

create trigger dossiers_on_created
  after insert on public.dossiers
  for each row execute function public.on_dossier_created();

-- Étapes clés d'un dossier (devis préparé, date proposée, date confirmée)
create or replace function public.on_dossier_key_changes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.montant_devis is null and new.montant_devis is not null then
    perform public.log_journal(new.id, 'devis_prepare', 'Montant devis : ' || new.montant_devis || ' €');
  end if;
  if old.date_proposee is null and new.date_proposee is not null then
    perform public.log_journal(new.id, 'date_proposee', to_char(new.date_proposee, 'DD/MM/YYYY'));
  end if;
  if old.date_confirmee_debut is null and new.date_confirmee_debut is not null then
    perform public.log_journal(new.id, 'date_confirmee', to_char(new.date_confirmee_debut, 'DD/MM/YYYY') || ' au ' || to_char(new.date_confirmee_fin, 'DD/MM/YYYY'));
  end if;
  return new;
end;
$$;

create trigger dossiers_on_key_changes
  after update on public.dossiers
  for each row execute function public.on_dossier_key_changes();

-- Document déposé par l'enseignant
create or replace function public.on_document_recu()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.statut = 'recu' and old.statut is distinct from 'recu' then
    perform public.log_journal(new.dossier_id, 'document_depose', 'Document déposé : ' || new.type::text);
    perform public.notify('document_depose', new.dossier_id, 'Document déposé : ' || new.type::text);
  end if;
  return new;
end;
$$;

create trigger documents_on_recu
  after update on public.documents
  for each row execute function public.on_document_recu();

-- Virement signalé par l'enseignant
create or replace function public.on_signalement_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.log_journal(new.dossier_id, 'virement_signale', new.montant || ' € le ' || to_char(new.date_virement, 'DD/MM/YYYY'));
  perform public.notify('virement_signale', new.dossier_id, 'Virement signalé : ' || new.montant || ' €');
  return new;
end;
$$;

create trigger signalements_on_created
  after insert on public.signalements_paiement
  for each row execute function public.on_signalement_created();

-- Cycle de vie de l'accès client (invitation envoyée / compte activé / désactivé)
create or replace function public.on_dossier_acces_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.statut = 'compte_active' then
      perform public.log_journal(new.dossier_id, 'acces_ajoute', 'Accès ajouté (compte existant)');
    else
      perform public.log_journal(new.dossier_id, 'invitation_envoyee', null);
    end if;
  elsif tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    if new.statut = 'compte_active' then
      perform public.log_journal(new.dossier_id, 'compte_active', null);
      perform public.notify('compte_active', new.dossier_id, 'Un enseignant a activé son compte');
    elsif new.statut = 'desactive' then
      perform public.log_journal(new.dossier_id, 'acces_desactive', null);
    elsif old.statut = 'desactive' then
      perform public.log_journal(new.dossier_id, 'acces_reactive', null);
    end if;
  end if;
  return new;
end;
$$;

create trigger dossier_acces_on_change
  after insert or update on public.dossier_acces
  for each row execute function public.on_dossier_acces_change();
