-- Mécanique de verrouillage GAV pour les commerces de clamart_merchants
-- (découverte ludique : un commerce reste masqué tant qu'il ne propose pas
-- GAV en rayon, déverrouillage manuel après vérification en admin).
-- Additive uniquement — reprend 05_migration_clamart_merchants.sql fourni
-- par l'utilisateur (clamart_supabase_categories_gav/), inchangé.
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
