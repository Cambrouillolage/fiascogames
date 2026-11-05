-- Date d'un événement de présentation GAV chez un commerçant (ex. journée
-- découverte en boutique) : si renseignée, la carte affiche un encart en
-- haut des filtres annonçant les prochains événements (voir filtersSheet.ts).
-- Non masquée même pour un commerce verrouillé (contrairement à
-- adresse/téléphone/horaires...) : l'événement est une information promue
-- publiquement pour faire venir du monde, pas une donnée d'identification
-- du commerce.
BEGIN;

ALTER TABLE public.clamart_merchants
  ADD COLUMN gav_event_date date;

CREATE OR REPLACE VIEW public.clamart_merchants_public
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  id,
  name,
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
  CASE WHEN is_locked THEN NULL ELSE gav_stock_quantity END AS gav_stock_quantity,
  gav_event_date
FROM public.clamart_merchants
WHERE status = 'active';

-- Même garde-fou réaffirmé à chaque CREATE OR REPLACE VIEW depuis la
-- migration 0011 (Supabase accorde par défaut INSERT/UPDATE/DELETE à
-- anon/authenticated sur toute nouvelle relation du schéma public).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.clamart_merchants_public FROM anon, authenticated;
GRANT SELECT ON public.clamart_merchants_public TO anon, authenticated;

COMMIT;
