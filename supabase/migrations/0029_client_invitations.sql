-- ============================================================
-- 0029 — Invitations aux espaces clients (Classes de découverte)
-- ============================================================
-- 1) client_invitations : trace de chaque e-mail d'accès envoyé depuis l'Admin
--    (destinataire, séjours concernés, auteur, date, résultat de l'envoi).
--    Le lien d'activation contient un jeton aléatoire dont SEULE l'empreinte
--    SHA-256 est stockée ; aucun mot de passe n'est jamais stocké ni envoyé.
--    Écriture réservée au serveur (service_role), lecture Admin uniquement.
-- 2) Accès explicites : un compte client n'accède qu'aux séjours qui lui ont
--    été ouverts (dossier_acces). L'appartenance à la fiche établissement
--    (organization_users) ne donne plus accès à TOUS les séjours de
--    l'établissement, sauf si l'Admin le décide explicitement
--    (organization_users.acces_tous_sejours).
-- 3) Activation : la définition du mot de passe par l'enseignant (lien reçu)
--    marque l'invitation comme utilisée.

create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  dossier_ids uuid[] not null default '{}',
  -- activation : compte jamais activé (l'enseignant définit son mot de passe)
  -- reinitialisation : compte déjà activé, lien de réinitialisation joint
  -- information : compte déjà activé, aucun lien (connexion habituelle)
  kind text not null check (kind in ('activation', 'reinitialisation', 'information')),
  token_hash text unique,
  expires_at timestamptz,
  statut text not null default 'preparee'
    check (statut in ('preparee', 'envoyee', 'echec', 'utilisee', 'remplacee')),
  error text,
  resend_id text,
  sent_at timestamptz,
  used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
comment on table public.client_invitations is 'E-mails d''accès à l''espace client envoyés depuis l''Admin. Empreinte du jeton uniquement, jamais de mot de passe.';
create index if not exists client_invitations_profile_idx on public.client_invitations (profile_id, created_at desc);
create index if not exists client_invitations_dossiers_idx on public.client_invitations using gin (dossier_ids);

alter table public.client_invitations enable row level security;
drop policy if exists client_invitations_admin_select on public.client_invitations;
create policy client_invitations_admin_select on public.client_invitations
  for select using (public.current_role_is_admin() and auth.uid() is not null);

-- ----------------------------------------------------------
-- 2) Accès explicites par séjour
-- ----------------------------------------------------------
alter table public.organization_users add column if not exists acces_tous_sejours boolean not null default false;
comment on column public.organization_users.acces_tous_sejours is 'Si vrai (décision Admin), le compte voit tous les séjours de l''établissement ; sinon uniquement ceux ouverts dans dossier_acces.';

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
          where d.id = check_dossier_id and ou.profile_id = auth.uid()
            and ou.statut = 'actif' and ou.acces_tous_sejours
        )
        and not exists (
          select 1 from public.dossier_acces
          where dossier_id = check_dossier_id and profile_id = auth.uid() and statut = 'desactive'
        )
      )
    );
$$;

-- ----------------------------------------------------------
-- 3) Activation : définition du mot de passe
-- ----------------------------------------------------------
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
    update public.profiles
       set staff_activated_at = now()
     where id = new.id and role = 'admin' and staff_activated_at is null;
    -- Les liens d'activation / de réinitialisation en cours deviennent inutilisables.
    update public.client_invitations
       set statut = 'utilisee', used_at = now()
     where profile_id = new.id and statut = 'envoyee' and token_hash is not null;
  end if;
  return new;
end;
$$;
