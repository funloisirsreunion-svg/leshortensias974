-- Précisions demandées après 0014 :
-- 1) public_registration_open, distinct du statut (cycle de vie), pilote seul
--    la visibilité publique — avec double verrou : jamais visible si
--    statut = 'annule', même si public_registration_open est resté à true.
-- 2) slug unique anti-doublon.

alter table public.colony_stays add column public_registration_open boolean not null default false;
alter table public.colony_stays add column slug text;

comment on column public.colony_stays.public_registration_open is 'Pilote seul la visibilité dans le formulaire public (indépendant du statut = cycle de vie). Un séjour peut être fermé aux inscriptions sans être terminé ni annulé.';
comment on column public.colony_stays.slug is 'Identifiant texte unique anti-doublon (dérivé du nom, généré côté application).';

-- Backfill du séjour déjà créé (Colonie d'Octobre 2026) : slug + ouverture publique.
update public.colony_stays
set slug = 'colonie-d-octobre-2026', public_registration_open = true
where nom = 'Colonie d''Octobre 2026 — 11 au 22 oct.' and slug is null;

-- Filet de sécurité si le nom ne correspondait pas exactement (autre libellé déjà en place) :
-- attribue un slug généré à toute ligne qui n'en aurait pas encore.
update public.colony_stays
set slug = 'sejour-' || substr(id::text, 1, 8)
where slug is null;

alter table public.colony_stays alter column slug set not null;
alter table public.colony_stays add constraint colony_stays_slug_key unique (slug);

-- Remplace la policy publique : double verrou public_registration_open + statut <> 'annule'
-- (une colonie annulée ne doit jamais apparaître publiquement même si
-- public_registration_open est resté à true par erreur).
drop policy if exists colony_stays_public_select_open on public.colony_stays;
create policy colony_stays_public_select_open on public.colony_stays
  for select using (
    public_registration_open = true
    and statut <> 'annule'
    and archived_at is null
  );

-- ==========================================================
-- 3) Wording de notification précisé : "Nouvelle inscription — <séjour>"
-- avec enfant/responsable/statut, jamais "Nouveau séjour".
-- ==========================================================

create or replace function public.on_colony_registration_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  stay_nom text;
  enfant_label text;
  resp_label text;
begin
  select nom into stay_nom from public.colony_stays where id = new.stay_id;
  enfant_label := trim(coalesce(new.enfant_prenom, '') || ' ' || coalesce(new.enfant_nom, ''));
  if enfant_label = '' then enfant_label := new.numero; end if;
  resp_label := trim(coalesce(new.contact_prenom, '') || ' ' || coalesce(new.contact_nom, ''));

  if new.source = 'public' then
    perform public.log_journal(null, 'inscription_creee', 'Nouvelle inscription reçue via le site public', new.id);
    perform public.notify(
      'nouvelle_inscription_colonie',
      null,
      'Nouvelle inscription — ' || coalesce(stay_nom, 'séjour') || ' : ' || enfant_label
        || case when resp_label <> '' then ' (responsable : ' || resp_label || ')' else '' end
        || ' — statut : ' || new.statut::text,
      new.id
    );
  else
    perform public.log_journal(null, 'inscription_creee_admin', 'Fiche créée par l''administrateur', new.id);
  end if;
  return new;
end;
$$;
