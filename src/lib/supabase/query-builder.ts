/**
 * Thin Supabase-compatible query builder that translates chained queries
 * into fetch calls to /api/data/[table].
 *
 * Supports: select, insert, update, delete, eq, neq, gt, gte, lt, lte,
 * in, like, is, order, range, single, maybeSingle, head/count, rpc.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupabaseFilterOp =
  | { type: 'eq'; col: string; val: unknown }
  | { type: 'neq'; col: string; val: unknown }
  | { type: 'gt'; col: string; val: unknown }
  | { type: 'gte'; col: string; val: unknown }
  | { type: 'lt'; col: string; val: unknown }
  | { type: 'lte'; col: string; val: unknown }
  | { type: 'in'; col: string; val: unknown[] }
  | { type: 'like'; col: string; val: string }
  | { type: 'is'; col: string; val: null };

export type SupabaseOrderClause = { col: string; ascending: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseResponse<T = any> {
  data: T | null;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  count?: number | null;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface QueryBuilderConfig {
  /** Base URL for the data API (defaults to '' for same-origin). */
  baseUrl?: string;
  /** Extra headers to attach to every request (e.g. auth tokens). */
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeFilter(op: SupabaseFilterOp): string {
  switch (op.type) {
    case 'eq':
      return op.val === null ? `${op.col}.is.null` : `${op.col}.eq.${encodeVal(op.val)}`;
    case 'neq':
      return `${op.col}.neq.${encodeVal(op.val)}`;
    case 'gt':
      return `${op.col}.gt.${encodeVal(op.val)}`;
    case 'gte':
      return `${op.col}.gte.${encodeVal(op.val)}`;
    case 'lt':
      return `${op.col}.lt.${encodeVal(op.val)}`;
    case 'lte':
      return `${op.col}.lte.${encodeVal(op.val)}`;
    case 'in':
      return `${op.col}.in.(${op.val.map(encodeVal).join(',')})`;
    case 'like':
      return `${op.col}.like.${encodeVal(op.val)}`;
    case 'is':
      return `${op.col}.is.null`;
  }
}

