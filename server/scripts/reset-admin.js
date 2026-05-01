import bcrypt from 'bcrypt'
import pg from 'pg'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') })

const EMAIL = 'admin@test.com'
const PASSWORD = 'admin1234'

console.log('Connecting to:', process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://***@'))

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const hash = await bcrypt.hash(PASSWORD, 12)
await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, EMAIL])

// Verify it round-trips correctly
const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [EMAIL])
const ok = await bcrypt.compare(PASSWORD, rows[0].password_hash)

console.log(ok ? '✓ Password reset and verified — login should work' : '✗ Verification failed')
console.log(`  Email:    ${EMAIL}`)
console.log(`  Password: ${PASSWORD}`)
console.log(`  DB host:  ${new URL(process.env.DATABASE_URL).hostname}`)

await pool.end()
