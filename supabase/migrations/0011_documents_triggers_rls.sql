-- Triggers documents (journal + notifications bidirectionnelles admin/client),
-- verrouillage des nouveaux champs, RLS de visibilité (table + storage),
-- notifications client, protection de l'archivage.

-- ==========================================================
-- Notification à destination du client (audience='client')
-- ==========================================================

create or replace function public.notify_client(p_dossier_id uuid, p_type text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (type, dossier_id, message, audience)
  values (p_type, p_dossier_id, p_message, 'client');
end;
$$;

-- ==========================================================
-- Trigger unifié sur documents : journal + notifications, à l'ajout,
-- au remplacement, à la validation, au refus, et aux bascules non_requis.
-- Remplace on_document_recu (0005), attaché désormais sur INSERT et UPDATE.
-- ==========================================================

drop trigger if exists documents_on_recu on public.documents;
drop function if exists public.on_document_recu();

create or replace function public.on_document_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_admin boolean;
begin
  is_admin := public.current_role_is_admin();

  if tg_op = 'INSERT' then
    if new.storage_path is not null then
      if is_admin then
        perform public.log_journal(new.dossier_id, 'document_ajoute', 'Ajouté par l''admin : ' || new.type::text);
        if new.client_visible then
          perform public.notify_client(new.dossier_id, 'document_ajoute', 'Nouveau document disponible : ' || new.type::text);
        end if;
      else
        perform public.log_journal(new.dossier_id, 'document_depose', 'Déposé par le client : ' || new.type::text);
        perform public.notify('document_depose', new.dossier_id, 'Document déposé : ' || new.type::text);
      end if;
    end if;
    return new;
  end if;

  -- UPDATE : nouveau fichier (ajout ou remplacement)
  if new.storage_path is distinct from old.storage_path and new.storage_path is not null then
    if is_admin then
      perform public.log_journal(new.dossier_id, case when old.storage_path is null then 'document_ajoute' else 'document_remplace' end, 'Par l''admin : ' || new.type::text);
      if new.client_visible then
        perform public.notify_client(new.dossier_id, 'document_ajoute', 'Nouveau document disponible : ' || new.type::text);
      end if;
    else
      perform public.log_journal(new.dossier_id, case when old.storage_path is null then 'document_depose' else 'document_remplace' end, 'Par le client : ' || new.type::text);
      perform public.notify('document_depose', new.dossier_id, 'Document déposé : ' || new.type::text);
    end if;
  end if;

  -- UPDATE : retrait par le client (redevient "à fournir")
  if new.storage_path is null and old.storage_path is not null and not is_admin then
    perform public.log_journal(new.dossier_id, 'document_supprime', 'Retiré par le client : ' || new.type::text);
  end if;

  -- UPDATE : changement de statut
  if new.statut is distinct from old.statut then
    if new.statut = 'valide' then
      perform public.log_journal(new.dossier_id, 'document_valide', new.type::text);
      perform public.notify_client(new.dossier_id, 'document_valide', 'Document validé : ' || new.type::text);
    elsif new.statut = 'refuse' then
      perform public.log_journal(new.dossier_id, 'document_refuse', new.type::text || coalesce(' — ' || new.refus_motif, ''));
      perform public.notify_client(new.dossier_id, 'document_refuse', 'Document refusé : ' || new.type::text || coalesce(' — ' || new.refus_motif, ''));
    elsif new.statut = 'non_requis' and old.statut is distinct from 'non_requis' then
      perform public.log_journal(new.dossier_id, 'document_non_requis', new.type::text);
    elsif old.statut = 'non_requis' and new.statut is distinct from 'non_requis' then
      perform public.log_journal(new.dossier_id, 'document_requis_again', new.type::text);
    end if;
  end if;

  return new;
end;
$$;

create trigger documents_on_change
  after insert or update on public.documents
  for each row execute function public.on_document_change();

-- ==========================================================
-- Verrouillage étendu des colonnes documents (admin uniquement),
-- + protection du contenu une fois validé, + documents "admin" jamais
-- modifiables par le client.
-- ==========================================================

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
     or new.document_source is distinct from old.document_source
     or new.client_visible is distinct from old.client_visible
     or new.refus_motif is distinct from old.refus_motif
  then
    raise exception 'Seul un administrateur peut modifier ces champs du document.';
  end if;

  if old.document_source = 'admin' then
    raise exception 'Ce document est fourni par Fun Loisirs Réunion : vous ne pouvez pas le modifier.';
  end if;

  if old.statut = 'valide' and (
    new.storage_path is distinct from old.storage_path
    or new.file_name is distinct from old.file_name
    or new.statut is distinct from old.statut
  ) then
    raise exception 'Ce document est déjà validé : contactez Fun Loisirs Réunion pour le remplacer.';
  end if;

  if new.statut is distinct from old.statut and new.statut not in ('recu', 'a_fournir') then
    raise exception 'Un client ne peut faire passer un document qu''aux statuts "reçu" ou "à fournir" (retrait).';
  end if;

  new.uploaded_by = auth.uid();
  new.uploaded_at = now();

  return new;
end;
$$;

-- ==========================================================
-- documents : le client ne voit jamais les documents internes
-- (client_visible = false), même l'admin bypass via current_role_is_admin().
-- ==========================================================

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select using (
    public.current_role_is_admin()
    or (public.has_dossier_access(dossier_id) and client_visible = true)
  );

-- ==========================================================
-- storage.objects : même protection appliquée au fichier lui-même — un
-- client ne peut pas obtenir d'URL signée pour un document interne même en
-- devinant le chemin, car l'accès dépend désormais aussi de client_visible.
-- ==========================================================

drop policy if exists storage_documents_select on storage.objects;
create policy storage_documents_select on storage.objects
  for select using (
    bucket_id = 'documents-dossiers'
    and (
      public.current_role_is_admin()
      or (
        public.has_dossier_access(((storage.foldername(name))[1])::uuid)
        and exists (
          select 1 from public.documents d
          where d.storage_path = storage.objects.name and d.client_visible = true
        )
      )
    )
  );

-- ==========================================================
-- notifications : le client voit ses propres notifications (audience=client,
-- dossier accessible) et peut uniquement les marquer comme lues.
-- ==========================================================

create policy notifications_client_select on public.notifications
  for select using (
    audience = 'client' and dossier_id is not null and public.has_dossier_access(dossier_id)
  );

create policy notifications_client_mark_read on public.notifications
  for update using (
    audience = 'client' and dossier_id is not null and public.has_dossier_access(dossier_id)
  )
  with check (
    audience = 'client' and dossier_id is not null and public.has_dossier_access(dossier_id)
  );

-- ==========================================================
-- dossiers : archived_at réservé à l'admin (même verrou que les autres
-- champs sensibles).
-- ==========================================================

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
     or new.client_type is distinct from old.client_type
     or new.archived_at is distinct from old.archived_at
     or new.etablissement is distinct from old.etablissement
     or new.commune is distinct from old.commune
     or new.adresse is distinct from old.adresse
     or new.contact_nom is distinct from old.contact_nom
     or new.contact_prenom is distinct from old.contact_prenom
     or new.contact_fonction is distinct from old.contact_fonction
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
