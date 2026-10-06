-- Fiche opérationnelle de séjour (Classes de découverte, extensible aux Groupes).
-- Rétrocompatible : uniquement des colonnes/tables nouvelles et des fonctions
-- redéfinies à l'identique + ajouts. Aucune donnée existante modifiée.
-- Prérequis : 0023 (rôles et permissions).
--
-- La fiche n'est PAS une base indépendante : elle est calculée depuis le dossier
-- (dernières versions validées en priorité). On ne conserve que l'historique des
-- ENVOIS (instantané de ce qui a été transmis, pour savoir si la fiche est obsolète).

-- ==========================================================
-- 1) Répartition filles/garçons et femmes/hommes
--    Elle porte sur l'effectif retenu : définitif s'il est renseigné, sinon
--    prévisionnel (même règle que le Planning).
-- ==========================================================

alter table public.dossiers add column if not exists effectif_filles int check (effectif_filles >= 0);
alter table public.dossiers add column if not exists effectif_garcons int check (effectif_garcons >= 0);
alter table public.dossiers add column if not exists effectif_profs_femmes int check (effectif_profs_femmes >= 0);
alter table public.dossiers add column if not exists effectif_profs_hommes int check (effectif_profs_hommes >= 0);
alter table public.dossiers add column if not exists effectif_accomp_femmes int check (effectif_accomp_femmes >= 0);
alter table public.dossiers add column if not exists effectif_accomp_hommes int check (effectif_accomp_hommes >= 0);

comment on column public.dossiers.effectif_filles is 'Répartition de l''effectif retenu (définitif sinon prévisionnel) — pour les couchages.';

-- ==========================================================
-- 2) Heures d'arrivée / de départ confirmées (HH:MM)
-- ==========================================================

