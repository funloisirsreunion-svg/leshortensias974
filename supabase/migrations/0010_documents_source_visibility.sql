-- Documents : source (qui doit fournir), visibilité client, commentaire admin,
-- motif de refus. Dossiers : archivage (distinct de "refusé" et de "supprimé").
-- Notifications : audience (admin ou client).

alter type document_type add value if not exists 'programme_sejour';
alter type document_type add value if not exists 'document_information';
alter type document_type add value if not exists 'autre_admin';
alter type document_statut add value if not exists 'refuse';

alter table public.documents add column document_source text not null default 'client' check (document_source in ('admin', 'client', 'both'));
alter table public.documents add column client_visible boolean not null default true;
alter table public.documents add column commentaire text;
alter table public.documents add column refus_motif text;

comment on column public.documents.document_source is 'Qui est censé fournir ce document : admin (Fun Loisirs), client, ou both (les deux). Modifiable par l''admin.';
comment on column public.documents.client_visible is 'false = document interne, jamais visible ni accessible (storage compris) côté client, même en devinant l''URL.';

alter table public.dossiers add column archived_at timestamptz;
comment on column public.dossiers.archived_at is 'Archivage administratif (distinct du statut "refusee") : dossier conservé mais retiré de la vue active. NULL = actif.';

alter table public.notifications add column audience text not null default 'admin' check (audience in ('admin', 'client'));
comment on column public.notifications.audience is 'admin = visible espace Admin uniquement ; client = visible par les comptes ayant accès au dossier concerné.';

-- ==========================================================
-- Backfill : document_source cohérent pour les documents déjà existants,
-- selon le type (uniquement des valeurs d'enum déjà en place avant cette
-- migration — aucune des 3 nouvelles valeurs n'est utilisée ici).
-- ==========================================================

update public.documents set document_source = 'admin'
where type in ('devis', 'facture', 'facture_finale');

update public.documents set document_source = 'client'
where type in (
  'devis_signe', 'attestation_mairie', 'autre_prise_en_charge', 'effectif_definitif',
  'regimes_alimentaires', 'transport', 'autre',
  'fiche_inscription_signee', 'carnet_vaccination', 'justificatif_caf'
);

update public.documents set document_source = 'both'
where type = 'fiche_generee';
