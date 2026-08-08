-- Fiche participant (enfant/famille) rattachée à un colony_stays.
-- Remplace l'ancien modèle où chaque inscription colonie créait sa propre
-- ligne `dossiers` (client_type='colony'). Aucun accès client (les familles
-- colonie n'ont jamais de compte) : RLS admin-only pour tout.

create type colony_registration_statut as enum (
  'demande_recue',
  'a_verifier',
  'dossier_incomplet',
  'dossier_complet',
  'paiement_partiel',
  'paiement_complet',
  'confirmee',
  'annulee'
);

create table public.colony_registrations (
  id uuid primary key default gen_random_uuid(),
  numero text unique not null,
  stay_id uuid not null references public.colony_stays(id) on delete restrict,

  source text not null default 'public' check (source in ('public', 'admin')),

  enfant_nom text,
  enfant_prenom text,
  enfant_date_naissance date,
  enfant_sexe text,

  contact_nom text,
  contact_prenom text,
  contact_telephone text,
  contact_email text,

  beneficiaire_vacaf boolean,
  numero_allocataire text,
  aide_pass_colo boolean,
  aide_autre text,

  autorisation_partage_prive boolean,
  autorisation_communication_publique boolean,

  tarif_sejour numeric(10,2),
  aide_prevue numeric(10,2) not null default 0,
  montant_du numeric(10,2),
  montant_paye numeric(10,2) not null default 0,

  statut colony_registration_statut not null default 'demande_recue',

  archived_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.colony_registrations is 'Fiche enfant/famille rattachée à un séjour colonie (colony_stays). Aucun compte client associé.';
comment on column public.colony_registrations.montant_paye is 'Somme calculée à partir de la table paiements (mise à jour par trigger, comme dossiers.montant_paye).';

create index colony_registrations_stay_id_idx on public.colony_registrations(stay_id);
create index colony_registrations_statut_idx on public.colony_registrations(statut);
create index colony_registrations_search_idx on public.colony_registrations
  using gin (to_tsvector('french',
    coalesce(enfant_nom, '') || ' ' || coalesce(enfant_prenom, '') || ' ' ||
    coalesce(contact_nom, '') || ' ' || coalesce(contact_prenom, '')
  ));

create trigger colony_registrations_set_updated_at
  before update on public.colony_registrations
  for each row execute function public.set_updated_at();

alter table public.colony_registrations enable row level security;

create policy colony_registrations_admin_all on public.colony_registrations
  for all using (public.current_role_is_admin())
  with check (public.current_role_is_admin());
