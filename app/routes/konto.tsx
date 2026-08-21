import { redirect } from "react-router";
import { Card } from "~/components/ui/card";
import { ProfileNameCard } from "~/components/ProfileNameCard";
import { EmailSettingsCard } from "~/components/EmailSettingsCard";
import type { Route } from "./+types/konto";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Konto – Spielwoerter.de" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/konto");
  return { user: context.user };
}

export default function KontoPage({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Konto</h1>
      <p className="text-gray-500 mb-8 text-sm">
        Angemeldet als <span className="font-medium text-gray-700">{user.email}</span>
        {user.isModerator && " · Moderator:in"}
      </p>

      <ProfileNameCard user={user} />

      <EmailSettingsCard user={user} />

      <Card className="p-4">
        <p className="text-sm text-gray-600">
          Deine E-Mail-Adresse ist nur für dich sichtbar. Überall sonst erscheint ausschließlich
          dein Anzeigename.
        </p>
      </Card>
    </div>
  );
}
