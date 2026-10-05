-- ==========================================================
-- 0021 — Fiche Classe : validation par blocs, verrouillage réel,
-- versions/historique, documents tracés, première connexion client.
--
-- Rétrocompatible : aucune colonne supprimée, aucune donnée effacée.
-- Un dossier sans ligne dans dossier_blocs est considéré "draft" (brouillon)
-- sur chaque bloc : les dossiers existants continuent de fonctionner tels quels.
-- La logique de blocs ne s'applique qu'aux dossiers client_type = 'school'
-- (Classes de découverte) : Groupes et Colonies ne sont pas touchés.
-- ==========================================================

-- ----------------------------------------------------------
-- 1) État courant de chaque bloc (un par dossier et par bloc)
-- ----------------------------------------------------------
create table if not exists public.dossier_blocs (
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  bloc text not null check (bloc in ('coordonnees', 'devis', 'effectifs', 'regimes')),
  -- draft = brouillon / modifiable par le client
  -- client_confirmed = confirmé par le client, en attente de l'Admin (verrouillé côté client)
  -- validated = validé par l'Admin (verrouillé pour tous ; l'Admin peut rouvrir)
  -- reopened = rouvert par l'Admin, à mettre à jour par le client
  statut text not null default 'draft' check (statut in ('draft', 'client_confirmed', 'validated', 'reopened')),
  version int not null default 1,
  client_confirmed_at timestamptz,
  client_confirmed_by uuid references auth.users(id) on delete set null,
  admin_validated_at timestamptz,
  admin_validated_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  -- Préparation de "Demander une modification" côté client (n'altère pas le statut).
  modification_requested_at timestamptz,
  modification_requested_by uuid references auth.users(id) on delete set null,
  modification_request_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dossier_id, bloc)
);

-- ----------------------------------------------------------
-- 2) Versions : chaque version garde ses propres données et dates.
--    Jamais écrasée par la version suivante (réouverture = version + 1).
-- ----------------------------------------------------------
create table if not exists public.dossier_bloc_versions (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  bloc text not null,
  version int not null,
  donnees_client jsonb,     -- valeurs telles que confirmées par le client
  donnees_validees jsonb,   -- valeurs telles que validées par l'Admin
  client_confirmed_at timestamptz,
  client_confirmed_by uuid references auth.users(id) on delete set null,
  admin_validated_at timestamptz,
  admin_validated_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,   -- date à laquelle CETTE version a été rouverte (donc remplacée)
  reopened_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dossier_id, bloc, version)
);
create index if not exists dossier_bloc_versions_dossier_idx on public.dossier_bloc_versions(dossier_id, bloc);

-- ----------------------------------------------------------
-- 3) Journal d'événements (append-only) : chaque confirmation, validation,
--    réouverture, demande de modification, et événements documents.
-- ----------------------------------------------------------
create table if not exists public.dossier_bloc_events (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  bloc text not null,
  version int,
  action text not null,
  donnees jsonb,
  message text,
  actor uuid references auth.users(id) on delete set null,
  actor_role text,
  created_at timestamptz not null default now()
);
create index if not exists dossier_bloc_events_dossier_idx on public.dossier_bloc_events(dossier_id, bloc, created_at);

alter table public.dossier_blocs enable row level security;
alter table public.dossier_bloc_versions enable row level security;
alter table public.dossier_bloc_events enable row level security;

-- Lecture : admin ou compte ayant accès au dossier. AUCUNE policy d'écriture :
-- toute écriture passe par les fonctions security definer ci-dessous, qui
-- contrôlent le rôle et l'état du bloc (impossible à contourner via l'API).
drop policy if exists dossier_blocs_select on public.dossier_blocs;
create policy dossier_blocs_select on public.dossier_blocs
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));
drop policy if exists dossier_bloc_versions_select on public.dossier_bloc_versions;
create policy dossier_bloc_versions_select on public.dossier_bloc_versions
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));
drop policy if exists dossier_bloc_events_select on public.dossier_bloc_events;
create policy dossier_bloc_events_select on public.dossier_bloc_events
  for select using (public.current_role_is_admin() or public.has_dossier_access(dossier_id));

