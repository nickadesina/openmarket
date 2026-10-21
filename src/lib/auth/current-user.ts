import type { Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { Database } from "../db/schema.js";
import { ensurePaperAccount } from "../services/user.js";
import {
  readCookie,
  resolveTournamentSession,
  TOURNAMENT_SESSION_COOKIE,
} from "./tournament-session.js";

type DatabaseProvider = () => Kysely<Database>;

/**
 * The paper account acting on this request. Tournament sign-in is the only
 * identity; its first trade, quote, portfolio view or comment opens the
 * account at the initial balance.
 */
export async function requireCurrentUserId(
  request: Request,
  getDatabase: DatabaseProvider,
): Promise<string> {
  const userRequired = () =>
    new ServiceError("USER_REQUIRED", "Sign in to trade, comment, or see a portfolio.");
  // Without a session cookie there is nothing to look up, so the pool stays closed.
  if (readCookie(request, TOURNAMENT_SESSION_COOKIE) === null) throw userRequired();
  const db = getDatabase();
  const session = await resolveTournamentSession(db, request);
  if (session === null) throw userRequired();
  return ensurePaperAccount(db, session.userId);
}
