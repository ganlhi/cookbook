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