-- ----------------------------------------------------------
-- 4) Helpers
-- ----------------------------------------------------------
create or replace function public.bloc_statut(p_dossier_id uuid, p_bloc text)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((select statut from public.dossier_blocs where dossier_id = p_dossier_id and bloc = p_bloc), 'draft');
$$;

create or replace function public.bloc_label(p_bloc text)
returns text
language sql immutable
as $$
  select case p_bloc
    when 'coordonnees' then 'Coordonnées'
    when 'devis' then 'Devis'
    when 'effectifs' then 'Effectifs'
    when 'regimes' then 'Régimes alimentaires'
    when 'documents' then 'Documents'
    else p_bloc end;
$$;

-- Verrou : pour un client, bloc verrouillé dès qu'il est confirmé ou validé ;
-- pour l'Admin (session utilisateur), verrouillé uniquement une fois validé
-- (il doit rouvrir pour modifier, l'ancienne version restant conservée).
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
  return v_statut in ('client_confirmed', 'validated');
end;
$$;

-- Instantané des données d'un bloc (stocké dans les versions/événements).
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
      'effectif_def_accompagnateurs', d.effectif_def_accompagnateurs);
  elsif p_bloc = 'regimes' then
    return jsonb_build_object(
      'remarques_alimentaires', d.remarques_alimentaires,
      'regimes', coalesce((select jsonb_object_agg(r.type::text, r.nombre) from public.regimes_alimentaires r where r.dossier_id = d.id), '{}'::jsonb));
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

