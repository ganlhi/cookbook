// Accès à Google Drive : autorisation OAuth 2.0 et appels REST.
//
// L'app n'a pas de serveur, donc pas de secret client ni de jeton de
// rafraîchissement : on utilise le flux implicite par redirection plein écran
// (`response_type=token`). C'est le seul flux qui fonctionne de façon fiable
// dans une PWA installée sur iOS — les popups y sont capricieuses — et il évite
// de charger une bibliothèque externe. Conséquence assumée : le jeton dure une
// heure et son renouvellement demande un geste de l'utilisateur.
//
// Le scope `drive.file` ne donne accès qu'aux fichiers créés par l'application :
// le reste du Drive lui reste invisible.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

// Éphémères et jamais exportés, mais ils doivent survivre à la redirection :
// localStorage plutôt qu'IndexedDB (accès synchrone au démarrage).
const TOKEN_KEY = 'cookbook.gdrive.token';
const STATE_KEY = 'cookbook.gdrive.state';

/** Marge avant expiration : on préfère redemander un jeton que voir un 401. */
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

export class DriveError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

/**
 * URI de redirection à déclarer à l'identique dans la console Google : origine
 * plus le dossier de l'app (on retire un éventuel `index.html`).
 */
export function redirectUri() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

// ---------------------------------------------------------------------------
// Stockage local (tolérant : Safari peut refuser localStorage en navigation privée)
// ---------------------------------------------------------------------------

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sans stockage, la session dure le temps de la page : acceptable.
  }
}

function currentToken() {
  const token = readJson(TOKEN_KEY);
  if (!token?.accessToken || typeof token.expiresAt !== 'number') return null;
  return Date.now() + EXPIRY_SKEW_MS < token.expiresAt ? token : null;
}

export function hasValidToken() {
  return currentToken() !== null;
}

export function clearToken() {
  writeJson(TOKEN_KEY, null);
}

// ---------------------------------------------------------------------------
// Autorisation
// ---------------------------------------------------------------------------

/**
 * Quitte la page vers l'écran d'autorisation Google. `action` est mémorisée pour
 * savoir quoi reprendre au retour. Ne retourne jamais : la navigation part.
 */
export function authorize({ clientId, email = null, action = 'sync' }) {
  const nonce = crypto.randomUUID();
  writeJson(STATE_KEY, { nonce, action });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    state: nonce,
    include_granted_scopes: 'true',
  });
  // Évite le sélecteur de compte quand on sait déjà lequel utiliser.
  if (email) params.set('login_hint', email);

  location.assign(`${AUTH_ENDPOINT}?${params}`);
}

/**
 * À appeler au démarrage. Si l'URL porte une réponse d'autorisation, la
 * consomme (jeton stocké, fragment nettoyé) et retourne `{ action }` ou
 * `{ action, error }`. Retourne null quand il n'y a rien à traiter.
 */
export function consumeRedirect() {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!fragment.includes('access_token=') && !fragment.includes('error=')) return null;

  const params = new URLSearchParams(fragment);
  history.replaceState(null, '', location.pathname + location.search);

  const pending = readJson(STATE_KEY);
  writeJson(STATE_KEY, null);
  if (!pending || params.get('state') !== pending.nonce) {
    return { action: null, error: 'Réponse d’autorisation inattendue' };
  }

  const error = params.get('error');
  if (error) {
    return {
      action: pending.action,
      error: error === 'access_denied' ? 'Autorisation refusée' : `Autorisation refusée (${error})`,
    };
  }

  const accessToken = params.get('access_token');
  if (!accessToken) return { action: pending.action, error: 'Aucun jeton reçu' };

  const expiresIn = Number.parseInt(params.get('expires_in'), 10);
  writeJson(TOKEN_KEY, {
    accessToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  });
  return { action: pending.action };
}

// ---------------------------------------------------------------------------
// Appels REST
// ---------------------------------------------------------------------------

async function driveMessage(response) {
  const body = await response.text().catch(() => '');
  try {
    const message = JSON.parse(body)?.error?.message;
    if (message) return message;
  } catch {
    // Corps non JSON : on retombe sur le code HTTP.
  }
  return `Google Drive a répondu ${response.status}`;
}

async function request(url, options = {}) {
  const token = currentToken();
  if (!token) throw new DriveError('Autorisation Google expirée', 401);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token.accessToken}`, ...options.headers },
    });
  } catch {
    throw new DriveError('Google Drive injoignable', 0);
  }

  if (response.status === 401) {
    clearToken();
    throw new DriveError('Autorisation Google expirée', 401);
  }
  if (!response.ok) throw new DriveError(await driveMessage(response), response.status);
  return response;
}

/** Métadonnées du fichier de synchronisation, ou null s'il n'existe pas encore. */
export async function findFile(name) {
  const params = new URLSearchParams({
    q: `name = '${name.replaceAll("'", "\\'")}' and trashed = false`,
    spaces: 'drive',
    fields: 'files(id,name,version,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '10',
  });
  const data = await (await request(`${API}/files?${params}`)).json();
  return data.files?.[0] ?? null;
}

export async function fileMeta(id) {
  const params = new URLSearchParams({ fields: 'id,version,modifiedTime,trashed' });
  return (await request(`${API}/files/${encodeURIComponent(id)}?${params}`)).json();
}

export async function readFile(id) {
  return (await request(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
}

export async function writeFile(id, content) {
  const params = new URLSearchParams({ uploadType: 'media', fields: 'id,version,modifiedTime' });
  return (await request(`${UPLOAD_API}/files/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  })).json();
}

/** Création en deux temps (métadonnées puis contenu) : évite d'assembler un multipart. */
export async function createFile(name, content) {
  const created = await (await request(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/json' }),
  })).json();
  return writeFile(created.id, content);
}

/** Compte connecté, pour l'afficher et pré-remplir `login_hint`. Best effort. */
export async function accountEmail() {
  try {
    const data = await (await request(`${API}/about?fields=user(emailAddress)`)).json();
    return data.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}
