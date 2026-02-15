import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [{ title: "wortliste" }];
}

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-6xl font-bold">wortliste</h1>
    </main>
  );
}
