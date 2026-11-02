-- Sécurise l'accès public à clamart_merchants maintenant que des commerces
-- peuvent être verrouillés (is_locked) : le nom complet d'un commerce
-- verrouillé ne doit jamais être récupérable par anon/authenticated via une
-- requête directe sur la table, seulement via cette vue, qui le masque.
BEGIN;

-- L'ancienne policy "public can read active merchants" (migration 0006)
-- exposait TOUTES les colonnes des commerces actifs à anon/authenticated,
-- `name` en clair compris — donc contournable pour un commerce verrouillé
-- en interrogeant directement la table plutôt que l'app. On la retire : la
-- table brute n'est plus lisible publiquement. Seule l'admin
-- (déjà couverte par "admin can read all merchants"/"admin can write
-- merchants", email florian@fiascogames.fr) continue d'y accéder.
DROP POLICY IF EXISTS "public can read active merchants" ON public.clamart_merchants;

-- Défense en profondeur : même si une policy RLS laissait filtrer des
-- lignes à l'avenir, anon n'a de toute façon plus le GRANT de base sur la
-- table (il passe obligatoirement par la vue ci-dessous).
REVOKE SELECT ON public.clamart_merchants FROM anon;

-- Vue "security definer" de fait : une vue normale (security_invoker=false,
-- le défaut PG15+, explicité ici) s'exécute avec les droits de son
-- propriétaire (postgres, propriétaire de la table), qui contourne RLS
-- (bypassrls). Le filtre `status = 'active'` et le masquage de `name` sont
-- donc appliqués explicitement ici, pas hérités d'une policy RLS côté
-- table — c'est le seul filtre qui protège ces données pour le public.
-- security_barrier empêche en plus Postgres de réordonner un filtre client
-- avant les expressions CASE de masquage (attaque par canal auxiliaire).
CREATE OR REPLACE VIEW public.clamart_merchants_public
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  id,
  CASE WHEN is_locked
    THEN left(regexp_replace(trim(name), '[^[:alnum:]]', '', 'g'), 2) || '****'
    ELSE name
  END AS name,
  category_id,
  subcategory_id,
  CASE WHEN is_locked THEN NULL ELSE description END AS description,
  CASE WHEN is_locked THEN NULL ELSE address END AS address,
  CASE WHEN is_locked THEN NULL ELSE postal_code END AS postal_code,
  city,
  lat,
  lon,
  CASE WHEN is_locked THEN NULL ELSE photo_url END AS photo_url,
  status,
  pointer_type,
  badge_icon,
  badge_color,
  badge_id,
  CASE WHEN is_locked THEN NULL ELSE website END AS website,
  CASE WHEN is_locked THEN NULL ELSE phone END AS phone,
  CASE WHEN is_locked THEN NULL ELSE opening_hours END AS opening_hours,
  is_locked
FROM public.clamart_merchants
WHERE status = 'active';

GRANT SELECT ON public.clamart_merchants_public TO anon, authenticated;

COMMIT;
