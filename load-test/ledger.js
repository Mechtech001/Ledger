import http from 'k6/http';
import { check, sleep } from 'k6';

// Ledger load test - read path (GET /api/accounts) with per-VU login.
//
// Run:
//   k6 run -e LEDGER_BASE_URL=https://your-ledger-url \
//          -e LEDGER_EMAIL=loadtest@example.com \
//          -e LEDGER_PASSWORD=your-password \
//          load-test/ledger.js
//
// Notes:
// - No hardcoded tokens: each VU logs in once and caches its token.
// - Thresholds match the figures quoted in the portfolio: p(95) < 2s, errors < 5%.
// - Write path (POST /api/transactions) intentionally excluded from load: each
//   transfer holds a MongoDB session open ~15s (PENDING -> COMPLETED), so write
//   concurrency is limited by design. Idempotency under replay is proven
//   deterministically by the Jest integration suite instead.

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 200 },
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
