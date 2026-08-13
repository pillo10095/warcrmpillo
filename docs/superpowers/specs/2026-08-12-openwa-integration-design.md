# WACRM Integración OpenWA — Segunda línea de WhatsApp

Fecha: 2026-08-12
Estado: Aprobado por el usuario

## Contexto

WACRM es un CRM para WhatsApp (Next.js 16, React 19, TypeScript, Prisma/MySQL)
conectado a la API oficial de Meta (WhatsApp Cloud API v21.0). El usuario quiere
**agregar** OpenWA como segunda línea gratuita de WhatsApp: envío/recepción de
mensajes y campañas (bulk messaging) sin costo por mensaje. Se mantiene la
integración de Meta intacta.

## Decisiones tomadas (con el usuario)

| Decisión | Elección |
|---|---|
| Servidor | **Mismo servidor** que WACRM (corre como proceso Node.js junto al app) |
| Selección de provider | **Opt-in** — el usuario elige Meta u OpenWA manualmente |
| Conversaciones | **Separadas** por provider (una por account+contact+provider) |
| Webhook | **Endpoint nuevo** — `/api/openwa/webhook` separado del de Meta |
| Infraestructura | **Sin Docker** — instalación local con npm (Node 22+, SQLite) |

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    SERVIDOR ÚNICO                           │
│                                                             │
│  ┌──────────────────────┐    ┌──────────────────────┐      │
│  │   WACRM (Next.js)    │    │   OpenWA (Node.js)   │      │
│  │   Puerto 3000        │    │   Puerto 2785         │      │
│  └──────────┬───────────┘    └──────────┬───────────┘      │
│             │                           │                   │
│             │    ┌──────────────┐       │                   │
│             ├───►│  Prisma      │◄──────┤                   │
│             │    │  (MySQL)     │       │                   │
│             │    └──────────────┘       │                   │
│             │                           │                   │
│             │    ┌──────────────┐       │                   │
│             │    │  SQLite      │◄──────┘                   │
│             │    │  (OpenWA)    │                           │
│             │    └──────────────┘                           │
│             │                                               │
│  ┌──────────▼───────────────────────────────────────────┐  │
│  │              WhatsApp Adapter Layer                   │  │
│  │  ┌─────────────────┐    ┌─────────────────┐          │  │
│  │  │  MetaProvider   │    │ OpenWAProvider  │          │  │
│  │  └────────┬────────┘    └────────┬────────┘          │  │
│  └───────────┼──────────────────────┼───────────────────┘  │
│              │                      │                       │
└──────────────┼──────────────────────┼───────────────────────┘
               │                      │
               ▼                      ▼
        WhatsApp Business      WhatsApp Web
        (API Oficial)          (Baileys)
```

## Modelo de datos (Prisma)

Cambios en `prisma/schema.prisma`:

1. `Conversation` — campo `provider String @default("meta")` y unique pasa a
   `@@unique([accountId, contactId, provider])`.
2. `Message` — campo `provider String @default("meta")` para filtrar el
   historial por canal.
3. Nuevo modelo `OpenWAConfig` — una por cuenta (url + api key encriptada).
4. Nuevo modelo `OpenWASession` — una por línea asociada (QR linking).

```prisma
model OpenWAConfig {
  id          String   @id @default(uuid()) @db.VarChar(36)
  accountId   String   @unique @map("account_id") @db.VarChar(36)
  apiUrl      String   @default("http://localhost:2785/api") @map("api_url") @db.VarChar(512)
  apiKey      String   @map("api_key") @db.Text
  status      String   @default("disconnected") @db.VarChar(20)
  connectedAt DateTime? @map("connected_at") @db.DateTime(3)
  createdAt   DateTime @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.DateTime(3)

  account  Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  sessions OpenWASession[]

  @@map("openwa_configs")
}

