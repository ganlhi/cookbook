import {
  fuzzyScore,
  normalizeIngredient,
  renderMarkdown,
  escapeHtml,
  exportDocument,
  planImport,
  EXPORT_FILENAME,
} from './logic.js';

// ---------------------------------------------------------------------------
// Persistance (IndexedDB)
// ---------------------------------------------------------------------------

const DB_NAME = 'cookbook';
const STORE = 'recipes';
let dbPromise = null;

function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
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

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

const state = {
  recipes: [],
  searchText: '',
  selectedIngredients: new Set(),
  selectedId: null,     // recette affichée en détail
  selecting: false,     // mode sélection multiple (export)
  selection: new Set(),
};

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  sidebar: document.querySelector('.sidebar'),
  search: $('search'),
  filterChips: $('filter-chips'),
  list: $('recipe-list'),
  emptyState: $('empty-state'),
  detailContent: $('detail-content'),
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
};

const ICONS = {
  book: '<svg class="kind-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5"/></svg>',
  list: '<svg class="kind-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>',
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

function selectedRecipe() {
  return state.recipes.find((recipe) => recipe.id === state.selectedId) ?? null;
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function render() {
  renderTopbar();
  renderFilterChips();
  renderList();
  renderEmptyState();
  renderDetail();
}

function renderTopbar() {
  el.normalActions.hidden = state.selecting;
  el.selectingActions.hidden = !state.selecting;
  el.sidebar.classList.toggle('selecting', state.selecting);
  el.exportSelectionBtn.textContent = `Exporter (${state.selection.size})`;
  el.exportSelectionBtn.disabled = state.selection.size === 0;
}

function renderFilterChips() {
  el.filterChips.innerHTML = '';
  for (const name of allIngredients()) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.selectedIngredients.has(name) ? ' selected' : '');
    chip.textContent = name;
    chip.onclick = () => {
      state.selectedIngredients.has(name)
        ? state.selectedIngredients.delete(name)
        : state.selectedIngredients.add(name);
      render();
    };
    el.filterChips.append(chip);
  }
}

function renderList() {
  el.list.innerHTML = '';
  for (const recipe of filteredRecipes()) {
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.className = 'recipe-row';
    if (recipe.id === state.selectedId && !state.selecting) row.classList.add('active');
    if (state.selection.has(recipe.id)) row.classList.add('checked');

    const sub = recipe.book
      ? `<div class="row-sub">${escapeHtml(recipe.book)}${recipe.page != null ? `, p. ${recipe.page}` : ''}</div>`
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

    row.onclick = () => {
      if (state.selecting) {
        state.selection.has(recipe.id) ? state.selection.delete(recipe.id) : state.selection.add(recipe.id);
        render();
      } else {
        state.selectedId = recipe.id;
        render();
      }
    };

    li.append(row);
    el.list.append(li);
  }
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

function renderDetail() {
  const recipe = selectedRecipe();
  el.app.classList.toggle('show-detail', !!recipe && !state.selecting);

  if (!recipe) {
    el.detailContent.innerHTML = `
      <div class="empty" style="height:100%">
        <div class="empty-icon">🍲</div>
        <h2>Sélectionnez une recette</h2>
        <p>Choisissez une recette dans la liste pour l'afficher.</p>
      </div>`;
    return;
  }

  const chips = recipe.ingredients.length
    ? `<p class="detail-section-label">Ingrédients principaux</p>
       <div class="chips wrap">${[...recipe.ingredients].sort()
         .map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join('')}</div>`
    : '';

  const book = recipe.book
    ? `<div class="book-card">
         ${ICONS.book}
         <div>
           <div class="book-title">${escapeHtml(recipe.book)}</div>
           ${recipe.page != null ? `<div class="book-page">Page ${recipe.page}</div>` : ''}
         </div>
       </div>`
    : '';

  const markdown = recipe.instructionsMarkdown != null
    ? `<div class="markdown">${renderMarkdown(recipe.instructionsMarkdown)}</div>`
    : '';

  el.detailContent.innerHTML = `
    <div class="detail-inner">
      <div class="detail-toolbar">
        <button class="back-btn" id="back-btn">${ICONS.back}Recettes</button>
        <div class="detail-actions">
          <button class="text-btn" id="edit-btn">Modifier</button>
          <button class="text-btn danger" id="delete-btn">Supprimer</button>
        </div>
      </div>
      <h1 class="detail-title">${escapeHtml(recipe.title)}</h1>
      ${chips}${book}${markdown}
    </div>`;

  $('back-btn').onclick = () => {
    state.selectedId = null;
    render();
  };
  $('edit-btn').onclick = () => openForm(recipe);
  $('delete-btn').onclick = async () => {
    if (!window.confirm(`Supprimer « ${recipe.title} » ?`)) return;
    await dbDelete(recipe.id);
    state.recipes = state.recipes.filter((r) => r.id !== recipe.id);
    state.selectedId = null;
    pruneIngredientFilters();
    render();
  };
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
  const recipe = editingRecipe ?? {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
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
    const newRecipes = toAdd.map((dto) => ({ id: crypto.randomUUID(), createdAt: now, ...dto }));
    await dbPutAll(newRecipes);
    state.recipes.push(...newRecipes);
    render();
    showToast(`${toAdd.length} recette(s) importée(s), ${skipped} ignorée(s) (déjà présentes).`);
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
  state.selectedId = null;
  render();
});

$('import-btn').addEventListener('click', () => {
  el.menu.open = false;
  el.fileInput.click();
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
  try {
    state.recipes = await dbGetAll();
  } catch (error) {
    showToast(`Impossible d'ouvrir la base locale : ${error.message}`);
    state.recipes = [];
  }
  render();

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
