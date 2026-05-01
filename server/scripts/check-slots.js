import pg from 'pg'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') })

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const { rows: users } = await pool.query('SELECT id, email, role FROM users ORDER BY created_at')
console.log(`Users (${users.length}):`)
users.forEach(u => console.log(`  ${u.role.padEnd(10)} ${u.email}`))

const { rows: slots } = await pool.query('SELECT id, name, code FROM camera_slots ORDER BY created_at')
console.log(`\nSlots (${slots.length}):`)
slots.forEach(s => console.log(`  ${s.name.padEnd(20)} ${s.code}`))

await pool.end()
