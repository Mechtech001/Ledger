// Ledger integration suite - Jest + Supertest + in-memory MongoDB.
// No local database or credentials needed: a throwaway MongoDB spins up for the run.
// Run: npm test

const request = require("supertest")
const mongoose = require("mongoose")
const { MongoMemoryReplSet } = require("mongodb-memory-server")

// Controllers send email (SES/Gmail). Mock the service so tests never touch the network.
jest.mock("../src/services/email.service", () => ({
    sendRegistrationEmail: jest.fn().mockResolvedValue(undefined),
    sendTransactionEmail: jest.fn().mockResolvedValue(undefined),
    sendTransactionFailureEmail: jest.fn().mockResolvedValue(undefined),
}))

process.env.JWT_SECRET = "test-secret-ledger-suite"

const app = require("../src/app")
const userModel = require("../src/models/user.model")
const accountModel = require("../src/models/account.model")
const ledgerModel = require("../src/models/ledger.model")

let replSet

beforeAll(async () => {
    // Single-node replica set: Ledger's transfers use MongoDB transactions,
    // which a standalone mongod does not support.
    replSet = await MongoMemoryReplSet.create({ replSet: { name: "rs0", count: 1 } })
    await mongoose.connect(replSet.getUri())
}, 90000)

afterAll(async () => {
    await mongoose.disconnect()
    if (replSet) await replSet.stop()
})

// The transfer flow holds its MongoDB session open for ~15s (PENDING -> COMPLETED),
// so the happy-path test needs a longer timeout.
jest.setTimeout(60000)

let counter = 0
const nextEmail = () => `user${++counter}@ledger.test`

const register = (name) =>
    request(app)
        .post("/api/auth/register")
        .send({ name, email: nextEmail(), password: "password123" })

const login = (email) =>
    request(app)
        .post("/api/auth/login")
        .send({ email, password: "password123" })

const bearer = (token) => ({ Authorization: `Bearer ${token}` })

const createAccount = async (token) =>
    (await request(app).post("/api/accounts").set(bearer(token))).body.account

// Seed ledger entries directly so an account has a known balance.
const creditAccount = (accountId, amount) =>
    ledgerModel.create({
        account: accountId,
        amount,
        transaction: new mongoose.Types.ObjectId(),
        type: "CREDIT",
    })

const debitAccount = (accountId, amount) =>
    ledgerModel.create({
        account: accountId,
        amount,
        transaction: new mongoose.Types.ObjectId(),
        type: "DEBIT",
    })

describe("Auth", () => {
    it("registers a user and returns a token", async () => {
        const res = await register("Alice")
        expect(res.status).toBe(201)
        expect(res.body.user.email).toMatch(/@/)
        expect(res.body.token).toBeTruthy()
    })

    it("rejects duplicate email with 422", async () => {
        const first = await register("Bob")
        const res = await request(app)
            .post("/api/auth/register")
            .send({ name: "Bob", email: first.body.user.email, password: "password123" })
        expect(res.status).toBe(422)
    })

    it("rejects wrong password with 401", async () => {
        const reg = await register("Carol")
        const res = await request(app)
            .post("/api/auth/login")
            .send({ email: reg.body.user.email, password: "not-the-password" })
        expect(res.status).toBe(401)
    })

    it("blacklists the token on logout", async () => {
        const reg = await register("Dan")
        const token = (await login(reg.body.user.email)).body.token

        const logout = await request(app).post("/api/auth/logout").set(bearer(token))
        expect(logout.status).toBe(200)

        const after = await request(app).get("/api/accounts").set(bearer(token))
        expect(after.status).toBe(401)
    })
})

describe("Accounts", () => {
    it("rejects unauthenticated requests with 401", async () => {
        const res = await request(app).get("/api/accounts")
        expect(res.status).toBe(401)
    })

    it("creates, lists and reads the balance of accounts", async () => {
        const reg = await register("Eve")
        const token = (await login(reg.body.user.email)).body.token

        const created = await request(app).post("/api/accounts").set(bearer(token))
        expect(created.status).toBe(201)
        expect(created.body.account.status).toBe("ACTIVE")

        const listed = await request(app).get("/api/accounts").set(bearer(token))
        expect(listed.status).toBe(200)
        expect(
            listed.body.accounts.some((a) => String(a._id) === String(created.body.account._id))
        ).toBe(true)

        const balance = await request(app)
            .get(`/api/accounts/balance/${created.body.account._id}`)
            .set(bearer(token))
        expect(balance.status).toBe(200)
        expect(balance.body.balance).toBe(0)
    })

    it("returns 404 for another user's account (ownership enforcement)", async () => {
        const alice = await register("Fay")
        const aliceToken = (await login(alice.body.user.email)).body.token
        const aliceAccount = await createAccount(aliceToken)

        const bob = await register("Gus")
        const bobToken = (await login(bob.body.user.email)).body.token

        const res = await request(app)
            .get(`/api/accounts/balance/${aliceAccount._id}`)
            .set(bearer(bobToken))
        expect(res.status).toBe(404)
    })
})

