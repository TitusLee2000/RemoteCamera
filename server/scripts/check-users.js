import pg from 'pg'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') })

const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
})

const { rows } = await pool.query('SELECT id, email, role, password_hash, created_at FROM users ORDER BY created_at')
if (rows.length === 0) {
  console.log('No users found in database.')
} else {
  console.log(`Found ${rows.length} user(s):`)
  rows.forEach(u => console.log(`  ${u.role.padEnd(10)} ${u.email}  hash:${u.password_hash.slice(0,10)}...`))
}
await pool.end()
