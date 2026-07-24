import type Database from "better-sqlite3";

export type User = {
  id: number;
  email: string;
  displayName: string | null;
  isModerator: boolean;
  isAdmin: boolean;
};

export function getUserFromSession(
  db: Database.Database,
  sessionId: string
): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.is_moderator, u.is_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .get(sessionId) as
    | {
        id: number;
        email: string;
        display_name: string | null;
        is_moderator: number;
        is_admin: number;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isModerator: !!row.is_moderator,
    isAdmin: !!row.is_admin,
  };
}
