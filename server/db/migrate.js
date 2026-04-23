import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pool } from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function runMigrations() {
  const sql = readFileSync(join(__dirname, 'migrations/001_init.sql'), 'utf8')
  await pool.query(sql)
  console.log('[db] migrations complete')
}
