-- Correctif : les écritures effectuées avec la clé service_role (fonctions
-- /api/admin/*.js, et les triggers internes comme le recalcul de montant_paye)
-- n'ont pas de auth.uid() (pas de session utilisateur), donc étaient à tort
-- bloquées par nos triggers de permission par colonne (enforce_dossier_field_permissions,
-- enforce_document_field_permissions) qui ne reconnaissaient que les admins
-- connectés via un compte. On reconnaît désormais aussi le rôle Postgres
-- 'service_role' comme équivalent admin pour ces vérifications.

create or replace function public.current_role_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(auth.role() = 'service_role', false)
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    );
$$;
