/**
 * github.js — GitHub Contents API helpers for auto-committing custom cards.
 *
 * Uses a fine-grained PAT stored in localStorage to read/write
 * public/data/custom_cards.json in the repo.
 */

const OWNER = "CmdrKerfy";
const REPO = "tropius-maximus";
const FILE_PATH = "public/data/custom_cards.json";
const ANNOTATIONS_FILE_PATH = "public/data/annotations.json";
const API_BASE = "https://api.github.com";

const LS_TOKEN_KEY = "github_pat";

export function getToken() {
  return localStorage.getItem(LS_TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(LS_TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(LS_TOKEN_KEY);
  }
}

/**
 * Fetch the current file content + SHA from the GitHub Contents API.
 * Returns { content: parsed JSON, sha: string }.
 */
export async function getFileContents(token) {
  const resp = await fetch(`${API_BASE}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub API error (${resp.status}): ${body}`);
  }

  const data = await resp.json();

  let content;
  if (data.content && data.content.trim() !== "") {
    const decoded = atob(data.content.replace(/\n/g, ""));
    content = JSON.parse(decoded);
  } else if (data.download_url) {
    // File is too large for inline base64 (>1MB) — fetch raw content via download_url
    const rawResp = await fetch(data.download_url);
    if (!rawResp.ok) throw new Error(`Failed to fetch file contents (${rawResp.status})`);
    content = await rawResp.json();
  } else {
    content = { cards: [] };
  }

  return { content, sha: data.sha };
}

/**
 * Update the file on GitHub (creates a commit).
 * `content` is the full JSON object to write. `sha` is the current file SHA.
 */
export async function updateFileContents(token, content, sha, message) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2) + "\n")));

  const resp = await fetch(`${API_BASE}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: encoded,
      sha,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub commit failed (${resp.status}): ${body}`);
  }

  return await resp.json();
}

export async function getAnnotationsFileContents(token) {
  const resp = await fetch(`${API_BASE}/repos/${OWNER}/${REPO}/contents/${ANNOTATIONS_FILE_PATH}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (resp.status === 404) return { content: {}, sha: null };
  if (!resp.ok) { const body = await resp.text(); throw new Error(`GitHub API error (${resp.status}): ${body}`); }
  const data = await resp.json();
  const decoded = atob(data.content.replace(/\n/g, ""));
  return { content: JSON.parse(decoded), sha: data.sha };
}

export async function updateAnnotationsFileContents(token, content, sha, message) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2) + "\n")));
  const body = { message, content: encoded };
  if (sha) body.sha = sha;
  const resp = await fetch(`${API_BASE}/repos/${OWNER}/${REPO}/contents/${ANNOTATIONS_FILE_PATH}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) { const b = await resp.text(); throw new Error(`GitHub commit failed (${resp.status}): ${b}`); }
  return await resp.json();
}

/**
 * High-level: append a card to custom_cards.json and commit.
 * Returns the commit result.
 */
export async function commitNewCard(token, card) {
  const { content, sha } = await getFileContents(token);
  const existingIdx = content.cards.findIndex((c) => c.id === card.id);
  if (existingIdx >= 0) {
    content.cards[existingIdx] = card;
  } else {
    content.cards.push(card);
  }
  const message = `Add custom card: ${card.name} (${card.id})`;
  return await updateFileContents(token, content, sha, message);
}

/**
 * High-level: remove cards by ID from custom_cards.json and commit.
 */
export async function deleteCardsFromGitHub(token, cardIds) {
  const idsToDelete = new Set(cardIds);
  const { content, sha } = await getFileContents(token);
  const before = content.cards.length;
  content.cards = content.cards.filter((c) => !idsToDelete.has(c.id));
  if (content.cards.length === before) return; // nothing changed
  const label = cardIds.length === 1 ? cardIds[0] : `${cardIds.length} cards`;
  return await updateFileContents(token, content, sha, `Delete custom card(s): ${label}`);
}

/**
 * Poll for the latest Actions workflow run triggered by a specific commit SHA.
 * Returns { runId, status, conclusion, htmlUrl } or null if not found / on error.
 */
export async function pollWorkflowRun(token, commitSha) {
  try {
    const resp = await fetch(
      `${API_BASE}/repos/${OWNER}/${REPO}/actions/runs?head_sha=${commitSha}&per_page=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const run = data.workflow_runs?.[0];
    if (!run) return null;
    return { runId: run.id, status: run.status, conclusion: run.conclusion, htmlUrl: run.html_url };
  } catch {
    return null;
  }
}
