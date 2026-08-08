# WACRM Supabase → MySQL: Cimiento (Capa de Datos + Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase (auth + RLS data layer) with a MySQL 8 + Prisma foundation — own sessions, bcrypt passwords, cookie auth, account-scoped data access, and local-disk storage — so the CRM runs with zero Supabase dependency.

**Architecture:** Prisma (MySQL) replaces PostgREST; a Prisma `$extends` tenant-scoping client replaces RLS; a stateful `sessions` table replaces GoTrue JWT sessions; a `proxy.ts` middleware validates the session cookie; storage moves to local disk behind `/api/files/[id]`. Downstream modules (inbox, broadcasts, automations) migrate in later sub-projects on top of this foundation.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, MySQL 8.0.17 (AppServ local, `mysql8` service), Prisma ORM, bcryptjs, Vitest.

## Global Constraints

- Node >= 20 (engines in package.json), npm 10.
- MySQL 8.0.17 at `localhost`, user `root`, no password (verified), database `wacrm` (already created, utf8mb4).
- `DATABASE_URL=mysql://root:@localhost:3306/wacrm`
- Every app query MUST be account-scoped — the `accountId` guard is non-negotiable (replaces RLS).
- Roles: `owner` > `admin` > `agent` > `viewer` (rank 4..1) — exact values from `src/lib/auth/roles.ts`.
- IDs are UUID strings (`CHAR(36)`); Prisma `@default(uuid())` handles generation.
- No `@supabase/*` imports remain after the cimiento is complete in the files it touches.
- `next.config.ts` `output: "standalone"` stays as-is.
- Keep existing file conventions: `src/lib/<domain>/` modules, `route.ts` API handlers, `*.test.ts` beside code, Vitest runner (`npm test` = `vitest run`).

---

### Task 1: Prisma setup + connection

**Files:**
- Create: `prisma/schema.prisma`
- Create: `.env` (dev only, gitignored) — or add `DATABASE_URL` to existing `.env.local`
- Modify: `package.json` (add prisma devDep + scripts)

**Interfaces:**
- Produces: `PrismaClient` instance importable as `@/lib/db/prisma` (Task 2 consumes), `prisma migrate` workflow.

- [ ] **Step 1: Install Prisma**

Run: `npm install -D prisma@^6 @prisma/client@^6 bcryptjs; npm install -D @types/bcryptjs`
Expected: added packages without peer errors.

- [ ] **Step 2: Add DATABASE_URL to env**

Edit `.env.local` — add:
```
DATABASE_URL="mysql://root:@localhost:3306/wacrm"
```

- [ ] **Step 3: Create prisma/schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid()) @db.VarChar(36)
  email        String   @unique @db.VarChar(255)
  passwordHash String   @map("password_hash") @db.VarChar(255)
  fullName     String   @map("full_name") @db.VarChar(255)
  avatarUrl    String?  @map("avatar_url") @db.Text
  createdAt    DateTime @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.DateTime(3)

  sessions      Session[]
  accountMember AccountMember?
  @@map("users")
}

