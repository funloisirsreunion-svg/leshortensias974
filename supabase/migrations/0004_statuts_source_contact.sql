-- Ajoute les statuts nécessaires au workflow "demande publique -> validation admin",
-- une colonne pour distinguer l'origine du dossier, et les champs contact manquants
-- (prénom, fonction, estimation tarifaire indicative) issus du formulaire public.

alter type dossier_statut add value if not exists 'demande_validee' after 'demande_recue';
alter type dossier_statut add value if not exists 'refusee';
alter type dossier_statut add value if not exists 'archivee';

alter table public.dossiers add column if not exists source text not null default 'admin' check (source in ('public', 'admin'));
alter table public.dossiers add column if not exists contact_prenom text;
alter table public.dossiers add column if not exists contact_fonction text;
alter table public.dossiers add column if not exists estimation_tarifaire text;

comment on column public.dossiers.source is 'public = créé via le formulaire de demande de devis du site ; admin = créé directement par Fun Loisirs Réunion';
