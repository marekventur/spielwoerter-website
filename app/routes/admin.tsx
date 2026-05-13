import { useState } from "react";
import { redirect } from "react-router";
import { Copy, Trash2, Plus } from "lucide-react";
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

type TokenRow = {
  id: number;
  token: string;
  label: string;
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

  const mcpTokens = context.db
    .prepare(
      "SELECT id, token, label, created_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(context.user.id) as TokenRow[];

  return { user: context.user, users, mcpTokens };
}

export default function AdminPage({ loaderData }: Route.ComponentProps) {
  const { users: initialUsers, mcpTokens: initialTokens } = loaderData;
  const [users, setUsers] = useState(initialUsers);
  const [pendingUser, setPendingUser] = useState<number | null>(null);

  const [tokens, setTokens] = useState(initialTokens);
  const [newLabel, setNewLabel] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://spielwoerter.de";

  const toggleModerator = async (id: number, current: number) => {
    setPendingUser(id);
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
    setPendingUser(null);
  };

  const createToken = async () => {
    if (!newLabel.trim()) return;
    setCreatingToken(true);
    const res = await fetch("/api/admin/mcp-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim() }),
    });
    if (res.ok) {
      const data = (await res.json()) as TokenRow;
      setTokens((prev) => [data, ...prev]);
      setNewLabel("");
    }
    setCreatingToken(false);
  };

  const revokeToken = async (id: number) => {
    await fetch(`/api/admin/mcp-tokens/${id}`, { method: "DELETE" });
    setTokens((prev) => prev.filter((t) => t.id !== id));
  };

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const mcpUrl = (token: string) => `${origin}/mcp/${token}`;

  const configSnippet = (token: string) =>
    JSON.stringify(
      {
        mcpServers: {
          spielwoerter: {
            type: "http",
            url: mcpUrl(token),
          },
        },
      },
      null,
      2
    );

  return (
    <div>
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-12">
        {/* Users */}
        <section>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin</h1>
          <p className="text-gray-500 mb-6 text-sm">{users.length} Nutzer registriert</p>

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
                        disabled={pendingUser === u.id}
                        onClick={() => toggleModerator(u.id, u.is_moderator)}
                      >
                        {pendingUser === u.id
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
        </section>

        {/* MCP Tokens */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-1">MCP Tokens</h2>
          <p className="text-gray-500 text-sm mb-6">
            Tokens für den Zugriff auf die Moderations-API via MCP (z.B. für KI-Agenten).
            Jedes Token gibt vollen Moderationszugriff — handle sie wie Passwörter.
          </p>

          {/* Create new token */}
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              placeholder="Token-Bezeichnung (z.B. 'tinyclaw')"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createToken()}
              className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <Button
              onClick={createToken}
              disabled={creatingToken || !newLabel.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white shrink-0"
            >
              <Plus className="w-4 h-4 mr-1" />
              Token erstellen
            </Button>
          </div>

          {tokens.length === 0 ? (
            <Card className="p-8 text-center text-gray-400 text-sm">
              Noch keine Tokens. Erstelle ein Token oben.
            </Card>
          ) : (
            <div className="space-y-4">
              {tokens.map((t) => (
                <Card key={t.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="font-medium text-gray-900">{t.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Erstellt {new Date(t.created_at).toLocaleDateString("de-DE")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="default"
                      className="text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                      onClick={() => revokeToken(t.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Widerrufen
                    </Button>
                  </div>

                  {/* MCP URL */}
                  <div className="mb-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">MCP URL</p>
                    <div className="flex items-center gap-2 bg-gray-50 rounded px-3 py-2">
                      <code className="flex-1 text-xs text-gray-700 break-all">
                        {mcpUrl(t.token)}
                      </code>
                      <button
                        onClick={() => copyToClipboard(mcpUrl(t.token), t.id)}
                        className="shrink-0 text-gray-400 hover:text-gray-700"
                        title="Kopieren"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Config snippet */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-500">
                        .claude/settings.json Eintrag
                      </p>
                      <button
                        onClick={() => copyToClipboard(configSnippet(t.token), -t.id)}
                        className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        {copied === -t.id ? "Kopiert!" : "Kopieren"}
                      </button>
                    </div>
                    <pre className="bg-gray-50 rounded px-3 py-2 text-xs text-gray-700 overflow-x-auto">
                      {configSnippet(t.token)}
                    </pre>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
