-- Exécuté une seule fois, à la création du volume MySQL.
-- Prisma Migrate a besoin de créer une base temporaire ("shadow database")
-- pour comparer les schémas : l'utilisateur de développement doit pouvoir
-- créer et supprimer des bases. Accès limité à la machine locale (port lié à 127.0.0.1).
GRANT ALL PRIVILEGES ON *.* TO 'agency'@'%';
FLUSH PRIVILEGES;
