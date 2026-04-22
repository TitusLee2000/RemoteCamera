// recordings-store.js — reads/writes recordings.json for the RecordingCamera server.
// All functions are async to keep the interface consistent with future DB migration.

import { readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'recordings.json')

/**
 * Load the recordings array from disk. Initializes the file if missing.
 * @returns {Promise<Array>}
 */
async function load() {
  try {
    const raw = await readFile(DB_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') {
      // First run — create empty store
      await writeFile(DB_PATH, '[]', 'utf8')
      return []
    }
    throw err
  }
}

/**
 * Persist the recordings array to disk.
 * @param {Array} entries
 */
async function save(entries) {
  await writeFile(DB_PATH, JSON.stringify(entries, null, 2), 'utf8')
}

/**
 * List all recordings, newest first.
 * @param {string} [camIdFilter] — optional filter by camId
 * @returns {Promise<Array>}
 */
export async function list(camIdFilter) {
  const entries = await load()
  const filtered = camIdFilter
    ? entries.filter((e) => e.camId === camIdFilter)
    : entries
  // Sort newest first by uploadedAt
  return filtered.slice().sort((a, b) => {
    return new Date(b.uploadedAt) - new Date(a.uploadedAt)
  })
}

/**
 * Add a new recording entry.
 * @param {{ id, camId, filename, startTime, duration, fileSize, uploadedAt }} entry
 * @returns {Promise<object>} the added entry
 */
export async function add(entry) {
  const entries = await load()
  entries.push(entry)
  await save(entries)
  return entry
}

/**
 * Remove a recording entry by id.
 * @param {string} id
 * @returns {Promise<boolean>} true if found and removed, false if not found
 */
export async function remove(id) {
  const entries = await load()
  const idx = entries.findIndex((e) => e.id === id)
  if (idx === -1) return false
  entries.splice(idx, 1)
  await save(entries)
  return true
}

/**
 * Get a single recording by id.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getById(id) {
  const entries = await load()
  return entries.find((e) => e.id === id) ?? null
}