alter table public.dossiers add column if not exists heure_arrivee text check (heure_arrivee ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.dossiers add column if not exists heure_depart text check (heure_depart ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

comment on column public.dossiers.heure_arrivee is 'Heure d''arrivée confirmée par Les Hortensias (les heures demandées par un groupe restent dans demande_heure_*).';

-- Heures : saisies par l'administration uniquement (comme les dates confirmées).
create or replace function public.enforce_heures_admin_only()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.current_role_is_admin()
     and (new.heure_arrivee is distinct from old.heure_arrivee or new.heure_depart is distinct from old.heure_depart) then
    raise exception 'Modification non autorisée : seul un administrateur peut modifier les horaires du séjour.';
  end if;
  return new;
end;
$$;

drop trigger if exists dossiers_enforce_heures_admin_only on public.dossiers;
create trigger dossiers_enforce_heures_admin_only
  before update on public.dossiers
  for each row execute function public.enforce_heures_admin_only();

-- La répartition suit le verrou du bloc Effectifs (comme les autres effectifs).
create or replace function public.enforce_effectifs_repartition_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.client_type is distinct from 'school' or auth.uid() is null then
    return new;
  end if;
  if public.bloc_locked_for_current_user(old.id, 'effectifs') and (
        new.effectif_filles is distinct from old.effectif_filles
     or new.effectif_garcons is distinct from old.effectif_garcons
     or new.effectif_profs_femmes is distinct from old.effectif_profs_femmes
     or new.effectif_profs_hommes is distinct from old.effectif_profs_hommes
     or new.effectif_accomp_femmes is distinct from old.effectif_accomp_femmes
     or new.effectif_accomp_hommes is distinct from old.effectif_accomp_hommes) then
    raise exception 'Effectifs%', case when public.current_role_is_admin()
      then ' validé(e)s : utilisez « Rouvrir » avant de modifier.'
      else ' verrouillé(e)s : contactez Les Hortensias pour toute modification.' end;
  end if;
  return new;
end;
$$;

drop trigger if exists dossiers_enforce_effectifs_repartition_lock on public.dossiers;
create trigger dossiers_enforce_effectifs_repartition_lock
  before update on public.dossiers
  for each row execute function public.enforce_effectifs_repartition_lock();

-- ==========================================================
-- 3) Contrôles de cohérence (filles + garçons = élèves, etc.)
-- ==========================================================

create or replace function public.effectifs_coherence_errors(p_dossier_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  d public.dossiers;
  use_def boolean;
  t_eleves int; t_profs int; t_accomp int;
  errs text[] := '{}';
begin
  select * into d from public.dossiers where id = p_dossier_id;
  if d.id is null then return errs; end if;
  use_def := d.effectif_def_eleves is not null or d.effectif_def_profs is not null or d.effectif_def_accompagnateurs is not null;
  t_eleves := case when use_def then d.effectif_def_eleves else d.effectif_prev_eleves end;
  t_profs := case when use_def then d.effectif_def_profs else d.effectif_prev_profs end;
  t_accomp := case when use_def then d.effectif_def_accompagnateurs else d.effectif_prev_accompagnateurs end;

  if (d.effectif_filles is not null or d.effectif_garcons is not null)
     and coalesce(d.effectif_filles, 0) + coalesce(d.effectif_garcons, 0) <> coalesce(t_eleves, 0) then
    errs := array_append(errs, 'La répartition filles/garçons ne correspond pas au nombre total d''élèves.');
  end if;
  if (d.effectif_profs_femmes is not null or d.effectif_profs_hommes is not null)
     and coalesce(d.effectif_profs_femmes, 0) + coalesce(d.effectif_profs_hommes, 0) <> coalesce(t_profs, 0) then
    errs := array_append(errs, 'La répartition femmes/hommes ne correspond pas au nombre total de professeurs.');
  end if;
  if (d.effectif_accomp_femmes is not null or d.effectif_accomp_hommes is not null)
     and coalesce(d.effectif_accomp_femmes, 0) + coalesce(d.effectif_accomp_hommes, 0) <> coalesce(t_accomp, 0) then
    errs := array_append(errs, 'La répartition femmes/hommes ne correspond pas au nombre total d''accompagnateurs.');
  end if;
  return errs;
end;
$$;

grant execute on function public.effectifs_coherence_errors(uuid) to authenticated;

-- Le bloc Effectifs ne peut être ni confirmé par le client ni validé par l'Admin
-- tant que la répartition est incohérente.
create or replace function public.enforce_effectifs_coherence_on_bloc()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  errs text[];
begin
  if new.bloc = 'effectifs' and new.statut in ('client_confirmed', 'validated')
     and new.statut is distinct from old.statut then
    errs := public.effectifs_coherence_errors(new.dossier_id);
    if array_length(errs, 1) > 0 then
      raise exception '%', array_to_string(errs, ' ');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dossier_blocs_effectifs_coherence on public.dossier_blocs;
create trigger dossier_blocs_effectifs_coherence
  before update on public.dossier_blocs
  for each row execute function public.enforce_effectifs_coherence_on_bloc();

-- ==========================================================
-- 4) Régimes : précisions libres + allergies structurées
-- ==========================================================

alter table public.regimes_alimentaires add column if not exists precisions text;
comment on column public.regimes_alimentaires.precisions is 'Précisions (ex. pour « Autre » : « sans fruits de mer »). La liste des types reste extensible via l''enum regime_type.';

create table if not exists public.dossier_allergies (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  allergene text not null check (length(btrim(allergene)) > 0),
  nombre int not null default 1 check (nombre >= 1),
  precisions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dossier_allergies_dossier_idx on public.dossier_allergies(dossier_id);
comment on table public.dossier_allergies is 'Allergies / informations alimentaires importantes (une ligne par allergène), mises en évidence sur la fiche opérationnelle.';

drop trigger if exists dossier_allergies_set_updated_at on public.dossier_allergies;
create trigger dossier_allergies_set_updated_at
  before update on public.dossier_allergies
  for each row execute function public.set_updated_at();

alter table public.dossier_allergies enable row level security;

drop policy if exists dossier_allergies_select on public.dossier_allergies;
create policy dossier_allergies_select on public.dossier_allergies
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));
drop policy if exists dossier_allergies_write on public.dossier_allergies;
create policy dossier_allergies_write on public.dossier_allergies
  for all using (public.current_role_is_admin() or public.has_dossier_access(dossier_id))
  with check (public.current_role_is_admin() or public.has_dossier_access(dossier_id));
-- Personnel : mêmes droits par type de dossier que le reste (cf. 0023).
drop policy if exists dossier_allergies_staff_perm on public.dossier_allergies;
create policy dossier_allergies_staff_perm on public.dossier_allergies as restrictive
  for all using (public.staff_can_read_dossier(dossier_id)) with check (public.staff_can_read_dossier(dossier_id));

