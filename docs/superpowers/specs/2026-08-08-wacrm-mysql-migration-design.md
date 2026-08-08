# WACRM Migration Supabase → MySQL — Sub-proyecto 1: Capa de datos + Auth

Fecha: 2026-08-08
Estado: Aprobado por el usuario (secciones 1–6)

## Contexto

WACRM es un CRM para WhatsApp (Next.js 16, React 19, TypeScript, Tailwind v4)
actualmente construido sobre Supabase (Postgres + Auth + RLS + Realtime +
Storage). El usuario quiere **independencia total de Supabase**: migrar a MySQL
8 (el de AppServ local, servicio `mysql8`).

Este documento cubre el **sub-proyecto 1**: la capa de datos + auth. Es el
cimiento sobre el que se apoyan los demás subsistemas (realtime, storage,
módulos de alto nivel).

## Decisiones tomadas (con el usuario)

| Decisión | Elección |
|---|---|
| Alcance | B — reemplazar TODO Supabase (independencia total) |
| Auth | A — completo: registro, invitaciones, roles, transferencia, API keys |
| ORM | A — Prisma |
| Sesiones | B — stateful en tabla MySQL (revocación individual, logout everywhere) |
| Realtime | C — SSE |
| Storage | A — disco local con ruta protegida |
| Datos existentes | B — de cero, sin migración de datos |

## Arquitectura

**Stack objetivo:**
- App: Next.js 16 (se mantiene)
- BD: MySQL 8 local (`localhost`, AppServ)
- ORM: Prisma (schema + migraciones + cliente tipado)
- Auth: propio — sesiones en tabla MySQL, bcrypt, cookies httpOnly
- Realtime: SSE (route handlers de Next.js)
- Storage: disco local, ruta protegida
- Seguridad: autorización por cuenta en la capa de aplicación (reemplaza RLS)

**Estructura nueva en `src/`:**
```
src/lib/db/                → cliente Prisma + helpers de autorización por cuenta
src/lib/auth/              → registro, login, logout, sesiones, bcrypt, cookies
src/lib/auth/invitations/  → tokens de invitación + roles
src/lib/auth/api-keys/     → API keys con hash
src/lib/storage/           → subida/servido de archivos en disco
src/app/api/auth/          → routes de auth (reemplazan Supabase Auth)
```

**Se elimina:** `@supabase/supabase-js`, `@supabase/ssr`, `supabase/`
(migraciones), Supabase Realtime, Supabase Storage, RLS policies.

## Modelo de datos (Prisma schema)

Tablas principales:

**Auth:**
- `users` — id (CHAR(36)), email único, password_hash, nombre, avatar_url, created_at
- `sessions` — id, user_id, token_hash (SHA-256), expires_at, created_at, last_seen_at
- `accounts` — la cuenta/workspace
- `account_members` — user_id ↔ account_id, role (owner/admin/agent/viewer)
- `invitations` — token, email, account_id, role, expires_at, invited_by
- `api_keys` — id, account_id, key_hash (nunca crudo), name, scopes, last_used_at

**CRM:**
- `contacts`, `tags`, `contact_tags`, `custom_fields`, `contact_custom_fields`
- `conversations`, `messages`, `message_actions`
- `pipelines`, `pipeline_stages`, `deals`
- `broadcasts`, `broadcast_recipients`, `message_templates`
- `automations`, `automation_runs`, `flows`, `flow_runs`
- `webhook_endpoints`, `notifications`, `quick_replies`, `ai_config`, `ai_knowledge_items`

**Conversiones Postgres → MySQL:**
- `uuid` → `CHAR(36)` (Prisma genera el UUID)
- `jsonb` → `JSON`
- `timestamptz` → `DATETIME(3)` con zona UTC
- Enums → `ENUM` de MySQL o `VARCHAR` + check
- Triggers/funciones RLS → se eliminan (autorización en capa Prisma)

## Flujo de auth

**Registro / Login / Logout:**
1. `POST /api/auth/register` — valida email+password, bcrypt (costo 12), crea
   user + account + account_member(owner) + sesión
2. `POST /api/auth/login` — verifica bcrypt, crea sesión, cookie httpOnly `wacrm_session`
3. `POST /api/auth/logout` — borra sesión + cookie

**Sesión stateful:**
- Cookie con token aleatorio (48 bytes hex), **no JWT**
- `sessions.token_hash` = SHA-256(token) — si la BD se filtra, las cookies no sirven
- Expiración 30 días, renovación deslizante (update si `last_seen_at` > 7 días)
- Logout everywhere = borrar todas las sesiones del user

**Invitaciones:** token aleatorio, expira 7 días, link `/join/[token]`, un solo uso.

**Roles:** owner (todo + transferencia/borrado), admin (todo salvo transferencia),
agent (inbox/contactos/pipelines), viewer (solo lectura).
Helper central `requireRole(accountId, userId, minRole)`.

