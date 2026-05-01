import bcrypt from 'bcrypt'
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

const EMAIL = 'admin@remotecamera.app'
const PASSWORD = 'admin1234'

const hash = await bcrypt.hash(PASSWORD, 12)
await pool.query(
  `INSERT INTO users (email, password_hash, role)
   VALUES ($1, $2, 'admin')
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
  [EMAIL, hash]
)
console.log('✓ Admin account ready')
console.log(`  Email:    ${EMAIL}`)
console.log(`  Password: ${PASSWORD}`)
await pool.end()
