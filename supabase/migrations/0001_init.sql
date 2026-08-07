-- Les Hortensias 974 — Espace Écoles / Admin
-- Migration 0001 : schéma initial (tables, types, triggers)
-- À exécuter dans l'éditeur SQL Supabase (ou via `supabase db push`) sur le projet du site.

create extension if not exists "pgcrypto";

-- ==========================================================
-- Types énumérés
-- ==========================================================

create type user_role as enum ('admin', 'enseignant');

create type programme_type as enum ('nature', 'volcan');

create type dossier_statut as enum (
  'demande_recue',
  'etude',
  'date_proposee',
  'date_validee',
  'devis_envoye',
  'devis_accepte',
  'acompte_attendu',
  'acompte_recu',
  'sejour_confirme',
  'dossier_incomplet',
  'dossier_complet',
  'sejour_en_cours',
  'sejour_termine',
  'facture_envoyee',
  'solde_attendu',
  'solde',
  'cloture',
  'annule'
);

create type document_type as enum (
  'devis',
  'devis_signe',
  'attestation_mairie',
  'autre_prise_en_charge',
  'facture',
  'facture_finale',
  'effectif_definitif',
  'regimes_alimentaires',
  'transport',
  'autre'
);

create type document_statut as enum ('a_fournir', 'recu', 'a_verifier', 'valide', 'non_requis');

create type regime_type as enum ('normal', 'sans_porc', 'vegetarien', 'sans_lactose', 'sans_gluten', 'allergies', 'autre');

-- ==========================================================
-- Table : dossiers (un séjour = un dossier)
-- ==========================================================

create table public.dossiers (
  id uuid primary key default gen_random_uuid(),
  numero text unique not null,

  etablissement text not null,
  commune text,
  adresse text,
  contact_nom text,
  contact_telephone text,
  contact_email text,

  programme programme_type,
  duree int check (duree in (3, 4, 5)),
  periode_souhaitee text,
  date_proposee date,
  date_confirmee_debut date,
  date_confirmee_fin date,

  statut dossier_statut not null default 'demande_recue',

  -- Niveaux scolaires : { "maternelle": 0, "cp": 0, "ce1": 0, "ce2": 0, "cm1": 0, "cm2": 0, "autre": 0 }
  niveaux jsonb not null default '{}'::jsonb,

  effectif_prev_eleves int,
  effectif_prev_profs int,
  effectif_prev_accompagnateurs int,
  effectif_def_eleves int,
  effectif_def_profs int,
  effectif_def_accompagnateurs int,

  remarques_alimentaires text,

  montant_devis numeric(10,2),
  acompte_attendu numeric(10,2),
  acompte_recu numeric(10,2),
  date_acompte date,
  part_mairie_prevue numeric(10,2),
  part_mairie_recue numeric(10,2),
  montant_facture numeric(10,2),
  montant_paye numeric(10,2) not null default 0,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dossiers is 'Un dossier = un séjour classe découverte pour un établissement scolaire';
comment on column public.dossiers.montant_paye is 'Somme calculée à partir de la table paiements (mise à jour par trigger)';

create index dossiers_statut_idx on public.dossiers(statut);
create index dossiers_etablissement_idx on public.dossiers using gin (to_tsvector('french', etablissement));

-- ==========================================================
-- Table : profiles (lié à auth.users, porte le rôle)
-- ==========================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'enseignant',
  full_name text,
  email text,
  dossier_id uuid references public.dossiers(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Un enseignant est rattaché à exactement un dossier (dossier_id). Un admin a dossier_id = null.';

-- ==========================================================
-- Table : regimes_alimentaires
-- ==========================================================

create table public.regimes_alimentaires (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  type regime_type not null,
  nombre int not null default 0 check (nombre >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dossier_id, type)
);

-- ==========================================================
-- Table : documents (checklist par dossier)
-- ==========================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  type document_type not null,
  statut document_statut not null default 'a_fournir',
  storage_path text,
  file_name text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz,
  validated_by uuid references auth.users(id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dossier_id, type)
);

-- ==========================================================
-- Table : paiements
-- ==========================================================

create table public.paiements (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  montant numeric(10,2) not null check (montant > 0),
  type text not null default 'autre', -- acompte | part_mairie | solde | autre
  date_paiement date not null default current_date,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ==========================================================
-- Table : statuts_historique
-- ==========================================================

create table public.statuts_historique (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  ancien_statut dossier_statut,
  nouveau_statut dossier_statut not null,
  note text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

-- ==========================================================
-- Table : taches ("à faire" par dossier — relances, checklist admin)
-- ==========================================================

create table public.taches (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  libelle text not null,
  echeance date,
  statut text not null default 'a_faire' check (statut in ('a_faire', 'fait')),
  created_at timestamptz not null default now()
);

-- ==========================================================
-- Triggers
-- ==========================================================

-- updated_at automatique sur dossiers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger dossiers_set_updated_at
  before update on public.dossiers
  for each row execute function public.set_updated_at();

create trigger regimes_set_updated_at
  before update on public.regimes_alimentaires
  for each row execute function public.set_updated_at();

-- Historisation automatique des changements de statut
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
    values (new.id, null, new.statut, auth.uid());
  end if;
  return new;
end;
$$;

create trigger dossiers_log_statut
  after insert or update on public.dossiers
  for each row execute function public.log_statut_change();

-- Recalcul automatique de montant_paye à partir des paiements
create or replace function public.recalc_montant_paye()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_dossier_id uuid;
begin
  target_dossier_id := coalesce(new.dossier_id, old.dossier_id);
  update public.dossiers
  set montant_paye = coalesce((
    select sum(montant) from public.paiements where dossier_id = target_dossier_id
  ), 0)
  where id = target_dossier_id;
  return null;
end;
$$;

create trigger paiements_recalc_after_change
  after insert or update or delete on public.paiements
  for each row execute function public.recalc_montant_paye();

-- Crée automatiquement les lignes de checklist documents et régimes quand un dossier est créé
create or replace function public.init_dossier_checklists()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.documents (dossier_id, type, statut)
  select new.id, t, 'a_fournir'
  from unnest(enum_range(null::document_type)) as t
  on conflict do nothing;

  insert into public.regimes_alimentaires (dossier_id, type, nombre)
  select new.id, t, 0
  from unnest(enum_range(null::regime_type)) as t
  on conflict do nothing;

  return new;
end;
$$;

create trigger dossiers_init_checklists
  after insert on public.dossiers
  for each row execute function public.init_dossier_checklists();

-- ==========================================================
-- Table : signalements_paiement
-- L'enseignant "signale" un virement effectué ; seul l'admin transforme
-- ce signalement en paiement validé (table paiements).
-- ==========================================================

create table public.signalements_paiement (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  montant numeric(10,2) not null check (montant > 0),
  date_virement date not null default current_date,
  note text,
  statut text not null default 'a_verifier' check (statut in ('a_verifier', 'rapproche', 'ignore')),
  paiement_id uuid references public.paiements(id) on delete set null,
  signale_par uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.signalements_paiement is 'Déclaration côté enseignant : "j''ai fait un virement". L''admin le rapproche ensuite d''un vrai paiement.';
