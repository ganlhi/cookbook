# Cookbook — Recettes

Index de recettes de cuisine : références vers vos livres (titre + page) ou recettes complètes en Markdown. **PWA locale** — pas de serveur applicatif, et par défaut aucune donnée ne quitte l'appareil ; la synchronisation Google Drive est facultative et passe directement de l'app à votre Drive.

## Fonctionnalités

- Deux types de recettes : référence livre (titre, ingrédients, livre + page) ou recette complète (instructions Markdown rendues)
- Recherche floue sur le titre (insensible aux accents), filtres multi-ingrédients
- Auto-complétion des livres et ingrédients déjà saisis
- Export/import de tout ou partie des recettes en un fichier JSON (`recettes.cookbook.json`), interopérable avec l'app iOS native archivée sur la branche [`ios-app`](../../tree/ios-app)
- Synchronisation optionnelle entre appareils via Google Drive (voir plus bas)
- Hors-ligne complet (service worker), thème clair/sombre, iPhone/iPad/desktop

## Développement local

Aucun build, aucune dépendance :

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Tests de la logique métier :

```bash
node --test
```

## Déploiement

N'importe quel hébergeur statique en HTTPS. Avec GitHub Pages : Settings → Pages → Deploy from branch → `main`, dossier `/ (root)`.

Après chaque modification déployée, incrémenter `CACHE_NAME` dans [sw.js](sw.js). Le service worker
sert le réseau en priorité (cache en repli hors-ligne) et l'app se recharge d'elle-même quand une
nouvelle version prend la main, donc un appareil connecté se met à jour au lancement suivant.

## Installation sur iPhone / iPad

1. Ouvrir l'URL dans Safari
2. Bouton Partager → **« Sur l'écran d'accueil »**
3. L'app s'ouvre en plein écran et fonctionne hors-ligne

Les données vivent dans le navigateur (IndexedDB). Sans synchronisation, pensez à faire un export JSON de temps en temps en guise de sauvegarde.

## Synchronisation Google Drive

Chaque appareil lit et réécrit un unique fichier `recettes.cookbook.json` dans votre Drive.
La fusion se fait **par recette** : la version la plus récemment modifiée gagne, et les
suppressions se propagent (elles laissent une trace qui est oubliée au bout de 90 jours).
Rien ne transite par un serveur tiers — les appels vont du navigateur à l'API Google.

L'app utilise le scope `drive.file` : elle ne voit **que** le fichier qu'elle a créé, jamais
le reste de votre Drive.

### Configuration (une fois)

L'app n'embarque pas d'identifiant OAuth — il est propre à votre déploiement, et il faut
donc en créer un :

1. [console.cloud.google.com](https://console.cloud.google.com) → créer un projet
2. **API et services → Bibliothèque** → activer **Google Drive API**
3. **Écran de consentement OAuth** → type « Externe », renseigner nom et e-mail. Laisser la
   publication en « Test » et s'ajouter comme utilisateur test suffit pour un usage personnel
4. **Identifiants → Créer → ID client OAuth → Application Web** :
   - *Origines JavaScript autorisées* : `https://<vous>.github.io` et `http://localhost:8000`
   - *URI de redirection autorisés* : `https://<vous>.github.io/<repo>/` et `http://localhost:8000/`
     (l'URL exacte de l'app, barre oblique finale comprise)
5. Dans l'app : menu `⋯` → **Synchronisation…** → coller l'ID client, puis **Synchroniser**

L'ID client n'est pas un secret (il est visible dans l'URL d'autorisation) ; il est stocké
localement sur l'appareil, comme le reste des paramètres.

### Limites

Sans serveur, l'app ne peut pas obtenir de jeton de rafraîchissement : l'autorisation Google
dure une heure. Au-delà, la synchronisation reprend au premier appui sur « Synchroniser » —
un aller-retour vers Google généralement instantané, puisque le consentement est déjà donné.
Tant que le jeton est valide, la sync se fait toute seule (au lancement, au retour au premier
plan et quelques secondes après chaque modification).
