-- §10 de la demande multi-dossiers : une notification ne doit jamais rester
-- générique ("Votre document a été validé") — elle doit toujours indiquer
-- quel séjour est concerné (établissement + dates), pour qu'un client avec
-- plusieurs dossiers sache immédiatement lequel est visé sans avoir à ouvrir
-- tous ses accordéons.

create or replace function public.dossier_label(p_dossier_id uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  d record;
  nom text;
  dates text;
begin
  select etablissement, structure_nom, date_confirmee_debut, date_confirmee_fin,
         date_proposee, demande_date_arrivee, demande_date_depart
  into d
  from public.dossiers where id = p_dossier_id;

  if not found then
    return 'Séjour';
  end if;

  nom := coalesce(d.structure_nom, d.etablissement, 'Séjour');

  if d.date_confirmee_debut is not null then
    dates := 'du ' || to_char(d.date_confirmee_debut, 'DD/MM/YYYY')
      || case when d.date_confirmee_fin is not null then ' au ' || to_char(d.date_confirmee_fin, 'DD/MM/YYYY') else '' end;
  elsif d.demande_date_arrivee is not null then
    dates := 'du ' || to_char(d.demande_date_arrivee, 'DD/MM/YYYY')
      || case when d.demande_date_depart is not null then ' au ' || to_char(d.demande_date_depart, 'DD/MM/YYYY') else '' end
      || ' (demandé)';
  elsif d.date_proposee is not null then
    dates := to_char(d.date_proposee, 'DD/MM/YYYY') || ' (proposé)';
  else
    dates := 'dates à préciser';
  end if;

  return nom || ' — séjour ' || dates;
end;
$$;

comment on function public.dossier_label(uuid) is 'Libellé "Établissement — séjour du DD/MM/YYYY au DD/MM/YYYY" réutilisé par toutes les notifications, pour que chaque message identifie sans ambiguïté le dossier concerné (utile dès qu''un client a plusieurs séjours).';

-- ==========================================================
-- Nouvelle demande / accès activé / virement signalé (0005)
-- ==========================================================

create or replace function public.on_dossier_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.source = 'public' then
    perform public.log_journal(new.id, 'demande_creee', 'Nouvelle demande reçue via le site public');
    perform public.notify('nouvelle_demande', new.id, 'Nouvelle demande : ' || public.dossier_label(new.id));
  else
    perform public.log_journal(new.id, 'dossier_cree', 'Dossier créé par l''administrateur');
  end if;
  return new;
end;
$$;

create or replace function public.on_signalement_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.log_journal(new.dossier_id, 'virement_signale', new.montant || ' € le ' || to_char(new.date_virement, 'DD/MM/YYYY'));
  perform public.notify('virement_signale', new.dossier_id, public.dossier_label(new.dossier_id) || ' : virement signalé (' || new.montant || ' €)');
  return new;
end;
$$;

create or replace function public.on_dossier_acces_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.statut = 'compte_active' then
      perform public.log_journal(new.dossier_id, 'acces_ajoute', 'Accès ajouté (compte existant)');
    else
      perform public.log_journal(new.dossier_id, 'invitation_envoyee', null);
    end if;
  elsif tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    if new.statut = 'compte_active' then
      perform public.log_journal(new.dossier_id, 'compte_active', null);
      perform public.notify('compte_active', new.dossier_id, public.dossier_label(new.dossier_id) || ' : le client a activé son compte');
    elsif new.statut = 'desactive' then
      perform public.log_journal(new.dossier_id, 'acces_desactive', null);
    elsif old.statut = 'desactive' then
      perform public.log_journal(new.dossier_id, 'acces_reactive', null);
    end if;
  end if;
  return new;
end;
$$;

-- ==========================================================
-- Documents (0011, adapté colonies par 0016) : dépôt client (audience admin)
-- + ajout/validation/refus (audience client). On reprend ici EXACTEMENT la
-- structure colonie-aware de 0016 (target_dossier / target_colony, XOR
-- dossier_id/colony_registration_id, log_journal/notify à 4 arguments) — la
-- seule différence est l'utilisation de dossier_label() dans les messages
-- côté dossier école/groupe. Les colonies n'ont pas de compte client
-- (cf. commentaire de 0016) : leurs messages restent inchangés.
-- ==========================================================

create or replace function public.on_document_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_admin boolean;
  target_dossier uuid;
  target_colony uuid;
begin
  is_admin := public.current_role_is_admin();
  target_dossier := new.dossier_id;
  target_colony := new.colony_registration_id;

  if tg_op = 'INSERT' then
    if new.storage_path is not null then
      if is_admin then
        perform public.log_journal(target_dossier, 'document_ajoute', 'Ajouté par l''admin : ' || new.type::text, target_colony);
        if new.client_visible and target_dossier is not null then
          perform public.notify_client(target_dossier, 'document_ajoute', public.dossier_label(target_dossier) || ' : nouveau document disponible (' || new.type::text || ')');
        end if;
      else
        perform public.log_journal(target_dossier, 'document_depose', 'Déposé par le client : ' || new.type::text, target_colony);
        if target_dossier is not null then
          perform public.notify('document_depose', target_dossier, public.dossier_label(target_dossier) || ' : document déposé (' || new.type::text || ')');
        else
          perform public.notify('document_depose', target_dossier, 'Document déposé : ' || new.type::text, target_colony);
        end if;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE : nouveau fichier (ajout ou remplacement)
  if new.storage_path is distinct from old.storage_path and new.storage_path is not null then
    if is_admin then
      perform public.log_journal(target_dossier, case when old.storage_path is null then 'document_ajoute' else 'document_remplace' end, 'Par l''admin : ' || new.type::text, target_colony);
      if new.client_visible and target_dossier is not null then
        perform public.notify_client(target_dossier, 'document_ajoute', public.dossier_label(target_dossier) || ' : nouveau document disponible (' || new.type::text || ')');
      end if;
    else
      perform public.log_journal(target_dossier, case when old.storage_path is null then 'document_depose' else 'document_remplace' end, 'Par le client : ' || new.type::text, target_colony);
      if target_dossier is not null then
        perform public.notify('document_depose', target_dossier, public.dossier_label(target_dossier) || ' : document déposé (' || new.type::text || ')');
      else
        perform public.notify('document_depose', target_dossier, 'Document déposé : ' || new.type::text, target_colony);
      end if;
    end if;
  end if;

  -- UPDATE : retrait par le client (redevient "à fournir")
  if new.storage_path is null and old.storage_path is not null and not is_admin then
    perform public.log_journal(target_dossier, 'document_supprime', 'Retiré par le client : ' || new.type::text, target_colony);
  end if;

  -- UPDATE : changement de statut
  if new.statut is distinct from old.statut then
    if new.statut = 'valide' then
      perform public.log_journal(target_dossier, 'document_valide', new.type::text, target_colony);
      if target_dossier is not null then
        perform public.notify_client(target_dossier, 'document_valide', public.dossier_label(target_dossier) || ' : document validé (' || new.type::text || ')');
      end if;
    elsif new.statut = 'refuse' then
      perform public.log_journal(target_dossier, 'document_refuse', new.type::text || coalesce(' — ' || new.refus_motif, ''), target_colony);
      if target_dossier is not null then
        perform public.notify_client(target_dossier, 'document_refuse', public.dossier_label(target_dossier) || ' : document refusé (' || new.type::text || ')' || coalesce(' — ' || new.refus_motif, ''));
      end if;
    elsif new.statut = 'non_requis' and old.statut is distinct from 'non_requis' then
      perform public.log_journal(target_dossier, 'document_non_requis', new.type::text, target_colony);
    elsif old.statut = 'non_requis' and new.statut is distinct from 'non_requis' then
      perform public.log_journal(target_dossier, 'document_requis_again', new.type::text, target_colony);
    end if;
  end if;

  return new;
end;
$$;
