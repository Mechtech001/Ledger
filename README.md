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

## Environment Variables

```env
MONGO_URI=
JWT_SECRET=
CLIENT_ID=
CLIENT_SECRET=
REFRESH_TOKEN=
EMAIL_USER=
```
