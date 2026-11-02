# Backend Ledger

**Live:** [https://ledger-hza3.onrender.com](https://ledger-hza3.onrender.com)

A financial transaction backend built with Node.js, Express, and MongoDB.

## Tech Stack
- Node.js
- Express
- MongoDB
- Mongoose
- JSON Web Tokens (JWT)
- Nodemailer

## Key Features
- Double-entry bookkeeping via a ledger model
- MongoDB transactions with sessions
- Idempotency keys to prevent duplicate transactions
- JWT authentication with token blacklisting
- System user Role-Based Access Control (RBAC)
- Email notifications via Gmail OAuth2

## API Endpoints

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`

### Accounts
- `POST /api/accounts`
- `GET /api/accounts`
- `GET /api/accounts/balance/:accountId`

### Transactions
- `POST /api/transactions`
- `POST /api/transactions/system/initial-funds`
- `GET /api/transactions/summary`

### System
- `GET /health`

## Setup and Running Locally

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd backend-ledger
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables in a `.env` file.

4. Start the server:
   ```bash
   npm run dev
   ```
   Or for production:
   ```bash
   npm start
   ```

## Testing

Integration suite (Jest + Supertest) running against a throwaway in-memory MongoDB — no local database or credentials needed.

Covers:
- **Auth** — register, duplicate-email rejection (422), wrong-password rejection (401), logout with token blacklisting
- **Accounts** — creation, listing, balance, ownership enforcement (other users get 404)
- **Transactions** — field validation (400), unknown accounts (400), insufficient balance (400), full transfer flow, **idempotency replay (same key twice returns the original transaction; the ledger holds exactly one debit + one credit)**, summary aggregation
- **System-user RBAC** — normal users get 403 on `/system/initial-funds`; system users get 201

Run:
```bash
npm install
npm test
```

## Load testing

k6 script at `load-test/ledger.js` — read path (`GET /api/accounts`) at 200 concurrent VUs. Each VU logs in once via env-provided credentials; no tokens are hardcoded.

```bash
k6 run -e LEDGER_BASE_URL=https://ledger-hza3.onrender.com \
       -e LEDGER_EMAIL=<load-test-user-email> \
       -e LEDGER_PASSWORD=<load-test-user-password> \
       load-test/ledger.js
```

Thresholds: p(95) < 2s, error rate < 5%.

Results from the May 2026 run against the Render deployment: **200 VUs · ~32 req/s · 99.8% success · 1.78s**. Re-run any time with the command above.

Note: the write path is excluded from load by design — each transfer holds a MongoDB session open for ~15s (PENDING → COMPLETED), so write concurrency is intentionally limited. Idempotency under replay is proven deterministically by the integration suite above.

## Environment Variables

```env
MONGO_URI=
JWT_SECRET=
CLIENT_ID=
CLIENT_SECRET=
REFRESH_TOKEN=
EMAIL_USER=
```