-- Verrou du bloc Régimes : allergies et précisions comprises.
create or replace function public.enforce_regimes_lock()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_dossier uuid;
begin
  v_dossier := coalesce(new.dossier_id, old.dossier_id);
  -- (IF imbriqués : la table des allergies n'a pas de colonne "type")
  if tg_table_name = 'regimes_alimentaires' and tg_op = 'UPDATE' then
    if new.nombre is not distinct from old.nombre and new.type is not distinct from old.type
       and new.precisions is not distinct from old.precisions then
      return new;
    end if;
  end if;
  if public.bloc_locked_for_current_user(v_dossier, 'regimes') then
    raise exception 'Régimes alimentaires verrouillés : %', case when public.current_role_is_admin()
      then 'utilisez « Rouvrir » avant de modifier.' else 'contactez Les Hortensias pour toute modification.' end;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists dossier_allergies_enforce_lock on public.dossier_allergies;
create trigger dossier_allergies_enforce_lock
  before insert or update or delete on public.dossier_allergies
  for each row execute function public.enforce_regimes_lock();

-- Instantanés des blocs (versions) : répartition, précisions et allergies inclus.
create or replace function public.bloc_snapshot(p_dossier_id uuid, p_bloc text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d public.dossiers;
begin
  select * into d from public.dossiers where id = p_dossier_id;
  if d.id is null then return null; end if;
  if p_bloc = 'coordonnees' then
    return jsonb_build_object(
      'etablissement', d.etablissement, 'adresse', d.adresse, 'code_postal', d.code_postal,
      'commune', d.commune, 'contact_nom', d.contact_nom, 'contact_telephone', d.contact_telephone,
      'contact_email', d.contact_email);
  elsif p_bloc = 'effectifs' then
    return jsonb_build_object(
      'niveaux', d.niveaux,
      'effectif_prev_eleves', d.effectif_prev_eleves, 'effectif_prev_profs', d.effectif_prev_profs,
      'effectif_prev_accompagnateurs', d.effectif_prev_accompagnateurs,
      'effectif_def_eleves', d.effectif_def_eleves, 'effectif_def_profs', d.effectif_def_profs,
      'effectif_def_accompagnateurs', d.effectif_def_accompagnateurs,
      'effectif_filles', d.effectif_filles, 'effectif_garcons', d.effectif_garcons,
      'effectif_profs_femmes', d.effectif_profs_femmes, 'effectif_profs_hommes', d.effectif_profs_hommes,
      'effectif_accomp_femmes', d.effectif_accomp_femmes, 'effectif_accomp_hommes', d.effectif_accomp_hommes);
  elsif p_bloc = 'regimes' then
    return jsonb_build_object(
      'remarques_alimentaires', d.remarques_alimentaires,
      'regimes', coalesce((select jsonb_object_agg(r.type::text, r.nombre) from public.regimes_alimentaires r where r.dossier_id = d.id), '{}'::jsonb),
      'precisions', coalesce((select jsonb_object_agg(r.type::text, r.precisions) from public.regimes_alimentaires r where r.dossier_id = d.id and nullif(btrim(r.precisions), '') is not null), '{}'::jsonb),
      'allergies', coalesce((select jsonb_agg(jsonb_build_object('allergene', a.allergene, 'nombre', a.nombre, 'precisions', a.precisions) order by a.allergene) from public.dossier_allergies a where a.dossier_id = d.id), '[]'::jsonb));
  elsif p_bloc = 'devis' then
    return jsonb_build_object(
      'montant_devis', d.montant_devis, 'acompte_attendu', d.acompte_attendu,
      'devis_file', (select file_name from public.documents where dossier_id = d.id and type = 'devis'),
      'devis_path', (select storage_path from public.documents where dossier_id = d.id and type = 'devis'),
      'devis_signe_file', (select file_name from public.documents where dossier_id = d.id and type = 'devis_signe'),
      'devis_signe_path', (select storage_path from public.documents where dossier_id = d.id and type = 'devis_signe'),
      'statut_dossier', d.statut);
  end if;
  return null;
end;
$$;

-- ==========================================================
-- 5) Permission d'envoi et historique des envois
-- ==========================================================

insert into public.permissions (code, label, sort_order) values
  ('operational_sheet.send', 'Fiche opérationnelle : aperçu et envoi', 55)
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission) values
  ('admin_operations', 'operational_sheet.send'),
  ('commercial_reservations', 'operational_sheet.send')
on conflict do nothing;

create table if not exists public.fiches_operationnelles (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by uuid references auth.users(id) on delete set null,
  sent_by_name text,
  recipient text not null,
  is_update boolean not null default false,
  snapshot jsonb not null,          -- contenu exact transmis (fiche calculée)
  snapshot_hash text not null,      -- empreinte des informations opérationnelles
  effectifs_version int,            -- version validée du bloc Effectifs utilisée (null = données du dossier)
  regimes_version int,
  storage_path text,                -- PDF archivé (stockage privé)
  email_id text
);
create index if not exists fiches_operationnelles_dossier_idx on public.fiches_operationnelles(dossier_id, sent_at desc);
comment on table public.fiches_operationnelles is 'Historique des envois de la fiche opérationnelle (jamais modifié). La fiche elle-même est toujours recalculée depuis le dossier.';

