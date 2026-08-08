-- Généralise documents / paiements / dossier_journal / notifications pour
-- qu'ils puissent référencer soit un dossier (école/groupe), soit une fiche
-- colony_registrations (colonie) — jamais les deux. École/Groupe inchangés :
-- ces triggers/policies continuent à fonctionner exactement comme avant dès
-- lors que colony_registration_id est null.

-- ==========================================================
-- 1) Colonnes + contraintes "exactement un parent"
-- ==========================================================

alter table public.documents add column colony_registration_id uuid references public.colony_registrations(id) on delete cascade;
alter table public.documents alter column dossier_id drop not null;
alter table public.documents add constraint documents_one_parent_chk
  check ((dossier_id is not null) <> (colony_registration_id is not null));

alter table public.paiements add column colony_registration_id uuid references public.colony_registrations(id) on delete cascade;
alter table public.paiements alter column dossier_id drop not null;
alter table public.paiements add constraint paiements_one_parent_chk
  check ((dossier_id is not null) <> (colony_registration_id is not null));

alter table public.dossier_journal add column colony_registration_id uuid references public.colony_registrations(id) on delete cascade;
alter table public.dossier_journal alter column dossier_id drop not null;
alter table public.dossier_journal add constraint dossier_journal_one_parent_chk
  check ((dossier_id is not null) <> (colony_registration_id is not null));

alter table public.notifications add column colony_registration_id uuid references public.colony_registrations(id) on delete cascade;
alter table public.notifications alter column dossier_id drop not null;
alter table public.notifications add constraint notifications_one_parent_chk
  check ((dossier_id is not null) <> (colony_registration_id is not null));

create index documents_colony_registration_id_idx on public.documents(colony_registration_id);
create index paiements_colony_registration_id_idx on public.paiements(colony_registration_id);
create index dossier_journal_colony_registration_id_idx on public.dossier_journal(colony_registration_id);
create index notifications_colony_registration_id_idx on public.notifications(colony_registration_id);

-- ==========================================================
-- 2) documents : remplace l'unique (dossier_id, type) hérité de 0001 par
-- deux index uniques partiels (un par branche de parent).
-- ==========================================================

do $$
declare
  c record;
begin
  for c in
    select tc.constraint_name
    from information_schema.table_constraints tc
    where tc.table_schema = 'public' and tc.table_name = 'documents' and tc.constraint_type = 'UNIQUE'
  loop
    execute format('alter table public.documents drop constraint %I', c.constraint_name);
  end loop;
end $$;

create unique index documents_dossier_type_uq on public.documents(dossier_id, type) where dossier_id is not null;
create unique index documents_colony_reg_type_uq on public.documents(colony_registration_id, type) where colony_registration_id is not null;

-- ==========================================================
-- 3) RLS : les policies existantes sur documents/paiements/dossier_journal/
-- notifications qui accordent l'accès client via has_dossier_access(dossier_id)
-- renvoient déjà `false` quand dossier_id est null (cas colonie) — seul
-- `current_role_is_admin()` donne donc accès aux lignes colonie. Aucune policy
-- à modifier : le comportement est déjà correct par construction.
-- ==========================================================

-- ==========================================================
-- 4) recalc_montant_paye : branche vers dossiers OU colony_registrations
-- selon la colonne renseignée sur la ligne de paiement.
-- ==========================================================

create or replace function public.recalc_montant_paye()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_dossier_id uuid;
  target_colony_registration_id uuid;
begin
  target_dossier_id := coalesce(new.dossier_id, old.dossier_id);
  target_colony_registration_id := coalesce(new.colony_registration_id, old.colony_registration_id);

  if target_dossier_id is not null then
    update public.dossiers
    set montant_paye = coalesce((
      select sum(montant) from public.paiements where dossier_id = target_dossier_id
    ), 0)
    where id = target_dossier_id;
  elsif target_colony_registration_id is not null then
    update public.colony_registrations
    set montant_paye = coalesce((
      select sum(montant) from public.paiements where colony_registration_id = target_colony_registration_id
    ), 0)
    where id = target_colony_registration_id;
  end if;

  return null;
end;
$$;

-- ==========================================================
-- 5) log_journal / notify : ajout d'un paramètre optionnel
-- p_colony_registration_id (défaut null) — tous les appels existants (école/
-- groupe) continuent à fonctionner sans modification.
-- ==========================================================

