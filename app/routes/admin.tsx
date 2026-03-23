import { useState } from "react";
import { Link, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type { Route } from "./+types/admin";

type UserRow = {
  id: number;
  email: string;
  is_moderator: number;
  is_admin: number;
  created_at: string;
};

export function meta({}: Route.MetaArgs) {
  return [{ title: "Admin – Spielwoerter.de" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/admin");
  if (!context.user.isAdmin) return redirect("/");

  const users = context.db
    .prepare(
      "SELECT id, email, is_moderator, is_admin, created_at FROM users ORDER BY created_at DESC"
    )
    .all() as UserRow[];

  return { user: context.user, users };
}

export default function AdminPage({ loaderData }: Route.ComponentProps) {
  const { users: initialUsers } = loaderData;
  const [users, setUsers] = useState(initialUsers);
  const [pending, setPending] = useState<number | null>(null);


  const toggleModerator = async (id: number, current: number) => {
    setPending(id);
    const res = await fetch(`/api/admin/users/${id}/set-moderator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: !current }),
    });
    if (res.ok) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, is_moderator: current ? 0 : 1 } : u
        )
      );
    }
    setPending(null);
  };

  return (
    <div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin</h1>
        <p className="text-gray-500 mb-8 text-sm">{users.length} Nutzer registriert</p>

        <Card className="overflow-hidden">
          <div className="divide-y">
            {users.map((u) => (
              <div key={u.id} className="px-5 py-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{u.email}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(u.created_at).toLocaleDateString("de-DE")}
                    {u.is_admin ? " · Admin" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.is_moderator ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                      Moderator
                    </span>
                  ) : null}
                  {!u.is_admin && (
                    <Button
                      variant="outline"
                      className={
                        u.is_moderator
                          ? "text-red-600 border-red-200 hover:bg-red-50 text-sm"
                          : "text-blue-600 border-blue-200 hover:bg-blue-50 text-sm"
                      }
                      disabled={pending === u.id}
                      onClick={() => toggleModerator(u.id, u.is_moderator)}
                    >
                      {pending === u.id
                        ? "…"
                        : u.is_moderator
                        ? "Moderator entfernen"
                        : "Zum Moderator machen"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
