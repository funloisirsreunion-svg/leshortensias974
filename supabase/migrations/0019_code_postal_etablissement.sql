-- Ajoute le code postal de l'établissement pour les dossiers Classe de découverte.
-- Colonne nullable : ne casse rien pour les dossiers existants qui n'ont pas cette
-- information.
alter table public.dossiers add column if not exists code_postal text;

comment on column public.dossiers.code_postal is 'Code postal de l''établissement (Classe de découverte), associé à la commune. Repris automatiquement depuis la demande publique quand renseigné.';
