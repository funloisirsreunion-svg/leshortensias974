-- ============================================================
-- 0025 — Utilisateurs internes : date d'activation du compte
-- ============================================================
-- staff_invited_at  = date du dernier e-mail d'invitation ACCEPTÉ par le service
--                     d'envoi (jamais mise à jour si l'envoi échoue).
-- staff_activated_at = date à laquelle la personne a défini elle-même son mot de
--                     passe (lien d'invitation / de réinitialisation).

alter table public.profiles add column if not exists staff_activated_at timestamptz;
comment on column public.profiles.staff_activated_at is 'Compte interne : date de définition du premier mot de passe par la personne.';
comment on column public.profiles.staff_invited_at is 'Compte interne : date du dernier e-mail d''invitation accepté par le service d''envoi.';

-- Reprise : comptes internes déjà utilisés (une connexion = mot de passe défini).
update public.profiles p
   set staff_activated_at = coalesce(u.email_confirmed_at, u.last_sign_in_at)
  from auth.users u
 where u.id = p.id and p.role = 'admin' and p.staff_activated_at is null
   and u.last_sign_in_at is not null;

-- Le changement effectif du mot de passe (Supabase Auth) lève l'obligation de
-- changement, active les accès client en attente et date l'activation d'un
-- compte interne.
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
  end if;
  return new;
end;
$$;