create or replace function public.log_journal(p_dossier_id uuid, p_action text, p_details text default null, p_colony_registration_id uuid default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.dossier_journal (dossier_id, colony_registration_id, action, details, actor)
  values (p_dossier_id, p_colony_registration_id, p_action, p_details, auth.uid());
end;
$$;

create or replace function public.notify(p_type text, p_dossier_id uuid, p_message text, p_colony_registration_id uuid default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (type, dossier_id, colony_registration_id, message)
  values (p_type, p_dossier_id, p_colony_registration_id, p_message);
end;
$$;

-- ==========================================================
-- 6) Nouvelle inscription colonie : journal + notification admin
-- (jamais de nouvelle ligne "principale" dans le dashboard général — la
-- ligne principale reste le séjour colony_stays, inchangé par cet insert).
-- ==========================================================

create or replace function public.on_colony_registration_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  stay_nom text;
  enfant_label text;
begin
  select nom into stay_nom from public.colony_stays where id = new.stay_id;
  enfant_label := trim(coalesce(new.enfant_prenom, '') || ' ' || coalesce(new.enfant_nom, ''));
  if enfant_label = '' then enfant_label := new.numero; end if;

  if new.source = 'public' then
    perform public.log_journal(null, 'inscription_creee', 'Nouvelle inscription reçue via le site public', new.id);
    perform public.notify('nouvelle_inscription_colonie', null, 'Nouvelle inscription : ' || enfant_label || ' — ' || coalesce(stay_nom, 'séjour'), new.id);
  else
    perform public.log_journal(null, 'inscription_creee_admin', 'Fiche créée par l''administrateur', new.id);
  end if;
  return new;
end;
$$;

create trigger colony_registrations_on_created
  after insert on public.colony_registrations
  for each row execute function public.on_colony_registration_created();

-- ==========================================================
-- 7) on_document_change (0011) : adapté pour cibler dossier_id OU
-- colony_registration_id selon laquelle est renseignée. Pas de notify_client
-- pour les documents colonie (aucun compte client colonie).
-- ==========================================================

create or replace function public.on_document_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_admin boolean;
  target_dossier uuid;
  target_colony uuid;
begin
  is_admin := public.current_role_is_admin();
  target_dossier := new.dossier_id;
  target_colony := new.colony_registration_id;

  if tg_op = 'INSERT' then
    if new.storage_path is not null then
      if is_admin then
        perform public.log_journal(target_dossier, 'document_ajoute', 'Ajouté par l''admin : ' || new.type::text, target_colony);
        if new.client_visible and target_dossier is not null then
          perform public.notify_client(target_dossier, 'document_ajoute', 'Nouveau document disponible : ' || new.type::text);
        end if;
      else
        perform public.log_journal(target_dossier, 'document_depose', 'Déposé par le client : ' || new.type::text, target_colony);
        perform public.notify('document_depose', target_dossier, 'Document déposé : ' || new.type::text, target_colony);
      end if;
    end if;
    return new;
  end if;

  -- UPDATE : nouveau fichier (ajout ou remplacement)
  if new.storage_path is distinct from old.storage_path and new.storage_path is not null then
    if is_admin then
      perform public.log_journal(target_dossier, case when old.storage_path is null then 'document_ajoute' else 'document_remplace' end, 'Par l''admin : ' || new.type::text, target_colony);
      if new.client_visible and target_dossier is not null then
        perform public.notify_client(target_dossier, 'document_ajoute', 'Nouveau document disponible : ' || new.type::text);
      end if;
    else
      perform public.log_journal(target_dossier, case when old.storage_path is null then 'document_depose' else 'document_remplace' end, 'Par le client : ' || new.type::text, target_colony);
      perform public.notify('document_depose', target_dossier, 'Document déposé : ' || new.type::text, target_colony);
    end if;
  end if;

  -- UPDATE : retrait par le client (redevient "à fournir")
  if new.storage_path is null and old.storage_path is not null and not is_admin then
    perform public.log_journal(target_dossier, 'document_supprime', 'Retiré par le client : ' || new.type::text, target_colony);
  end if;

  -- UPDATE : changement de statut
  if new.statut is distinct from old.statut then
    if new.statut = 'valide' then
      perform public.log_journal(target_dossier, 'document_valide', new.type::text, target_colony);
      if target_dossier is not null then
        perform public.notify_client(target_dossier, 'document_valide', 'Document validé : ' || new.type::text);
      end if;
    elsif new.statut = 'refuse' then
      perform public.log_journal(target_dossier, 'document_refuse', new.type::text || coalesce(' — ' || new.refus_motif, ''), target_colony);
      if target_dossier is not null then
        perform public.notify_client(target_dossier, 'document_refuse', 'Document refusé : ' || new.type::text || coalesce(' — ' || new.refus_motif, ''));
      end if;
    elsif new.statut = 'non_requis' and old.statut is distinct from 'non_requis' then
      perform public.log_journal(target_dossier, 'document_non_requis', new.type::text, target_colony);
    elsif old.statut = 'non_requis' and new.statut is distinct from 'non_requis' then
      perform public.log_journal(target_dossier, 'document_requis_again', new.type::text, target_colony);
    end if;
  end if;

  return new;
end;
$$;