create or replace function public.sejour_label_court(p_dossier_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(d.etablissement, '') || ' — ' ||
    case
      when d.date_confirmee_debut is not null then 'séjour du ' || to_char(d.date_confirmee_debut, 'DD/MM/YYYY') || ' au ' || to_char(coalesce(d.date_confirmee_fin, d.date_confirmee_debut), 'DD/MM/YYYY')
      when d.date_proposee is not null then 'séjour proposé le ' || to_char(d.date_proposee, 'DD/MM/YYYY')
      when d.periode_souhaitee is not null then 'période souhaitée : ' || d.periode_souhaitee
      else 'dossier ' || d.numero
    end
  from public.dossiers d where d.id = p_dossier_id;
$$;

create or replace function public.now_reunion_txt()
returns text
language sql stable
as $$ select to_char(now() at time zone 'Indian/Reunion', 'DD/MM/YYYY "à" HH24:MI'); $$;

create or replace function public.insert_bloc_event(p_dossier_id uuid, p_bloc text, p_version int, p_action text, p_donnees jsonb, p_message text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.dossier_bloc_events (dossier_id, bloc, version, action, donnees, message, actor, actor_role)
  values (p_dossier_id, p_bloc, p_version, p_action, p_donnees, p_message, auth.uid(),
    case when auth.uid() is null then 'systeme' when public.current_role_is_admin() then 'admin' else 'client' end);
end;
$$;

-- ----------------------------------------------------------
-- 5) Actions (RPC) — seules portes d'écriture sur les blocs
-- ----------------------------------------------------------

-- CLIENT : confirmer un bloc (coordonnées, effectifs, régimes).
create or replace function public.bloc_confirm_client(p_dossier_id uuid, p_bloc text)
returns public.dossier_blocs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dossier_blocs;
  v_type text;
  v_snap jsonb;
  v_had_validation boolean;
begin
  if auth.uid() is null or public.current_role_is_admin() then
    raise exception 'Action réservée au client.';
  end if;
  if not public.has_dossier_access(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.';
  end if;
  if p_bloc not in ('coordonnees', 'effectifs', 'regimes') then
    raise exception 'Bloc inconnu ou non confirmable par le client : %', p_bloc;
  end if;
  select client_type::text into v_type from public.dossiers where id = p_dossier_id;
  if v_type is distinct from 'school' then
    raise exception 'La validation par blocs concerne uniquement les classes de découverte.';
  end if;

  insert into public.dossier_blocs (dossier_id, bloc) values (p_dossier_id, p_bloc) on conflict do nothing;
  select * into v_row from public.dossier_blocs where dossier_id = p_dossier_id and bloc = p_bloc for update;
  if v_row.statut not in ('draft', 'reopened') then
    raise exception 'Ces informations sont déjà confirmées : contactez Les Hortensias pour toute modification.';
  end if;

  v_snap := public.bloc_snapshot(p_dossier_id, p_bloc);
  insert into public.dossier_bloc_versions (dossier_id, bloc, version, donnees_client, client_confirmed_at, client_confirmed_by)
  values (p_dossier_id, p_bloc, v_row.version, v_snap, now(), auth.uid())
  on conflict (dossier_id, bloc, version) do update
    set donnees_client = excluded.donnees_client,
        client_confirmed_at = excluded.client_confirmed_at,
        client_confirmed_by = excluded.client_confirmed_by,
        updated_at = now();

  update public.dossier_blocs
     set statut = 'client_confirmed', client_confirmed_at = now(), client_confirmed_by = auth.uid(),
         modification_requested_at = null, modification_requested_by = null, modification_request_message = null,
         updated_at = now()
   where dossier_id = p_dossier_id and bloc = p_bloc
   returning * into v_row;

  perform public.insert_bloc_event(p_dossier_id, p_bloc, v_row.version, 'client_confirmed', v_snap, null);
  perform public.log_journal(p_dossier_id, 'bloc_confirme', public.bloc_label(p_bloc) || ' (version ' || v_row.version || ')');

  -- Une version > 1 signifie qu'une version précédente a existé (réouverture) :
  -- toute modification alimentaire après une première version est signalée en rouge.
  select exists (
    select 1 from public.dossier_bloc_versions
    where dossier_id = p_dossier_id and bloc = p_bloc and version < v_row.version and admin_validated_at is not null
  ) into v_had_validation;

  if p_bloc = 'regimes' and v_had_validation then
    perform public.notify('regimes_modifies', p_dossier_id,
      '🔴 INFORMATIONS ALIMENTAIRES MODIFIÉES — ' || public.sejour_label_court(p_dossier_id)
      || ' — nouvelle version transmise le ' || public.now_reunion_txt() || '. À contrôler (cuisine).');
  else
    perform public.notify('bloc_confirme', p_dossier_id,
      '🔵 ' || public.bloc_label(p_bloc) || ' confirmé(e)s par le client — validation Admin nécessaire — '
      || public.sejour_label_court(p_dossier_id));
  end if;

  return v_row;
end;
$$;

-- ADMIN : valider un bloc (avec ou sans confirmation client préalable).
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
  if p_bloc not in ('coordonnees', 'devis', 'effectifs', 'regimes') then
    raise exception 'Bloc inconnu : %', p_bloc;
  end if;
  select client_type::text into v_type from public.dossiers where id = p_dossier_id;
  if v_type is distinct from 'school' then
    raise exception 'La validation par blocs concerne uniquement les classes de découverte.';
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
    '🟢 ' || public.bloc_label(p_bloc) || ' validé(e)s par Les Hortensias — ' || public.sejour_label_court(p_dossier_id));

  -- Les notifications Admin "à valider" de ce bloc sont traitées.
  update public.notifications set lu = true
   where audience = 'admin' and dossier_id = p_dossier_id and lu = false
     and type in ('bloc_confirme', 'regimes_modifies', 'modification_demandee')
     and message like '%' || public.bloc_label(p_bloc) || '%';

  return v_row;
end;
$$;

-- ADMIN : rouvrir un bloc. La version courante est figée (reopened_at), une
-- nouvelle version est ouverte. Rien n'est effacé.
create or replace function public.bloc_reopen_admin(p_dossier_id uuid, p_bloc text, p_message text default null)
returns public.dossier_blocs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dossier_blocs;
  v_snap jsonb;
begin
  if not public.current_role_is_admin() then
    raise exception 'Action réservée à l''administration.';
  end if;
  select * into v_row from public.dossier_blocs where dossier_id = p_dossier_id and bloc = p_bloc for update;
  if v_row.dossier_id is null or v_row.statut not in ('client_confirmed', 'validated') then
    raise exception 'Seul un bloc confirmé ou validé peut être rouvert.';
  end if;

  v_snap := public.bloc_snapshot(p_dossier_id, p_bloc);
  -- La version qui se termine conserve ses données et ses dates.
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

  perform public.insert_bloc_event(p_dossier_id, p_bloc, v_row.version - 1, 'reopened', v_snap, nullif(btrim(coalesce(p_message, '')), ''));
  perform public.log_journal(p_dossier_id, 'bloc_rouvert', public.bloc_label(p_bloc) || ' (nouvelle version ' || v_row.version || ')');
  if p_bloc <> 'devis' then
    perform public.notify_client(p_dossier_id, 'bloc_rouvert',
      '✏️ ' || public.bloc_label(p_bloc) || ' : Les Hortensias vous permet de modifier de nouveau ces informations — '
      || public.sejour_label_court(p_dossier_id));
  end if;
  return v_row;
end;
$$;

-- CLIENT : demander une modification d'un bloc confirmé/validé (préparation :
-- ne déverrouille rien, prévient seulement l'Admin qui décide de rouvrir).
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

revoke all on function public.bloc_confirm_client(uuid, text) from public, anon;
revoke all on function public.bloc_validate_admin(uuid, text) from public, anon;
revoke all on function public.bloc_reopen_admin(uuid, text, text) from public, anon;
revoke all on function public.bloc_request_modification(uuid, text, text) from public, anon;
revoke all on function public.insert_bloc_event(uuid, text, int, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.bloc_confirm_client(uuid, text) to authenticated;
grant execute on function public.bloc_validate_admin(uuid, text) to authenticated;
grant execute on function public.bloc_reopen_admin(uuid, text, text) to authenticated;
grant execute on function public.bloc_request_modification(uuid, text, text) to authenticated;

-- ----------------------------------------------------------
-- 6) Verrouillage réel côté base
-- ----------------------------------------------------------

-- 6a) Permissions par champ (remplace la version 0011) : identique, sauf que
-- pour une classe de découverte le client peut désormais renseigner ses
-- coordonnées tant que le bloc "coordonnees" est en brouillon ou rouvert.
-- code_postal rejoint la liste des champs protégés (oubli de 0019).
create or replace function public.enforce_dossier_field_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  coord_ouvertes boolean;
begin
  if public.current_role_is_admin() then
    return new;
  end if;

  coord_ouvertes := old.client_type = 'school'
    and public.bloc_statut(old.id, 'coordonnees') in ('draft', 'reopened');

  if not coord_ouvertes and (
        new.etablissement is distinct from old.etablissement
     or new.commune is distinct from old.commune
     or new.code_postal is distinct from old.code_postal
     or new.adresse is distinct from old.adresse
     or new.contact_nom is distinct from old.contact_nom
     or new.contact_telephone is distinct from old.contact_telephone
     or new.contact_email is distinct from old.contact_email)
  then
    raise exception 'Modification non autorisée : ces coordonnées sont verrouillées. Contactez Les Hortensias.';
  end if;

  if new.numero is distinct from old.numero
     or new.client_type is distinct from old.client_type
     or new.archived_at is distinct from old.archived_at
     or new.contact_prenom is distinct from old.contact_prenom
     or new.contact_fonction is distinct from old.contact_fonction
     or new.programme is distinct from old.programme
     or new.duree is distinct from old.duree
     or new.date_proposee is distinct from old.date_proposee
     or new.date_confirmee_debut is distinct from old.date_confirmee_debut
     or new.date_confirmee_fin is distinct from old.date_confirmee_fin
     or new.statut is distinct from old.statut
     or new.montant_devis is distinct from old.montant_devis
     or new.acompte_attendu is distinct from old.acompte_attendu
     or new.acompte_recu is distinct from old.acompte_recu
     or new.date_acompte is distinct from old.date_acompte
     or new.part_mairie_prevue is distinct from old.part_mairie_prevue
     or new.part_mairie_recue is distinct from old.part_mairie_recue
     or new.montant_facture is distinct from old.montant_facture
     or new.montant_paye is distinct from old.montant_paye
     or new.created_by is distinct from old.created_by
     or new.structure_nom is distinct from old.structure_nom
     or new.structure_type is distinct from old.structure_type
     or new.demande_date_arrivee is distinct from old.demande_date_arrivee
     or new.demande_heure_arrivee is distinct from old.demande_heure_arrivee
     or new.demande_date_depart is distinct from old.demande_date_depart
     or new.demande_heure_depart is distinct from old.demande_heure_depart
     or new.formule is distinct from old.formule
     or new.estimation_montant is distinct from old.estimation_montant
     or new.enfant_nom is distinct from old.enfant_nom
     or new.enfant_prenom is distinct from old.enfant_prenom
     or new.enfant_date_naissance is distinct from old.enfant_date_naissance
     or new.enfant_sexe is distinct from old.enfant_sexe
     or new.beneficiaire_vacaf is distinct from old.beneficiaire_vacaf
     or new.numero_allocataire is distinct from old.numero_allocataire
     or new.autorisation_partage_prive is distinct from old.autorisation_partage_prive
     or new.autorisation_communication_publique is distinct from old.autorisation_communication_publique
     or new.colonie_nom is distinct from old.colonie_nom
     or new.tarif_colonie is distinct from old.tarif_colonie
  then
    raise exception 'Modification non autorisée : seul un administrateur peut modifier ces champs du dossier.';
  end if;

  return new;
