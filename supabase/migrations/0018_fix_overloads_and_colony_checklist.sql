-- Corrige deux bugs révélés par les tests end-to-end de la refonte Colonies :
--
-- 1) 0016 a ajouté un 4e paramètre par défaut à log_journal()/notify() via
--    `create or replace function`, mais Postgres traite une signature avec un
--    paramètre en plus comme une SURCHARGE distincte, pas un remplacement —
--    l'ancienne fonction à 3 paramètres est restée en place à côté de la
--    nouvelle à 4, rendant tout appel à 3 arguments AMBIGU ("is not unique").
--    Cassait la création de dossiers école/groupe (qui appellent log_journal
--    avec 3 arguments). Correction : supprimer explicitement les anciennes
--    signatures à 3 paramètres.
--
-- 2) Aucun trigger ne seedait la checklist documents (fiche_inscription_signee,
--    carnet_vaccination, justificatif_caf, fiche_generee, facture, autre) à la
--    création d'une colony_registrations — oubli dans 0015/0016. Sans ce
--    trigger, les documents déposés à l'inscription publique s'uploadaient
--    bien dans le stockage mais ne pouvaient jamais être rattachés (aucune
--    ligne `documents` à mettre à jour), les rendant invisibles côté Admin.

drop function if exists public.log_journal(uuid, text, text);
drop function if exists public.notify(text, uuid, text);

create or replace function public.init_colony_registration_checklist()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.documents (colony_registration_id, type, statut, document_source)
  select
    new.id, t, 'a_fournir',
    case when t in ('facture') then 'admin' when t = 'fiche_generee' then 'both' else 'client' end
  from unnest(array['fiche_inscription_signee','carnet_vaccination','justificatif_caf','fiche_generee','facture','autre']::document_type[]) as t
  on conflict do nothing;
  return new;
end;
$$;

create trigger colony_registrations_init_checklist
  after insert on public.colony_registrations
  for each row execute function public.init_colony_registration_checklist();
