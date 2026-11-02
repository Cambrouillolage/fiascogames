-- Nombre d'exemplaires de GAV qu'un commerce déverrouillé a en stock,
-- affiché en priorité dans la liste de résultats de la carte publique
-- (commerces débloqués affichés en premier, avec ce nombre). Rempli depuis
-- l'admin, pas automatique : NULL tant que non renseigné (le badge de
-- quantité reste alors simplement masqué côté client).
BEGIN;

ALTER TABLE public.clamart_merchants
  ADD COLUMN IF NOT EXISTS gav_stock_quantity integer;

ALTER TABLE public.clamart_merchants
  ADD CONSTRAINT clamart_merchants_gav_stock_quantity_nonneg
  CHECK (gav_stock_quantity IS NULL OR gav_stock_quantity >= 0);

-- CREATE OR REPLACE VIEW permet d'ajouter une colonne en fin de liste sans
-- casser la vue existante (voir migration 0010 pour le reste du masquage) ;
-- masquée comme les autres champs "intéressants" quand le commerce est
-- verrouillé, cohérent avec le reste du masquage de cette vue.
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
  is_locked,
  CASE WHEN is_locked THEN NULL ELSE gav_stock_quantity END AS gav_stock_quantity
FROM public.clamart_merchants
WHERE status = 'active';

-- CREATE OR REPLACE VIEW ne redonne normalement pas les droits par défaut,
-- mais on réaffirme explicitement le même garde-fou que la migration 0011
-- (faille corrigée en urgence : Supabase accorde par défaut INSERT/UPDATE/
-- DELETE à anon/authenticated sur toute nouvelle relation du schéma public).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.clamart_merchants_public FROM anon, authenticated;
GRANT SELECT ON public.clamart_merchants_public TO anon, authenticated;

COMMIT;
