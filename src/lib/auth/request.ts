import { getSessionUser } from "./session";
import { SESSION_COOKIE } from "./cookies";

export interface SessionUser {
  userId: string;
  accountId: string;
  role: string;
}

export async function getSessionFromRequest(req: Request): Promise<SessionUser | null> {
  const cookies = req.headers.get("cookie") ?? "";
  const token = cookies
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(SESSION_COOKIE + "="))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  return getSessionUser(token);
}