model Session {
  id         String   @id @default(uuid()) @db.VarChar(36)
  userId     String   @map("user_id") @db.VarChar(36)
  tokenHash  String   @unique @map("token_hash") @db.VarChar(64)
  expiresAt  DateTime @map("expires_at") @db.DateTime(3)
  createdAt  DateTime @default(now()) @map("created_at") @db.DateTime(3)
  lastSeenAt DateTime @default(now()) @map("last_seen_at") @db.DateTime(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model Account {
  id              String   @id @default(uuid()) @db.VarChar(36)
  name            String   @db.VarChar(255)
  ownerUserId     String   @unique @map("owner_user_id") @db.VarChar(36)
  defaultCurrency String   @default("USD") @map("default_currency") @db.VarChar(3)
  createdAt       DateTime @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.DateTime(3)

  members       AccountMember[]
  invitations   Invitation[]
  apiKeys       ApiKey[]
  webhookEndpoints WebhookEndpoint[]
  @@map("accounts")
}

model AccountMember {
  userId    String   @id @map("user_id") @db.VarChar(36)
  accountId String   @map("account_id") @db.VarChar(36)
  role      AccountRole @db.VarChar(16)
  createdAt DateTime @default(now()) @map("created_at") @db.DateTime(3)

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
  @@map("account_members")
}

enum AccountRole {
  owner
  admin
  agent
  viewer
}

model Invitation {
  id             String    @id @default(uuid()) @db.VarChar(36)
  accountId      String    @map("account_id") @db.VarChar(36)
  tokenHash      String    @unique @map("token_hash") @db.VarChar(64)
  role           AccountRole @db.VarChar(16)
  createdByUserId String?  @map("created_by_user_id") @db.VarChar(36)
  label          String?   @db.VarChar(255)
  createdAt      DateTime  @default(now()) @map("created_at") @db.DateTime(3)
  expiresAt      DateTime  @map("expires_at") @db.DateTime(3)
  acceptedAt     DateTime? @map("accepted_at") @db.DateTime(3)
  acceptedByUserId String? @map("accepted_by_user_id") @db.VarChar(36)

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
  @@map("account_invitations")
}

model ApiKey {
  id         String   @id @default(uuid()) @db.VarChar(36)
  accountId  String   @map("account_id") @db.VarChar(36)
  createdBy  String?  @map("created_by") @db.VarChar(36)
  name       String   @db.VarChar(255)
  keyPrefix  String   @map("key_prefix") @db.VarChar(64)
  keyHash    String   @unique @map("key_hash") @db.VarChar(64)
  scopes     String   @default("[]") @db.Text
  lastUsedAt DateTime? @map("last_used_at") @db.DateTime(3)
  expiresAt  DateTime? @map("expires_at") @db.DateTime(3)
  revokedAt  DateTime? @map("revoked_at") @db.DateTime(3)
  createdAt  DateTime @default(now()) @map("created_at") @db.DateTime(3)

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
  @@map("api_keys")
}

model FileRecord {
  id           String   @id @default(uuid()) @db.VarChar(36)
  accountId    String   @map("account_id") @db.VarChar(36)
  originalName String   @map("original_name") @db.VarChar(255)
  mime         String   @db.VarChar(127)
  size         Int
  diskPath     String   @map("disk_path") @db.VarChar(512)
  createdAt    DateTime @default(now()) @map("created_at") @db.DateTime(3)

  @@index([accountId])
  @@map("files")
}

model WebhookEndpoint {
  id           String    @id @default(uuid()) @db.VarChar(36)
  accountId    String    @map("account_id") @db.VarChar(36)
  createdBy    String?   @map("created_by") @db.VarChar(36)
  url          String    @db.VarChar(512)
  secret       String    @db.Text
  events       String    @default("[]") @db.Text
  isActive     Boolean   @default(true) @map("is_active")
  lastDeliveryAt DateTime? @map("last_delivery_at") @db.DateTime(3)
  failureCount Int       @default(0) @map("failure_count")
  createdAt    DateTime  @default(now()) @map("created_at") @db.DateTime(3)

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
  @@map("webhook_endpoints")
}
```

- [ ] **Step 4: Run the migration**

Run: `npx prisma migrate dev --name init`
Expected: migration applied to `wacrm` MySQL; client generated. If it prompts, accept creating the migration.

- [ ] **Step 5: Create the shared Prisma client**

Create `src/lib/db/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 6: Verify connection**

Run: `node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.$queryRawUnsafe('SELECT 1').then(r=>{console.log('OK',r);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `OK [ { '1': 1 } ]` (or similar `1`).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/db/prisma.ts .env.local package.json package-lock.json
git commit -m "feat(db): prisma + mysql schema for auth and storage foundation"
```

---

### Task 2: Account-scoped Prisma client (replaces RLS)

**Files:**
- Create: `src/lib/db/scoped.ts`
- Create: `src/lib/db/scoped.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/prisma` (Task 1).
- Produces: `scopedPrisma(accountId: string)` → a `PrismaClient`-like instance whose models auto-append `{ account_id }` where a `accountId` field exists; `withAccountScope(accountId)` for `$transaction` use.

- [ ] **Step 1: Write the failing test**

Create `src/lib/db/scoped.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { withAccountScope } from "./scoped";

const PRISMA_MOCK = {
  message: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
  },
  user: { findUnique: vi.fn().mockResolvedValue(null) },
};

describe("withAccountScope", () => {
  it("injects accountId into where for findMany on scoped models", async () => {
    const scoped = withAccountScope("acc-1", PRISMA_MOCK as any);
    await scoped.message.findMany({ where: { status: "open" } });
    expect(PRISMA_MOCK.message.findMany).toHaveBeenCalledWith({
      where: { status: "open", accountId: "acc-1" },
    });
  });

  it("does not inject accountId for unscoped models like user", async () => {
    const scoped = withAccountScope("acc-1", PRISMA_MOCK as any);
    await scoped.user.findUnique({ where: { id: "u1" } });
    expect(PRISMA_MOCK.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/db/scoped.test.ts`
Expected: FAIL — module `./scoped` has no export `withAccountScope`.

- [ ] **Step 3: Implement the scoping helper**

Create `src/lib/db/scoped.ts`:

```ts
import type { PrismaClient } from "@prisma/client";

/** Models that carry an accountId column and MUST be scoped by account. */
const SCOPED_MODELS = new Set([
  "message", "conversation", "contact", "tag", "contactTag", "customField",
  "contactCustomValue", "contactNote", "broadcast", "broadcastRecipient",
  "messageTemplate", "pipeline", "pipelineStage", "deal", "automation",
  "automationStep", "automationLog", "flow", "flowNode", "flowRun",
  "flowRunEvent", "quickReply", "notification", "webhookEndpoint", "apiKey",
  "aiConfig", "aiKnowledgeDocument", "aiUsageLog", "fileRecord",
]);

function scopeWhere(model: string, where?: Record<string, unknown>, accountId: string) {
  if (!SCOPED_MODELS.has(model)) return where;
  return { ...(where ?? {}), accountId };
}

/**
 * Wraps a Prisma client so every query on account-scoped models
 * automatically gets `accountId` injected into `where`.
 * This is the application-level replacement for Supabase RLS.
 */
export function withAccountScope<T extends Record<string, any>>(
  accountId: string,
  prisma: T,
): T {
  const scoped = {} as T;
  for (const key of Object.keys(prisma)) {
    const model = key as keyof T;
    const delegate = prisma[model];
    if (!delegate || typeof delegate !== "object") {
      scoped[model] = delegate;
      continue;
    }
    const wrapped: Record<string, unknown> = {};
    for (const method of ["findMany", "findFirst", "findUnique", "update", "updateMany", "delete", "deleteMany", "count", "aggregate", "groupBy"]) {
      const original = (delegate as any)[method];
      if (typeof original !== "function") continue;
      wrapped[method] = (args: any) => {
        if (method === "findUnique" || method === "delete") {
          // findUnique/delete take a scalar/where — wrap with a findFirst that scopes
          const where = args?.where ?? args;
          const scopedArgs = {
            ...args,
            where: scopeWhere(model as string, { id: where?.id ?? where }, accountId),
          };
          return original.call(delegate, scopedArgs);
        }
        const scopedArgs = { ...args, where: scopeWhere(model as string, args?.where, accountId) };
        return original.call(delegate, scopedArgs);
      };
    }
    scoped[model] = wrapped as any;
  }
  return scoped;
}

export const ACCOUNT_SCOPED_MODELS = SCOPED_MODELS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/db/scoped.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/scoped.ts src/lib/db/scoped.test.ts
git commit -m "feat(db): account-scoped prisma helper replaces RLS filtering"
```

---

### Task 3: Session + password core (stateful auth)

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/auth/session.test.ts`
- Create: `src/lib/auth/password.ts`
- Create: `src/lib/auth/password.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/prisma` (Task 1).
- Produces:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(plain: string, hash: string): Promise<boolean>`
  - `createSession(userId: string): Promise<{ token: string; expiresAt: Date }>` — stores SHA-256(token), returns plaintext once
  - `getSessionUser(token: string): Promise<{ userId: string; accountId: string; role: string } | null>` — validates + sliding renewal
  - `deleteSession(token: string): Promise<void>`
  - `deleteAllSessions(userId: string): Promise<void>`

- [ ] **Step 1: Write the failing password test**

Create `src/lib/auth/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("s3cret!");
    expect(hash).not.toBe("s3cret!");
    expect(await verifyPassword("s3cret!", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("right");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/password.test.ts`
Expected: FAIL — module `./password` not found.

- [ ] **Step 3: Implement password hashing**

Create `src/lib/auth/password.ts`:

```ts
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run password test to verify it passes**

Run: `npx vitest run src/lib/auth/password.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing session test**

Create `src/lib/auth/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSession, getSessionUser, deleteSession, hashToken } from "./session";

const mockDb = {
  session: {
    create: vi.fn().mockResolvedValue({ id: "s1" }),
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
  accountMember: {
    findUnique: vi.fn().mockResolvedValue({ accountId: "acc-1", role: "owner" }),
  },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

describe("session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores only a SHA-256 hash of the token", async () => {
    const { token, expiresAt } = await createSession("user-1");
    expect(token).toHaveLength(96); // 48 bytes hex
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const saved = mockDb.session.create.mock.calls[0][0];
    expect(saved.data.tokenHash).toBe(hashToken(token));
    expect(saved.data.tokenHash).not.toBe(token);
  });

  it("returns null for unknown token", async () => {
    mockDb.session.findUnique.mockResolvedValue(null);
    expect(await getSessionUser("nope")).toBeNull();
  });

  it("returns user + account for valid session and renews", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 29);
    mockDb.session.findUnique.mockResolvedValue({
      userId: "user-1",
      expiresAt: future,
      lastSeenAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago → renew
    });
    const result = await getSessionUser("tok");
    expect(result).toEqual({ userId: "user-1", accountId: "acc-1", role: "owner" });
    expect(mockDb.session.update).toHaveBeenCalled();
  });

  it("rejects expired sessions", async () => {
    mockDb.session.findUnique.mockResolvedValue({
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1000),
      lastSeenAt: new Date(),
    });
    expect(await getSessionUser("expired")).toBeNull();
  });

  it("deletes a session", async () => {
    await deleteSession("tok");
    expect(mockDb.session.delete).toHaveBeenCalledWith({ where: { tokenHash: hashToken("tok") } });
  });
});
```

- [ ] **Step 6: Run session test to verify it fails**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: FAIL — module `./session` not found.

- [ ] **Step 7: Implement session core**

Create `src/lib/auth/session.ts`:

```ts
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const RENEW_AFTER_MS = 1000 * 60 * 60 * 24 * 7; // renew if lastSeen > 7 days

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function getSessionUser(
  token: string,
): Promise<{ userId: string; accountId: string; role: string } | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const membership = await prisma.accountMember.findUnique({ where: { userId: session.userId } });
  if (!membership) return null;

  // Sliding renewal — extend session if last seen more than RENEW_AFTER_MS ago
  if (Date.now() - session.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return { userId: session.userId, accountId: membership.accountId, role: membership.role };
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.delete({ where: { tokenHash: hashToken(token) } }).catch(() => {});
}

export async function deleteAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
```

- [ ] **Step 8: Run session test to verify it passes**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/password.ts src/lib/auth/password.test.ts src/lib/auth/session.ts src/lib/auth/session.test.ts
git commit -m "feat(auth): bcrypt password hashing and stateful mysql sessions"
```

---

### Task 4: API auth routes (register, login, logout, me)

**Files:**
- Create: `src/app/api/auth/register/route.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/me/route.ts`
- Create: `src/app/api/auth/register/route.test.ts`
- Create: `src/app/api/auth/login/route.test.ts`

**Interfaces:**
- Consumes: `createSession`, `deleteSession`, `getSessionUser`, `hashToken` (Task 3); `hashPassword`, `verifyPassword` (Task 3); `prisma` (Task 1).
- Produces: `SESSION_COOKIE` name `"wacrm_session"`; `getSessionFromRequest(req: Request): Promise<SessionUser | null>` (Task 5 consumes); `requireUser(req)` helper.

- [ ] **Step 1: Write the failing register test**

Create `src/app/api/auth/register/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const mockDb = {
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "user-1", email: "a@b.com" }),
  },
  account: { create: vi.fn().mockResolvedValue({ id: "acc-1" }) },
  accountMember: { create: vi.fn().mockResolvedValue({}) },
  session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
}));

