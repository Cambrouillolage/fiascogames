-- Ajoute le badge cartoon (pack clamart_badges_cartoon) sélectionnable par
-- commerçant depuis l'admin. Référence libre vers un id du catalogue
-- clamart-app/src/data/badgesClamart.ts (pas de table badges en base : le
-- catalogue est un pack d'images statique, pas une donnée métier).
-- Si null, la carte publique retombe sur le badge "boutique" par défaut
-- (voir BADGE_DEFAULT_ID côté app).

alter table public.clamart_merchants
  add column badge_id text;
