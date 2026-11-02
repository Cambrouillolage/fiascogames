# fiascogames

Site statique (HTML/CSS/JS, sans build) hébergé sur GitHub Pages, domaine `fiascogames.fr`.

## Chat de règles GAV (`gav/video`)

`gav/video/index.html` propose un chat permettant aux visiteurs de poser des
questions sur les règles du jeu GAV. Les réponses sont générées par l'API
Claude (Anthropic) via une Edge Function Supabase qui sert de proxy sécurisé,
et les conversations sont stockées dans une base Postgres pour être relues
depuis `gav/admin/` (accès réservé, protégé par Supabase Auth).

C'est le premier backend de ce repo — il ajoute Docker (pour Supabase en
local) et le CLI Supabase comme prérequis, uniquement pour cette
fonctionnalité. Le reste du site n'a besoin d'aucun outillage.

### Mise en place (une fois)

1. Créer un projet sur [supabase.com](https://supabase.com), récupérer
   l'URL du projet, la clé `anon` et la clé `service_role`.
2. `npx supabase login`, puis `npx supabase link --project-ref <ref>`.
3. Appliquer le schéma : `npx supabase db push` (voir
   `supabase/migrations/0001_gav_chat.sql`).
4. Définir le secret de la fonction :
   `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
   (`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont injectées
   automatiquement dans les Edge Functions, rien à faire).
5. Déployer la fonction : `npx supabase functions deploy gav-chat`.
6. Créer le compte admin unique dans le Dashboard Supabase
   (Authentication → Users → Add user, `florian@fiascogames.fr` +
   mot de passe), puis désactiver les inscriptions publiques
   (Authentication → Settings).