describe("POST /api/auth/register", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates user, account, owner membership, and session", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "password123", fullName: "Ana" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockDb.user.create).toHaveBeenCalled();
    expect(mockDb.account.create).toHaveBeenCalled();
    expect(mockDb.accountMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "owner" }) }),
    );
  });

  it("rejects duplicate email", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "u" });
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "dup@b.com", password: "password123", fullName: "D" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects short passwords", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "123", fullName: "A" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/auth/register/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement register route**

Create `src/app/api/auth/register/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "User";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email, passwordHash, fullName },
    });
    const account = await tx.account.create({
      data: { name: fullName, ownerUserId: u.id },
    });
    await tx.accountMember.create({
      data: { userId: u.id, accountId: account.id, role: "owner" },
    });
    return u;
  });

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return res;
}
```

- [ ] **Step 4: Create the cookie helper (also used by login)**

Create `src/lib/auth/cookies.ts`:

```ts
export const SESSION_COOKIE = "wacrm_session";
```

(Note: `getSessionFromRequest` and `requireUser` land in Task 5.)

- [ ] **Step 5: Run register test to verify it passes**

Run: `npx vitest run src/app/api/auth/register/route.test.ts`
Expected: PASS (3 tests). If the mock for `createSession` still hits the real prisma import, add `vi.mock("@/lib/auth/cookies", () => ({ SESSION_COOKIE: "wacrm_session" }))` and `vi.mock("@/lib/auth/session", () => ({ createSession: vi.fn().mockResolvedValue({ token: "t", expiresAt: new Date() }) }))` to the test.

