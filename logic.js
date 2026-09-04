// Fonctions pures de l'application (sans DOM ni IndexedDB), testables sous node.

/** Normalisation pour la recherche : accents et casse ignorés. */
export function searchNormalize(str) {
  return str
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Normalisation d'un nom d'ingrédient (minuscules, trim). */
export function normalizeIngredient(raw) {
  return raw.trim().toLowerCase();
}

/**
 * Recherche floue par sous-séquence. Retourne un score (plus haut = meilleur)
 * ou null si tous les caractères de la requête ne sont pas trouvés dans l'ordre.
 * Bonus : début de mot, caractères contigus, correspondance compacte.
 */
export function fuzzyScore(query, candidate) {
  const q = [...searchNormalize(query)];
  const c = [...searchNormalize(candidate)];
  if (q.length === 0) return 0;

  let score = 0;
  let qi = 0;
  let prevMatched = false;

  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) {
      const isWordStart = i === 0 || c[i - 1] === ' ';
      score += isWordStart ? 3 : prevMatched ? 2 : 1;
      prevMatched = true;
      qi++;
    } else {
      prevMatched = false;
    }
  }

  if (qi < q.length) return null;
  return score + Math.max(0, 10 - Math.floor((c.length - q.length) / 4));
}

export function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Styles inline : `code`, **gras**, *italique* / _italique_. */
function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');
  return out;
}

/**
 * Rendu Markdown par blocs : titres #..####, listes -/* et 1./1),
 * paragraphes. Retourne du HTML sûr (texte échappé).
 */
export function renderMarkdown(markdown) {
  const html = [];
  let paragraph = [];
  let list = null; // { type: 'ul' | 'ol', start, items: [] }

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const start = list.type === 'ol' && list.start !== 1 ? ` start="${list.start}"` : '';
      const items = list.items.map((item) => `<li>${inline(item)}</li>`).join('');
      html.push(`<${list.type}${start}>${items}</${list.type}>`);
      list = null;
    }
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (list?.type !== 'ul') {
        flushList();
        list = { type: 'ul', start: 1, items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (list?.type !== 'ol') {
        flushList();
        list = { type: 'ol', start: parseInt(ordered[1], 10), items: [] };
      }
      list.items.push(ordered[2]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return html.join('\n');
}

// ---------------------------------------------------------------------------
// Export / import — format identique à l'app iOS archivée (branche ios-app) :
// { "version": 1, "recipes": [ { title, ingredients, book?, page?, instructionsMarkdown? } ] }
// ---------------------------------------------------------------------------

export const EXPORT_VERSION = 1;
export const EXPORT_FILENAME = 'recettes.cookbook.json';

/** Clé d'identité d'une recette pour la déduplication à l'import. */
export function recipeKey(recipe) {
  return JSON.stringify([
    recipe.title,
    [...(recipe.ingredients ?? [])].map(normalizeIngredient).sort(),
    recipe.book ?? null,
    recipe.page ?? null,
    recipe.instructionsMarkdown ?? null,
  ]);
}

/** DTO d'export : champs absents plutôt que null (comme l'encodeur Swift). */
export function toDTO(recipe) {
  const dto = {
    title: recipe.title,
    ingredients: [...(recipe.ingredients ?? [])].sort(),
  };
  if (recipe.book) {
    dto.book = recipe.book;
    if (recipe.page != null) dto.page = recipe.page;
  }
  if (recipe.instructionsMarkdown != null) dto.instructionsMarkdown = recipe.instructionsMarkdown;
  return dto;
}

export function exportDocument(recipes) {
  return JSON.stringify({ version: EXPORT_VERSION, recipes: recipes.map(toDTO) }, null, 2);
}

/**
 * Nettoie les champs métier d'une entrée reçue de l'extérieur (fichier importé
 * ou document de synchronisation). Retourne null si l'entrée est inexploitable.
 */
export function cleanRecipeFields(dto) {
  if (!dto || typeof dto !== 'object' || typeof dto.title !== 'string' || !dto.title.trim()) {
    return null;
  }
  const clean = {
    title: dto.title.trim(),
    ingredients: [...new Set((Array.isArray(dto.ingredients) ? dto.ingredients : [])
      .filter((i) => typeof i === 'string')
      .map(normalizeIngredient)
      .filter(Boolean))].sort(),
    book: typeof dto.book === 'string' && dto.book.trim() ? dto.book.trim() : null,
    page: Number.isInteger(dto.page) ? dto.page : null,
    instructionsMarkdown: typeof dto.instructionsMarkdown === 'string' ? dto.instructionsMarkdown : null,
  };
  if (!clean.book) clean.page = null;
  return clean;
}

/**
 * Prépare un import : nettoie les entrées, ignore les recettes déjà présentes
 * (même titre, ingrédients, livre/page, instructions) et les doublons du fichier.
 * Accepte aussi bien un document v1 qu'un document de synchronisation v2 (dont
 * les champs supplémentaires — id, dates, suppressions — sont simplement ignorés).
 * Lève une erreur si le document n'a pas le format attendu.
 */
export function planImport(existingRecipes, document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.recipes)) {
    throw new Error('Format de fichier invalide');
  }

  const seen = new Set(existingRecipes.map(recipeKey));
  const toAdd = [];
  let skipped = 0;

  for (const dto of document.recipes) {
    const clean = cleanRecipeFields(dto);
    if (!clean) {
      skipped++;
      continue;
    }

    const key = recipeKey(clean);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    toAdd.push(clean);
  }

  return { toAdd, skipped };
}

