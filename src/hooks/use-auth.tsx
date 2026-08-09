"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";

interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  /** Optional so consumers that read `user.created_at` keep compiling.
   *  The /api/auth/me response doesn't include it. */
  created_at?: string | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  /** Default deal currency (ISO-4217). NOT NULL DEFAULT 'USD' in the
   *  DB (migration 021); narrowed to DEFAULT_CURRENCY when absent. */
  default_currency: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  profile: Profile | null;
  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in. Use this for chrome (sidebar / header).
   */
  loading: boolean;
  /**
   * Profile-row loading. Stays true until the /api/auth/me fetch
   * settles. Code that branches on `profile.beta_features` MUST gate
   * on this — otherwise it sees the `{ loading: false, profile: null }`
   * window during initial load.
   */
  profileLoading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the current user/profile/account — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context
  //
  // All of these are nullable until `profileLoading` is false.
  // ----------------------------------------------------------

  /** Account id the current user belongs to. Null while loading. */
  accountId: string | null;
  /** Role within that account. Null while loading. */
  accountRole: AccountRole | null;
  /** Lightweight account meta — id + name + default_currency. Null while loading. */
  account: AccountSummary | null;
  /** Account default deal currency. Falls back to DEFAULT_CURRENCY
   *  while loading or when no account is resolved, so callers can use
   *  it unconditionally. */
  defaultCurrency: string;
  /** True if `accountRole === 'owner'`. */
  isOwner: boolean;
  /** True if `accountRole === 'admin'` (does NOT include owner — use canManageMembers for "admin or above"). */
  isAdmin: boolean;
  /** True if `accountRole === 'agent'`. */
  isAgent: boolean;
  /** True if `accountRole === 'viewer'`. */
  isViewer: boolean;
  /** True if the caller can manage members (admin+). */
  canManageMembers: boolean;
  /** True if the caller can edit account-wide settings (admin+). */
  canEditSettings: boolean;
  /** True if the caller can send messages and edit operational data (agent+). */
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider — wrap this around the dashboard layout.
 * Makes ONE /api/auth/me call for the whole tree instead of one per
 * component, and rebuilds user/profile/account/role from that single
 * response.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracked separately from `loading`. The fetch settles in one round
  // trip, but the two flags are kept distinct so consumers that gate on
  // `profileLoading` keep their fail-closed behaviour during load.
  const [profileLoading, setProfileLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const nextUser: AuthUser | null = data.user
          ? {
              id: data.user.id,
              email: data.user.email,
              fullName: data.user.fullName ?? null,
            }
          : null;
        const nextAccount: AccountSummary | null = data.account
          ? {
              id: data.account.id,
              name: data.account.name,
              default_currency: DEFAULT_CURRENCY,
            }
          : null;
        // Narrow the API role string into our AccountRole union. Fall
        // back to null on anything unexpected and let UI gates treat
        // the caller as least-privileged.
        const accountRole = isAccountRole(data.role) ? data.role : null;

        setUser(nextUser);
        setAccount(nextAccount);
        setProfile(
          nextUser
            ? {
                id: nextUser.id,
                full_name: nextUser.fullName,
                email: nextUser.email,
                avatar_url: null,
                role: null,
                beta_features: [],
                account_id: nextAccount?.id ?? null,
                account_role: accountRole,
              }
            : null,
        );
      } else {
        setUser(null);
        setAccount(null);
        setProfile(null);
      }
    } catch {
      setUser(null);
      setAccount(null);
      setProfile(null);
    } finally {
      setLoading(false);
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    // Safety net — never leave chrome stuck on the loading spinner if
    // the /api/auth/me fetch hangs.
    const safetyTimer = setTimeout(() => {
      setLoading(false);
      setProfileLoading(false);
    }, 3000);

    refreshProfile();

    return () => clearTimeout(safetyTimer);
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setProfile(null);
      setAccount(null);
      window.location.href = "/login";
    }
  }, []);

  // Derive the role booleans once per profile change rather than on
  // every consumer render. The memo also gives each derived value a
  // stable identity for React.memo / useEffect dependencies downstream.
  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page). Account state
    // collapses to least-privileged null — every `canX` boolean is
    // false so UI gates fail closed.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      defaultCurrency: DEFAULT_CURRENCY,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
    };
  }
  return ctx;
}
