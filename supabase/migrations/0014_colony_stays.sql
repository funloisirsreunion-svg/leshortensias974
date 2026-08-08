-- Refonte de la gestion des Colonies : introduit le niveau "séjour"
-- (colony_stays) au-dessus des fiches participant. École et Groupe restent
-- inchangés dans `dossiers` (un séjour = un dossier). Pour les colonies,
-- un séjour = plusieurs fiches enfant/famille (colony_registrations, 0015).
--
-- Les familles inscrites en colonie n'ont jamais de compte client (contraire
-- école/groupe) : la RLS de colony_stays est donc admin-only pour l'écriture,
-- + une policy select publique limitée aux séjours "ouverts" (aucune colonne
-- sensible sur cette table, sûr d'exposer la ligne entière aux séjours ouverts,
-- nécessaire pour que le formulaire public liste les séjours sans authentification).

create type colony_stay_statut as enum ('brouillon', 'ouvert', 'ferme', 'termine', 'annule');

create table public.colony_stays (
  id uuid primary key default gen_random_uuid(),

  nom text not null,
  date_debut date,
  date_fin date,
  duree_texte text,

  statut colony_stay_statut not null default 'ouvert',

  tarif_public numeric(10,2),
  tarif_caf_info text,
  age_min int,
  age_max int,
  public_accueilli text,
  description text,
  aides_applicables text,
  infos_generales text,

  -- Purement informatif : jamais utilisé comme limite ni vérifié nulle part
  -- dans le code (demande explicite : pas de capacité maximale bloquante).
  nb_participants_indicatif int,

  archived_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.colony_stays is 'Un séjour de colonie de vacances (ex. "Colonie Octobre 2026"). Niveau principal Admin pour les colonies — regroupe plusieurs fiches participant (colony_registrations).';
comment on column public.colony_stays.nb_participants_indicatif is 'Indicatif uniquement, jamais une limite rigide.';
comment on column public.colony_stays.statut is 'ouvert = sélectionnable dans le formulaire public d''inscription.';

create index colony_stays_statut_idx on public.colony_stays(statut);

create trigger colony_stays_set_updated_at
  before update on public.colony_stays
  for each row execute function public.set_updated_at();

alter table public.colony_stays enable row level security;

create policy colony_stays_admin_all on public.colony_stays
  for all using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

create policy colony_stays_public_select_open on public.colony_stays
  for select using (statut = 'ouvert' and archived_at is null);