// ---------------------------------------------------------------------------
// Synchronisation — document v2 et fusion
//
// Le fichier posé sur Google Drive est un sur-ensemble du format d'export v1 :
// il porte en plus l'identité et les dates de chaque recette, ainsi que les
// « pierres tombales » (ids supprimés) qui permettent aux suppressions de se
// propager d'un appareil à l'autre.
// ---------------------------------------------------------------------------

export const SYNC_VERSION = 2;
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const EPOCH = new Date(0).toISOString();

/** Hash FNV-1a, pour dériver un id stable d'un document v1 sans identifiants. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function isoOrDefault(value, fallback) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

/** DTO de synchronisation : les champs métier de `toDTO` plus l'identité. */
export function toSyncDTO(recipe) {
  return {
    id: recipe.id,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt ?? recipe.createdAt,
    ...toDTO(recipe),
  };
}

export function syncDocument(recipes, tombstones, now = new Date().toISOString()) {
  const byId = (a, b) => a.id.localeCompare(b.id);
  return JSON.stringify({
    version: SYNC_VERSION,
    updatedAt: now,
    recipes: recipes.map(toSyncDTO).sort(byId),
    deleted: [...tombstones]
      .map((tombstone) => ({ id: tombstone.id, deletedAt: tombstone.deletedAt }))
      .sort(byId),
  }, null, 2);
}

/**
 * Lit un document de synchronisation. Un document v1 (export manuel déposé à la
 * main sur le Drive) est accepté : chaque recette reçoit un id dérivé de son
 * contenu — donc identique sur tous les appareils — et une date au plus ancien,
 * pour que les versions locales l'emportent.
 */
export function parseSyncDocument(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('Fichier de synchronisation illisible');
  }
  if (!document || typeof document !== 'object' || !Array.isArray(document.recipes)) {
    throw new Error('Format de synchronisation invalide');
  }

  const recipes = [];
  for (const dto of document.recipes) {
    const clean = cleanRecipeFields(dto);
    if (!clean) continue;
    const id = typeof dto.id === 'string' && dto.id ? dto.id : `v1-${hash32(recipeKey(clean))}`;
    const createdAt = isoOrDefault(dto.createdAt, EPOCH);
    recipes.push({ id, createdAt, updatedAt: isoOrDefault(dto.updatedAt, createdAt), ...clean });
  }

  const tombstones = [];
  for (const entry of Array.isArray(document.deleted) ? document.deleted : []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    tombstones.push({ id: entry.id, deletedAt: isoOrDefault(entry.deletedAt, EPOCH) });
  }

  return dedupeById(recipes, tombstones);
}