alter table public.fiches_operationnelles enable row level security;
drop policy if exists fiches_operationnelles_select on public.fiches_operationnelles;
create policy fiches_operationnelles_select on public.fiches_operationnelles
  for select using (public.current_role_is_admin() and public.staff_can_read_dossier(dossier_id));
-- Écriture uniquement par l'API serveur (clé service), après contrôle de la permission.

drop trigger if exists fiches_operationnelles_fill_actor on public.fiches_operationnelles;
create or replace function public.fill_fiche_sender_name()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.sent_by_name is null and new.sent_by is not null then
    select coalesce(nullif(full_name, ''), email) into new.sent_by_name from public.profiles where id = new.sent_by;
  end if;
  return new;
end;
$$;
create trigger fiches_operationnelles_fill_actor
  before insert on public.fiches_operationnelles
  for each row execute function public.fill_fiche_sender_name();

-- ==========================================================
-- 6) Historique des modifications : nouveaux champs suivis
-- ==========================================================

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
    ['heure_arrivee', 'Heure d''arrivée'], ['heure_depart', 'Heure de départ'],
    ['date_proposee', 'Date proposée'], ['programme', 'Programme'], ['duree', 'Durée'],
    ['formule', 'Formule'], ['periode_souhaitee', 'Période souhaitée'],
    ['demande_date_arrivee', 'Arrivée demandée'], ['demande_date_depart', 'Départ demandé'],
    ['demande_heure_arrivee', 'Heure d''arrivée demandée'], ['demande_heure_depart', 'Heure de départ demandée'],
    ['effectif_prev_eleves', 'Élèves (prév.)'], ['effectif_prev_profs', 'Professeurs (prév.)'],
    ['effectif_prev_accompagnateurs', 'Accompagnateurs (prév.)'],
    ['effectif_def_eleves', 'Élèves (déf.)'], ['effectif_def_profs', 'Professeurs (déf.)'],
    ['effectif_def_accompagnateurs', 'Accompagnateurs (déf.)'],
    ['effectif_filles', 'Filles'], ['effectif_garcons', 'Garçons'],
    ['effectif_profs_femmes', 'Professeurs femmes'], ['effectif_profs_hommes', 'Professeurs hommes'],
    ['effectif_accomp_femmes', 'Accompagnateurs femmes'], ['effectif_accomp_hommes', 'Accompagnateurs hommes'],
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
      case when (v_changes ? 'date_confirmee_debut') or (v_changes ? 'date_confirmee_fin')
                or (v_changes ? 'heure_arrivee') or (v_changes ? 'heure_depart') then 'dates_modifiees'
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

-- Régimes / allergies modifiés : tracés aussi (pour l'alerte « fiche obsolète »).
create or replace function public.on_regimes_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_dossier uuid := coalesce(new.dossier_id, old.dossier_id);
  v_txt text;
begin
  -- Suppression en cascade du dossier : rien à tracer.
  if not exists (select 1 from public.dossiers where id = v_dossier) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'regimes_alimentaires' then
    if tg_op <> 'UPDATE' or (new.nombre is not distinct from old.nombre and new.precisions is not distinct from old.precisions) then
      return coalesce(new, old);
    end if;
    v_txt := new.type::text || ' : ' || coalesce(old.nombre::text, '0') || ' → ' || coalesce(new.nombre::text, '0');
  else
    v_txt := 'Allergie ' || case tg_op when 'INSERT' then 'ajoutée : ' when 'DELETE' then 'retirée : ' else 'modifiée : ' end
      || coalesce(new.allergene, old.allergene) || ' (' || coalesce(new.nombre, old.nombre) || ')';
  end if;
  insert into public.dossier_journal (dossier_id, action, details, actor) values (v_dossier, 'regimes_modifies', v_txt, auth.uid());
  return coalesce(new, old);
end;
$$;

drop trigger if exists regimes_on_audit on public.regimes_alimentaires;
create trigger regimes_on_audit after update on public.regimes_alimentaires
  for each row execute function public.on_regimes_audit();
drop trigger if exists dossier_allergies_on_audit on public.dossier_allergies;
create trigger dossier_allergies_on_audit after insert or update or delete on public.dossier_allergies
  for each row execute function public.on_regimes_audit();
