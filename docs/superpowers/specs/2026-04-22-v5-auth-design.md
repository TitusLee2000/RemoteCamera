# RemoteCamera v5 — Auth & Access Control Design

**Date:** 2026-04-22
**Status:** Approved

---

## Overview

Add authentication and role-based access control to RemoteCamera. The app is publicly
accessible over WAN, so all routes and WebSocket connections must be protected.
A single login page handles both dashboard users (email + password) and camera
operators (slot access code).

---

## Database — PostgreSQL

PostgreSQL is introduced in v5 and used for all persistent state going forward.
The same DB instance serves auth, camera slots, and recordings (replacing the
current `recordings.json` flat file).

### Tables

#### `users`
| column | type | notes |
|--------|------|-------|
| id | UUID | primary key |
| email | TEXT | unique, login identifier |
| password_hash | TEXT | bcrypt |
| role | ENUM(`admin`,`operator`,`viewer`) | |
| created_at | TIMESTAMP | |

#### `sessions`
Managed automatically by `connect-pg-simple`. No manual schema needed.

#### `camera_slots`
| column | type | notes |
|--------|------|-------|
| id | UUID | primary key |
| name | TEXT | friendly name e.g. "Front Door" |
| code | TEXT | unique 12-char nanoid, UNIQUE constraint |
| created_by | UUID | FK → users.id |
| created_at | TIMESTAMP | |

#### `recordings`
Replaces `recordings.json`. References `camera_slots` instead of raw camId.

| column | type | notes |
|--------|------|-------|
| id | TEXT | `{slotId}_{timestamp}` |
| slot_id | UUID | FK → camera_slots.id |
| filename | TEXT | |
| start_time | TIMESTAMP | |
| duration_ms | INTEGER | |
| file_size | INTEGER | bytes |
| uploaded_at | TIMESTAMP | |

---

## Auth Architecture

### Packages added to server
- `passport` + `passport-local` — login strategy
- `express-session` — session cookie management
- `connect-pg-simple` — session storage in Postgres
- `bcrypt` — password hashing
- `pg` — Postgres client
- `nanoid` — camera slot code generation

### New server file structure
```
server/
  db/
    index.js            — pg Pool instance, exported for all routes
    migrate.js          — runs SQL migrations on startup
    migrations/
      001_init.sql      — creates all tables if missing
  auth/
    passport.js         — local strategy, serializeUser, deserializeUser
    middleware.js       — requireAuth(role) middleware
  routes/
    auth.js             — POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
    users.js            — admin-only: list users, delete user, create user
    slots.js            — operator: create slot, list slots, delete slot, regenerate code
    recordings.js       — updated to query DB instead of recordings.json
```

### Session cookie settings
- `httpOnly: true`
- `secure: true` in production (HTTPS), `false` in development
- `sameSite: 'lax'`
- `maxAge: 7 days`, rolling (resets on every request while active)

---

## Roles & Permissions

| Action | Admin | Operator | Viewer |
|--------|-------|----------|--------|
| View camera streams | — | ✓ | ✓ |
| Control cameras (record, dim, lock) | — | ✓ | — |
| Generate / manage camera slots | — | ✓ | — |
| View all recordings | — | ✓ | — |
| View own slot recordings | — | ✓ | ✓ (own slot only) |
| Download recordings | — | ✓ | ✓ (own slot only) |
| Delete recordings | — | ✓ | — |
| List users | ✓ | — | — |
| Create users | ✓ | — | — |
| Delete users | ✓ | — | — |
| Assign roles | ✓ | — | — |

Admins cannot view cameras or recordings — their only surface is account management.

---

## Login Page

Single page at `/login`, two tabs:

### Dashboard tab (default)
- Email + password fields
- "Remember me" checkbox (enables 7-day rolling session)
- `POST /api/auth/login` on submit
- On success: redirect to `/`
- On failure: inline error, no page reload

### Camera tab
- Single "Access Code" input field
- Code validated against `camera_slots` table on submit
- On success: proceeds directly into camera streaming mode
- No user account required — code is the credential

### First-run detection
If `SELECT COUNT(*) FROM users` returns 0, `/login` renders a one-time
"Create Admin Account" form (email + password). After submission, normal
login resumes and this form never appears again.

---

## Route Protection

| Route | Rule |
|-------|------|
| `/` | Requires valid session (any role except admin) → redirect to `/login` |
| `/admin` | Requires `admin` role → redirect to `/login` |
| `/client` | No redirect — code validated at WebSocket layer |
| `/login` | Redirects to `/` if already authenticated |
| `GET /api/*` | Returns `401` if no valid session |
| `POST /api/auth/login` | Public |
| `POST /api/auth/logout` | Requires valid session |

Dashboard JS handles `401` responses by redirecting to `/login`.

---

## Camera Slot System

### Pairing flow
1. Operator creates a slot (provides a friendly name)
2. Server generates a unique 12-char nanoid code:
   - Checked against `camera_slots` for collision before saving
   - `UNIQUE` constraint in DB as final backstop
3. Operator copies code and shares it with whoever sets up the phone
4. Phone opens `/client`, pastes code in Camera tab
5. Server validates code → binds that WebSocket connection to the slot's `id`
6. Camera appears in dashboard under the slot's friendly name

### Slot uniqueness guarantee
- nanoid 12-char from 64-char alphabet ≈ 68 billion combinations
- Collision check before insert
- DB UNIQUE constraint enforces no duplicates
- Camera is bound to exactly one `slot_id` — matching is done on the DB record,
  not the code string, so a camera can only stream to the slot it authenticated against

### Operator actions
- **Add slot** — enter name → server generates code → slot appears in table
- **Remove slot** — confirm → slot deleted → connected camera disconnected immediately
- **Regenerate code** — old code invalidated → new code generated → camera using old code disconnected

### Slot UI (operator-only panel in dashboard)
- Table: Name | Code (masked, reveal + copy button) | Status (live/idle) | Actions
- Status updates in real-time via existing WebSocket camera-list events
- Camera now identified by slot name in the grid, not raw camId

---

## WebSocket Auth

On WebSocket upgrade, server reads the session cookie:
- Dashboard connections: must have a valid session with `operator` or `viewer` role
- Unauthenticated WS connections are dropped immediately

Camera connections:
- First message must be `register` with a valid `code` field
- Server looks up `camera_slots` by code — invalid or deleted code drops the connection
- Valid code: connection is tagged with `slotId` for all future routing

---

## Out of Scope (v5)
- OAuth / social login (planned for a future version)
- Fine-grained per-recording permissions
- Per-camera viewer restrictions
- Mobile native auth flows
- Two-factor authentication
