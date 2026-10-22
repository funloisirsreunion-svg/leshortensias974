-- 0028 — Classes de découverte : deux circuits d'effectifs indépendants.
--
--   * Effectif PRÉVISIONNEL (bloc « effectifs ») : saisi par le professeur
--     (élèves, professeurs, accompagnateurs, répartition pour le couchage,
--     niveaux), transmis par « Demander la validation de l'effectif
--     prévisionnel », validé par l'Admin ou renvoyé en « Corrections demandées ».
--   * Effectif DÉFINITIF (nouveau bloc « effectifs_def ») : saisi, modifié et
--     validé par l'administration UNIQUEMENT. Visible en lecture seule côté client.
--
-- La validation de l'un n'entraîne jamais celle de l'autre.
-- Rétrocompatible : aucune colonne supprimée, aucune donnée effacée ; les
-- versions et événements existants du bloc « effectifs » sont conservés tels quels.

-- ==========================================================
-- 1) Répartition propre à l'effectif définitif
-- ==========================================================

alter table public.dossiers add column if not exists effectif_def_filles int check (effectif_def_filles >= 0);
alter table public.dossiers add column if not exists effectif_def_garcons int check (effectif_def_garcons >= 0);
alter table public.dossiers add column if not exists effectif_def_profs_femmes int check (effectif_def_profs_femmes >= 0);
alter table public.dossiers add column if not exists effectif_def_profs_hommes int check (effectif_def_profs_hommes >= 0);
alter table public.dossiers add column if not exists effectif_def_accomp_femmes int check (effectif_def_accomp_femmes >= 0);
alter table public.dossiers add column if not exists effectif_def_accomp_hommes int check (effectif_def_accomp_hommes >= 0);

comment on column public.dossiers.effectif_filles is 'Répartition de l''effectif PRÉVISIONNEL (saisie professeur) — pour les couchages.';
comment on column public.dossiers.effectif_def_filles is 'Répartition de l''effectif DÉFINITIF (saisie administration uniquement).';

-- Reprise : jusqu'ici une seule répartition portait sur l'effectif définitif
-- lorsqu'il était renseigné. Elle est recopiée dans la répartition définitive
-- (l'originale reste en place dans la rubrique prévisionnelle).
update public.dossiers set
  effectif_def_filles = effectif_filles, effectif_def_garcons = effectif_garcons,
  effectif_def_profs_femmes = effectif_profs_femmes, effectif_def_profs_hommes = effectif_profs_hommes,
  effectif_def_accomp_femmes = effectif_accomp_femmes, effectif_def_accomp_hommes = effectif_accomp_hommes
where client_type = 'school'
  and (effectif_def_eleves is not null or effectif_def_profs is not null or effectif_def_accompagnateurs is not null)
  and effectif_def_filles is null and effectif_def_garcons is null
  and effectif_def_profs_femmes is null and effectif_def_profs_hommes is null
  and effectif_def_accomp_femmes is null and effectif_def_accomp_hommes is null;

-- ==========================================================
-- 2) Nouveau bloc « effectifs_def »
-- ==========================================================

alter table public.dossier_blocs drop constraint if exists dossier_blocs_bloc_check;
alter table public.dossier_blocs add constraint dossier_blocs_bloc_check
  check (bloc in ('coordonnees', 'devis', 'effectifs', 'effectifs_def', 'regimes'));

create or replace function public.bloc_label(p_bloc text)
returns text
language sql immutable
as $$
  select case p_bloc
    when 'coordonnees' then 'Coordonnées'
    when 'devis' then 'Devis'
    when 'effectifs' then 'Effectif prévisionnel'
    when 'effectifs_def' then 'Effectif définitif'
    when 'regimes' then 'Régimes alimentaires'
    when 'documents' then 'Documents'
    else p_bloc end;
$$;

