import http from 'k6/http';
import { check, sleep } from 'k6';

// Ledger load test - read path (GET /api/accounts), sustained 50 VUs.
//
// Why 50: a 2026-11-03 stress probe at 200 VUs collapsed to 5.4 req/s with
// 20.8% errors - the free tier (Render + Atlas) saturates between 50 and 100
// concurrent users. 50 VUs is the level this deployment actually sustains
// (19.1 req/s, 3.64% errors, 302ms median, p(95) 3.14s).
//
// Thresholds encode the target, not the claim: p(95) < 2s, errors < 5%.
// On free-tier infrastructure the error threshold passes at 50 VUs; the
// p(95) threshold does not (3.14s).
//
// Run:
//   k6 run -e LEDGER_BASE_URL=https://ledger-hza3.onrender.com \
//          -e LEDGER_EMAIL=<load-test-user-email> \
//          -e LEDGER_PASSWORD=<load-test-user-password> \
//          load-test/ledger.js
//
// Write path (POST /api/transactions) intentionally excluded: each transfer
// holds a MongoDB session open ~15s (PENDING -> COMPLETED). Idempotency under
// replay is proven deterministically by the Jest integration suite instead.

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.LEDGER_BASE_URL || 'http://localhost:3000';
const EMAIL = __ENV.LEDGER_EMAIL;
const PASSWORD = __ENV.LEDGER_PASSWORD;

// One login per VU, cached for the whole run.
let token = null;

function login() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (res.status !== 200) {
    throw new Error(`login failed (status ${res.status}): ${res.body}`);
  }
  return res.json().token;
}

export default function () {
  if (!token) {
    token = login();
  }

  const res = http.get(`${BASE_URL}/api/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response under 2s': (r) => r.timings.duration < 2000,
  });

  sleep(1);
}
