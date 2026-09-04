import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fuzzyScore,
  searchNormalize,
  normalizeIngredient,
  renderMarkdown,
  toDTO,
  exportDocument,
  planImport,
  recipeKey,
  mergeSync,
  syncDocument,
  parseSyncDocument,
  stateSignature,
} from './logic.js';

// ---------------------------------------------------------------------------
// Fuzzy search
// ---------------------------------------------------------------------------

test('fuzzyScore : requête vide → score 0 (tout correspond)', () => {
  assert.equal(fuzzyScore('', 'Tarte aux pommes'), 0);
});

test('fuzzyScore : sous-séquence trouvée → score positif', () => {
  assert.ok(fuzzyScore('tarte', 'Tarte aux pommes') > 0);
  assert.ok(fuzzyScore('tp', 'Tarte aux pommes') > 0);
});

test('fuzzyScore : caractères absents ou dans le désordre → null', () => {
  assert.equal(fuzzyScore('tartz', 'Tarte aux pommes'), null);
  assert.equal(fuzzyScore('pommes tarte', 'Tarte aux pommes'), null);
});

test('fuzzyScore : insensible aux accents et à la casse', () => {
  assert.ok(fuzzyScore('creme brulee', 'Crème brûlée') > 0);
  assert.ok(fuzzyScore('CRÈME', 'creme brulee') > 0);
});

test('fuzzyScore : une correspondance exacte bat une correspondance éparse', () => {
  const exact = fuzzyScore('tarte', 'Tarte fine');
  const sparse = fuzzyScore('tarte', 'Toast à la rhubarbe éternelle');
  assert.ok(exact > sparse);
});

test('searchNormalize et normalizeIngredient', () => {
  assert.equal(searchNormalize('  Crème Brûlée '), 'creme brulee');
  assert.equal(normalizeIngredient('  Pommes '), 'pommes');
});

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

test('renderMarkdown : titres', () => {
  assert.equal(renderMarkdown('# Titre'), '<h1>Titre</h1>');
  assert.equal(renderMarkdown('### Sous-titre'), '<h3>Sous-titre</h3>');
});

test('renderMarkdown : liste non ordonnée groupée', () => {
  assert.equal(
    renderMarkdown('- un\n- deux'),
    '<ul><li>un</li><li>deux</li></ul>'
  );
});

test('renderMarkdown : liste ordonnée avec numéro de départ', () => {
  assert.equal(
    renderMarkdown('3. trois\n4. quatre'),
    '<ol start="3"><li>trois</li><li>quatre</li></ol>'
  );
  assert.equal(renderMarkdown('1. un'), '<ol><li>un</li></ol>');
});

test('renderMarkdown : styles inline', () => {
  assert.equal(renderMarkdown('du **gras** et de l\'*italique* et du `code`'),
    '<p>du <strong>gras</strong> et de l\'<em>italique</em> et du <code>code</code></p>');
});

test('renderMarkdown : paragraphes multi-lignes joints, séparés par ligne vide', () => {
  assert.equal(renderMarkdown('ligne 1\nligne 2\n\nligne 3'),
    '<p>ligne 1 ligne 2</p>\n<p>ligne 3</p>');
});

