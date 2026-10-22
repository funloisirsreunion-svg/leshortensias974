-- Import du tableau des réservations 2026-2027 : ajouts uniquement (aucune
-- donnée existante modifiée par cette migration).
--
-- 1) Groupes : effectif total sans répartition adultes/enfants (« 19 P »,
--    « 30 personnes ») et prestations sans hébergement (repas, réception).
-- 2) Clients : drapeau « accès à préparer » (décision manuelle de l'Admin,
--    jamais d'invitation automatique).
-- 3) Traçabilité de l'import : une ligne par ligne du tableau, clé de
--    rapprochement unique (relancer l'import ne recrée rien).

alter table public.dossiers add column if not exists nb_participants int check (nb_participants >= 0);
alter table public.dossiers add column if not exists sans_hebergement boolean not null default false;
comment on column public.dossiers.nb_participants is 'Groupes : effectif total quand la répartition adultes/enfants n''est pas connue. Ignoré si nb_adultes/nb_enfants sont renseignés.';
comment on column public.dossiers.sans_hebergement is 'Prestation sans nuitée (repas, réception, salle) : aucune nuitée comptée au planning.';

alter table public.organizations add column if not exists acces_a_preparer boolean not null default false;
comment on column public.organizations.acces_a_preparer is 'Marqué par l''Admin : un accès client est à créer plus tard. Aucun e-mail envoyé automatiquement.';

create table if not exists public.import_lignes (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  source_file text not null,
  ligne int not null,
  cle text not null,
  libelle text,
  action text not null check (action in ('cree', 'complete', 'aucune', 'protege')),
  dossier_id uuid references public.dossiers(id) on delete set null,
  colony_stay_id uuid references public.colony_stays(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  effectif_brut text,
  changes jsonb not null default '{}'::jsonb,
  anomalies text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (source_file, cle)
);
comment on table public.import_lignes is 'Trace de chaque ligne importée depuis un tableau de réservations (champs créés/modifiés, anciennes et nouvelles valeurs, anomalies à examiner).';
create index if not exists import_lignes_dossier_idx on public.import_lignes (dossier_id);

alter table public.import_lignes enable row level security;
-- Lecture Admin uniquement ; écriture réservée au serveur (service_role).
create policy import_lignes_admin_select on public.import_lignes
  for select using (public.current_role_is_admin());