-- Effectif définitif : toujours verrouillé pour un client ; pour l'Admin,
-- verrouillé une fois validé (il doit rouvrir pour modifier).
create or replace function public.bloc_locked_for_current_user(p_dossier_id uuid, p_bloc text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_type text;
  v_statut text;
begin
  if auth.uid() is null then return false; end if; -- serveur / migration
  select client_type::text into v_type from public.dossiers where id = p_dossier_id;
  if v_type is distinct from 'school' then return false; end if;
  v_statut := public.bloc_statut(p_dossier_id, p_bloc);
  if public.current_role_is_admin() then
    return v_statut = 'validated';
  end if;
  if p_bloc = 'effectifs_def' then return true; end if;
  return v_statut in ('client_confirmed', 'validated');
end;
$$;

-- Instantanés : le bloc prévisionnel ne contient plus le définitif (et inversement).
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
      'effectif_filles', d.effectif_filles, 'effectif_garcons', d.effectif_garcons,
      'effectif_profs_femmes', d.effectif_profs_femmes, 'effectif_profs_hommes', d.effectif_profs_hommes,
      'effectif_accomp_femmes', d.effectif_accomp_femmes, 'effectif_accomp_hommes', d.effectif_accomp_hommes);
  elsif p_bloc = 'effectifs_def' then
    return jsonb_build_object(
      'effectif_def_eleves', d.effectif_def_eleves, 'effectif_def_profs', d.effectif_def_profs,
      'effectif_def_accompagnateurs', d.effectif_def_accompagnateurs,
      'effectif_def_filles', d.effectif_def_filles, 'effectif_def_garcons', d.effectif_def_garcons,
      'effectif_def_profs_femmes', d.effectif_def_profs_femmes, 'effectif_def_profs_hommes', d.effectif_def_profs_hommes,
      'effectif_def_accomp_femmes', d.effectif_def_accomp_femmes, 'effectif_def_accomp_hommes', d.effectif_def_accomp_hommes);
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

-- Reprise de l'historique : un dossier dont les effectifs (anciennement un seul
-- bloc) ont été VALIDÉS avec un effectif définitif renseigné garde cette
-- validation sur le nouveau bloc « effectifs_def » (date et auteur d'origine).
insert into public.dossier_blocs (dossier_id, bloc, statut, version, admin_validated_at, admin_validated_by, created_at, updated_at)
select b.dossier_id, 'effectifs_def', 'validated', 1, b.admin_validated_at, b.admin_validated_by, now(), now()
from public.dossier_blocs b
join public.dossiers d on d.id = b.dossier_id
where b.bloc = 'effectifs' and b.statut = 'validated' and d.client_type = 'school'
  and (d.effectif_def_eleves is not null or d.effectif_def_profs is not null or d.effectif_def_accompagnateurs is not null)
on conflict do nothing;

insert into public.dossier_bloc_versions (dossier_id, bloc, version, donnees_validees, admin_validated_at, admin_validated_by)
select b.dossier_id, 'effectifs_def', 1, public.bloc_snapshot(b.dossier_id, 'effectifs_def'), b.admin_validated_at, b.admin_validated_by
from public.dossier_blocs b
where b.bloc = 'effectifs_def' and b.statut = 'validated'
on conflict (dossier_id, bloc, version) do nothing;

-- ==========================================================
-- 3) Verrous côté base
-- ==========================================================

