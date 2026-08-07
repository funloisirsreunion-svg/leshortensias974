-- Les Hortensias 974 — Espace Écoles / Admin
-- Migration 0002 : Row Level Security (rôles admin / enseignant)
--
-- Principe : un enseignant ne doit JAMAIS pouvoir lire ou modifier un dossier
-- autre que le sien. Il ne doit jamais pouvoir modifier une date, un montant,
-- un statut, ou valider un document / paiement.
-- Ces règles sont vérifiées à deux niveaux :
--   1) RLS (quelles LIGNES sont visibles / modifiables)
--   2) Triggers BEFORE UPDATE (quelles COLONNES sont modifiables selon le rôle)

-- ==========================================================
-- Fonction utilitaire : rôle de l'utilisateur courant
-- (security definer + search_path fixe pour éviter la récursion RLS sur profiles)
-- ==========================================================

create or replace function public.current_role_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_dossier_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select dossier_id from public.profiles where id = auth.uid();
$$;

-- ==========================================================
-- Activation RLS sur toutes les tables
-- ==========================================================

alter table public.profiles enable row level security;
alter table public.dossiers enable row level security;
alter table public.regimes_alimentaires enable row level security;
alter table public.documents enable row level security;
alter table public.paiements enable row level security;
alter table public.statuts_historique enable row level security;
alter table public.taches enable row level security;
alter table public.signalements_paiement enable row level security;

-- ==========================================================
-- profiles
-- ==========================================================

create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.current_role_is_admin());

create policy profiles_update_admin_only on public.profiles
  for update using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

-- Pas de policy insert/delete : la création de comptes enseignant passe
-- exclusivement par la fonction serveur api/admin/create-teacher.js
-- (clé service_role, qui contourne RLS).

-- ==========================================================
-- dossiers
-- ==========================================================

create policy dossiers_select on public.dossiers
  for select using (
    public.current_role_is_admin()
    or id = public.current_dossier_id()
  );

create policy dossiers_insert_admin_only on public.dossiers
  for insert with check (public.current_role_is_admin());

create policy dossiers_update on public.dossiers
  for update using (
    public.current_role_is_admin()
    or id = public.current_dossier_id()
  )
  with check (
    public.current_role_is_admin()
    or id = public.current_dossier_id()
  );

create policy dossiers_delete_admin_only on public.dossiers
  for delete using (public.current_role_is_admin());

-- Verrou colonnes : un enseignant ne peut modifier que niveaux, effectifs,
-- remarques_alimentaires. Toute autre colonne (dates, montants, statut,
-- numero, coordonnées...) est réservée à l'admin.
create or replace function public.enforce_dossier_field_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.current_role_is_admin() then
    return new;
  end if;

  if new.numero is distinct from old.numero
     or new.etablissement is distinct from old.etablissement
     or new.commune is distinct from old.commune
     or new.adresse is distinct from old.adresse
     or new.contact_nom is distinct from old.contact_nom
     or new.contact_telephone is distinct from old.contact_telephone
     or new.contact_email is distinct from old.contact_email
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
  then
    raise exception 'Modification non autorisée : seul un administrateur peut modifier ces champs du dossier.';
  end if;

  -- Un enseignant peut modifier : periode_souhaitee, niveaux, effectifs (prev/def), remarques_alimentaires
  return new;
end;
$$;

create trigger dossiers_enforce_field_permissions
  before update on public.dossiers
  for each row execute function public.enforce_dossier_field_permissions();

-- ==========================================================
-- regimes_alimentaires
-- ==========================================================

create policy regimes_select on public.regimes_alimentaires
  for select using (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  );

create policy regimes_update on public.regimes_alimentaires
  for update using (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  )
  with check (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  );

create policy regimes_insert_admin_only on public.regimes_alimentaires
  for insert with check (public.current_role_is_admin());

create policy regimes_delete_admin_only on public.regimes_alimentaires
  for delete using (public.current_role_is_admin());

-- ==========================================================
-- documents
-- ==========================================================

create policy documents_select on public.documents
  for select using (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  );

create policy documents_update on public.documents
  for update using (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  )
  with check (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  );

create policy documents_insert_admin_only on public.documents
  for insert with check (public.current_role_is_admin());

create policy documents_delete_admin_only on public.documents
  for delete using (public.current_role_is_admin());

-- Un enseignant qui dépose un fichier ne peut faire passer le statut qu'à
-- 'recu', ne peut jamais valider lui-même, ni toucher validated_by/validated_at.
create or replace function public.enforce_document_field_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.current_role_is_admin() then
    return new;
  end if;

  if new.validated_by is distinct from old.validated_by
     or new.validated_at is distinct from old.validated_at
  then
    raise exception 'Seul un administrateur peut valider un document.';
  end if;

  if new.statut is distinct from old.statut and new.statut not in ('recu') then
    raise exception 'Un enseignant ne peut faire passer un document qu''au statut "reçu".';
  end if;

  new.uploaded_by = auth.uid();
  new.uploaded_at = now();

  return new;
end;
$$;

create trigger documents_enforce_field_permissions
  before update on public.documents
  for each row execute function public.enforce_document_field_permissions();

-- ==========================================================
-- paiements — administrateur uniquement (aucun accès enseignant)
-- ==========================================================

create policy paiements_admin_only on public.paiements
  for all using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

-- ==========================================================
-- statuts_historique — lecture seule pour l'enseignant (son dossier),
-- écriture réservée au trigger (security definer) donc pas de policy insert.
-- ==========================================================

create policy statuts_historique_select on public.statuts_historique
  for select using (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  );

-- ==========================================================
-- taches — visibles par l'enseignant concerné, gérées par l'admin
-- ==========================================================

create policy taches_select on public.taches
  for select using (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  );

create policy taches_write_admin_only on public.taches
  for insert with check (public.current_role_is_admin());

create policy taches_update_admin_only on public.taches
  for update using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

create policy taches_delete_admin_only on public.taches
  for delete using (public.current_role_is_admin());

-- ==========================================================
-- signalements_paiement — l'enseignant peut créer/voir les siens,
-- l'admin voit tout et les rapproche.
-- ==========================================================

create policy signalements_select on public.signalements_paiement
  for select using (
    public.current_role_is_admin()
    or dossier_id = public.current_dossier_id()
  );

create policy signalements_insert on public.signalements_paiement
  for insert with check (
    (public.current_role_is_admin() or dossier_id = public.current_dossier_id())
    and signale_par = auth.uid()
  );

create policy signalements_update_admin_only on public.signalements_paiement
  for update using (public.current_role_is_admin())
  with check (public.current_role_is_admin());

-- ==========================================================
-- Storage : bucket privé "documents-dossiers"
-- Convention de chemin : <dossier_id>/<type_document>/<nom_fichier>
-- ==========================================================

insert into storage.buckets (id, name, public)
values ('documents-dossiers', 'documents-dossiers', false)
on conflict (id) do nothing;

create policy storage_documents_select on storage.objects
  for select using (
    bucket_id = 'documents-dossiers'
    and (
      public.current_role_is_admin()
      or (storage.foldername(name))[1] = public.current_dossier_id()::text
    )
  );

create policy storage_documents_insert on storage.objects
  for insert with check (
    bucket_id = 'documents-dossiers'
    and (
      public.current_role_is_admin()
      or (storage.foldername(name))[1] = public.current_dossier_id()::text
    )
  );

create policy storage_documents_delete_admin_only on storage.objects
  for delete using (
    bucket_id = 'documents-dossiers'
    and public.current_role_is_admin()
  );