describe("Transactions", () => {
    it("rejects requests with missing fields (400)", async () => {
        const reg = await register("Hank")
        const token = (await login(reg.body.user.email)).body.token
        const res = await request(app)
            .post("/api/transactions")
            .set(bearer(token))
            .send({})
        expect(res.status).toBe(400)
    })

    it("rejects unknown account ids (400)", async () => {
        const reg = await register("Ivy")
        const token = (await login(reg.body.user.email)).body.token
        const fakeId = new mongoose.Types.ObjectId().toString()
        const res = await request(app)
            .post("/api/transactions")
            .set(bearer(token))
            .send({ fromAccount: fakeId, toAccount: fakeId, amount: 10, idempotencyKey: "unknown-accounts" })
        expect(res.status).toBe(400)
    })

    it("rejects insufficient balance (400)", async () => {
        const reg = await register("Jack")
        const token = (await login(reg.body.user.email)).body.token
        const from = await createAccount(token)
        const to = await createAccount(token)
        const res = await request(app)
            .post("/api/transactions")
            .set(bearer(token))
            .send({ fromAccount: from._id, toAccount: to._id, amount: 100, idempotencyKey: "no-funds" })
        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/Insufficient balance/)
    })

    it("completes a transfer and is idempotent on replay", async () => {
        const alice = await register("Kim")
        const aliceToken = (await login(alice.body.user.email)).body.token
        const from = await createAccount(aliceToken)
        await creditAccount(from._id, 1000)

        const bob = await register("Leo")
        const bobToken = (await login(bob.body.user.email)).body.token
        const to = await createAccount(bobToken)

        const body = {
            fromAccount: from._id,
            toAccount: to._id,
            amount: 250,
            idempotencyKey: "idem-replay-test-1",
        }

        // First request - full flow. The controller holds the session ~15s by design.
        const first = await request(app)
            .post("/api/transactions")
            .set(bearer(aliceToken))
            .send(body)
        expect(first.status).toBe(201)
        expect(first.body.transaction.status).toBe("COMPLETED")

        // Replay with the same idempotency key - must NOT double-process.
        const replay = await request(app)
            .post("/api/transactions")
            .set(bearer(aliceToken))
            .send(body)
        expect(replay.status).toBe(200)
        expect(replay.body.message).toBe("Transaction already processed")
        expect(String(replay.body.transaction._id)).toBe(String(first.body.transaction._id))

        // Exactly one debit and one credit - balances prove no double-processing.
        const fromBal = await request(app)
            .get(`/api/accounts/balance/${from._id}`)
            .set(bearer(aliceToken))
        const toBal = await request(app)
            .get(`/api/accounts/balance/${to._id}`)
            .set(bearer(bobToken))
        expect(fromBal.body.balance).toBe(750)
        expect(toBal.body.balance).toBe(250)

        // Idempotency proof: exactly one debit for the sender (the seeded credit
        // is separate) and one credit for the receiver - the replay added nothing.
        expect(await ledgerModel.countDocuments({ account: from._id, type: "DEBIT" })).toBe(1)
        expect(await ledgerModel.countDocuments({ account: to._id, type: "CREDIT" })).toBe(1)
    }, 30000)

    it("summarizes received, sent and net balance per user", async () => {
        const reg = await register("Mia")
        const token = (await login(reg.body.user.email)).body.token
        const account = await createAccount(token)

        await creditAccount(account._id, 400)
        await debitAccount(account._id, 150)

        const res = await request(app)
            .get("/api/transactions/summary")
            .set(bearer(token))
        expect(res.status).toBe(200)
        expect(res.body.totalReceived).toBe(400)
        expect(res.body.totalSent).toBe(150)
        expect(res.body.netBalance).toBe(250)
        expect(res.body.totalTransactions).toBe(2)
    })
})

describe("System-user RBAC", () => {
    it("rejects normal users on the system endpoint with 403", async () => {
        const reg = await register("Nia")
        const token = (await login(reg.body.user.email)).body.token
        const res = await request(app)
            .post("/api/transactions/system/initial-funds")
            .set(bearer(token))
            .send({ toAccount: new mongoose.Types.ObjectId().toString(), amount: 100, idempotencyKey: "rbac-denial" })
        expect(res.status).toBe(403)
    })

    it("allows system users to fund accounts", async () => {
        const systemUser = await userModel.create({
            name: "System",
            email: nextEmail(),
            password: "password123",
            systemUser: true,
        })
        const loginRes = await request(app)
            .post("/api/auth/login")
            .send({ email: systemUser.email, password: "password123" })
        expect(loginRes.status).toBe(200)
        const token = loginRes.body.token

        // System user needs their own account (the debit side of initial funds).
        const systemAccount = await createAccount(token)
        expect(systemAccount).toBeTruthy()

        const target = await register("Omar")
        const targetToken = (await login(target.body.user.email)).body.token
        const targetAccount = await createAccount(targetToken)

        const res = await request(app)
            .post("/api/transactions/system/initial-funds")
            .set(bearer(token))
            .send({ toAccount: targetAccount._id, amount: 500, idempotencyKey: "sys-test-1" })
        expect(res.status).toBe(201)

        const bal = await request(app)
            .get(`/api/accounts/balance/${targetAccount._id}`)
            .set(bearer(targetToken))
        expect(bal.body.balance).toBe(500)
    })
})
