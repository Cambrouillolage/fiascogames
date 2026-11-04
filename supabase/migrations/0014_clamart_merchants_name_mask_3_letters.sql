-- Le nom masqué d'un commerce verrouillé affichait seulement ses 2 premières
-- lettres ("Ma****") — passe à 3 ("Mar****"). Le `regexp_replace` qui
-- retire déjà tout caractère non alphanumérique avant de prendre `left(...)`
-- (voir migration 0010) fait qu'un espace dans le nom n'est jamais compté
-- dans ces 3 lettres (ex. "Le Petit Marché" -> "LeP****", pas "Le ****").
BEGIN;

CREATE OR REPLACE VIEW public.clamart_merchants_public
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  id,
  CASE WHEN is_locked
    THEN left(regexp_replace(trim(name), '[^[:alnum:]]', '', 'g'), 3) || '****'
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
  is_locked,
  CASE WHEN is_locked THEN NULL ELSE gav_stock_quantity END AS gav_stock_quantity
FROM public.clamart_merchants
WHERE status = 'active';

-- CREATE OR REPLACE VIEW ne redonne normalement pas les droits par défaut,
-- mais on réaffirme explicitement le même garde-fou que les migrations
-- 0011/0013 (faille corrigée en urgence : Supabase accorde par défaut
-- INSERT/UPDATE/DELETE à anon/authenticated sur toute nouvelle relation du
-- schéma public).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.clamart_merchants_public FROM anon, authenticated;
GRANT SELECT ON public.clamart_merchants_public TO anon, authenticated;

COMMIT;
