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
 * Prépare un import : nettoie les entrées, ignore les recettes déjà présentes
 * (même titre, ingrédients, livre/page, instructions) et les doublons du fichier.
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
    if (!dto || typeof dto.title !== 'string' || !dto.title.trim()) {
      skipped++;
      continue;
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