end;
$$;

-- 6b) Verrous de blocs sur dossiers (client ET Admin connecté ; l'Admin doit
-- rouvrir un bloc validé avant de le modifier, l'ancienne version restant tracée).
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
     or new.effectif_prev_accompagnateurs is distinct from old.effectif_prev_accompagnateurs
     or new.effectif_def_eleves is distinct from old.effectif_def_eleves
     or new.effectif_def_profs is distinct from old.effectif_def_profs
     or new.effectif_def_accompagnateurs is distinct from old.effectif_def_accompagnateurs) then
    raise exception 'Effectifs%', msg;
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

drop trigger if exists dossiers_enforce_bloc_locks on public.dossiers;
create trigger dossiers_enforce_bloc_locks
  before update on public.dossiers
  for each row execute function public.enforce_bloc_locks();

-- 6c) Régimes alimentaires (table séparée) : même verrou.
create or replace function public.enforce_regimes_lock()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_dossier uuid;
begin
  v_dossier := coalesce(new.dossier_id, old.dossier_id);
  if tg_op = 'UPDATE' and new.nombre is not distinct from old.nombre and new.type is not distinct from old.type then
    return new;
  end if;
  if public.bloc_locked_for_current_user(v_dossier, 'regimes') then
    raise exception 'Régimes alimentaires verrouillés : %', case when public.current_role_is_admin()
      then 'utilisez « Rouvrir » avant de modifier.' else 'contactez Les Hortensias pour toute modification.' end;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists regimes_enforce_lock on public.regimes_alimentaires;