**API keys:** key crudo mostrado una vez, guardado como SHA-256.
`Authorization: Bearer <key>` → hash → validar scope + account.

**Middleware (`proxy.ts`):** valida cookie de sesión, redirige a `/login`.

## Realtime (SSE) + Storage

**SSE inbox:**
- `GET /api/realtime/inbox` — route handler con conexión abierta
- Empuja `event: message` cuando hay mensajes nuevos (polling interno 3s o triggers)
- Valida sesión antes de abrir el canal; solo ve mensajes de su cuenta
- Heartbeat cada 25s; fallback a polling si el cliente no soporta SSE

**Storage disco:**
- Carpeta `uploads/` (fuera de `src/`, ignorada por git)
- `src/lib/storage/` — `saveFile(buffer, {accountId})` → URL `/api/files/[id]`
- Tabla `files` (id, account_id, original_name, mime, size, path, created_at)
- Ruta en disco aleatoria (`<uuid>.<ext>`), nunca el nombre original
- `GET /api/files/[id]` valida sesión + pertenencia a la cuenta

## Seguridad (reemplazo de RLS)

**Patrón obligatorio — filtrado por cuenta en toda query:**
```ts
const db = requireAccountScoped(user.accountId); // inyecta where: { accountId }
// o explícitamente: prisma.messages.findMany({ where: { accountId: user.accountId } })
```

- Ninguna query del CRM corre sin filtro de `account_id`
- Cada API route resuelve sesión → userId → accountId + role
- `requireRole` antes de mutar
- Los `[id]` de rutas se validan contra `account_id`

**Controles que se mantienen:** rate limiting, HMAC webhook WhatsApp, AES-256-GCM
para secretos (`ENCRYPTION_KEY`).

**Env vars nuevas:** `DATABASE_URL` (MySQL), `SESSION_SECRET`, `UPLOAD_DIR`.
Se eliminan: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### Hallazgos del código actual que la migración DEBE corregir

Revisión adversarial (Judge A, 2026-08-08) — estos bugs de multi-tenant se
resuelven de raíz en la capa nueva:

1. **CRÍTICO — Inyección cross-tenant en automations** (`api/automations/engine/route.ts`):
   `conversation_id` de llamada se confía sin verificar que la conversación
   pertenezca a la cuenta. En la capa Prisma, todo paso del engine valida
   ownership de conversación antes de insertar mensajes.
2. **MEDIO — Webhook no tenant-scoped**: actualizaciones de `messages` y
   `broadcast_recipients` por Meta message_id sin verificar cuenta. Verificar
   que el target pertenezca al phone_number_id del webhook.
3. **MEDIO — Media proxy sin ownership**: `/api/whatsapp/media/[mediaId]` sirve
   cualquier media a cualquier cuenta autenticada. Resolver owner en BD antes
   de hacer proxy; `Cache-Control: private`.
4. **MEDIO — Timestamps de webhook sin guard**: `parseInt(...)*1000` lanza
   RangeError y mata el batch. Guard: fallback a `now()`.
5. **BAJO — CBC legacy sin upgrade en todos los sitios de decrypt**.
6. **BAJO — Broadcast sin cap de recipients** (v1 sí lo tiene en 1000).
7. **INFO — Rate limiter en memoria** no sirve multi-instancia (documentado).
8. **INFO — Guard muerto** `'sent_at' in update` en webhook.

## Pruebas

- Helpers de auth: registro, login, logout, expiración, invitaciones, roles —
  unit tests con BD de test (MySQL local de test o SQLite en memoria vía Prisma)
- API routes: tests de integración (`route.test.ts`) — sin sesión → 401,
  sesión de otra cuenta → 404/403 (nunca 401, no filtrar existencia)
- Anti-IDOR: test que fuerza el filtro por `accountId` (Prisma middleware)
- E2E final: registro → login → inbox → enviar mensaje → pipeline

## Orden de implementación

1. Setup Prisma + MySQL: schema completo, `prisma migrate dev`, conexión
2. Capa `src/lib/db/` + helper de autorización por cuenta
3. Capa `src/lib/auth/`: sesiones, bcrypt, cookies, `proxy.ts`
4. Routes API de auth: register, login, logout, invitations, api-keys, me
5. Storage en disco + `files` + `/api/files/[id]`
6. Migrar módulos CRM: contacts, conversations, messages, pipelines
7. Realtime SSE del inbox
8. Migrar módulos restantes: broadcasts, automations, flows, AI, API v1, MCP
9. E2E

## Riesgos

- **Principal:** bugs de multi-tenant (olvidar filtrar por cuenta) — mitigado
  con helper central + code review + tests anti-IDOR
- Migración grande → avanzar por módulos con verificación por etapa
- El juicio adversarial (judgment-day) está en curso; los hallazgos del Judge B
  se incorporarán al diseño cuando termine
