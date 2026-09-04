import {
  fuzzyScore,
  searchNormalize,
  normalizeIngredient,
  renderMarkdown,
  escapeHtml,
  exportDocument,
  planImport,
  mergeSync,
  syncDocument,
  parseSyncDocument,
  EXPORT_FILENAME,
} from './logic.js';
import * as gdrive from './gdrive.js';

// ---------------------------------------------------------------------------
// Persistance (IndexedDB)
// ---------------------------------------------------------------------------

const DB_NAME = 'cookbook';
const STORE = 'recipes';
const TOMBSTONES = 'tombstones';   // ids supprimés, pour propager les suppressions
const SETTINGS = 'settings';       // paramètres locaux (dont la synchronisation)
let dbPromise = null;

function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(TOMBSTONES)) db.createObjectStore(TOMBSTONES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });

      // v1 → v2 : les recettes existantes n'ont pas de date de modification.
      if (event.oldVersion >= 1) {
        request.transaction.objectStore(STORE).openCursor().onsuccess = (cursorEvent) => {
          const cursor = cursorEvent.target.result;
          if (!cursor) return;
          if (cursor.value.updatedAt == null) {
            cursor.update({ ...cursor.value, updatedAt: cursor.value.createdAt });
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return asPromise(db.transaction(STORE).objectStore(STORE).getAll());
}

async function dbPut(recipe) {
  const db = await openDB();
  return asPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(recipe));
}

async function dbPutAll(recipes) {
  const db = await openDB();
  const transaction = db.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  recipes.forEach((recipe) => store.put(recipe));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return asPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
}

async function dbGetTombstones() {
  const db = await openDB();
  return asPromise(db.transaction(TOMBSTONES).objectStore(TOMBSTONES).getAll());
}

async function dbPutTombstone(tombstone) {
  const db = await openDB();
  return asPromise(db.transaction(TOMBSTONES, 'readwrite').objectStore(TOMBSTONES).put(tombstone));
}

/** Remplace l'état complet en une transaction — utilisé au retour d'une fusion. */
async function dbReplaceState(recipes, tombstones) {
  const db = await openDB();
  const transaction = db.transaction([STORE, TOMBSTONES], 'readwrite');
  const recipeStore = transaction.objectStore(STORE);
  const tombstoneStore = transaction.objectStore(TOMBSTONES);
  recipeStore.clear();
  recipes.forEach((recipe) => recipeStore.put(recipe));
  tombstoneStore.clear();
  tombstones.forEach((tombstone) => tombstoneStore.put(tombstone));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function dbGetSettings(key) {
  const db = await openDB();
  const record = await asPromise(db.transaction(SETTINGS).objectStore(SETTINGS).get(key));
  return record?.value ?? null;
}

async function dbSetSettings(key, value) {
  const db = await openDB();
  return asPromise(db.transaction(SETTINGS, 'readwrite').objectStore(SETTINGS).put({ key, value }));
}

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

const state = {
  recipes: [],
  searchText: '',
  selectedIngredients: new Set(),
  openId: null,         // recette affichée en popup (recettes à contenu uniquement)
  selecting: false,     // mode sélection multiple (export)
  selection: new Set(),
  syncing: false,
  syncMessage: null,    // dernier retour de synchronisation, affiché dans son dialog
  hideUnavailable: false, // masquer les ingrédients sans résultat (préférence persistée)
};

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  search: $('search'),
  filterBar: $('filter-bar'),
  ingredientsBtn: $('ingredients-btn'),
  ingredientsBtnLabel: $('ingredients-btn-label'),
  selectedChips: $('selected-chips'),
  ingredientsDialog: $('ingredients-dialog'),
  ingredientsSearch: $('ingredients-search'),
  ingredientsHideRow: $('ingredients-hide-row'),
  ingredientsHide: $('ingredients-hide'),
  ingredientsHideLabel: $('ingredients-hide-label'),
  ingredientsList: $('ingredients-list'),
  ingredientsClear: $('ingredients-clear'),
  list: $('recipe-list'),
  emptyState: $('empty-state'),
  recipeDialog: $('recipe-dialog'),
  recipeDialogTitle: $('recipe-dialog-title'),
  recipeDialogBody: $('recipe-dialog-body'),
  rowMenu: $('row-menu'),
  normalActions: $('normal-actions'),
  selectingActions: $('selecting-actions'),
  exportSelectionBtn: $('export-selection-btn'),
  menu: $('menu'),
  formDialog: $('form-dialog'),
  form: $('recipe-form'),
  formTitle: $('form-title'),
  fTitle: $('f-title'),
  fIngredientTags: $('f-ingredient-tags'),
  fIngredientInput: $('f-ingredient-input'),
  fIngredientAdd: $('f-ingredient-add'),
  fIngredientSuggestions: $('f-ingredient-suggestions'),
  fBookSection: $('f-book-section'),
  fBook: $('f-book'),
  fBookSuggestions: $('f-book-suggestions'),
  fPage: $('f-page'),
  fMdSection: $('f-md-section'),
  fMarkdown: $('f-markdown'),
  fSave: $('f-save'),
  fileInput: $('file-input'),
  toast: $('toast'),
  syncDialog: $('sync-dialog'),
  syncStatus: $('sync-status'),
  syncClientId: $('sync-client-id'),
  syncAuto: $('sync-auto'),
  syncNow: $('sync-now'),
  syncDisconnect: $('sync-disconnect'),
};

const ICONS = {
  book: '<svg class="kind-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5"/></svg>',
  list: '<svg class="kind-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
};

// ---------------------------------------------------------------------------
// Dérivations
// ---------------------------------------------------------------------------

function allIngredients() {
  return [...new Set(state.recipes.flatMap((recipe) => recipe.ingredients))].sort();
}

function allBooks() {
  return [...new Set(state.recipes.map((recipe) => recipe.book).filter(Boolean))].sort();
}

function filteredRecipes() {
  let result = [...state.recipes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (state.selectedIngredients.size) {
    result = result.filter((recipe) => {
      const names = new Set(recipe.ingredients);
      return [...state.selectedIngredients].every((name) => names.has(name));
    });
  }

  const query = state.searchText.trim();
  if (!query) return result;

  return result
    .map((recipe) => [recipe, fuzzyScore(query, recipe.title)])
    .filter(([, score]) => score !== null)
    .sort((a, b) => b[1] - a[1])
    .map(([recipe]) => recipe);
}

function recipeById(id) {
  return state.recipes.find((recipe) => recipe.id === id) ?? null;
}

/** Une recette « complète » a des instructions ; une référence livre n'en a pas. */
function hasContent(recipe) {
  return recipe.instructionsMarkdown != null;
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function render() {
  renderTopbar();
  renderFilterBar();
  renderList();
  renderEmptyState();
  renderRecipeDialog();
  renderIngredientsDialog();
}

function renderTopbar() {
  el.normalActions.hidden = state.selecting;
  el.selectingActions.hidden = !state.selecting;
  el.app.classList.toggle('selecting', state.selecting);
  el.exportSelectionBtn.textContent = `Exporter (${state.selection.size})`;
  el.exportSelectionBtn.disabled = state.selection.size === 0;
}

/**
 * La barre ne porte que le bouton d'ouverture et les ingrédients actifs : la
 * liste complète ne tient pas dans une rangée dès qu'elle s'allonge, elle vit
 * donc dans une feuille dédiée avec recherche.
 */
function renderFilterBar() {
  el.filterBar.hidden = state.recipes.length === 0;

  const selected = [...state.selectedIngredients].sort();
  el.ingredientsBtnLabel.textContent = selected.length
    ? `Ingrédients (${selected.length})`
    : 'Ingrédients';
  el.ingredientsBtn.classList.toggle('active', selected.length > 0);

  el.selectedChips.innerHTML = '';
  for (const name of selected) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip selected removable';
    chip.innerHTML = `${escapeHtml(name)}<span class="remove-glyph" aria-hidden="true">×</span>`;
    chip.setAttribute('aria-label', `Retirer le filtre ${name}`);
    chip.onclick = () => {
      state.selectedIngredients.delete(name);
      render();
    };
    el.selectedChips.append(chip);
  }
}

/**
 * Pour chaque ingrédient, le nombre de recettes qui l'associent aux *autres*
 * ingrédients déjà cochés — donc ce que donnerait la liste si on le cochait.
 * Un zéro signale une combinaison sans résultat, sans avoir à l'essayer.
 */
function ingredientCounts() {
  const counts = new Map();
  for (const name of allIngredients()) {
    const others = [...state.selectedIngredients].filter((selected) => selected !== name);
    const matching = state.recipes.filter((recipe) => {
      const names = new Set(recipe.ingredients);
      return names.has(name) && others.every((other) => names.has(other));
    });
    counts.set(name, matching.length);
  }
  return counts;
}

// Ordre figé à l'ouverture de la feuille : cocher une case ne doit pas faire
// bouger les lignes sous le doigt.
let ingredientOrder = [];

// Préférence d'affichage de la feuille, conservée d'une session à l'autre.
const UI_SETTINGS_KEY = 'ui';

async function loadUiSettings() {
  const ui = await dbGetSettings(UI_SETTINGS_KEY);
  state.hideUnavailable = Boolean(ui?.hideUnavailableIngredients);
}

function saveUiSettings() {
  return dbSetSettings(UI_SETTINGS_KEY, { hideUnavailableIngredients: state.hideUnavailable });
}

function openIngredientsDialog() {
  el.ingredientsSearch.value = '';
  ingredientOrder = allIngredients().sort((a, b) => {
    const pinned = Number(state.selectedIngredients.has(b)) - Number(state.selectedIngredients.has(a));
    return pinned || a.localeCompare(b, 'fr');
  });
  el.ingredientsDialog.showModal();
  renderIngredientsDialog();
}

function renderIngredientsDialog() {
  if (!el.ingredientsDialog.open) return;

  // L'ordre figé peut avoir vieilli (une synchro a pu passer entre-temps).
  const existing = new Set(allIngredients());
  const known = new Set(ingredientOrder);
  ingredientOrder = [
    ...ingredientOrder.filter((name) => existing.has(name)),
    ...allIngredients().filter((name) => !known.has(name)),
  ];

  const counts = ingredientCounts();
  const unavailable = (name) =>
    !state.selectedIngredients.has(name) && (counts.get(name) ?? 0) === 0;

  const query = searchNormalize(el.ingredientsSearch.value);
  const matching = ingredientOrder.filter((name) => !query || searchNormalize(name).includes(query));
  const names = state.hideUnavailable ? matching.filter((name) => !unavailable(name)) : matching;

  // La bascule se compte sur toute la liste, pas sur la recherche en cours :
  // elle ne doit pas apparaître et disparaître pendant la frappe.
  const withoutResult = ingredientOrder.filter(unavailable).length;
  el.ingredientsHideRow.hidden = withoutResult === 0;
  el.ingredientsHide.checked = state.hideUnavailable;
  el.ingredientsHideLabel.textContent = withoutResult === 1
    ? 'Masquer l’ingrédient sans résultat'
    : `Masquer les ${withoutResult} ingrédients sans résultat`;

  el.ingredientsClear.disabled = state.selectedIngredients.size === 0;

  // Le rendu est intégral : on remet le défilement où il était.
  const scroll = el.ingredientsList.scrollTop;
  el.ingredientsList.innerHTML = '';

  if (names.length === 0) {
    const message = matching.length
      ? 'Tous les ingrédients correspondants sont sans résultat.'
      : 'Aucun ingrédient ne correspond.';
    el.ingredientsList.innerHTML = `<p class="ingredient-empty-state">${message}</p>`;
    return;
  }

  for (const name of names) {
    const checked = state.selectedIngredients.has(name);
    const count = counts.get(name) ?? 0;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ingredient-row'
      + (checked ? ' checked' : '')
      + (!checked && count === 0 ? ' unavailable' : '');
    row.setAttribute('aria-pressed', String(checked));
    row.innerHTML = `
      <span class="ingredient-box" aria-hidden="true">${checked ? '✓' : ''}</span>
      <span class="ingredient-name">${escapeHtml(name)}</span>
      <span class="ingredient-count">${count}</span>`;
    row.onclick = () => {
      if (checked) state.selectedIngredients.delete(name);
      else state.selectedIngredients.add(name);
      render();
    };
    el.ingredientsList.append(row);
  }

  el.ingredientsList.scrollTop = scroll;
}

function renderList() {
  el.list.innerHTML = '';
  for (const recipe of filteredRecipes()) {
    const li = document.createElement('li');
    li.className = 'recipe-item';

    // Cliquable seulement s'il y a quelque chose à ouvrir : une référence livre
    // affiche déjà tout dans la ligne.
    const actionable = state.selecting || hasContent(recipe);
    const row = document.createElement(actionable ? 'button' : 'div');
    if (actionable) row.type = 'button';
    row.className = 'recipe-row' + (actionable ? '' : ' static');
    if (state.selection.has(recipe.id)) row.classList.add('checked');

    const sub = recipe.book
      ? `<div class="row-sub">${escapeHtml(recipe.book)}${recipe.page != null ? `, p. ${recipe.page}` : ''}</div>`
      : '';
    const ingredients = recipe.ingredients.length
      ? `<div class="row-ingredients">${escapeHtml([...recipe.ingredients].sort().join(' · '))}</div>`
      : '';

    row.innerHTML = `
      <span class="checkbox">${state.selection.has(recipe.id) ? '✓' : ''}</span>
      <span class="row-body">
        <div class="row-title">${recipe.book ? ICONS.book : ICONS.list}<span>${escapeHtml(recipe.title)}</span></div>
        ${sub}${ingredients}
      </span>`;

    if (actionable) {
      row.onclick = () => {
        if (state.selecting) {
          state.selection.has(recipe.id) ? state.selection.delete(recipe.id) : state.selection.add(recipe.id);
          render();
        } else {
          state.openId = recipe.id;
          render();
        }
      };
    }
    li.append(row);

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'row-menu-btn';
    menuBtn.title = 'Actions';
    menuBtn.setAttribute('aria-label', `Actions pour ${recipe.title}`);
    menuBtn.innerHTML = ICONS.more;
    menuBtn.onclick = () => openRowMenu(menuBtn, recipe);
    li.append(menuBtn);

    el.list.append(li);
  }
}

// ---------------------------------------------------------------------------
// Menu « ⋯ » d'une ligne
// ---------------------------------------------------------------------------

/**
 * Ouvre le menu en modal (top layer) puis le positionne sur le bouton : le
 * top layer échappe au défilement de la liste, donc rien n'est rogné.
 */
function openRowMenu(anchor, recipe) {
  const menu = el.rowMenu;
  if (menu.open) menu.close();
  menu.showModal();

  const button = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(button.right - box.width, window.innerWidth - box.width - margin);
  const below = button.bottom + 6;
  const top = below + box.height + margin > window.innerHeight
    ? button.top - box.height - 6
    : below;
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;

  $('row-menu-edit').onclick = () => {
    menu.close();
    openForm(recipe);
  };
  $('row-menu-delete').onclick = () => {
    menu.close();
    deleteRecipe(recipe);
  };
}

async function deleteRecipe(recipe) {
  if (!window.confirm(`Supprimer « ${recipe.title} » ?`)) return;
  await dbDelete(recipe.id);
  // La pierre tombale fait voyager la suppression vers les autres appareils.
  await dbPutTombstone({ id: recipe.id, deletedAt: new Date().toISOString() });
  state.recipes = state.recipes.filter((r) => r.id !== recipe.id);
  state.selection.delete(recipe.id);
  if (state.openId === recipe.id) state.openId = null;
  pruneIngredientFilters();
  render();
  scheduleSync();
}

function renderEmptyState() {
  const filtered = filteredRecipes();
  if (state.recipes.length === 0) {
    el.emptyState.hidden = false;
    el.emptyState.innerHTML = `
      <div class="empty-icon">📖</div>
      <h2>Aucune recette</h2>
      <p>Ajoutez une recette de vos livres de cuisine ou une recette complète.</p>
      <button class="primary" id="empty-add-btn">Ajouter une recette</button>`;
    $('empty-add-btn').onclick = () => openForm(null);
  } else if (filtered.length === 0) {
    el.emptyState.hidden = false;
    const searching = state.searchText.trim();
    el.emptyState.innerHTML = `
      <div class="empty-icon">🔍</div>
      <h2>Aucun résultat</h2>
      <p>${searching
        ? `Aucune recette ne correspond à « ${escapeHtml(searching)} ».`
        : 'Aucune recette ne contient tous les ingrédients sélectionnés.'}</p>`;
  } else {
    el.emptyState.hidden = true;
  }
  el.list.hidden = !el.emptyState.hidden;
}

function renderRecipeDialog() {
  const recipe = state.openId != null ? recipeById(state.openId) : null;

  if (!recipe || !hasContent(recipe) || state.selecting) {
    state.openId = null;
    if (el.recipeDialog.open) el.recipeDialog.close();
    return;
  }

  el.recipeDialogTitle.textContent = recipe.title;

  const chips = recipe.ingredients.length
    ? `<div class="chips wrap">${[...recipe.ingredients].sort()
        .map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join('')}</div>`
    : '';

  el.recipeDialogBody.innerHTML =
    `${chips}<div class="markdown">${renderMarkdown(recipe.instructionsMarkdown)}</div>`;
  el.recipeDialogBody.scrollTop = 0;

  $('recipe-dialog-edit').onclick = () => {
    el.recipeDialog.close();
    openForm(recipe);
  };
  $('recipe-dialog-delete').onclick = () => {
    el.recipeDialog.close();
    deleteRecipe(recipe);
  };

  if (!el.recipeDialog.open) el.recipeDialog.showModal();
}

/** Retire des filtres les ingrédients qui n'existent plus. */
function pruneIngredientFilters() {
  const existing = new Set(allIngredients());
  for (const name of [...state.selectedIngredients]) {
    if (!existing.has(name)) state.selectedIngredients.delete(name);
  }
}

// ---------------------------------------------------------------------------
// Formulaire d'ajout / édition
// ---------------------------------------------------------------------------

let editingRecipe = null;
let formIngredients = [];

function openForm(recipe) {
  editingRecipe = recipe;
  el.formTitle.textContent = recipe ? 'Modifier la recette' : 'Nouvelle recette';
  el.fTitle.value = recipe?.title ?? '';
  formIngredients = recipe ? [...recipe.ingredients].sort() : [];
  el.fIngredientInput.value = '';
  el.fBook.value = recipe?.book ?? '';
  el.fPage.value = recipe?.page ?? '';
  el.fMarkdown.value = recipe?.instructionsMarkdown ?? '';

  const kind = recipe && recipe.instructionsMarkdown != null && !recipe.book ? 'full' : 'book';
  el.form.elements.kind.value = kind;

  renderForm();
  el.formDialog.showModal();
}

function formKind() {
  return el.form.elements.kind.value;
}

function renderForm() {
  const kind = formKind();
  el.fBookSection.hidden = kind !== 'book';
  el.fMdSection.hidden = kind !== 'full';

  // Tags d'ingrédients
  el.fIngredientTags.innerHTML = '';
  formIngredients.forEach((name, index) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `${escapeHtml(name)}<button type="button" class="remove" aria-label="Retirer ${escapeHtml(name)}">×</button>`;
    tag.querySelector('.remove').onclick = () => {
      formIngredients.splice(index, 1);
      renderForm();
    };
    el.fIngredientTags.append(tag);
  });

  renderFormSuggestions();
  validateForm();
}

function renderFormSuggestions() {
  const input = normalizeIngredient(el.fIngredientInput.value);
  el.fIngredientAdd.disabled = !input || formIngredients.includes(input);
  const ingredientSuggestions = allIngredients()
    .filter((name) => !formIngredients.includes(name)
      && (!input || name.includes(input))
      && name !== input)
    .slice(0, 8);
  renderSuggestionChips(el.fIngredientSuggestions, ingredientSuggestions, (name) => {
    formIngredients.push(name);
    el.fIngredientInput.value = '';
    renderForm();
    el.fIngredientInput.focus();
  });

  const bookInput = el.fBook.value.trim().toLowerCase();
  const bookSuggestions = allBooks()
    .filter((title) => (!bookInput || title.toLowerCase().includes(bookInput))
      && title !== el.fBook.value.trim())
    .slice(0, 8);
  renderSuggestionChips(el.fBookSuggestions, bookSuggestions, (title) => {
    el.fBook.value = title;
    renderForm();
  });
}

function renderSuggestionChips(container, suggestions, onSelect) {
  container.innerHTML = '';
  for (const suggestion of suggestions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip suggestion';
    chip.textContent = suggestion;
    chip.onclick = () => onSelect(suggestion);
    container.append(chip);
  }
}

function addIngredientFromInput() {
  commitIngredientInput();
  renderForm();
  el.fIngredientInput.focus();
}

function commitIngredientInput() {
  const name = normalizeIngredient(el.fIngredientInput.value);
  el.fIngredientInput.value = '';
  if (name && !formIngredients.includes(name)) {
    formIngredients.push(name);
  }
}

function validateForm() {
  const hasTitle = el.fTitle.value.trim().length > 0;
  const valid = formKind() === 'book'
    ? hasTitle && el.fBook.value.trim().length > 0
    : hasTitle && el.fMarkdown.value.trim().length > 0;
  el.fSave.disabled = !valid;
}

async function submitForm(event) {
  event.preventDefault();
  commitIngredientInput();

  const kind = formKind();
  const now = new Date().toISOString();
  const recipe = editingRecipe ?? { id: crypto.randomUUID(), createdAt: now };
  recipe.updatedAt = now;
  recipe.title = el.fTitle.value.trim();
  recipe.ingredients = [...formIngredients].sort();
  if (kind === 'book') {
    recipe.book = el.fBook.value.trim();
    const page = parseInt(el.fPage.value, 10);
    recipe.page = Number.isInteger(page) && page > 0 ? page : null;
    recipe.instructionsMarkdown = null;
  } else {
    recipe.book = null;
    recipe.page = null;
    recipe.instructionsMarkdown = el.fMarkdown.value;
  }

  await dbPut(recipe);
  if (!editingRecipe) state.recipes.push(recipe);
  pruneIngredientFilters();
  el.formDialog.close();
  render();
  scheduleSync();
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

async function exportRecipes(recipes) {
  if (recipes.length === 0) return;
  const json = exportDocument(recipes);
  const file = new File([json], EXPORT_FILENAME, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Recettes' });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      // Partage indisponible : on retombe sur le téléchargement.
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = EXPORT_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

async function importFile(file) {
  try {
    const document = JSON.parse(await file.text());
    const { toAdd, skipped } = planImport(state.recipes, document);
    const now = new Date().toISOString();
    const newRecipes = toAdd.map((dto) => ({
      id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...dto,
    }));
    await dbPutAll(newRecipes);
    state.recipes.push(...newRecipes);
    render();
    showToast(`${toAdd.length} recette(s) importée(s), ${skipped} ignorée(s) (déjà présentes).`);
    scheduleSync();
  } catch (error) {
    showToast(`Échec de l'import : ${error.message}`);
  }
}

let toastTimer = null;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4000);
}

// ---------------------------------------------------------------------------
// Synchronisation Google Drive
//
// Un fichier unique dans le Drive de l'utilisateur porte l'état complet ; à
// chaque synchronisation on le lit, on le fusionne avec l'état local (dernier
// écrit gagnant par recette, pierres tombales pour les suppressions) puis on le
// réécrit s'il a changé. Les paramètres restent sur l'appareil.
// ---------------------------------------------------------------------------

const SYNC_SETTINGS_KEY = 'sync';
const AUTO_SYNC_DEBOUNCE_MS = 5000;
const AUTO_SYNC_THROTTLE_MS = 60_000;

const syncSettings = {
  clientId: '',
  autoSync: true,
  fileId: null,
  remoteVersion: null,
  lastSyncAt: null,
  accountEmail: null,
};

let syncDebounce = null;
let lastAutoSyncAt = 0;

async function loadSyncSettings() {
  Object.assign(syncSettings, (await dbGetSettings(SYNC_SETTINGS_KEY)) ?? {});
}

async function saveSyncSettings(patch) {
  Object.assign(syncSettings, patch);
  await dbSetSettings(SYNC_SETTINGS_KEY, { ...syncSettings });
}

function syncConfigured() {
  return Boolean(syncSettings.clientId);
}

function setSyncMessage(message) {
  state.syncMessage = message;
  renderSyncDialog();
}

/** Sync différée après une modification locale, pour ne pas pousser à chaque frappe. */
function scheduleSync() {
  if (!syncConfigured() || !syncSettings.autoSync || !gdrive.hasValidToken()) return;
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => runSync(), AUTO_SYNC_DEBOUNCE_MS);
}

/**
 * `allowRedirect` autorise le départ vers l'écran d'autorisation Google, qui
 * quitte la page : réservé à une action explicite de l'utilisateur.
 */
async function runSync({ interactive = false, allowRedirect = interactive } = {}) {
  if (state.syncing) return;

  if (!syncConfigured()) {
    if (interactive) setSyncMessage('Renseignez l’ID client OAuth pour commencer.');
    return;
  }
  if (!navigator.onLine) {
    if (interactive) setSyncMessage('Hors ligne : synchronisation impossible.');
    return;
  }
  if (!gdrive.hasValidToken()) {
    if (!allowRedirect) {
      setSyncMessage('Autorisation Google expirée — touchez « Synchroniser ».');
      return;
    }
    gdrive.authorize({ clientId: syncSettings.clientId, email: syncSettings.accountEmail });
    return; // la page part en redirection
  }

  state.syncing = true;
  setSyncMessage('Synchronisation…');
  try {
    const { added, updated, removed } = await syncOnce();
    const parts = [];
    if (added) parts.push(`${added} ajoutée(s)`);
    if (updated) parts.push(`${updated} mise(s) à jour`);
    if (removed) parts.push(`${removed} supprimée(s)`);
    const detail = parts.length ? parts.join(', ') : 'déjà à jour';
    setSyncMessage(`Synchronisé — ${detail}.`);
    if (interactive || parts.length) showToast(`Synchronisation : ${detail}.`);
  } catch (error) {
    setSyncMessage(`Échec : ${error.message}`);
    if (interactive) showToast(`Synchronisation : ${error.message}`);
  } finally {
    state.syncing = false;
    renderSyncDialog();
  }
}

async function syncOnce() {
  // Deux tentatives : si un autre appareil écrit entre notre lecture et notre
  // écriture, on refusionne une fois avant d'abandonner.
  for (let attempt = 0; attempt < 2; attempt++) {
    let file = await locateSyncFile();
    const remote = file
      ? parseSyncDocument(await gdrive.readFile(file.id))
      : { recipes: [], tombstones: [] };
    const local = { recipes: state.recipes, tombstones: await dbGetTombstones() };
    const merged = mergeSync(local, remote);

    if (merged.localChanged) await applyMergedState(merged);

    if (!file) {
      file = await gdrive.createFile(
        EXPORT_FILENAME, syncDocument(merged.recipes, merged.tombstones));
    } else if (merged.remoteChanged) {
      const fresh = await gdrive.fileMeta(file.id);
      if (fresh.version !== file.version) continue; // le distant a bougé : on refait un tour
      file = await gdrive.writeFile(
        file.id, syncDocument(merged.recipes, merged.tombstones));
    }

    await saveSyncSettings({
      fileId: file.id,
      remoteVersion: file.version ?? null,
      lastSyncAt: new Date().toISOString(),
      accountEmail: syncSettings.accountEmail ?? await gdrive.accountEmail(),
    });
    return merged.summary;
  }
  throw new Error('un autre appareil écrivait au même moment, réessayez');
}

async function applyMergedState(merged) {
  await dbReplaceState(merged.recipes, merged.tombstones);
  state.recipes = merged.recipes;
  const alive = new Set(merged.recipes.map((recipe) => recipe.id));
  state.selection = new Set([...state.selection].filter((id) => alive.has(id)));
  if (state.openId != null && !alive.has(state.openId)) state.openId = null;
  pruneIngredientFilters();
  render();
}

/** Métadonnées du fichier de sync, ou null s'il faut le créer. */
async function locateSyncFile() {
  if (syncSettings.fileId) {
    try {
      const meta = await gdrive.fileMeta(syncSettings.fileId);
      if (!meta.trashed) return meta;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    // Fichier supprimé ou mis à la corbeille depuis le Drive : on repart de zéro.
    await saveSyncSettings({ fileId: null, remoteVersion: null });
  }
  return gdrive.findFile(EXPORT_FILENAME);
}

// --- Dialog de synchronisation ---

function openSyncDialog() {
  el.syncClientId.value = syncSettings.clientId;
  el.syncAuto.checked = syncSettings.autoSync;
  el.syncDialog.showModal();
  renderSyncDialog();
}

function renderSyncDialog() {
  if (!el.syncDialog.open) return;

  el.syncNow.disabled = state.syncing || !syncConfigured();
  el.syncNow.textContent = state.syncing ? 'Synchronisation…' : 'Synchroniser';
  el.syncDisconnect.hidden = !syncSettings.accountEmail && !gdrive.hasValidToken();

  const lines = [];
  if (!syncConfigured()) lines.push('Non configuré.');
  else if (syncSettings.accountEmail) lines.push(`Compte : ${syncSettings.accountEmail}`);
  if (syncSettings.lastSyncAt) {
    lines.push(`Dernière synchronisation : ${formatDateTime(syncSettings.lastSyncAt)}`);
  }
  if (state.syncMessage) lines.push(state.syncMessage);

  el.syncStatus.innerHTML = lines.map((line) => `<span>${escapeHtml(line)}</span>`).join('');
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

async function disconnectSync() {
  if (!window.confirm('Se déconnecter de Google Drive ? Les recettes de cet appareil sont conservées.')) return;
  gdrive.clearToken();
  await saveSyncSettings({
    fileId: null, remoteVersion: null, lastSyncAt: null, accountEmail: null,
  });
  setSyncMessage('Déconnecté.');
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

el.search.addEventListener('input', () => {
  state.searchText = el.search.value;
  render();
});

$('add-btn').addEventListener('click', () => openForm(null));

$('export-all-btn').addEventListener('click', () => {
  el.menu.open = false;
  exportRecipes(state.recipes);
});

$('select-btn').addEventListener('click', () => {
  el.menu.open = false;
  state.selecting = true;
  state.selection = new Set();
  state.openId = null;
  render();
});

$('import-btn').addEventListener('click', () => {
  el.menu.open = false;
  el.fileInput.click();
});

$('sync-btn').addEventListener('click', () => {
  el.menu.open = false;
  openSyncDialog();
});

$('done-btn').addEventListener('click', () => {
  state.selecting = false;
  state.selection = new Set();
  render();
});

el.exportSelectionBtn.addEventListener('click', () => {
  exportRecipes(state.recipes.filter((recipe) => state.selection.has(recipe.id)));
});

el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files[0];
  el.fileInput.value = '';
  if (file) importFile(file);
});

// Ferme le menu quand on clique ailleurs
document.addEventListener('click', (event) => {
  if (el.menu.open && !el.menu.contains(event.target)) el.menu.open = false;
});

// Popup de recette
$('recipe-dialog-close').addEventListener('click', () => el.recipeDialog.close());
el.recipeDialog.addEventListener('close', () => {
  state.openId = null;
  renderList();
});
el.recipeDialog.addEventListener('click', (event) => {
  // Le backdrop n'est pas un enfant : un clic dessus cible le dialog lui-même.
  if (event.target === el.recipeDialog) el.recipeDialog.close();
});
el.rowMenu.addEventListener('click', (event) => {
  if (event.target === el.rowMenu) el.rowMenu.close();
});

// Feuille des ingrédients
el.ingredientsBtn.addEventListener('click', openIngredientsDialog);
el.ingredientsSearch.addEventListener('input', renderIngredientsDialog);
el.ingredientsHide.addEventListener('change', () => {
  state.hideUnavailable = el.ingredientsHide.checked;
  saveUiSettings();
  renderIngredientsDialog();
});
el.ingredientsClear.addEventListener('click', () => {
  state.selectedIngredients.clear();
  render();
});
$('ingredients-close').addEventListener('click', () => el.ingredientsDialog.close());
$('ingredients-done').addEventListener('click', () => el.ingredientsDialog.close());
el.ingredientsDialog.addEventListener('click', (event) => {
  if (event.target === el.ingredientsDialog) el.ingredientsDialog.close();
});

// Synchronisation
el.syncClientId.addEventListener('input', () => {
  saveSyncSettings({ clientId: el.syncClientId.value.trim() }).then(renderSyncDialog);
});
el.syncAuto.addEventListener('change', () => {
  saveSyncSettings({ autoSync: el.syncAuto.checked });
});
el.syncNow.addEventListener('click', () => runSync({ interactive: true }));
el.syncDisconnect.addEventListener('click', disconnectSync);
$('sync-close').addEventListener('click', () => el.syncDialog.close());
el.syncDialog.addEventListener('close', () => { state.syncMessage = null; });
el.syncDialog.addEventListener('click', (event) => {
  if (event.target === el.syncDialog) el.syncDialog.close();
});

// L'app installée reste ouverte longtemps : on retente au retour au premier plan.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !syncSettings.autoSync || !gdrive.hasValidToken()) return;
  if (Date.now() - lastAutoSyncAt < AUTO_SYNC_THROTTLE_MS) return;
  lastAutoSyncAt = Date.now();
  runSync();
});