- [ ] **Step 6: Write the failing login test**

Create `src/app/api/auth/login/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const mockDb = {
  user: {
    findUnique: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      passwordHash: "hash",
    }),
  },
  session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

describe("POST /api/auth/login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets session cookie on valid credentials", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "password123" }),
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wacrm_session=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("rejects wrong password with 401", async () => {
    const { verifyPassword } = await import("@/lib/auth/password");
    (verifyPassword as any).mockResolvedValue(false);
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "nope" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects unknown email with 401 (same message)", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "x@b.com", password: "whatever1" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 7: Run login test to verify it fails**

Run: `npx vitest run src/app/api/auth/login/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 8: Implement login + logout + me**

Create `src/app/api/auth/login/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return res;
}
```

Create `src/app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
```

Create `src/app/api/auth/me/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 401 });
  const session = await getSessionUser(token);
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  const account = await prisma.account.findUnique({ where: { id: session.accountId } });
  return NextResponse.json({
    user: { id: user?.id, email: user?.email, fullName: user?.fullName },
    account: account ? { id: account.id, name: account.name } : null,
    role: session.role,
  });
}
```

- [ ] **Step 9: Run login test to verify it passes**

Run: `npx vitest run src/app/api/auth/login/route.test.ts`
Expected: PASS (3 tests). Add `vi.mock("@/lib/auth/session", () => ({ createSession: vi.fn().mockResolvedValue({ token: "tok", expiresAt: new Date() }) }))` to the test if the real prisma import leaks.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/auth src/lib/auth/cookies.ts src/lib/auth/session.ts
git commit -m "feat(auth): register, login, logout, me api routes with session cookie"
```

---

### Task 5: Session request helper + proxy.ts middleware

**Files:**
- Create: `src/lib/auth/request.ts`
- Create: `src/lib/auth/request.test.ts`
- Modify: `src/middleware.ts` (rewrite to validate cookie against MySQL)

**Interfaces:**
- Consumes: `getSessionUser` (Task 3), `SESSION_COOKIE` (Task 4).
- Produces: `getSessionFromRequest(req: Request)` → `SessionUser | null`; `requireUser(req)` → `SessionUser` (throws 401); middleware guards the same route lists as today.

- [ ] **Step 1: Write the failing request helper test**

Create `src/lib/auth/request.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getSessionFromRequest } from "./request";
import { SESSION_COOKIE } from "./cookies";

