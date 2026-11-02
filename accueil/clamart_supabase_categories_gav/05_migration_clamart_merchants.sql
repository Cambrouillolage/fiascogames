-- Migration additive pour la table existante public.clamart_merchants.
-- À exécuter APRÈS vérification dans un environnement de test / sauvegarde.
-- Ne remplace pas la création des catégories ni les politiques RLS.
BEGIN;
ALTER TABLE public.clamart_merchants
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS opening_hours text,
  ADD COLUMN IF NOT EXISTS data_source text,
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS gav_stock_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'a_verifier';

-- Vérifier si la contrainte existe avant de l'ajouter.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clamart_merchants_verification_status_check'
      AND conrelid = 'public.clamart_merchants'::regclass
  ) THEN
    ALTER TABLE public.clamart_merchants ADD CONSTRAINT clamart_merchants_verification_status_check
      CHECK (verification_status IN ('a_verifier','verifie','ferme','doublon'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clamart_merchants_locked_idx
  ON public.clamart_merchants (is_locked);
CREATE INDEX IF NOT EXISTS clamart_merchants_source_idx
  ON public.clamart_merchants (data_source, source_ref);
COMMIT;

-- Après validation manuelle du stock GAV :
-- UPDATE public.clamart_merchants
-- SET is_locked = false, gav_stock_confirmed_at = now(), updated_at = now()
-- WHERE id = '<uuid-revendeur>';

-- Exemple de masquage côté serveur pour une requête contrôlée :
-- SELECT id,
--   CASE WHEN is_locked THEN
--     LEFT(regexp_replace(trim(name), '[^[:alnum:]]', '', 'g'), 2) || '****'
--   ELSE name END AS display_name
-- FROM public.clamart_merchants
-- WHERE status = 'active';
-- IMPORTANT : ce SELECT n'est pas une protection si le client peut lire `name`
-- directement. Configurer les grants/RLS et un endpoint public restreint.
