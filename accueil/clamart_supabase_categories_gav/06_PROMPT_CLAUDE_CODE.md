# Instructions Claude Code — Evolution Supabase Clamart + GAV

Analyse le projet, et AVANT migration inspecte la définition exacte de `public.clamart_categories`, ses colonnes NOT NULL, ses clés étrangères, son RLS et les catégories déjà utilisées. Nous connaissons seulement le CREATE TABLE de `public.clamart_merchants` (colonnes `category_id` et `subcategory_id` sont des TEXT référençant `clamart_categories(id)`). Ne recrée ni ne supprime les tables existantes, et ne change pas les IDs déjà référencés sans migration de leurs références.

## 1. Taxonomie

Importe la taxonomie depuis `01_categories_principales.csv`, `02_sous_categories.csv` et `03_catalogue_hierarchique.csv`. Si `clamart_categories` contient déjà une hiérarchie par `parent_id`, réutilise-la ; sinon ajoute de façon non destructive un lien parent/enfant adapté à sa structure, ou propose une table `clamart_subcategories` si c'est plus simple. Les IDs de sous-catégories et `badge_id` sont fondés sur les assets réels ; garde-les stables. Préviens tout orphelin, impose qu'une sous-catégorie appartienne à la catégorie parente sélectionnée. Prévois le classement, les sous-filtres futurs et les labels accentués à l'écran, mais des slugs ASCII en base.

## 2. Marchands

Applique en test `05_migration_clamart_merchants.sql` après sauvegarde et audit. Champ `is_locked` obligatoire, booléen, `DEFAULT true`. Les établissements publics et repères non commerciaux (mairie, parc, église, mosquée, écoles publiques, hôpital, gare, etc.) seront importés `is_locked=false` après vérification du type de lieu ; les commerces seront importés verrouillés par défaut. Déverrouillage manuel dans l'administration seulement après confirmation de la disponibilité de GAV. Ajoute dans l'admin le filtre verrouillé/déverrouillé et l'action Déverrouiller. Le champ `gav_stock_confirmed_at` trace l'action.

## 3. Affichage de l'annuaire et de la carte

Verrouillé : afficher uniquement les deux premières lettres alphanumériques du nom suivies de 4 étoiles fixes (ex. `La****`), le métier et le badge cartoon éventuellement surmonté d'un petit cadenas, le statut `Commerce à débloquer`. Ne pas afficher le nom complet, la photo portant une enseigne, le site, le téléphone ou une adresse permettant une identification immédiate. Si afficher une localisation précise rend le masquage trompeur, choisir une position approximative / un repère de zone clairement identifié comme tel, ou assumer que le verrouillage est uniquement ludique et ne promet pas de confidentialité. Déverrouillé : nom complet, description, photo, adresse, site, itinéraire et badge `Revendeur GAV`.

Ne masque pas simplement le nom dans React. Sers au public des données filtrées et masquées par un endpoint serveur / RPC sécurisé, en contrôlant précisément les droits. Vérifie la politique RLS et les GRANT sur la table brute ; `anon` et les utilisateurs ordinaires ne doivent pas pouvoir récupérer le nom complet des fiches verrouillées via une requête directe. Tester aussi recherche, export CSV, suggestions et liens images.

## 4. Gestion des données

En CSV, ne pas insérer `id`, `created_at`, `updated_at` : la base a des valeurs par défaut. Importer les catégories avant les marchands, puisque les deux colonnes de catégorie ont des FK. Traçabilité de source, date de vérification, dédoublonnage, pas de commerces fictifs. Le fichier `04_MODELE_commerces_A_REMPLIR.csv` a zéro ligne d'établissements : c'est volontaire. Les données de vrais commerçants seront collectées et vérifiées séparément. Pour les badges, les deux fichiers de pack d'assets sont dans le dossier de travail de l'utilisateur ; vérifier les chemins exacts avant de les lier.

Commence par exposer un plan de migration, une vérification des conflits et le schéma actuel. Procède ensuite sans casser l'existant, puis fournis un récapitulatif des colonnes et tests (FK, RLS, masquage, unlock, import). Ne change pas en masse le statut de commerces déjà déverrouillés sans confirmation.
