-- ============================================================
-- 0026 — Commercial / Réservations : accès opérationnel aux colonies
-- ============================================================
-- Le rôle Commercial / Réservations (Luigi) peut remplacer Admin / Opérations
-- (Océane) sur les colonies : consultation et gestion des séjours et des
-- inscriptions enfants. La suppression définitive (fiche enfant, séjour) devient
-- une permission distincte, colonies.delete, que ce rôle n'a PAS.

-- 1) Nouvelle permission de suppression définitive des colonies
insert into public.permissions (code, label, sort_order) values
  ('colonies.delete', 'Colonies : supprimer définitivement (fiche enfant, séjour)', 62)
on conflict (code) do nothing;

-- Admin / Opérations conserve exactement ses droits actuels (Super Admin = '*').
insert into public.role_permissions (role_code, permission) values
  ('admin_operations', 'colonies.delete')
on conflict do nothing;

-- 2) Commercial / Réservations : colonies (consulter + gérer), sans suppression
insert into public.role_permissions (role_code, permission) values
  ('commercial_reservations', 'colonies.read'),
  ('commercial_reservations', 'colonies.manage')
on conflict do nothing;

update public.staff_roles
   set description = 'Classes de découverte, groupes, colonies (gestion opérationnelle), devis, réservations, clients et planning. Pas de gestion des utilisateurs/rôles, ni paramètres techniques, ni suppression définitive.'
 where code = 'commercial_reservations';

-- 3) Suppression définitive réservée à colonies.delete (base + stockage)
drop policy if exists colony_registrations_staff_delete on public.colony_registrations;
create policy colony_registrations_staff_delete on public.colony_registrations as restrictive
  for delete using (not public.staff_lacks('colonies.delete'));

drop policy if exists colony_stays_staff_delete on public.colony_stays;
create policy colony_stays_staff_delete on public.colony_stays as restrictive
  for delete using (not public.staff_lacks('colonies.delete'));

drop policy if exists storage_documents_staff_delete on storage.objects;
create policy storage_documents_staff_delete on storage.objects as restrictive
  for delete using (
    bucket_id <> 'documents-dossiers'
    or not public.staff_lacks('dossiers.delete')
    or (public.is_colony_folder((storage.foldername(name))[1]) and not public.staff_lacks('colonies.delete'))
  );

-- 4) Traçabilité serveur des modifications d'une fiche enfant
-- (le changement de statut reste journalisé par l'écran Admin : pas de doublon).
create or replace function public.on_colony_registration_audit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_labels text[] := '{}';
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  f text;
  i int;
  v_fields text[][] := array[
    ['enfant_nom', 'Nom enfant'], ['enfant_prenom', 'Prénom enfant'],
    ['enfant_date_naissance', 'Date de naissance'], ['enfant_sexe', 'Sexe'],
    ['contact_nom', 'Nom responsable'], ['contact_prenom', 'Prénom responsable'],
    ['contact_telephone', 'Téléphone'], ['contact_email', 'E-mail'],
    ['beneficiaire_vacaf', 'VACAF'], ['numero_allocataire', 'N° allocataire'],
    ['aide_pass_colo', 'Pass Colo'], ['aide_autre', 'Autre aide'],
    ['autorisation_partage_prive', 'Autorisation partage privé'],
    ['autorisation_communication_publique', 'Autorisation communication publique'],
    ['tarif_sejour', 'Tarif'], ['aide_prevue', 'Aide prévue'], ['montant_du', 'Montant dû'],
    ['stay_id', 'Séjour'], ['archived_at', 'Archivage']
  ];
begin
  -- Seules les actions faites par un utilisateur du site sont journalisées ici.
  if auth.uid() is null then return new; end if;
  for i in 1 .. array_length(v_fields, 1) loop
    f := v_fields[i][1];
    if (v_old -> f) is distinct from (v_new -> f) then
      v_changes := v_changes || jsonb_build_object(f, jsonb_build_object('avant', v_old -> f, 'apres', v_new -> f, 'label', v_fields[i][2]));
      v_labels := array_append(v_labels, v_fields[i][2] || ' : ' || coalesce(v_old ->> f, '—') || ' → ' || coalesce(v_new ->> f, '—'));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    insert into public.dossier_journal (colony_registration_id, action, details, changes, actor)
    values (new.id, 'fiche_colonie_modifiee', array_to_string(v_labels, ' ; '), v_changes, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists colony_registrations_on_audit on public.colony_registrations;
create trigger colony_registrations_on_audit
  after update on public.colony_registrations
  for each row execute function public.on_colony_registration_audit();