/** Dernier écrit gagnant ; à date égale, on tranche sur le contenu pour que tous les appareils convergent. */
function isNewer(candidate, current) {
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return recipeKey(candidate) < recipeKey(current);
}

/** Réduit une liste brute à un état canonique : un enregistrement par id. */
function dedupeById(recipes, tombstones) {
  const kept = new Map();
  for (const recipe of recipes) {
    const current = kept.get(recipe.id);
    if (!current || isNewer(recipe, current)) kept.set(recipe.id, recipe);
  }
  const graves = new Map();
  for (const tombstone of tombstones) {
    const current = graves.get(tombstone.id);
    if (!current || tombstone.deletedAt > current.deletedAt) graves.set(tombstone.id, tombstone);
  }
  return { recipes: [...kept.values()], tombstones: [...graves.values()] };
}

/** Signature canonique d'un état, pour détecter ce qui a changé de chaque côté. */
export function stateSignature({ recipes, tombstones }) {
  const items = [...recipes]
    .map((recipe) => [recipe.id, recipe.updatedAt, recipeKey(recipe)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const graves = [...tombstones]
    .map((tombstone) => [tombstone.id, tombstone.deletedAt])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([items, graves]);
}

/**
 * Fusionne l'état local et l'état distant.
 *
 * 1. union par id, la version au `updatedAt` le plus récent l'emporte
 * 2. une pierre tombale gagne si son `deletedAt` est postérieur ou égal à
 *    l'`updatedAt` de la recette — sinon la recette a été recréée depuis
 * 3. déduplication par contenu des recettes d'ids différents (même recette
 *    importée séparément sur deux appareils) : on garde le plus petit id
 * 4. oubli des pierres tombales de plus de 90 jours
 *
 * L'opération est commutative et idempotente : deux appareils qui fusionnent le
 * même couple d'états aboutissent au même résultat.
 */
export function mergeSync(local, remote, { now = Date.now() } = {}) {
  const merged = dedupeById(
    [...local.recipes, ...remote.recipes],
    [...local.tombstones, ...remote.tombstones],
  );

  const recipes = new Map(merged.recipes.map((recipe) => [recipe.id, recipe]));
  const tombstones = new Map(merged.tombstones.map((tombstone) => [tombstone.id, tombstone]));

  for (const [id, tombstone] of tombstones) {
    const recipe = recipes.get(id);
    if (!recipe) continue;
    if (recipe.updatedAt > tombstone.deletedAt) tombstones.delete(id);
    else recipes.delete(id);
  }

  const nowIso = new Date(now).toISOString();
  const byContent = new Map();
  for (const recipe of [...recipes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = recipeKey(recipe);
    if (!byContent.has(key)) {
      byContent.set(key, recipe);
      continue;
    }
    recipes.delete(recipe.id);
    tombstones.set(recipe.id, { id: recipe.id, deletedAt: nowIso });
  }

  const cutoff = new Date(now - TOMBSTONE_TTL_MS).toISOString();
  for (const [id, tombstone] of tombstones) {
    if (tombstone.deletedAt < cutoff) tombstones.delete(id);
  }

  const result = {
    recipes: [...recipes.values()],
    tombstones: [...tombstones.values()],
  };
  const signature = stateSignature(result);

  const before = new Map(local.recipes.map((recipe) => [recipe.id, recipe]));
  let added = 0;
  let updated = 0;
  for (const recipe of result.recipes) {
    const previous = before.get(recipe.id);
    if (!previous) added++;
    else if (recipeKey(previous) !== recipeKey(recipe)) updated++;
  }
  const removed = local.recipes.filter((recipe) => !recipes.has(recipe.id)).length;

  return {
    ...result,
    localChanged: signature !== stateSignature(local),
    remoteChanged: signature !== stateSignature(remote),
    summary: { added, updated, removed },
  };
}