model OpenWASession {
  id              String   @id @default(uuid()) @db.VarChar(36)
  configId        String   @map("config_id") @db.VarChar(36)
  openwaSessionId String   @unique @map("openwa_session_id") @db.VarChar(64)
  name            String   @db.VarChar(100)
  phone           String?  @db.VarChar(32)
  pushName        String?  @map("push_name") @db.VarChar(255)
  status          String   @default("created") @db.VarChar(20)
  engineType      String   @default("baileys") @map("engine_type") @db.VarChar(20)
  createdAt       DateTime @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.DateTime(3)

  config OpenWAConfig @relation(fields: [configId], references: [id], onDelete: Cascade)

  @@index([configId])
  @@map("openwa_sessions")
}
```

## Interfaz de providers

`src/lib/whatsapp/providers/types.ts`:

```typescript
export type WhatsAppProviderType = "meta" | "openwa";

export interface WhatsAppProvider {
  readonly type: WhatsAppProviderType;
  sendText(to: string, text: string): Promise<SendResult>;
  sendMedia(to: string, media: MediaMessage): Promise<SendResult>;
  sendBulk(messages: BulkMessage[]): Promise<BulkResult>;
  getBatchStatus(batchId: string): Promise<BatchStatus>;
  getStatus(): Promise<ProviderStatus>;
}

export interface SendResult {
  messageId: string;
  providerMessageId: string;
  timestamp: number;
}
export interface BulkMessage {
  to: string;
  text: string;
}
export interface BulkResult {
  batchId: string;
  totalMessages: number;
}
export interface BatchStatus {
  batchId: string;
  sent: number;
  failed: number;
  pending: number;
  status: string;
}
export interface ProviderStatus {
  connected: boolean;
  status: string;
  phone?: string | null;
}
```

## Endpoints nuevos

| Endpoint | Método | Descripción | Auth |
|---|---|---|---|
| `/api/openwa/config` | GET/POST | Leer/guardar config (url + api key) | admin |
| `/api/openwa/session` | POST | Crear sesión en OpenWA | admin |
| `/api/openwa/session/[sessionId]` | GET/POST | Estado/detener sesión | admin |
| `/api/openwa/session/[sessionId]/start` | POST | Iniciar sesión | admin |
| `/api/openwa/session/[sessionId]/qr` | GET | QR para vincular | admin |
| `/api/openwa/messages/send` | POST | Enviar mensaje (opt-in provider) | agent |
| `/api/openwa/messages/bulk` | POST | Campaña bulk | agent |
| `/api/openwa/webhook` | POST | Recibir mensajes de OpenWA | HMAC/secret |

## Flujo de envío

1. Usuario elige provider en UI (Meta / OpenWA).
2. `POST /api/whatsapp/send` con `provider: "openwa"` (o el endpoint
   `/api/openwa/messages/send`).
3. Si `openwa`: se resuelve conversación con `provider: "openwa"`, se instancia
   `OpenWAProvider`, se envía via OpenWA REST, se persiste en `messages` con
   `provider: "openwa"`.

## Flujo de recepción

1. OpenWA recibe mensaje y notifica `POST /api/openwa/webhook`.
2. El route valida el secret, busca/crea contacto, busca conversación
   `provider: "openwa"` (o la crea), persiste el mensaje, y despacha a
   flows/automations igual que el webhook de Meta.

## Seguridad

- `OpenWAConfig.apiKey` se encripta con AES-256-GCM reutilizando
  `src/lib/whatsapp/encryption.ts`.
- Webhook de OpenWA protegido por `OPENWA_WEBHOOK_SECRET` (HMAC).
- Toda query scoped por `accountId`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Ban de cuenta WhatsApp Web | Delay configurable entre mensajes, límites por día |
| OpenWA se desconecta | Auto-reconnect + campo `status` monitoreado |
| Duplicación de conversación | Unique `(accountId, contactId, provider)` |

## Estimación

Fase 1 Fundación ~4h · Fase 2 Providers ~6h · Fase 3 Endpoints ~8h · Fase 4 UI
~6h · Fase 5 Tests ~4h. Total ~28h.