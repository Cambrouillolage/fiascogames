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
