-- Correctif urgent : Supabase accorde par défaut TOUS les privilèges
-- (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, pas seulement SELECT)
-- à anon/authenticated sur toute nouvelle relation créée dans le schéma
-- public — la vue clamart_merchants_public (migration 0010) en a hérité
-- sans que ce soit explicité. Comme la vue est "auto-updatable" par
-- Postgres (colonnes non transformées comme is_locked, status, category_id
-- passent telles quelles) et que son propriétaire (postgres) contourne le
-- RLS de la table sous-jacente, un visiteur anonyme pouvait effectivement
-- écrire dans clamart_merchants via cette vue (ex. déverrouiller un
-- commerce lui-même). On ne laisse que SELECT.
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.clamart_merchants_public
  FROM anon, authenticated;

GRANT SELECT ON public.clamart_merchants_public TO anon, authenticated;

COMMIT;