create trigger regimes_enforce_lock
  before insert or update or delete on public.regimes_alimentaires
  for each row execute function public.enforce_regimes_lock();

-- ----------------------------------------------------------
-- 7) Documents : dates, versions, aucune suppression côté client
-- ----------------------------------------------------------
alter table public.documents add column if not exists first_uploaded_at timestamptz;
alter table public.documents add column if not exists reopened_at timestamptz;
alter table public.documents add column if not exists reopened_by uuid references auth.users(id) on delete set null;
alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_by uuid references auth.users(id) on delete set null;

-- Reprise des dates de premier dépôt (verrou de permission suspendu le temps de
-- cette seule mise à jour : la session de migration n'est pas un admin connecté).
alter table public.documents disable trigger documents_enforce_field_permissions;
update public.documents
   set first_uploaded_at = coalesce(uploaded_at, created_at)
 where storage_path is not null and first_uploaded_at is null;
alter table public.documents enable trigger documents_enforce_field_permissions;

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete set null,
  dossier_id uuid references public.dossiers(id) on delete cascade,
  colony_registration_id uuid references public.colony_registrations(id) on delete cascade,
  type text not null,
  storage_path text,
  file_name text,
  uploaded_at timestamptz,
  uploaded_by uuid references auth.users(id) on delete set null,
  statut_final text,
  validated_at timestamptz,
  validated_by uuid references auth.users(id) on delete set null,
  -- remplacement | suppression_admin | retrait_client (groupes uniquement)
  motif text not null,
  archived_at timestamptz not null default now(),
  archived_by uuid references auth.users(id) on delete set null,
  archived_by_role text
);
create index if not exists document_versions_dossier_idx on public.document_versions(dossier_id, type);

alter table public.document_versions enable row level security;
drop policy if exists document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions
  for select using (
    public.current_role_is_admin()
    or (dossier_id is not null and public.has_dossier_access(dossier_id)
        and exists (select 1 from public.documents d where d.id = document_versions.document_id and d.client_visible))
  );
