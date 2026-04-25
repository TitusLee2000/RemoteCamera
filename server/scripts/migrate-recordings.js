import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'
import { pool } from '../db/index.js'
import { runMigrations } from '../db/migrate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const jsonPath = join(__dirname, '../recordings.json')

async function migrate() {
  await runMigrations()
  if (!existsSync(jsonPath)) {
    console.log('No recordings.json found — nothing to migrate')
    process.exit(0)
  }
  const records = JSON.parse(readFileSync(jsonPath, 'utf8'))
  console.log(`Migrating ${records.length} recordings…`)
  for (const rec of records) {
    await pool.query(
      `INSERT INTO recordings (id, slot_id, filename, start_time, duration_ms, file_size, uploaded_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [rec.id, rec.filename, new Date(rec.startTime), rec.duration ?? 0, rec.fileSize ?? 0, new Date(rec.uploadedAt)]
    )
  }
  console.log('Migration complete. Old recordings have slot_id = NULL.')
  process.exit(0)
}

migrate().catch((e) => { console.error(e); process.exit(1) })