// Formulaire
el.form.addEventListener('submit', submitForm);
$('f-cancel').addEventListener('click', () => el.formDialog.close());
el.form.addEventListener('change', (event) => {
  if (event.target.name === 'kind') renderForm();
});
el.fTitle.addEventListener('input', validateForm);
el.fBook.addEventListener('input', () => { renderFormSuggestions(); validateForm(); });
el.fMarkdown.addEventListener('input', validateForm);
el.fIngredientInput.addEventListener('input', renderFormSuggestions);
el.fIngredientInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    addIngredientFromInput();
  }
});
el.fIngredientAdd.addEventListener('click', addIngredientFromInput);
// Certains claviers virtuels (Android/GBoard) n'émettent pas de keydown « Enter »
// exploitable : on intercepte aussi le saut de ligne au niveau de beforeinput.
el.fIngredientInput.addEventListener('beforeinput', (event) => {
  if (event.inputType === 'insertLineBreak') {
    event.preventDefault();
    addIngredientFromInput();
  }
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

async function start() {
  // Avant tout : nettoyer un éventuel retour d'autorisation Google dans l'URL.
  const redirect = gdrive.consumeRedirect();

  try {
    state.recipes = await dbGetAll();
    await loadSyncSettings();
    await loadUiSettings();
  } catch (error) {
    showToast(`Impossible d'ouvrir la base locale : ${error.message}`);
    state.recipes = [];
  }
  render();

  if (redirect?.error) {
    showToast(redirect.error);
  } else if (redirect) {
    // On revient de Google avec un jeton frais : `allowRedirect: false` évite
    // toute boucle de redirection si quelque chose cloche malgré tout.
    runSync({ interactive: true, allowRedirect: false });
  } else if (syncSettings.autoSync && gdrive.hasValidToken()) {
    lastAutoSyncAt = Date.now();
    runSync();
  }

  // Demande la persistance du stockage (best effort, ignoré si non supporté).
  navigator.storage?.persist?.().catch(() => {});

  if ('serviceWorker' in navigator) {
    // Si un service worker contrôlait déjà la page, l'arrivée d'un nouveau
    // signifie qu'une version plus récente est prête : on recharge pour
    // l'appliquer tout de suite au lieu d'attendre un prochain lancement.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });

    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        registration.update().catch(() => {});
        // L'app installée reste ouverte longtemps : on revérifie au retour au premier plan.
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) registration.update().catch(() => {});
        });
      })
      .catch(() => {});
  }
}

start();