-- Écriture uniquement par trigger (security definer) : aucune policy d'écriture.

-- 7a) Permissions client (remplace 0013) : + jamais de suppression d'un
-- document transmis, + devis/devis signé figés une fois le devis validé.
create or replace function public.enforce_document_field_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.statut = 'refuse' and (new.refus_motif is null or btrim(new.refus_motif) = '') then
    raise exception 'Un motif est obligatoire pour refuser un document.';
  end if;

  -- Devis validé : ni le client ni l'Admin connecté ne remplacent/suppriment
  -- silencieusement le devis ou le devis signé (l'Admin doit rouvrir le bloc Devis).
  if new.dossier_id is not null and new.type::text in ('devis', 'devis_signe')
     and public.bloc_locked_for_current_user(new.dossier_id, 'devis')
     and public.bloc_statut(new.dossier_id, 'devis') = 'validated'
     and (new.storage_path is distinct from old.storage_path or new.file_name is distinct from old.file_name) then
    raise exception 'Le devis est validé : il ne peut pas être remplacé ni supprimé (rouvrir le bloc Devis si nécessaire).';
  end if;

  if public.current_role_is_admin() then
    return new;
  end if;

  if new.validated_by is distinct from old.validated_by
     or new.validated_at is distinct from old.validated_at
     or new.document_source is distinct from old.document_source
     or new.client_visible is distinct from old.client_visible
     or new.refus_motif is distinct from old.refus_motif
     or new.reopened_at is distinct from old.reopened_at
     or new.reopened_by is distinct from old.reopened_by
     or new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by
     or new.first_uploaded_at is distinct from old.first_uploaded_at
  then
    raise exception 'Seul un administrateur peut modifier ces champs du document.';
  end if;

  if old.document_source = 'admin' then
    raise exception 'Ce document est fourni par Les Hortensias : vous ne pouvez pas le modifier.';
  end if;

  -- Classes de découverte : un document transmis n'est jamais supprimable par le
  -- client (Groupes/Colonies : comportement antérieur conservé, retrait possible).
  if exists (select 1 from public.dossiers where id = old.dossier_id and client_type = 'school') then
    if old.storage_path is not null and new.storage_path is null then
      raise exception 'Un document transmis ne peut pas être supprimé. Contactez Les Hortensias si nécessaire.';
    end if;
    if new.statut is distinct from old.statut and new.statut <> 'recu' then
      raise exception 'Un client peut uniquement transmettre un document (statut « reçu »).';
    end if;
  end if;

  if old.statut = 'valide' and (
    new.storage_path is distinct from old.storage_path
    or new.file_name is distinct from old.file_name
    or new.statut is distinct from old.statut
  ) then
    raise exception 'Ce document est validé : il ne peut plus être remplacé. Contactez Les Hortensias.';
  end if;

  if new.statut is distinct from old.statut and new.statut not in ('recu', 'a_fournir') then
    raise exception 'Un client ne peut faire passer un document qu''aux statuts "reçu" ou "à fournir" (retrait).';
  end if;

  new.uploaded_by = auth.uid();
  new.uploaded_at = now();

  return new;
end;
$$;

-- 7b) Traçabilité des fichiers : chaque fichier remplacé ou supprimé est archivé
-- dans document_versions (le fichier reste dans le stockage privé : suppression
-- logique). Dates de premier dépôt / dernière version maintenues automatiquement.
create or replace function public.track_document_versions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  v_role := case when auth.uid() is null then 'systeme' when public.current_role_is_admin() then 'admin' else 'client' end;

  if tg_op = 'INSERT' then
    if new.storage_path is not null then
      new.uploaded_at := coalesce(new.uploaded_at, now());
      new.first_uploaded_at := coalesce(new.first_uploaded_at, new.uploaded_at);
    end if;
    return new;
  end if;

  if new.storage_path is distinct from old.storage_path then
    if old.storage_path is not null then
      insert into public.document_versions (document_id, dossier_id, colony_registration_id, type, storage_path, file_name,
        uploaded_at, uploaded_by, statut_final, validated_at, validated_by, motif, archived_by, archived_by_role)
      values (old.id, old.dossier_id, old.colony_registration_id, old.type::text, old.storage_path, old.file_name,
        old.uploaded_at, old.uploaded_by, old.statut::text, old.validated_at, old.validated_by,
        case when new.storage_path is null then (case when v_role = 'client' then 'retrait_client' else 'suppression_admin' end) else 'remplacement' end,
        auth.uid(), v_role);
    end if;
    if new.storage_path is not null then
      new.uploaded_at := now();
      new.first_uploaded_at := coalesce(old.first_uploaded_at, old.uploaded_at, now());
      new.deleted_at := null;
      new.deleted_by := null;
    else
      new.deleted_at := now();
      new.deleted_by := auth.uid();
    end if;
    -- Un nouveau fichier n'hérite jamais de la validation de l'ancien.
    if new.statut is distinct from 'valide' then
      new.validated_at := null;
      new.validated_by := null;
    end if;
  end if;

  -- Réouverture d'un document validé (validé -> autre statut) : la date de
  -- validation précédente est conservée dans l'historique des événements.
  if old.statut = 'valide' and new.statut is distinct from 'valide' and new.dossier_id is not null then
    perform public.insert_bloc_event(new.dossier_id, 'documents', null, 'document_reouvert',
      jsonb_build_object('type', old.type::text, 'file_name', old.file_name, 'validated_at', old.validated_at), null);
    if new.storage_path is not distinct from old.storage_path then
      new.reopened_at := now();
      new.reopened_by := auth.uid();
    end if;
    new.validated_at := null;
    new.validated_by := null;
  end if;

  if new.statut = 'valide' and old.statut is distinct from 'valide' then
    new.validated_at := coalesce(new.validated_at, now());
    new.validated_by := coalesce(new.validated_by, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists documents_track_versions on public.documents;
create trigger documents_track_versions
  before insert or update on public.documents
  for each row execute function public.track_document_versions();

-- 7c) Journal : suppression par l'administration (complète on_document_change,
-- qui ne journalise que les retraits faits par le client).
create or replace function public.on_document_deleted_by_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.storage_path is not null and new.storage_path is null and public.current_role_is_admin() then
    perform public.log_journal(new.dossier_id, 'document_supprime_admin',
      'Document supprimé par l''administration : ' || new.type::text || coalesce(' (' || old.file_name || ')', ''),
      new.colony_registration_id);
  end if;
  return new;
