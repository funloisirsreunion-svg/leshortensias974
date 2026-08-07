-- Généralise `dossiers` pour porter 3 types de séjours (école / groupe / colonie)
-- au lieu d'un système par type. Choix d'architecture : une seule table `dossiers`
-- avec un discriminant `client_type` + colonnes spécifiques nullables par type,
-- plutôt que des tables `school_details`/`group_details`/`colony_details`
-- séparées : évite de dupliquer RLS/triggers/historique/journal/notifications/
-- documents/paiements (déjà tous génériques, ancrés sur dossier_id) sur 3 jeux de
-- tables. Reste facilement extensible (Erasmus+/Seniors = nouvelle valeur enum +
-- quelques colonnes nullables de plus).

create type client_type as enum ('school', 'group', 'colony');

alter table public.dossiers add column client_type client_type not null default 'school';
comment on column public.dossiers.client_type is 'Type de séjour : school (classe découverte), group (groupe indépendant), colony (colonie de vacances). Extensible (Erasmus+/Seniors...).';

-- ==========================================================
-- Colonnes spécifiques "Groupe indépendant"
-- ==========================================================
alter table public.dossiers add column structure_nom text;
alter table public.dossiers add column structure_type text check (structure_type in (
  'association', 'club_sportif', 'entreprise', 'collectivite', 'famille', 'etablissement', 'organisme_public', 'autre'
));
alter table public.dossiers add column demande_date_arrivee date;
alter table public.dossiers add column demande_heure_arrivee text;
alter table public.dossiers add column demande_date_depart date;
alter table public.dossiers add column demande_heure_depart text;
alter table public.dossiers add column nb_adultes int;
alter table public.dossiers add column nb_enfants int;
alter table public.dossiers add column formule text check (formule in ('pension_complete', 'demi_pension', 'weekend', 'autre'));
alter table public.dossiers add column premier_repas text;
alter table public.dossiers add column dernier_repas text;
alter table public.dossiers add column repas_supplementaires_nombre int;
alter table public.dossiers add column gouter_souhaite boolean;
alter table public.dossiers add column gouter_jours int;
alter table public.dossiers add column salle_reunion boolean;
alter table public.dossiers add column besoins_particuliers text;
alter table public.dossiers add column estimation_montant numeric(10,2);

comment on column public.dossiers.demande_date_arrivee is 'Date souhaitée par le client (demande de disponibilité, jamais une réservation confirmée) — la date qui fait foi reste date_confirmee_debut/fin, saisie par l''admin.';

-- ==========================================================
-- Colonnes spécifiques "Colonie de vacances"
-- ==========================================================
alter table public.dossiers add column enfant_nom text;
alter table public.dossiers add column enfant_prenom text;
alter table public.dossiers add column enfant_date_naissance date;
alter table public.dossiers add column enfant_sexe text;
alter table public.dossiers add column beneficiaire_vacaf boolean;
alter table public.dossiers add column numero_allocataire text;
alter table public.dossiers add column autorisation_partage_prive boolean;
alter table public.dossiers add column autorisation_communication_publique boolean;
alter table public.dossiers add column colonie_nom text;
alter table public.dossiers add column tarif_colonie numeric(10,2);

-- Le contact/responsable légal réutilise les colonnes génériques déjà existantes
-- (contact_nom, contact_prenom, contact_telephone, contact_email) pour les 3 types.

-- ==========================================================
-- Nouveaux types de documents (colonie)
-- ==========================================================
alter type document_type add value if not exists 'fiche_inscription_signee';
alter type document_type add value if not exists 'carnet_vaccination';
alter type document_type add value if not exists 'justificatif_caf';
alter type document_type add value if not exists 'fiche_generee';

comment on column public.documents.type is 'Checklist propre au client_type du dossier — voir init_dossier_checklists().';
