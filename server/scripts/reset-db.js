import pg from 'pg'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') })

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

await pool.query('DELETE FROM recordings')
await pool.query('DELETE FROM camera_slots')
await pool.query('DELETE FROM users')
console.log('✓ Database cleared — go to /login to run first-time setup')
await pool.end()