end;
$$;

drop trigger if exists documents_log_admin_delete on public.documents;
create trigger documents_log_admin_delete
  after update on public.documents
  for each row execute function public.on_document_deleted_by_admin();

-- ----------------------------------------------------------
-- 8) Première connexion : mot de passe provisoire à changer obligatoirement
-- ----------------------------------------------------------
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists password_changed_at timestamptz;

-- Tant que le mot de passe provisoire n'a pas été remplacé, le compte n'a accès
-- à AUCUNE donnée de dossier (RLS) — l'obligation n'est pas que visuelle.
create or replace function public.has_dossier_access(check_dossier_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    not exists (select 1 from public.profiles where id = auth.uid() and must_change_password)
    and (
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
      )
    );
$$;

-- Le changement effectif du mot de passe (Supabase Auth) lève l'obligation et
-- active les accès en attente. Le serveur repose le drapeau APRÈS avoir défini
-- un nouveau mot de passe provisoire, donc ce trigger ne le contourne pas.
create or replace function public.on_auth_password_changed()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles
       set must_change_password = false, password_changed_at = now()
     where id = new.id and must_change_password;
    if found then
      update public.dossier_acces
         set statut = 'compte_active', activated_at = coalesce(activated_at, now())
       where profile_id = new.id and statut = 'invitation_envoyee';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_password_changed on auth.users;
create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.on_auth_password_changed();

-- ----------------------------------------------------------
-- 9) Les helpers internes (security definer) ne sont pas appelables via l'API :
-- bloc_snapshot exposerait sinon les données d'un autre dossier.
-- ----------------------------------------------------------
revoke all on function public.bloc_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function public.sejour_label_court(uuid) from public, anon, authenticated;
revoke all on function public.bloc_statut(uuid, text) from public, anon, authenticated;
revoke all on function public.bloc_locked_for_current_user(uuid, text) from public, anon, authenticated;
