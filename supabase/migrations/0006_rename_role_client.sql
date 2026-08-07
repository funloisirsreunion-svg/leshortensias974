-- Renomme le rôle 'enseignant' en 'client' (générique : école, groupe ou famille).
-- L'ancienne valeur d'enum reste techniquement définie (Postgres ne permet pas de
-- supprimer facilement une valeur d'enum) mais n'est plus utilisée par le code.
-- Note : l'ajout de la valeur doit être dans une transaction séparée de son
-- utilisation (restriction Postgres) — voir 0007 pour le backfill des données.

alter type user_role add value if not exists 'client';
