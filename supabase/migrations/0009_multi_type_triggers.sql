-- Triggers adaptés au multi-type (dans une migration séparée de 0008 : Postgres
-- interdit d'utiliser une valeur d'enum tout juste ajoutée par ALTER TYPE ... ADD
-- VALUE dans la même transaction).

-- Checklist documents/régimes adaptée par client_type.
create or replace function public.init_dossier_checklists()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  doc_types document_type[];
  seed_regimes boolean := true;
begin
  if new.client_type = 'school' then
    doc_types := array['devis','devis_signe','attestation_mairie','autre_prise_en_charge','facture','facture_finale','effectif_definitif','regimes_alimentaires','transport','autre']::document_type[];
  elsif new.client_type = 'group' then
    doc_types := array['devis','devis_signe','facture','facture_finale','autre_prise_en_charge','autre']::document_type[];
  elsif new.client_type = 'colony' then
    doc_types := array['fiche_inscription_signee','carnet_vaccination','justificatif_caf','fiche_generee','facture','autre']::document_type[];
    seed_regimes := false;
  else
    doc_types := array['devis','autre']::document_type[];
  end if;

  insert into public.documents (dossier_id, type, statut)
  select new.id, t, 'a_fournir'
  from unnest(doc_types) as t
  on conflict do nothing;

  if seed_regimes then
    insert into public.regimes_alimentaires (dossier_id, type, nombre)
    select new.id, t, 0
    from unnest(enum_range(null::regime_type)) as t
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- Verrou colonnes étendu aux champs Groupe/Colonie (mêmes principes que school :
-- identité, dates, financier et statut = admin uniquement ; effectifs et besoins
-- pratiques = modifiables par le client).
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
     -- Groupe
     or new.structure_nom is distinct from old.structure_nom
     or new.structure_type is distinct from old.structure_type
     or new.demande_date_arrivee is distinct from old.demande_date_arrivee
     or new.demande_heure_arrivee is distinct from old.demande_heure_arrivee
     or new.demande_date_depart is distinct from old.demande_date_depart
     or new.demande_heure_depart is distinct from old.demande_heure_depart
     or new.formule is distinct from old.formule
     or new.estimation_montant is distinct from old.estimation_montant
     -- Colonie
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

  -- Modifiable par le client : niveaux, effectifs (école), nb_adultes/nb_enfants
  -- et besoins_particuliers (groupe), remarques_alimentaires, periode_souhaitee,
  -- premier_repas/dernier_repas/repas_supplementaires_nombre/gouter_* (groupe),
  -- salle_reunion (groupe).
  return new;
end;
$$;
