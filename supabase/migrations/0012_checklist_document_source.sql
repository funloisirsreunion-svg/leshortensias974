-- Corrige le seeding de la checklist documents pour attribuer le bon
-- document_source dès la création du dossier (au lieu du défaut 'client'
-- pour tous les types).

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

  insert into public.documents (dossier_id, type, statut, document_source)
  select
    new.id, t, 'a_fournir',
    case
      when t in ('devis', 'facture', 'facture_finale', 'programme_sejour', 'document_information', 'autre_admin') then 'admin'
      when t = 'fiche_generee' then 'both'
      else 'client'
    end
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
