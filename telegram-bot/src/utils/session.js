// Simple in-memory session store for multi-step admin flows (upload, broadcast,
// folder creation, etc.). This is ephemeral state for in-progress interactions
// only — all durable data lives in the database. A single long-running bot
// process makes this safe; if the process restarts, in-progress flows simply
// restart, which is acceptable for admin operations.

const sessions = new Map();

function get(userId) {
  if (!sessions.has(userId)) sessions.set(userId, {});
  return sessions.get(userId);
}

function set(userId, data) {
  sessions.set(userId, data);
}

function clear(userId) {
  sessions.delete(userId);
}

function update(userId, patch) {
  const cur = get(userId);
  set(userId, { ...cur, ...patch });
}

module.exports = { get, set, clear, update };