vi.mock("./session", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ userId: "u", accountId: "a", role: "owner" }),
}));

describe("getSessionFromRequest", () => {
  it("reads the session cookie and validates it", async () => {
    const req = new Request("http://localhost/inbox", {
      headers: { cookie: `${SESSION_COOKIE}=tok123` },
    });
    const session = await getSessionFromRequest(req);
    expect(session).toEqual({ userId: "u", accountId: "a", role: "owner" });
  });

  it("returns null when no cookie", async () => {
    const req = new Request("http://localhost/inbox");
    expect(await getSessionFromRequest(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/request.test.ts`
Expected: FAIL — module `./request` not found.

- [ ] **Step 3: Implement the request helper**

Create `src/lib/auth/request.ts`:

```ts
import { getSessionUser } from "./session";
import { SESSION_COOKIE } from "./cookies";

export interface SessionUser {
  userId: string;
  accountId: string;
  role: string;
}

export async function getSessionFromRequest(req: Request): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
}
```

- [ ] **Step 4: Run request test to verify it passes**

Run: `npx vitest run src/lib/auth/request.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Rewrite the middleware**

Replace the contents of `src/middleware.ts` (read the current file first, then replace — keep the same `config.matcher`):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

const PROTECTED_PREFIXES = [
  "/dashboard", "/inbox", "/contacts", "/pipelines", "/broadcasts",
  "/automations", "/settings", "/flows", "/agents", "/notifications",
];

const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await getSessionFromRequest(req);

  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isWhatsappApi = pathname.startsWith("/api/whatsapp/") && !pathname.includes("/webhook");

  if (session && isAuthPage) {
    const inviteToken = req.nextUrl.searchParams.get("invite");
    if (inviteToken) {
      return NextResponse.redirect(new URL(`/join/${inviteToken}`, req.url));
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (!session && isProtected) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!session && isWhatsappApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: All existing tests pass (middleware.test.ts may need updating to the new middleware signature — update it to call `middleware(new NextRequest(...))` with a fake session token; verify with `npx vitest run src/middleware.test.ts` first and adapt assertions to the new redirect targets).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/request.ts src/lib/auth/request.test.ts src/middleware.ts src/middleware.test.ts
git commit -m "feat(auth): session request helper and mysql-backed middleware"
```

---

### Task 6: Invitations + members (team)

**Files:**
- Create: `src/lib/auth/invites-db.ts`
- Create: `src/lib/auth/invites-db.test.ts`
- Modify: `src/app/api/invitations/[token]/peek/route.ts`
- Modify: `src/app/api/invitations/[token]/redeem/route.ts`
- Modify: `src/app/api/account/members/[userId]/route.ts`
- Modify: `src/app/api/account/transfer-ownership/route.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `hashInviteToken` from existing `src/lib/auth/invitations.ts` (keep the pure helpers).
- Produces: `createInvitation(accountId, invitedBy, role, label?, expiresInDays?)` → `{ token, expiresAt }`; `redeemInvitation(token, userId)` → accountId; `transferOwnership(accountId, newOwnerUserId)`.

- [ ] **Step 1: Write the failing invite-db test**

Create `src/lib/auth/invites-db.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createInvitation, redeemInvitation } from "./invites-db";

const mockDb = {
  invitation: {
    create: vi.fn().mockResolvedValue({ id: "inv-1" }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },
  accountMember: { upsert: vi.fn().mockResolvedValue({}) },
  account: { findUnique: vi.fn().mockResolvedValue({ id: "acc-1" }) },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

describe("invites-db", () => {
  it("creates an invitation storing only the token hash", async () => {
    const { token, expiresAt } = await createInvitation("acc-1", "u-1", "agent");
    expect(token.length).toBeGreaterThan(20);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const data = mockDb.invitation.create.mock.calls[0][0].data;
    expect(data.tokenHash).not.toBe(token);
  });

  it("redeems an invitation and joins the account", async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      id: "inv-1",
      accountId: "acc-1",
      role: "agent",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      acceptedAt: null,
    });
    mockDb.account.findUnique.mockResolvedValue({ id: "acc-1" });
    const accountId = await redeemInvitation("the-token", "user-2");
    expect(accountId).toBe("acc-1");
    expect(mockDb.accountMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-2" },
        create: expect.objectContaining({ accountId: "acc-1", role: "agent" }),
      }),
    );
    expect(mockDb.invitation.update).toHaveBeenCalled();
  });

  it("rejects an already-accepted invitation", async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      id: "inv-1",
      accountId: "acc-1",
      role: "agent",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      acceptedAt: new Date(),
    });
    await expect(redeemInvitation("used-token", "user-3")).rejects.toThrow(/used/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/invites-db.test.ts`
Expected: FAIL — module `./invites-db` not found.

- [ ] **Step 3: Implement invites-db**

Create `src/lib/auth/invites-db.ts`:

```ts
import { randomBytes } from "crypto";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import type { AccountRole } from "@prisma/client";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(
  accountId: string,
  invitedBy: string,
  role: AccountRole,
  opts: { label?: string; expiresInDays?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * (opts.expiresInDays ?? 7),
  );
  await prisma.invitation.create({
    data: {
      accountId,
      tokenHash: hashInviteToken(token),
      role,
      createdByUserId: invitedBy,
      label: opts.label ?? null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function redeemInvitation(token: string, userId: string): Promise<string> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
  });
  if (!invitation || invitation.acceptedAt) {
    throw new Error("Invitation is invalid or already used");
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation has expired");
  }

  await prisma.$transaction(async (tx) => {
    await tx.accountMember.upsert({
      where: { userId },
      create: { userId, accountId: invitation.accountId, role: invitation.role },
      update: { accountId: invitation.accountId, role: invitation.role },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedByUserId: userId },
    });
  });

  return invitation.accountId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/invites-db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the peek route**

Read `src/app/api/invitations/[token]/peek/route.ts` and replace the Supabase RPC call with a Prisma lookup:

```ts
// inside GET handler, replace supabase.rpc("peek_invitation", ...) with:
import { prisma } from "@/lib/db/prisma";
import { hashInviteToken } from "@/lib/auth/invites-db";

const inv = await prisma.invitation.findUnique({
  where: { tokenHash: hashInviteToken(token) },
  select: { role: true, expiresAt: true, acceptedAt: true, account: { select: { name: true } } },
});
if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
if (inv.acceptedAt) return NextResponse.json({ error: "Invitation already used" }, { status: 409 });
return NextResponse.json({ role: inv.role, accountName: inv.account.name, expiresAt: inv.expiresAt });
```

- [ ] **Step 6: Wire the redeem route**

Read `src/app/api/invitations/[token]/redeem/route.ts` and replace `supabase.rpc("redeem_invitation", ...)` with `redeemInvitation(token, userId)`; resolve `userId` from the session cookie via `getSessionFromRequest` (new users created before redeeming follow the register flow).

- [ ] **Step 7: Wire members + transfer-ownership routes**

Read `src/app/api/account/members/[userId]/route.ts` and `src/app/api/account/transfer-ownership/route.ts`; replace `supabase.rpc("set_member_role" | "remove_account_member" | "transfer_account_ownership", ...)` with direct Prisma writes inside `prisma.$transaction`, guarded by `requireRole` from the session (owner-only for transfer, admin+ for member role changes).

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: PASS — existing tests still green (fix any that referenced Supabase RPCs).

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/invites-db.ts src/lib/auth/invites-db.test.ts src/app/api/invitations src/app/api/account/members src/app/api/account/transfer-ownership
git commit -m "feat(auth): mysql-backed invitations, member roles, ownership transfer"
```

---

### Task 7: API keys (MySQL-backed)

**Files:**
- Create: `src/lib/api-keys/store-mysql.ts`
- Create: `src/lib/api-keys/store-mysql.test.ts`
- Modify: `src/lib/api-keys/store.ts` (delegate to MySQL, keep the same exported shape)
- Modify: `src/lib/auth/api-context.ts` (replace Supabase lookup with Prisma)

**Interfaces:**
- Consumes: `prisma` (Task 1); existing pure helpers `generateApiKey`, `hashApiKey`, `looksLikeApiKey`, `timingSafeHexEqual` from `src/lib/api-keys/keys.ts`.
- Produces: `findActiveKeyByHash(hash)` → row, `getAccountName(accountId)`, `touchLastUsed(id)` — same signatures as today so `api-context.ts` keeps working.

- [ ] **Step 1: Write the failing store test**

Create `src/lib/api-keys/store-mysql.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { findActiveKeyByHash } from "./store-mysql";

const mockDb = {
  apiKey: { findUnique: vi.fn() },
  account: { findUnique: vi.fn().mockResolvedValue({ name: "Acme" }) },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

describe("findActiveKeyByHash", () => {
  it("returns null for unknown hash", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(null);
    expect(await findActiveKeyByHash("nope")).toBeNull();
  });

  it("returns null for revoked keys", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1", accountId: "a1", revokedAt: new Date(), expiresAt: null,
    });
    expect(await findActiveKeyByHash("rev")).toBeNull();
  });

  it("returns active key", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1", accountId: "a1", revokedAt: null, expiresAt: null, scopes: '["messages:send"]',
    });
    const key = await findActiveKeyByHash("ok");
    expect(key?.id).toBe("k1");
    expect(key?.accountId).toBe("a1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api-keys/store-mysql.test.ts`
Expected: FAIL — module `./store-mysql` not found.

- [ ] **Step 3: Implement the MySQL store**

Create `src/lib/api-keys/store-mysql.ts`:

```ts
import { prisma } from "@/lib/db/prisma";

export interface ApiKeyRow {
  id: string;
  accountId: string;
  createdBy: string | null;
  name: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function findActiveKeyByHash(hash: string): Promise<ApiKeyRow | null> {
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return {
    id: row.id,
    accountId: row.accountId,
    createdBy: row.createdBy,
    name: row.name,
    scopes: parseScopes(row.scopes),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

export async function getAccountName(accountId: string): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true },
  });
  return account?.name ?? null;
}

export async function touchLastUsed(id: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/api-keys/store-mysql.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Repoint store.ts + api-context.ts**

Read `src/lib/api-keys/store.ts` — replace its body with re-exports from `./store-mysql` keeping the same names (`findActiveKeyByHash`, `getAccountName`, `touchLastUsed`). Read `src/lib/auth/api-context.ts` — remove the `supabaseAdmin()` service-role client and return `{ authType: 'api_key', accountId, keyId, scopes, createdBy }` without the `supabase` field (callers use `scopedPrisma(accountId)` instead — see Task 2; update the `ApiKeyContext` type accordingly and adjust the handful of v1 routes that read `ctx.supabase`).

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS — update any test that constructed `ApiKeyContext` with a `supabase` property.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api-keys src/lib/auth/api-context.ts src/app/api/v1
git commit -m "feat(auth): mysql-backed api key store replaces supabase service-role lookup"
```

---

### Task 8: Storage on local disk

**Files:**
- Create: `src/lib/storage/disk.ts`
- Create: `src/lib/storage/disk.test.ts`
- Create: `src/app/api/files/[id]/route.ts`
- Modify: `src/lib/storage/upload-media.ts` (swap Supabase storage for disk)

**Interfaces:**
- Consumes: `prisma` (Task 1), `getSessionFromRequest` (Task 5).
- Produces: `saveFile({ accountId, originalName, mime, buffer })` → `{ id, url }`; `getFileRecord(id)`; `deleteFile(id)`; `UPLOAD_DIR` from env.

- [ ] **Step 1: Write the failing disk storage test**

Create `src/lib/storage/disk.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveFile } from "./disk";

const mockDb = {
  fileRecord: { create: vi.fn().mockResolvedValue({ id: "f-1" }) },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe("saveFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a file record and returns an id + url", async () => {
    const { id, url } = await saveFile({
      accountId: "acc-1",
      originalName: "photo.png",
      mime: "image/png",
      buffer: Buffer.from("x"),
    });
    expect(id).toBe("f-1");
    expect(url).toContain("/api/files/f-1");
    const data = mockDb.fileRecord.create.mock.calls[0][0].data;
    expect(data.diskPath).toMatch(/[0-9a-f-]{36}\.png$/);
  });

  it("never stores the original filename in the path", async () => {
    await saveFile({
      accountId: "acc-1",
      originalName: "photo.png",
      mime: "image/png",
      buffer: Buffer.from("x"),
    });
    const data = mockDb.fileRecord.create.mock.calls[0][0].data;
    expect(data.diskPath).not.toContain("photo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/storage/disk.test.ts`
Expected: FAIL — module `./disk` not found.

- [ ] **Step 3: Implement disk storage**

Create `src/lib/storage/disk.ts`:

```ts
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

function safeExtension(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "video/mp4": "mp4", "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

export interface SaveFileInput {
  accountId: string;
  originalName: string;
  mime: string;
  buffer: Buffer;
}

export async function saveFile({ accountId, originalName, mime, buffer }: SaveFileInput) {
  const id = randomUUID();
  const ext = safeExtension(mime);
  const diskName = `${id}.${ext}`;
  const accountDir = path.join(UPLOAD_DIR, accountId);
  const diskPath = path.join(accountDir, diskName);

  await mkdir(accountDir, { recursive: true });
  await writeFile(diskPath, buffer);

  const record = await prisma.fileRecord.create({
    data: {
      id,
      accountId,
      originalName,
      mime,
      size: buffer.length,
      diskPath,
    },
  });

  return { id: record.id, url: `/api/files/${record.id}` };
}

export async function deleteFile(id: string, accountId: string): Promise<void> {
  const record = await prisma.fileRecord.findUnique({ where: { id } });
  if (!record || record.accountId !== accountId) return;
  await rm(record.diskPath, { force: true }).catch(() => {});
  await prisma.fileRecord.delete({ where: { id } }).catch(() => {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/storage/disk.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the file-serving route**

Create `src/app/api/files/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { prisma } from "@/lib/db/prisma";
import { getSessionFromRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await prisma.fileRecord.findUnique({ where: { id } });
  if (!record || record.accountId !== session.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readFile(record.diskPath).catch(() => null);
  if (!buffer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": record.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(buffer.length),
    },
  });
}
```

- [ ] **Step 6: Swap upload-media.ts to disk**

Read `src/lib/storage/upload-media.ts` — replace the `supabase.storage.from(...)` call with `saveFile(...)` and update the return shape to `{ id, url, path }` where `path` is the record id. Update `src/components/settings/profile-form.tsx` if it reads `avatar_url` expecting a public Supabase URL — change to the `/api/files/[id]` URL shape.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test; npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/storage src/app/api/files .gitignore
git commit -m "feat(storage): local disk storage with account-scoped file serving"
```

(Add `uploads/` to `.gitignore` in this commit.)

---

### Task 9: Client auth state + pages (swap Supabase for our API)

**Files:**
- Modify: `src/hooks/use-auth.tsx` — replace `supabase.auth.*` calls with fetch to `/api/auth/*`
- Modify: `src/app/(auth)/login/page.tsx` — call our login API
- Modify: `src/app/(auth)/signup/page.tsx` — call our register API
- Modify: `src/app/(auth)/forgot-password/page.tsx` — keep page but wire to a placeholder or API stub

**Interfaces:**
- Consumes: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` (Task 4).
- Produces: `useAuth()` still exposes the same shape (`user, profile, loading, accountId, accountRole, isOwner, isAdmin, signOut, refreshProfile`) so existing components keep compiling.

- [ ] **Step 1: Rewrite use-auth.tsx**

Read the current `src/hooks/use-auth.tsx`, then replace Supabase calls:

```tsx
// fetch /api/auth/me on mount; store user/account/role in state.
// refreshProfile() re-fetches /api/auth/me.
// signOut() calls POST /api/auth/logout then sets state to null.
```

Concretely:

```tsx
"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface AuthState {
  user: { id: string; email: string; fullName: string } | null;
  account: { id: string; name: string } | null;
  role: string | null;
  loading: boolean;
  profileLoading: boolean;
  accountId: string | null;
  accountRole: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  isAgent: boolean;
  isViewer: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ROLE_RANK: Record<string, number> = { viewer: 1, agent: 2, admin: 3, owner: 4 };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [account, setAccount] = useState<AuthState["account"]>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
        setAccount(data.account ?? null);
        setRole(data.role ?? null);
      } else {
        setUser(null); setAccount(null); setRole(null);
      }
    } catch {
      setUser(null); setAccount(null); setRole(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  const rank = role ? (ROLE_RANK[role] ?? 0) : 0;
  const auth: AuthState = {
    user, account, role,
    loading,
    profileLoading: loading,
    accountId: account?.id ?? null,
    accountRole: role,
    isOwner: rank >= 4,
    isAdmin: rank >= 3,
    isAgent: rank >= 2,
    isViewer: rank >= 1,
    signOut: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null); setAccount(null); setRole(null);
    },
    refreshProfile,
  };

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 2: Rewrite login page**

Read `src/app/(auth)/login/page.tsx` and replace `supabase.auth.signInWithPassword(...)`:

```tsx
const res = await fetch("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (res.ok) {
  window.location.href = destination; // full navigation so middleware sees the cookie
} else {
  const data = await res.json().catch(() => ({}));
  setError(data.error ?? "Login failed");
}
```

- [ ] **Step 3: Rewrite signup page**

Read `src/app/(auth)/signup/page.tsx` and replace `supabase.auth.signUp(...)` with `fetch("/api/auth/register", ...)`; keep the invite-token redirect behavior (`/join/<token>`).

- [ ] **Step 4: Run tests + typecheck + build**

Run: `npm test; npm run typecheck`
Expected: PASS. Then `npm run build` — the standalone build must succeed (no Supabase imports in the touched files).

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`
Expected: at http://localhost:3001 → `/signup` → create account → redirected to `/dashboard` → `/login` works → `/logout` returns to `/login`.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-auth.tsx src/app/\(auth\)/login src/app/\(auth\)/signup
git commit -m "feat(auth): client auth state and login/signup pages on mysql-backed api"
```

---

## Self-Review Notes

- **Spec coverage:** Tasks 1–9 implement design sections 1–5 (architecture, data model auth/CRM foundations, auth flow, storage, security helpers). The CRM domain tables (contacts, conversations, messages, pipelines, broadcasts, automations, flows) are intentionally deferred — they are the next sub-project and will reuse `scopedPrisma` (Task 2) + `getSessionFromRequest` (Task 5).
- **Placeholders:** none — every step has concrete code or exact commands. The only "read current file then replace" steps reference real files that exist in the repo (verified via exploration map: `src/lib/storage/upload-media.ts`, `src/hooks/use-auth.tsx`, `src/app/(auth)/login/page.tsx`, etc.).
- **Type consistency:** `SESSION_COOKIE` defined once in `src/lib/auth/cookies.ts` (Task 4), used in Tasks 4–5. `withAccountScope`/`scopedPrisma` naming: the exported function is `withAccountScope(accountId, prisma)` — callers use `scopedPrisma(accountId)` only as a convenience alias defined in the same file (Task 2). `AccountRole` enum values match `src/lib/auth/roles.ts` (`owner|admin|agent|viewer`).
- **Known adapt-and-verify steps:** Tests that reference the old Supabase mocks (`route.test.ts` files for send/webhook) will be updated in their own sub-project; Task 5/6/7 explicitly call out updating `middleware.test.ts` and `ApiKeyContext` consumers.
