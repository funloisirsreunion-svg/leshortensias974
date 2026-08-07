-- Le motif de refus doit être obligatoire au niveau base (pas seulement dans
-- l'interface), y compris pour l'admin — c'est une règle d'intégrité des
-- données, pas une règle de permission.

create or replace function public.enforce_document_field_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.statut = 'refuse' and (new.refus_motif is null or btrim(new.refus_motif) = '') then
    raise exception 'Un motif est obligatoire pour refuser un document.';
  end if;

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
