/**
 * github.js — GitHub Contents API helpers for auto-committing custom cards.
 *
 * Uses a fine-grained PAT stored in localStorage to read/write
 * public/data/custom_cards.json in the repo.
 */

const OWNER = "CmdrKerfy";
const REPO = "tropius-maximus";
const FILE_PATH = "public/data/custom_cards.json";
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
  const decoded = atob(data.content.replace(/\n/g, ""));
  const content = JSON.parse(decoded);
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

/**
 * High-level: append a card to custom_cards.json and commit.
 * Returns the commit result.
 */
export async function commitNewCard(token, card) {
  const { content, sha } = await getFileContents(token);
  content.cards.push(card);
  const message = `Add custom card: ${card.name} (${card.id})`;
  return await updateFileContents(token, content, sha, message);
}
