-- 0022 — La revalidation des régimes marque aussi comme traitée l'alerte
-- « INFORMATIONS ALIMENTAIRES MODIFIÉES » (son texte ne contient pas le libellé du bloc).

-- ADMIN : valider un bloc (avec ou sans confirmation client préalable).
create or replace function public.bloc_validate_admin(p_dossier_id uuid, p_bloc text)
returns public.dossier_blocs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dossier_blocs;
  v_type text;
  v_snap jsonb;
begin
  if not public.current_role_is_admin() then
    raise exception 'Action réservée à l''administration.';
  end if;
  if p_bloc not in ('coordonnees', 'devis', 'effectifs', 'regimes') then
    raise exception 'Bloc inconnu : %', p_bloc;
  end if;
  select client_type::text into v_type from public.dossiers where id = p_dossier_id;
  if v_type is distinct from 'school' then
    raise exception 'La validation par blocs concerne uniquement les classes de découverte.';
  end if;

  insert into public.dossier_blocs (dossier_id, bloc) values (p_dossier_id, p_bloc) on conflict do nothing;
  select * into v_row from public.dossier_blocs where dossier_id = p_dossier_id and bloc = p_bloc for update;
  if v_row.statut = 'validated' then
    raise exception 'Ce bloc est déjà validé.';
  end if;

  v_snap := public.bloc_snapshot(p_dossier_id, p_bloc);
  insert into public.dossier_bloc_versions (dossier_id, bloc, version, donnees_validees, admin_validated_at, admin_validated_by)
  values (p_dossier_id, p_bloc, v_row.version, v_snap, now(), auth.uid())
  on conflict (dossier_id, bloc, version) do update
    set donnees_validees = excluded.donnees_validees,
        admin_validated_at = excluded.admin_validated_at,
        admin_validated_by = excluded.admin_validated_by,
        updated_at = now();

  update public.dossier_blocs
     set statut = 'validated', admin_validated_at = now(), admin_validated_by = auth.uid(),
         modification_requested_at = null, modification_requested_by = null, modification_request_message = null,
         updated_at = now()
   where dossier_id = p_dossier_id and bloc = p_bloc
   returning * into v_row;

  perform public.insert_bloc_event(p_dossier_id, p_bloc, v_row.version, 'admin_validated', v_snap, null);
  perform public.log_journal(p_dossier_id, 'bloc_valide', public.bloc_label(p_bloc) || ' (version ' || v_row.version || ')');
  perform public.notify_client(p_dossier_id, 'bloc_valide',
    '🟢 ' || public.bloc_label(p_bloc) || ' validé(e)s par Les Hortensias — ' || public.sejour_label_court(p_dossier_id));

  -- Les notifications Admin "à valider" de ce bloc sont traitées.
  update public.notifications set lu = true
   where audience = 'admin' and dossier_id = p_dossier_id and lu = false
     and (
       (p_bloc = 'regimes' and type = 'regimes_modifies')
       or (type in ('bloc_confirme', 'modification_demandee') and message like '%' || public.bloc_label(p_bloc) || '%')
     );

  return v_row;
end;
$$;