test('renderMarkdown : le HTML utilisateur est échappé', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'),
    '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

const bookRecipe = {
  id: 'a', createdAt: '2026-09-02T00:00:00Z',
  title: 'Tarte aux pommes', ingredients: ['pommes', 'beurre'],
  book: 'Le Grand Livre', page: 42, instructionsMarkdown: null,
};
const fullRecipe = {
  id: 'b', createdAt: '2026-09-02T00:00:00Z',
  title: 'Salade', ingredients: ['laitue'],
  book: null, page: null, instructionsMarkdown: '# Salade\n- laver',
};

test('toDTO : champs internes exclus, champs vides omis, ingrédients triés', () => {
  assert.deepEqual(toDTO(bookRecipe), {
    title: 'Tarte aux pommes', ingredients: ['beurre', 'pommes'],
    book: 'Le Grand Livre', page: 42,
  });
  assert.deepEqual(toDTO(fullRecipe), {
    title: 'Salade', ingredients: ['laitue'], instructionsMarkdown: '# Salade\n- laver',
  });
});

test('export → import : round-trip sans doublon', () => {
  const doc = JSON.parse(exportDocument([bookRecipe, fullRecipe]));
  assert.equal(doc.version, 1);
  const { toAdd, skipped } = planImport([bookRecipe, fullRecipe], doc);
  assert.equal(toAdd.length, 0);
  assert.equal(skipped, 2);
});

test('planImport : nouvelles recettes ajoutées, doublons du fichier ignorés', () => {
  const doc = {
    version: 1,
    recipes: [
      { title: 'Gratin', ingredients: ['Pommes De Terre '] },
      { title: 'Gratin', ingredients: ['pommes de terre'] }, // doublon interne
      { title: '  ', ingredients: [] },                       // invalide
    ],
  };
  const { toAdd, skipped } = planImport([], doc);
  assert.equal(toAdd.length, 1);
  assert.equal(skipped, 2);
  assert.deepEqual(toAdd[0].ingredients, ['pommes de terre']);
});

test('planImport : page ignorée sans livre, format invalide rejeté', () => {
  const { toAdd } = planImport([], { version: 1, recipes: [{ title: 'X', page: 3 }] });
  assert.equal(toAdd[0].page, null);
  assert.throws(() => planImport([], { hello: 'world' }), /invalide/);
});

test('recipeKey : indépendant de l\'ordre des ingrédients', () => {
  assert.equal(
    recipeKey({ title: 'A', ingredients: ['b', 'a'] }),
    recipeKey({ title: 'A', ingredients: ['a', 'b'] })
  );
});

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-09-04T12:00:00.000Z');
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

function recipe(id, title, overrides = {}) {
  return {
    id,
    title,
    ingredients: ['sel'],
    book: 'Livre',
    page: 1,
    instructionsMarkdown: null,
    createdAt: at(-10_000),
    updatedAt: at(-10_000),
    ...overrides,
  };
}

const empty = { recipes: [], tombstones: [] };
const merge = (local, remote) => mergeSync(local, remote, { now: NOW });
const titles = (result) => result.recipes.map((r) => r.title).sort();

test('mergeSync — union des ajouts de chaque côté', () => {
  const result = merge(
    { recipes: [recipe('a', 'Tarte')], tombstones: [] },
    { recipes: [recipe('b', 'Soupe')], tombstones: [] },
  );
  assert.deepEqual(titles(result), ['Soupe', 'Tarte']);
  assert.equal(result.localChanged, true);
  assert.equal(result.remoteChanged, true);
  assert.equal(result.summary.added, 1);
});

test('mergeSync — état identique des deux côtés : rien à faire', () => {
  const state = { recipes: [recipe('a', 'Tarte')], tombstones: [] };
  const result = merge(state, { recipes: [recipe('a', 'Tarte')], tombstones: [] });
  assert.equal(result.localChanged, false);
  assert.equal(result.remoteChanged, false);
  assert.deepEqual(result.summary, { added: 0, updated: 0, removed: 0 });
});

test('mergeSync — la modification la plus récente gagne', () => {
  const result = merge(
    { recipes: [recipe('a', 'Ancien', { updatedAt: at(-5000) })], tombstones: [] },
    { recipes: [recipe('a', 'Récent', { updatedAt: at(-1000) })], tombstones: [] },
  );
  assert.deepEqual(titles(result), ['Récent']);
  assert.equal(result.summary.updated, 1);
});

test('mergeSync — une suppression distante retire la recette locale', () => {
  const result = merge(
    { recipes: [recipe('a', 'Tarte')], tombstones: [] },
    { recipes: [], tombstones: [{ id: 'a', deletedAt: at(-1000) }] },
  );
  assert.deepEqual(result.recipes, []);
  assert.deepEqual(result.tombstones, [{ id: 'a', deletedAt: at(-1000) }]);
  assert.equal(result.summary.removed, 1);
  assert.equal(result.localChanged, true);
});

test('mergeSync — une recette modifiée après la suppression est conservée', () => {
  const result = merge(
    { recipes: [recipe('a', 'Tarte', { updatedAt: at(-500) })], tombstones: [] },
    { recipes: [], tombstones: [{ id: 'a', deletedAt: at(-1000) }] },
  );
  assert.deepEqual(titles(result), ['Tarte']);
  assert.deepEqual(result.tombstones, []);
});

test('mergeSync — la suppression ne ressuscite pas au tour suivant', () => {
  const first = merge(
    { recipes: [recipe('a', 'Tarte')], tombstones: [] },
    { recipes: [], tombstones: [{ id: 'a', deletedAt: at(-1000) }] },
  );
  const second = merge(first, { recipes: [recipe('a', 'Tarte')], tombstones: [] });
  assert.deepEqual(second.recipes, []);
});

test('mergeSync — recettes identiques d’ids différents : une seule survit', () => {
  const result = merge(
    { recipes: [recipe('bbb', 'Tarte')], tombstones: [] },
    { recipes: [recipe('aaa', 'Tarte')], tombstones: [] },
  );
  assert.equal(result.recipes.length, 1);
  assert.equal(result.recipes[0].id, 'aaa');
  assert.deepEqual(result.tombstones, [{ id: 'bbb', deletedAt: at(0) }]);
});

test('mergeSync — les pierres tombales périmées sont oubliées', () => {
  const old = new Date(NOW - 100 * 24 * 3600 * 1000).toISOString();
  const result = merge({ recipes: [], tombstones: [{ id: 'a', deletedAt: old }] }, empty);
  assert.deepEqual(result.tombstones, []);
});

test('mergeSync — commutatif et idempotent', () => {
  const a = { recipes: [recipe('a', 'Tarte'), recipe('c', 'Cake')], tombstones: [] };
  const b = {
    recipes: [recipe('b', 'Soupe')],
    tombstones: [{ id: 'c', deletedAt: at(-100) }],
  };
  const ab = merge(a, b);
  const ba = merge(b, a);
  assert.equal(stateSignature(ab), stateSignature(ba));

  const again = merge(ab, ab);
  assert.equal(stateSignature(again), stateSignature(ab));
  assert.equal(again.localChanged, false);
});

test('mergeSync — convergence A → B → A', () => {
  const a = { recipes: [recipe('a', 'Tarte')], tombstones: [] };
  const b = { recipes: [recipe('b', 'Soupe')], tombstones: [{ id: 'a', deletedAt: at(0) }] };
  const onB = merge(b, a);
  const onA = merge(a, onB);
  assert.equal(stateSignature(onA), stateSignature(onB));
  assert.deepEqual(titles(onA), ['Soupe']);
});

test('syncDocument / parseSyncDocument — aller-retour fidèle', () => {
  const recipes = [
    recipe('a', 'Tarte'),
    recipe('b', 'Soupe', { book: null, page: null, instructionsMarkdown: '# Étapes' }),
  ];
  const tombstones = [{ id: 'z', deletedAt: at(-1000) }];
  const parsed = parseSyncDocument(syncDocument(recipes, tombstones));
  assert.equal(stateSignature(parsed), stateSignature({ recipes, tombstones }));
});

test('parseSyncDocument — un export v1 reçoit des ids stables dérivés du contenu', () => {
  const v1 = exportDocument([recipe('a', 'Tarte')]);
  const first = parseSyncDocument(v1);
  const second = parseSyncDocument(v1);
  assert.equal(first.recipes.length, 1);
  assert.equal(first.recipes[0].id, second.recipes[0].id);
  assert.match(first.recipes[0].id, /^v1-[0-9a-f]{8}$/);
});

test('parseSyncDocument — document illisible ou mal formé', () => {
  assert.throws(() => parseSyncDocument('{'), /illisible/);
  assert.throws(() => parseSyncDocument('{"version":2}'), /invalide/);
});

test('planImport accepte un document de synchronisation v2', () => {
  const document = JSON.parse(syncDocument([recipe('a', 'Tarte')], [{ id: 'z', deletedAt: at(0) }]));
  const { toAdd, skipped } = planImport([], document);
  assert.equal(toAdd.length, 1);
  assert.equal(toAdd[0].title, 'Tarte');
  assert.equal(skipped, 0);
});
