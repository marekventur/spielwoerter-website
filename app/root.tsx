import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { NavBar } from "~/components/NavBar";
import { SiteFooter } from "~/components/SiteFooter";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
  { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "128x128" },
  { rel: "icon", href: "/favicon.ico" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" data-theme="light">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Links />
        <Meta />
        {/* Analytics, production only.
          *
          * Self-hosted GoatCounter on vps3 (see vps-setup). It replaces Umami
          * cloud, which used to be loaded here; that site's history back to
          * 2026-06-05 was imported into GoatCounter first, so nothing was lost
          * by dropping it.
          *
          * The gate is not cosmetic. `import.meta.env.PROD` is false on
          * dev.spielwoerter.de, because server.js starts the Vite dev server
          * when NODE_ENV=development and the dev box therefore serves an
          * unbuilt bundle. The Umami tag this replaces had no such gate, and
          * its export duly contained pageviews from the dev host counted as
          * production traffic. */}
        {import.meta.env.PROD && (
          <script data-goatcounter="https://analytics.spielwoerter.de/count" async src="https://analytics.spielwoerter.de/count.js"></script>
        )}
      </head>
      <body className="font-sans antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export async function loader({ context }: Route.LoaderArgs) {
  return { user: context.user };
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-orange-50 flex flex-col">
      <NavBar user={user} />
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold text-error">{message}</h1>
      <p className="text-base-content/80">{details}</p>
      {stack && (
        <pre className="max-w-full overflow-auto rounded-lg bg-base-200 p-4 text-sm">
          {stack}
        </pre>
      )}
    </div>
  );
}