7. Renseigner `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans les deux
   fichiers `<script>` de `gav/video/index.html` et `gav/admin/index.html`
   (constantes en haut du script, marquées `TODO`). Voir `.env.example`.

### Contenu des règles fourni à Claude

Le texte utilisé comme contexte de règles vit dans
`supabase/functions/gav-chat/rules-context.ts` (exporté en constante TS,
plutôt qu'un fichier `.md` lu à l'exécution — un `Deno.readTextFile()` sur
un fichier voisin n'est pas fiable à l'usage, il n'est pas garanti d'être
inclus dans le bundle déployé). **Modifier ce fichier ne suffit pas** pour
que le chat en tienne compte sur le site en ligne — il faut redéployer la
fonction après chaque changement :

```
npx supabase functions deploy gav-chat
```

### Développement local

```bash
npx supabase start                                        # Postgres/Auth/Studio/Edge Runtime (Docker)
npx supabase functions serve gav-chat --env-file supabase/.env.local   # vraie clé Anthropic, coût réel
python3 -m http.server                                     # sert le site statique
```

Studio local : http://localhost:54323. Pointer temporairement
`SUPABASE_URL`/`SUPABASE_ANON_KEY` dans les pages HTML vers l'instance
locale (affichée par `supabase start`) pour tester sans toucher à la prod.

### Sécurité

- La clé `anon` est publique par conception (client Supabase standard) —
  seules la clé Anthropic et la clé `service_role` restent secrètes,
  côté Edge Function uniquement.
- Row Level Security interdit toute lecture des tables `conversations` /
  `messages` sauf au compte `florian@fiascogames.fr` authentifié ; aucune
  policy d'écriture n'existe pour `anon`/`authenticated` — seule la
  fonction (clé `service_role`) écrit.
- `gav/admin/` n'est pas lié dans la navigation et porte
  `noindex,nofollow`, mais ce n'est pas la protection réelle : c'est
  Auth + RLS qui empêchent l'accès aux données.
- L'endpoint de chat est public et non authentifié (nécessaire pour des
  visiteurs anonymes) : des plafonds par conversation et par IP limitent
  l'abus côté fonction, mais une alerte de dépense côté
  [console Anthropic](https://console.anthropic.com/) est recommandée.

## Formulaire boutiques (`shop-contact`)

Le bouton "Boutique" (header/footer de `accueil/index.html`) ouvre une
modale avec un formulaire (nom,
prénom, boutique, email, téléphone). À l'envoi, une Edge Function Supabase
enregistre la demande et envoie deux emails via [Resend](https://resend.com) :
une confirmation à la boutique (depuis `galane@fiascogames.fr`) et une
notification interne à `galane@fiascogames.fr` et `florian@fiascogames.fr`.

Réutilise le même projet Supabase que le chat GAV (mêmes
`SUPABASE_URL`/`SUPABASE_ANON_KEY` déjà en clair dans le HTML).

### Mise en place (une fois)

1. Appliquer le schéma : `npx supabase db push` (voir
   `supabase/migrations/0002_shop_contact.sql`).
2. Créer un compte [Resend](https://resend.com) et **vérifier le domaine
   `fiascogames.fr`** (ajout d'enregistrements DNS SPF/DKIM chez le
   registrar du domaine) — indispensable pour pouvoir envoyer depuis
   `galane@fiascogames.fr`, sinon les emails seront rejetés ou finiront en
   spam.
3. Définir le secret de la fonction :
   `npx supabase secrets set RESEND_API_KEY=re_...`
4. Déployer la fonction : `npx supabase functions deploy shop-contact`.

### Développement local

```bash
npx supabase start                                            # Postgres/Auth/Studio/Edge Runtime (Docker)
npx supabase functions serve shop-contact --env-file supabase/.env.local  # vraie clé Resend, envoi réel
python3 -m http.server                                         # sert le site statique
```

### Sécurité

- Row Level Security interdit toute lecture/écriture directe de
  `shop_requests` par `anon`/`authenticated` — seule la fonction (clé
  `service_role`) y écrit. Pas d'interface d'admin dédiée pour l'instant :
  consultation via le Dashboard Supabase (Table Editor).
- L'endpoint est public et non authentifié (nécessaire pour des visiteurs
  anonymes) : un plafond par IP limite l'abus côté fonction.
- Un échec d'envoi d'email n'empêche pas l'enregistrement de la demande en
  base (l'inverse serait pire : perdre un lead à cause d'un souci
  d'emailing) — surveiller les logs de la fonction en cas de doute sur la
  délivrabilité.

## Annuaire des boutiques (`shop_directory`)

Table publique `public.shop_directory` (voir
`supabase/migrations/0003_shop_directory.sql`, étendue par
`0004_shop_directory_stock.sql`) : boutiques partenaires qui vendent GAV.

**Plus affichée sur `gav/index.html`** depuis la refonte épurée de cette
page (carte nationale + recherche retirées, voir le hero/FAQ actuels) —
la table sert aujourd'hui la page dédiée `gav/clamart/` (carte Leaflet
stylisée + filtre par catégorie + classement des ventes, limitée aux
boutiques de Clamart). Rien n'empêche de rebrancher une vue nationale
ailleurs plus tard, la table et ses données restent intactes.

- **Ajout/modification d'une boutique** : directement dans le Dashboard
  Supabase → Table Editor → `shop_directory`. Colonnes : `name`,
  `address`, `postal_code`, `city`, `latitude`, `longitude` (coordonnées
  GPS à renseigner à la main, ex. via un clic droit → coordonnées sur
  Google Maps), `photo_url`, `website_url`, `is_active` (passer à `false`
  pour masquer une boutique sans la supprimer), plus `category`,
  `stock_quantity`, `units_sold` (éditables aussi depuis la page d'admin
  `gav/admin/shops/`, voir `0004_shop_directory_stock.sql`).
- **Photo** : uploader l'image dans le bucket de stockage public
  `shop-photos` (Dashboard Supabase → Storage), puis copier l'URL
  publique obtenue dans la colonne `photo_url` de la ligne correspondante.
- Contrairement à `shop_requests`, cette table est **lisible publiquement**
  (policy `select` ouverte à `anon` pour les lignes `is_active = true`) :
  c'est nécessaire pour que la carte s'affiche côté visiteur sans
  authentification. Écriture : Dashboard (accès propriétaire) pour les
  champs de base, ou `gav/admin/shops/` (connecté en tant que
  `florian@fiascogames.fr`) pour `category`/`stock_quantity`/`units_sold`.
- Le formulaire "Je suis une boutique" (voir section précédente) est
  séparé de cet annuaire : il recueille des candidatures dans
  `shop_requests`, à valider manuellement avant de les faire apparaître
  dans `shop_directory`.

## Cookies et Google Analytics

- `assets/analytics.js` : gtag/dataLayer + Consent Mode v2 (refusé par
  défaut) + chargement de gtag.js (`G-K4ZG29HP07`) + suivi générique des
  clics (`data-ga-id="..."` sur n'importe quel élément → événement
  `cta_click`). Inclus sur **toutes** les pages suivies, y compris
  `/gav/*`.
- `assets/consent.js` + `assets/vendor/cookieconsent/` (vanilla-cookieconsent,
  auto-hébergé) : le bandeau de consentement lui-même. **Volontairement
  absent des pages `/gav/*`** (`gav/index.html`, `gav/video/index.html`,
  `gav/feuille/index.html`) à la demande de Florian — ces pages suivent
  quand même la fréquentation/les clics via `analytics.js`, mais restent
  en `Consent Mode: denied` par défaut (pings anonymisés, aucun cookie
  `_ga` posé) puisque personne n'y voit d'invite à consentir. Inclus sur
  `accueil/`, `cambrouillolage/`, `cambrouillolage/video/`,
  `mentions-legales.html` et `politique-confidentialite.html`.
- Ordre d'inclusion sur les pages avec bandeau : `analytics.js` d'abord
  (définit `gtag`/`dataLayer`), puis `cookieconsent.css`/`cookieconsent.umd.js`,
  puis `consent.js` (utilise `CookieConsent` et `gtag`, tous deux déjà
  définis).
- `gav/admin/` ne charge ni l'un ni l'autre (page interne).
- Section « Cookies et traceurs » dans `politique-confidentialite.html` —
  texte à relire par Florian avant publication, ce n'est qu'un brouillon
  structurel.