-- 3a) Effectif définitif : réservé à l'administration (avec la permission
--     d'édition des classes), et figé une fois validé.
create or replace function public.enforce_effectifs_def_admin_only()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- serveur (clé service) / migration
  end if;
  if new.effectif_def_eleves is not distinct from old.effectif_def_eleves
     and new.effectif_def_profs is not distinct from old.effectif_def_profs
     and new.effectif_def_accompagnateurs is not distinct from old.effectif_def_accompagnateurs
     and new.effectif_def_filles is not distinct from old.effectif_def_filles
     and new.effectif_def_garcons is not distinct from old.effectif_def_garcons
     and new.effectif_def_profs_femmes is not distinct from old.effectif_def_profs_femmes
     and new.effectif_def_profs_hommes is not distinct from old.effectif_def_profs_hommes
     and new.effectif_def_accomp_femmes is not distinct from old.effectif_def_accomp_femmes
     and new.effectif_def_accomp_hommes is not distinct from old.effectif_def_accomp_hommes then
    return new;
  end if;
  if not public.current_role_is_admin() then
    raise exception 'Modification non autorisée : l''effectif définitif est renseigné et validé par l''équipe du Centre Les Hortensias.';
  end if;
  if public.staff_lacks(public.dossier_permission(old.client_type::text, 'edit')) then
    raise exception 'Modification non autorisée : permission insuffisante pour modifier l''effectif définitif.';
  end if;
  if public.bloc_locked_for_current_user(old.id, 'effectifs_def') then
    raise exception 'Effectif définitif validé : utilisez « Modifier l''effectif définitif » (réouverture) avant de le changer.';
  end if;
  return new;
end;
$$;

drop trigger if exists dossiers_enforce_effectifs_def_admin_only on public.dossiers;
create trigger dossiers_enforce_effectifs_def_admin_only
  before update on public.dossiers
  for each row execute function public.enforce_effectifs_def_admin_only();

-- 3b) Verrous de blocs : le bloc prévisionnel ne verrouille plus le définitif
--     (sinon valider le prévisionnel figerait aussi le définitif).
create or replace function public.enforce_bloc_locks()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  msg text;
begin
  if old.client_type is distinct from 'school' or auth.uid() is null then
    return new;
  end if;
  msg := case when public.current_role_is_admin()
    then ' validé(e)s : utilisez « Rouvrir » avant de modifier.'
    else ' verrouillé(e)s : contactez Les Hortensias pour toute modification.' end;

  if public.bloc_locked_for_current_user(old.id, 'coordonnees') and (
        new.etablissement is distinct from old.etablissement
     or new.commune is distinct from old.commune
     or new.code_postal is distinct from old.code_postal
     or new.adresse is distinct from old.adresse
     or new.contact_nom is distinct from old.contact_nom
     or new.contact_telephone is distinct from old.contact_telephone
     or new.contact_email is distinct from old.contact_email) then
    raise exception 'Coordonnées%', msg;
  end if;

  if public.bloc_locked_for_current_user(old.id, 'effectifs') and (
        new.niveaux is distinct from old.niveaux
     or new.effectif_prev_eleves is distinct from old.effectif_prev_eleves
     or new.effectif_prev_profs is distinct from old.effectif_prev_profs
     or new.effectif_prev_accompagnateurs is distinct from old.effectif_prev_accompagnateurs) then
    raise exception 'Effectif prévisionnel%', msg;
  end if;

  if public.bloc_locked_for_current_user(old.id, 'regimes')
     and new.remarques_alimentaires is distinct from old.remarques_alimentaires then
    raise exception 'Régimes alimentaires%', msg;
  end if;

  if public.bloc_locked_for_current_user(old.id, 'devis') and (
        new.montant_devis is distinct from old.montant_devis
     or new.acompte_attendu is distinct from old.acompte_attendu) then
    raise exception 'Devis%', msg;
  end if;

  return new;
end;
$$;

-- ==========================================================
-- 4) Contrôles de cohérence, chacun sur son propre effectif
-- ==========================================================

