# TrainServe Backend — Complete Setup Guide

## Folder Structure

```
trainserve-backend/
├── src/
│   ├── index.js                  ← main server file
│   ├── db/
│   │   ├── pool.js               ← database connection
│   │   └── init.js               ← creates tables automatically
│   ├── middleware/
│   │   └── auth.js               ← JWT authentication
│   └── routes/
│       ├── auth.js               ← login, register, crew-login
│       ├── users.js              ← crew list, all users, logout
│       ├── orders.js             ← all order operations
│       └── notifications.js      ← notifications
├── scripts/
│   └── seed.js                   ← creates admin + crew accounts
├── .env.example                  ← template — copy to .env
├── .gitignore
└── package.json
```

---

## Step 1 — Install Node.js (if not installed)

Download from https://nodejs.org — install the **LTS** version.
Verify: open a terminal and run:
```
node -v      # should show v18 or higher
npm -v       # should show 9 or higher
```

---

## Step 2 — Install PostgreSQL (if not installed)

Download from https://www.postgresql.org/download/
During installation, remember the password you set for the `postgres` user.

---

## Step 3 — Create the database

Open **pgAdmin** (installed with PostgreSQL) or run in terminal:
```sql
-- in psql or pgAdmin query tool:
CREATE DATABASE trainserve;
```

---

## Step 4 — Fill in your .env file

Copy `.env.example` to `.env`:
```
cp .env.example .env
```

Open `.env` and fill in **every blank value**:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trainserve          ← name of the database you just created
DB_USER=postgres            ← your PostgreSQL username (usually postgres)
DB_PASSWORD=your_password   ← the password you set during PostgreSQL install

JWT_SECRET=paste_a_long_random_string_here   ← generate one (see below)

PORT=8080

FRONTEND_ORIGIN=https://yourusername.github.io   ← your GitHub Pages URL
```

**Generate a JWT secret** (run in terminal):
```
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output and paste it as `JWT_SECRET`.

---

## Step 5 — Install dependencies

Open a terminal inside the `trainserve-backend` folder:
```
npm install
```

---

## Step 6 — Start the server (creates all tables automatically)

```
npm start
```

You should see:
```
✓ Database tables ready
🚂 TrainServe backend running on http://localhost:8080
```

---

## Step 7 — Seed the database (run ONCE)

Open `scripts/seed.js` and change the admin email/password and crew PINs to what you want, then run:

```
node scripts/seed.js
```

This creates:
- An **admin** account you can log in with
- **3 crew members** with their IDs and PINs

---

## Step 8 — Expose your backend via ngrok

Your backend runs on `localhost:8080`. For your GitHub Pages frontend to reach it, you need to expose it to the internet using ngrok.

**Install ngrok:** https://ngrok.com/download

**Run it** (in a new terminal, while the backend is running):
```
ngrok http 8080
```

You'll see output like:
```
Forwarding   https://abc123.ngrok-free.app -> http://localhost:8080
```

Copy that `https://` URL.

---

## Step 9 — Connect frontend to backend

On your GitHub Pages site, when you first open it, click the **"Configure Backend URL"** button and paste:
```
https://abc123.ngrok-free.app/api
```
(add `/api` at the end of the ngrok URL)

The frontend saves this in your browser's localStorage, so you only need to do it once per browser.

> ⚠️ **Free ngrok URLs change every time you restart ngrok.**
> You'll need to update the URL in the frontend settings each time.
> To get a permanent URL, sign up for a free ngrok account.

---

## Where values live — quick reference

| What | File | Key |
|------|------|-----|
| Database name | `.env` | `DB_NAME` |
| Database user | `.env` | `DB_USER` |
| Database password | `.env` | `DB_PASSWORD` |
| JWT secret | `.env` | `JWT_SECRET` |
| Server port | `.env` | `PORT` |
| GitHub Pages URL | `.env` | `FRONTEND_ORIGIN` |
| Admin email/password | `scripts/seed.js` | `ADMIN` object |
| Crew names/PINs | `scripts/seed.js` | `CREW_MEMBERS` array |

---

## Development workflow (daily)

1. Start PostgreSQL (it may start automatically on Windows)
2. `cd trainserve-backend && npm start`
3. `ngrok http 8080` in another terminal
4. Open your GitHub Pages site and update backend URL if needed

---

## Frontend changes needed (in your HTML file)

The frontend already has the dynamic URL system built in. The only thing you need to verify is the `DEFAULT_BACKEND_URL_GITHUB_PAGES` constant at the top of the `<script>` block. You can leave it as-is since users configure the URL through the UI.

**No other frontend changes are needed.** All API paths already match the backend routes.

---

## API Endpoints Reference

| Method | Path | Who | What |
|--------|------|-----|------|
| GET | /api/auth/crew-list | Public | Crew names for login dropdown |
| POST | /api/auth/register | Public | Create user account |
| POST | /api/auth/login | Public | User/admin login |
| POST | /api/auth/crew-login | Public | Crew PIN login |
| GET | /api/users/crew | Auth | List all crew |
| GET | /api/users/all | Admin | List all users |
| POST | /api/users/logout | Auth | Mark crew offline |
| POST | /api/orders | Auth | Place new order |
| GET | /api/orders/my | Auth | My orders |
| GET | /api/orders/pending | Crew/Admin | Pending orders |
| GET | /api/orders/deliveries | Crew | My deliveries |
| GET | /api/orders/all | Admin | All orders |
| GET | /api/orders/stats | Admin | Dashboard stats |
| PATCH | /api/orders/:id/accept | Crew | Accept order |
| PATCH | /api/orders/:id/assign | Admin | Assign crew |
| PATCH | /api/orders/:id/payment-screenshot | Crew | Upload payment proof |
| PATCH | /api/orders/:id/complete | Crew | Mark delivered |
| GET | /api/orders/admin/logs | Admin | Audit event log |
| GET | /api/orders/admin/delivery-logs | Admin | Delivery timeline |
| GET | /api/orders/admin/payments | Admin | Payment records |
| GET | /api/notifications | Auth | Get notifications |
| PATCH | /api/notifications/mark-read | Auth | Mark all read |