function encodeVal(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v.replace(/,/g, '%2C');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * Resolve an API path to a full URL when running on the server. Node's
 * `fetch` rejects relative URLs, so internal API calls made during SSR
 * or from API routes need an absolute URL; the browser accepts the
 * relative form and must keep it so the request stays same-origin.
 */
function resolveApiUrl(path: string): string {
  if (typeof window !== 'undefined') return path;
  return `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}${path}`;
}

function buildFilterParams(filters: SupabaseFilterOp[]): string {
  if (filters.length === 0) return '';
  // PostgREST style: ?or=(col.eq.val,and(...))
  // For simplicity, pass as repeated filter params — the API route will parse them.
  return filters.map(serializeFilter).join('&');
}

// ---------------------------------------------------------------------------
// QueryBuilder — chainable, thenable
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class QueryBuilder<T = any> {
  private _table: string;
  private _method: HttpMethod = 'GET';
  private _select: string | null = null;
  private _body: unknown = null;
  private _filters: SupabaseFilterOp[] = [];
  private _orders: SupabaseOrderClause[] = [];
  private _rangeFrom: number | null = null;
  private _rangeTo: number | null = null;
  private _single = false;
  private _maybeSingle = false;
  private _countOnly = false;
  private _countExact = false;
  private _headOnly = false;
  private _resolved = false;
  private _promise: Promise<SupabaseResponse<T>> | null = null;
  private _config: QueryBuilderConfig;

  constructor(table: string, config: QueryBuilderConfig = {}) {
    this._table = table;
    this._config = config;
  }

  // -- Terminal / modifier methods ------------------------------------------------

  select(columns?: string, opts?: { count?: string; head?: boolean }): this {
    this._select = columns ?? '*';
    this._method = 'GET';
    if (opts?.count === 'exact') this._countExact = true;
    if (opts?.head) this._headOnly = true;
    return this;
  }

  insert(data: unknown | unknown[]): this {
    this._method = 'POST';
    this._body = Array.isArray(data) ? data : [data];
    return this;
  }

  update(data: unknown): this {
    this._method = 'PATCH';
    this._body = data;
    return this;
  }

  delete(opts?: { count?: string }): this {
    this._method = 'DELETE';
    if (opts?.count === 'exact') this._countExact = true;
    return this;
  }

  upsert(data: unknown | unknown[], opts?: { onConflict?: string }): this {
    this._method = 'POST';
    this._body = Array.isArray(data) ? data : [data];
    return this;
  }

  // -- Filters -------------------------------------------------------------------

  eq(col: string, val: unknown): this {
    this._filters.push({ type: 'eq', col, val });
    return this;
  }

  neq(col: string, val: unknown): this {
    this._filters.push({ type: 'neq', col, val });
    return this;
  }

  gt(col: string, val: unknown): this {
    this._filters.push({ type: 'gt', col, val });
    return this;
  }

  gte(col: string, val: unknown): this {
    this._filters.push({ type: 'gte', col, val });
    return this;
  }

  lt(col: string, val: unknown): this {
    this._filters.push({ type: 'lt', col, val });
    return this;
  }

  lte(col: string, val: unknown): this {
    this._filters.push({ type: 'lte', col, val });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this._filters.push({ type: 'in', col, val: vals });
    return this;
  }

  like(col: string, pattern: string): this {
    this._filters.push({ type: 'like', col, val: pattern });
    return this;
  }

  ilike(col: string, pattern: string): this {
    this._filters.push({ type: 'like', col, val: pattern });
    return this;
  }

  contains(col: string, val: unknown): this {
    // Supabase .contains() — for JSON arrays, use LIKE with %
    this._filters.push({ type: 'like', col, val: `%${JSON.stringify(val)}%` } as SupabaseFilterOp);
    return this;
  }

  is(col: string, val: null): this {
    this._filters.push({ type: 'is', col, val: null });
    return this;
  }

  or(expr: string): this {
    // PostgREST .or() — pass through as a raw filter param
    // The API route should handle or= expressions
    this._filters.push({ type: 'eq', col: '__or', val: expr } as SupabaseFilterOp);
    return this;
  }

  filter(col: string, op: string, val: unknown): this {
    // Generic filter method — parse operator string
    switch (op) {
      case 'eq': return this.eq(col, val);
      case 'neq': return this.neq(col, val);
      case 'gt': return this.gt(col, val);
      case 'gte': return this.gte(col, val);
      case 'lt': return this.lt(col, val);
      case 'lte': return this.lte(col, val);
      case 'in': return this.in(col, val as unknown[]);
      case 'like': return this.like(col, val as string);
      case 'ilike': return this.ilike(col, val as string);
      case 'is': return this.is(col, null);
      default: return this.eq(col, val);
    }
  }

  // -- Ordering / pagination / single -------------------------------------------

  order(col: string, opts?: { ascending?: boolean }): this {
    this._orders.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }

  range(from: number, to: number): this {
    this._rangeFrom = from;
    this._rangeTo = to;
    return this;
  }

  limit(count: number): this {
    this._rangeFrom = 0;
    this._rangeTo = count - 1;
    return this;
  }

  single(): this {
    this._single = true;
    return this;
  }

  maybeSingle(): this {
    this._maybeSingle = true;
    return this;
  }

  // -- RPC -----------------------------------------------------------------------

  rpc(fnName: string, params?: Record<string, unknown>): this {
    this._method = 'POST';
    this._table = `__rpc:${fnName}`;
    this._body = params ?? {};
    return this;
  }

  // -- Execution -----------------------------------------------------------------

  /** Build the full URL + options and execute the fetch. */
  private _execute(): Promise<SupabaseResponse<T>> {
    const baseUrl = this._config.baseUrl ?? '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this._config.headers,
    };

    let url: string;
    const isRpc = this._table.startsWith('__rpc:');

    if (isRpc) {
      const fnName = this._table.slice('__rpc:'.length);
      url = resolveApiUrl(`${baseUrl}/api/data/rpc/${fnName}`);
    } else {
      url = resolveApiUrl(`${baseUrl}/api/data/${encodeURIComponent(this._table)}`);
    }

    const params = new URLSearchParams();

    // Select
    if (this._select) params.set('select', this._select);

    // Filters
    for (const f of this._filters) {
      if (f.type === 'is') {
        const val = (f as { type: 'is'; col: string; val: null }).val;
        params.set(f.col, `is.${val === null ? 'null' : String(val)}`);
      } else if (f.type === 'in') {
        params.set(`${f.col}`, `in.(${(f.val as unknown[]).map(encodeVal).join(',')})`);
      } else {
        params.set(`${f.col}`, `${f.type}.${encodeVal((f as any).val)}`);
      }
    }

    // Orders
    if (this._orders.length > 0) {
      params.set(
        'order',
        this._orders.map((o) => `${o.col}.${o.ascending ? 'asc' : 'desc'}`).join(',')
      );
    }

    // Range
    if (this._rangeFrom !== null && this._rangeTo !== null) {
      headers['Range'] = `${this._rangeFrom}-${this._rangeTo}`;
    }

    // Count
    if (this._countExact) {
      params.set('count', 'exact');
    }
    if (this._headOnly) {
      params.set('head', 'true');
    }

    const qs = params.toString();
    if (qs && this._method === 'GET') url += `?${qs}`;
    // For POST/PATCH/DELETE with filters, pass them as query params too
    if (qs && this._method !== 'GET' && !isRpc) url += `?${qs}`;

    const init: RequestInit = { method: this._method, headers };
    if (this._body && this._method !== 'GET') {
      init.body = JSON.stringify(this._body);
    }

    return fetch(url, init)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(text); } catch { /* ignore */ }
          return {
            data: null,
            error: {
              message: (parsed?.message as string) ?? text ?? `HTTP ${res.status}`,
              code: (parsed?.code as string) ?? String(res.status),
              details: (parsed?.details as string) ?? undefined,
            },
            count: null,
          };
        }

        // Head-only or count-only: return count from header
        if (this._headOnly && !this._select) {
          const cnt = res.headers.get('content-range');
          const match = cnt?.match(/\/(\d+)/);
          return {
            data: null,
            error: null,
            count: match ? parseInt(match[1], 10) : null,
          };
        }

        // Empty body (DELETE, etc.)
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          return { data: null as T, error: null, count: null };
        }

        const json = await res.json();

        // Unwrap if the API returned the standard {data, error} envelope
        const payload = json && typeof json === 'object' && 'data' in json && 'error' in json
          ? json
          : { data: json, error: null };

        // Handle count from header
        let count: number | null = null;
        if (this._countExact) {
          const cr = res.headers.get('content-range');
          const m = cr?.match(/\/(\d+)/);
          if (m) count = parseInt(m[1], 10);
        }

        // single() — return first item
        if (this._single) {
          const rows = payload.data;
          if (Array.isArray(rows) && rows.length > 0) {
            return { data: rows[0] as T, error: payload.error, count };
          }
          if (Array.isArray(rows) && rows.length === 0) {
            return {
              data: null,
              error: { message: 'Row not found', code: 'PGRST116' },
              count,
            };
          }
          return { data: rows as T, error: payload.error, count };
        }

        // maybeSingle() — return first item or null (no error on empty)
        if (this._maybeSingle) {
          const rows = payload.data;
          if (Array.isArray(rows) && rows.length > 0) {
            return { data: rows[0] as T, error: payload.error, count };
          }
          return { data: null, error: null, count };
        }

        return { data: payload.data as T, error: payload.error, count };
      })
      .catch((err: Error) => ({
        data: null,
        error: { message: err.message ?? 'Fetch failed', code: 'FETCH_ERROR' },
        count: null,
      }));
  }

  /** Make the builder thenable so it can be awaited directly. */
  then<TResult1 = SupabaseResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    if (!this._promise) {
      this._promise = this._execute();
    }
    return this._promise.then(onfulfilled, onrejected);
  }

  /** Allow `await builder` without .then(). */
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<SupabaseResponse<T> | TResult> {
    if (!this._promise) {
      this._promise = this._execute();
    }
    return this._promise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<SupabaseResponse<T>> {
    if (!this._promise) {
      this._promise = this._execute();
    }
    return this._promise.finally(onfinally);
  }

  [Symbol.toStringTag] = 'QueryBuilder';
}