create or replace function public.effectifs_coherence_errors(p_dossier_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  d public.dossiers;
  errs text[] := '{}';
begin
  select * into d from public.dossiers where id = p_dossier_id;
  if d.id is null then return errs; end if;
  if (d.effectif_filles is not null or d.effectif_garcons is not null)
     and coalesce(d.effectif_filles, 0) + coalesce(d.effectif_garcons, 0) <> coalesce(d.effectif_prev_eleves, 0) then
    errs := array_append(errs, 'La répartition filles/garçons ne correspond pas au nombre total d''élèves.');
  end if;
  if (d.effectif_profs_femmes is not null or d.effectif_profs_hommes is not null)
     and coalesce(d.effectif_profs_femmes, 0) + coalesce(d.effectif_profs_hommes, 0) <> coalesce(d.effectif_prev_profs, 0) then
    errs := array_append(errs, 'La répartition femmes/hommes ne correspond pas au nombre total de professeurs.');
  end if;
  if (d.effectif_accomp_femmes is not null or d.effectif_accomp_hommes is not null)
     and coalesce(d.effectif_accomp_femmes, 0) + coalesce(d.effectif_accomp_hommes, 0) <> coalesce(d.effectif_prev_accompagnateurs, 0) then
    errs := array_append(errs, 'La répartition femmes/hommes ne correspond pas au nombre total d''accompagnateurs.');
  end if;
  return errs;
end;
$$;

create or replace function public.effectifs_def_coherence_errors(p_dossier_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  d public.dossiers;
  errs text[] := '{}';
begin
  select * into d from public.dossiers where id = p_dossier_id;
  if d.id is null then return errs; end if;
  if d.effectif_def_eleves is null then
    errs := array_append(errs, 'Le nombre définitif d''élèves n''est pas renseigné.');
  end if;
  if (d.effectif_def_filles is not null or d.effectif_def_garcons is not null)
     and coalesce(d.effectif_def_filles, 0) + coalesce(d.effectif_def_garcons, 0) <> coalesce(d.effectif_def_eleves, 0) then
    errs := array_append(errs, 'Effectif définitif : la répartition filles/garçons ne correspond pas au nombre d''élèves.');
  end if;
  if (d.effectif_def_profs_femmes is not null or d.effectif_def_profs_hommes is not null)
     and coalesce(d.effectif_def_profs_femmes, 0) + coalesce(d.effectif_def_profs_hommes, 0) <> coalesce(d.effectif_def_profs, 0) then
    errs := array_append(errs, 'Effectif définitif : la répartition femmes/hommes ne correspond pas au nombre de professeurs.');
  end if;
  if (d.effectif_def_accomp_femmes is not null or d.effectif_def_accomp_hommes is not null)
     and coalesce(d.effectif_def_accomp_femmes, 0) + coalesce(d.effectif_def_accomp_hommes, 0) <> coalesce(d.effectif_def_accompagnateurs, 0) then
    errs := array_append(errs, 'Effectif définitif : la répartition femmes/hommes ne correspond pas au nombre d''accompagnateurs.');
  end if;
  return errs;
end;
$$;

grant execute on function public.effectifs_def_coherence_errors(uuid) to authenticated;

create or replace function public.enforce_effectifs_coherence_on_bloc()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  errs text[];
begin
  if new.statut in ('client_confirmed', 'validated') and new.statut is distinct from old.statut then
    if new.bloc = 'effectifs' then
      errs := public.effectifs_coherence_errors(new.dossier_id);
    elsif new.bloc = 'effectifs_def' then
      errs := public.effectifs_def_coherence_errors(new.dossier_id);
    end if;
    if array_length(errs, 1) > 0 then
      raise exception '%', array_to_string(errs, ' ');
    end if;
  end if;
  return new;
end;
$$;

-- ==========================================================
-- 5) Actions sur les blocs
-- ==========================================================

-- ADMIN : valider un bloc. L'effectif définitif exige la permission d'édition
-- des classes ; valider l'un des deux effectifs ne touche jamais à l'autre.
create or replace function public.bloc_validate_admin(p_dossier_id uuid, p_bloc text)
returns public.dossier_blocs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dossier_blocs;
  v_type text;
  v_snap jsonb;
begin
  if not public.current_role_is_admin() then
    raise exception 'Action réservée à l''administration.';
  end if;
  if p_bloc not in ('coordonnees', 'devis', 'effectifs', 'effectifs_def', 'regimes') then
    raise exception 'Bloc inconnu : %', p_bloc;
  end if;
  select client_type::text into v_type from public.dossiers where id = p_dossier_id;
  if v_type is distinct from 'school' then
    raise exception 'La validation par blocs concerne uniquement les classes de découverte.';
  end if;
  if p_bloc = 'effectifs_def' and public.staff_lacks(public.dossier_permission(v_type, 'edit')) then
    raise exception 'Permission insuffisante pour valider l''effectif définitif.';
  end if;

  insert into public.dossier_blocs (dossier_id, bloc) values (p_dossier_id, p_bloc) on conflict do nothing;
  select * into v_row from public.dossier_blocs where dossier_id = p_dossier_id and bloc = p_bloc for update;
  if v_row.statut = 'validated' then
    raise exception 'Ce bloc est déjà validé.';
  end if;

  v_snap := public.bloc_snapshot(p_dossier_id, p_bloc);
  insert into public.dossier_bloc_versions (dossier_id, bloc, version, donnees_validees, admin_validated_at, admin_validated_by)
  values (p_dossier_id, p_bloc, v_row.version, v_snap, now(), auth.uid())
  on conflict (dossier_id, bloc, version) do update
    set donnees_validees = excluded.donnees_validees,
        admin_validated_at = excluded.admin_validated_at,
        admin_validated_by = excluded.admin_validated_by,
        updated_at = now();

  update public.dossier_blocs
     set statut = 'validated', admin_validated_at = now(), admin_validated_by = auth.uid(),
         modification_requested_at = null, modification_requested_by = null, modification_request_message = null,
         updated_at = now()
   where dossier_id = p_dossier_id and bloc = p_bloc
   returning * into v_row;

  perform public.insert_bloc_event(p_dossier_id, p_bloc, v_row.version, 'admin_validated', v_snap, null);
  perform public.log_journal(p_dossier_id, 'bloc_valide', public.bloc_label(p_bloc) || ' (version ' || v_row.version || ')');
  perform public.notify_client(p_dossier_id, 'bloc_valide',
    '🟢 ' || public.bloc_label(p_bloc) || ' validé par Les Hortensias — ' || public.sejour_label_court(p_dossier_id));

  -- Les notifications Admin "à valider" de ce bloc sont traitées.
  update public.notifications set lu = true
   where audience = 'admin' and dossier_id = p_dossier_id and lu = false
     and (
       (p_bloc = 'regimes' and type = 'regimes_modifies')
       or (type in ('bloc_confirme', 'modification_demandee') and message like '%' || public.bloc_label(p_bloc) || '%')
       -- anciennes notifications (libellé « Effectifs » d'avant 0028)
       or (p_bloc = 'effectifs' and type in ('bloc_confirme', 'modification_demandee') and message like '%Effectifs%')
     );

  return v_row;
end;
$$;

-- ADMIN : rouvrir un bloc. Pour l'effectif prévisionnel, c'est « Demander des
-- corrections » (le message est transmis au professeur) ; pour l'effectif
-- définitif, une simple remise en préparation (le client n'est pas sollicité).
create or replace function public.bloc_reopen_admin(p_dossier_id uuid, p_bloc text, p_message text default null)
returns public.dossier_blocs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dossier_blocs;
  v_snap jsonb;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not public.current_role_is_admin() then
    raise exception 'Action réservée à l''administration.';
  end if;
  if p_bloc = 'effectifs_def' and public.staff_lacks(public.dossier_permission(
       (select client_type::text from public.dossiers where id = p_dossier_id), 'edit')) then
    raise exception 'Permission insuffisante pour modifier l''effectif définitif.';
  end if;
  select * into v_row from public.dossier_blocs where dossier_id = p_dossier_id and bloc = p_bloc for update;
  if v_row.dossier_id is null or v_row.statut not in ('client_confirmed', 'validated') then
    raise exception 'Seul un bloc confirmé ou validé peut être rouvert.';
  end if;

  v_snap := public.bloc_snapshot(p_dossier_id, p_bloc);
  insert into public.dossier_bloc_versions (dossier_id, bloc, version, reopened_at, reopened_by)
  values (p_dossier_id, p_bloc, v_row.version, now(), auth.uid())
  on conflict (dossier_id, bloc, version) do update
    set reopened_at = excluded.reopened_at, reopened_by = excluded.reopened_by, updated_at = now();

  update public.dossier_blocs
     set statut = 'reopened', version = version + 1,
         reopened_at = now(), reopened_by = auth.uid(),
         client_confirmed_at = null, client_confirmed_by = null,
         admin_validated_at = null, admin_validated_by = null,
         modification_requested_at = null, modification_requested_by = null, modification_request_message = null,
         updated_at = now()
   where dossier_id = p_dossier_id and bloc = p_bloc
   returning * into v_row;

  perform public.insert_bloc_event(p_dossier_id, p_bloc, v_row.version - 1, 'reopened', v_snap, v_msg);
  perform public.log_journal(p_dossier_id, 'bloc_rouvert', public.bloc_label(p_bloc) || ' (nouvelle version ' || v_row.version || ')' || coalesce(' — ' || v_msg, ''));
  if p_bloc = 'effectifs' then
    perform public.notify_client(p_dossier_id, 'bloc_rouvert',
      '✏️ Effectif prévisionnel : corrections demandées par Les Hortensias' || coalesce(' — « ' || v_msg || ' »', '')
      || ' — ' || public.sejour_label_court(p_dossier_id));
  elsif p_bloc not in ('devis', 'effectifs_def') then
    perform public.notify_client(p_dossier_id, 'bloc_rouvert',
      '✏️ ' || public.bloc_label(p_bloc) || ' : Les Hortensias vous permet de modifier de nouveau ces informations — '
      || public.sejour_label_court(p_dossier_id));
  end if;
  return v_row;
end;
$$;

-- CLIENT : demander une modification — jamais sur l'effectif définitif.
create or replace function public.bloc_request_modification(p_dossier_id uuid, p_bloc text, p_message text default null)
returns public.dossier_blocs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dossier_blocs;
begin
  if auth.uid() is null or public.current_role_is_admin() or not public.has_dossier_access(p_dossier_id) then
    raise exception 'Accès refusé.';
  end if;
  if p_bloc not in ('coordonnees', 'effectifs', 'regimes', 'devis') then
    raise exception 'L''effectif définitif est renseigné et validé par l''équipe du Centre Les Hortensias.';
  end if;
  select * into v_row from public.dossier_blocs where dossier_id = p_dossier_id and bloc = p_bloc for update;
  if v_row.dossier_id is null or v_row.statut not in ('client_confirmed', 'validated') then
    raise exception 'Ce bloc est déjà modifiable.';
  end if;
  update public.dossier_blocs
     set modification_requested_at = now(), modification_requested_by = auth.uid(),
         modification_request_message = left(nullif(btrim(coalesce(p_message, '')), ''), 1000), updated_at = now()
   where dossier_id = p_dossier_id and bloc = p_bloc
   returning * into v_row;
  perform public.insert_bloc_event(p_dossier_id, p_bloc, v_row.version, 'modification_requested', null, v_row.modification_request_message);
  perform public.log_journal(p_dossier_id, 'modification_demandee', public.bloc_label(p_bloc) || coalesce(' — ' || v_row.modification_request_message, ''));
  perform public.notify('modification_demandee', p_dossier_id,
    '🔴 Modification demandée — ' || public.bloc_label(p_bloc) || ' — ' || public.sejour_label_court(p_dossier_id)
    || coalesce(' : « ' || v_row.modification_request_message || ' »', ''));
  return v_row;
end;
$$;

-- ==========================================================
-- 6) Journal des modifications : répartition définitive suivie
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
    ['effectif_def_filles', 'Filles (déf.)'], ['effectif_def_garcons', 'Garçons (déf.)'],
    ['effectif_def_profs_femmes', 'Professeurs femmes (déf.)'], ['effectif_def_profs_hommes', 'Professeurs hommes (déf.)'],
    ['effectif_def_accomp_femmes', 'Accompagnateurs femmes (déf.)'], ['effectif_def_accomp_hommes', 'Accompagnateurs hommes (déf.)'],
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
