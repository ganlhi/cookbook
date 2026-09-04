# Objectif

Créer une application pour téléphone ou tablette (PWA installable, cible principale iPhone/iPad), permettant d'indexer des recettes de cuisines se trouvant dans des livres ou d'insérer directement les recettes dans l'application.

> Note : une première implémentation en app iOS native (SwiftUI + SwiftData) est archivée sur la branche `ios-app`. Elle a été abandonnée pour éviter le compte développeur Apple payant ; la PWA offre les mêmes fonctionnalités sans distribution App Store.

Deux types d'ajouts possible : 
- une recette avec un titre, une liste des ingrédients principaux, un titre de livre et une page
- une recette avec un titre, une liste des ingrédients principaux, des instructions pour faire la recette au format Markdown

Lors de l'ajout, les titres de livres déjà utilisés sont suggérés, de même que les aliments.

Tout est local, pas de base de données externe à l'application.

Possibilité d'exporter tout où partie des recettes sous la forme d'un fichier unique partageable pour pouvoir l'importer dans l'application sur un autre appareil.

Synchronisation optionnelle entre appareils via Google Drive (fichier unique dans le Drive de l'utilisateur, aucun serveur applicatif) ; les paramètres restent stockés localement.

Consultation des recettes : 
- liste filtrable par ingrédients, par partie du titre (fuzzy search)
- affichage des instructions pour les recettes qui en disposent dans un format agréable à lire (rendu du contenu Markdown).

# Plan

## Stack technique

- **PWA statique, vanilla JS (modules ES), sans build ni dépendance** — déployable telle quelle (GitHub Pages ou n'importe quel hébergeur statique, HTTPS requis pour l'installation)
- **IndexedDB** pour la persistance locale (les données restent sur l'appareil)
- **Service worker** pour le fonctionnement hors-ligne, **manifest** pour l'installation sur l'écran d'accueil (iOS : « Ajouter à l'écran d'accueil »)
- Rendu Markdown et fuzzy search implémentés à la main (mêmes algorithmes que la version iOS archivée)

## Modèle de données

Un seul type `Recipe` ; livres et ingrédients sont **dérivés** des recettes (pas de stores séparés, la déduplication par nom est calculée) :

```js
{
  id,                    // généré
  title,
  createdAt,             // ISO 8601
  updatedAt,             // ISO 8601, base du « dernier écrit gagnant » à la synchro
  ingredients: ["..."],  // noms normalisés (minuscules, trim)
  book,  page,           // référence livre (exclusif avec instructions)
  instructionsMarkdown,  // recette complète
}
```

Trois stores IndexedDB (base `cookbook`, version 2) :

- `recipes` — les recettes ci-dessus
- `tombstones` — `{ id, deletedAt }` : les suppressions doivent voyager jusqu'aux autres appareils, sans quoi une recette effacée ici réapparaîtrait de là-bas. Oubliées au bout de 90 jours
- `settings` — paramètres locaux, dont ceux de la synchronisation (un enregistrement `sync`)

## Écrans (SPA centrée sur la liste)

L'usage principal est la consultation de la liste : la plupart des recettes sont de simples références à des livres, et une ligne suffit à les afficher en entier. Il n'y a donc pas de volet détail.

1. **Liste des recettes** (écran unique) — recherche fuzzy sur le titre (sous-séquence avec score, insensible accents/casse), filtres multi-ingrédients (intersection). Chaque ligne porte le titre, le livre + page, les ingrédients, et un bouton « ⋯ » ouvrant modifier / supprimer
2. **Feuille des ingrédients** — la liste complète ne tient pas dans une rangée de chips dès qu'elle s'allonge : la barre ne garde que le bouton d'ouverture et les ingrédients actifs (retirables d'un tap), le choix se fait dans une feuille avec recherche. Chaque ligne affiche le nombre de recettes qui associent cet ingrédient à ceux déjà cochés — un zéro, grisé, signale une combinaison sans résultat. L'ordre est figé à l'ouverture pour que cocher une case ne déplace pas les lignes
3. **Popup de recette** — uniquement pour les recettes à contenu : un clic sur la ligne affiche les instructions Markdown rendues (titres, listes, gras/italique) et les chips d'ingrédients. Les références livre ne sont pas cliquables, tout est déjà dans la ligne
4. **Ajout / édition** — dialog avec choix du type, saisie des ingrédients en tags avec suggestions, auto-complétion des titres de livres
5. **Export / import** — export JSON de tout ou d'une sélection (téléchargement + Web Share si dispo) ; import avec déduplication des recettes identiques et récapitulatif
6. **Synchronisation** — dialog : ID client OAuth, compte connecté, date de dernière synchro, bascule auto, boutons synchroniser / déconnecter

Mise en page pensée pour le portrait : une seule colonne occupant toute la largeur du viewport. La coquille `.app` est `position: fixed` sur le viewport (pas de `dvh`, dont l'absence de support cassait le défilement) et seule la liste défile. Thème clair/sombre via `prefers-color-scheme`.

Deux pièges de mise en page rencontrés sur les `dialog`, à garder en tête :

- les navigateurs leur appliquent `height: fit-content` et `margin: auto`. Pour qu'une feuille remplisse le viewport via `top`/`bottom`, il faut écraser les deux (`height: auto`, `margin: 0 auto`), sinon `bottom` est ignoré et le contenu déborde
- `flex: 1` sur un enfant vaut `flex-basis: 0%` : dans un conteneur de hauteur automatique, cet enfant ne compte alors pour rien dans la hauteur intrinsèque et se retrouve écrasé. Safari applique la règle, Chrome la rattrape — d'où `flex: 1 1 auto` sur `.sheet-body`

## Format d'export

Identique à la version iOS archivée (interopérable), fichier `recettes.cookbook.json` :

```json
{
  "version": 1,
  "recipes": [
    { "title": "...", "ingredients": ["..."], "book": "...", "page": 42 },
    { "title": "...", "ingredients": ["..."], "instructionsMarkdown": "..." }
  ]
}
```

## Synchronisation Google Drive

Facultative, activée en collant un ID client OAuth (propre au déploiement, créé dans la
console Google Cloud — procédure dans le README) dans le dialog de synchronisation.

- **Autorisation** : flux implicite OAuth 2.0 **par redirection plein écran**, construit à la
  main. Pas de bibliothèque externe, et surtout pas de popup — celles-ci sont peu fiables dans
  une PWA installée sur iOS. Sans backend il n'y a pas de jeton de rafraîchissement : le jeton
  dure une heure et son renouvellement passe par un geste de l'utilisateur.
- **Scope `drive.file`** : l'app ne voit que le fichier qu'elle a créé. Scope non sensible,
  donc pas de procédure de vérification chez Google.
- **Fichier** : un seul `recettes.cookbook.json` dans le Drive, au format v2 — sur-ensemble du
  format d'export v1, avec l'identité et les dates de chaque recette plus les suppressions.
  L'export manuel reste en v1 pour rester interopérable avec l'app iOS archivée.
- **Fusion** (`mergeSync` dans `logic.js`, fonction pure et testée) : union par id, dernier
  écrit gagnant, pierres tombales pour les suppressions, déduplication par contenu pour les
  recettes importées séparément sur deux appareils. Commutative et idempotente — deux
  appareils convergent quel que soit l'ordre des synchronisations.
- **Déclenchement** : au lancement, au retour au premier plan, quelques secondes après une
  modification locale, et à la demande. Jamais de redirection sans geste utilisateur.

## Structure des fichiers

```
index.html            # shell de l'app
style.css             # styles (clair/sombre, responsive)
logic.js              # fonctions pures : fuzzy search, markdown, dédup import, fusion (testées via node)
app.js                # DOM, état, IndexedDB, export/import, orchestration de la synchro
gdrive.js             # OAuth Google et appels REST Drive
sw.js                 # service worker (cache offline)
manifest.webmanifest  # installation PWA
icons/                # icônes PNG (192, 512, apple-touch-icon 180)
```