// ---------------------------------------------------------------------------
// SupabaseClient-like wrapper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth stub — replaces Supabase Auth with our session-based auth
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
}

export interface AuthSession {
  user: AuthUser;
}

export interface AuthResponse {
  data: { user: AuthUser | null; session: AuthSession | null };
  error: { message: string } | null;
}

export interface SupabaseQueryBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from<T = any>(table: string): QueryBuilder<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc<T = any>(fn: string, params?: Record<string, unknown>): QueryBuilder<T>;
  auth: {
    getSession(): Promise<AuthResponse>;
    getUser(): Promise<AuthResponse>;
    signOut(opts?: { scope?: string }): Promise<{ error: { message: string } | null }>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<AuthResponse>;
    updateUser(data: {
      email?: string;
      password?: string;
    }): Promise<{ data: { user: AuthUser | null }; error: { message: string } | null }>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAuth(
  path: string,
  init?: RequestInit,
  headers?: Record<string, string>,
): Promise<any> {
  const res = await fetch(resolveApiUrl(path), {
    credentials: 'include',
    ...init,
    headers: { ...(headers ?? {}), ...(init?.headers ?? {}) },
  });
  return res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
}

function buildAuthStub(config: QueryBuilderConfig = {}): SupabaseQueryBuilder['auth'] {
  const forward = (path: string, init?: RequestInit) =>
    fetchAuth(path, init, config.headers);

  return {
    async getSession(): Promise<AuthResponse> {
      const json = await forward('/api/auth/me');
      if (json.user) {
        return {
          data: {
            user: json.user,
            session: { user: json.user },
          },
          error: null,
        };
      }
      return { data: { user: null, session: null }, error: json.error ?? null };
    },

    async getUser(): Promise<AuthResponse> {
      const json = await forward('/api/auth/me');
      if (json.user) {
        return {
          data: { user: json.user, session: null },
          error: null,
        };
      }
      return { data: { user: null, session: null }, error: json.error ?? null };
    },

    async signOut() {
      await forward('/api/auth/logout', { method: 'POST' });
      return { error: null };
    },

    async signInWithPassword(credentials) {
      const json = await forward('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      if (json.user) {
        return {
          data: {
            user: json.user,
            session: { user: json.user },
          },
          error: null,
        };
      }
      return { data: { user: null, session: null }, error: json.error ?? null };
    },

    async updateUser(data) {
      // For now, only password update is supported via settings API
      // Email update would need a dedicated endpoint
      if (data.password) {
        const json = await forward('/api/account/password', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: data.password }),
        });
        if (json.error) {
          return { data: { user: null }, error: json.error };
        }
      }
      // Re-fetch current user
      const me = await forward('/api/auth/me');
      return {
        data: { user: me.user ?? null },
        error: me.error ?? null,
      };
    },
  };
}

export function createSupabaseQueryBuilder(config: QueryBuilderConfig = {}): SupabaseQueryBuilder {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from<T = any>(table: string): QueryBuilder<T> {
      return new QueryBuilder<T>(table, config);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc<T = any>(fn: string, params?: Record<string, unknown>): QueryBuilder<T> {
      return new QueryBuilder<T>('__rpc:' + fn, config).rpc(fn, params);
    },
    auth: buildAuthStub(config),
  };
}
