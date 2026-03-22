import { Link } from "react-router";
import type { Route } from "./+types/warum";

const LICENSE =
  "https://github.com/marekventur/spielwoerter/blob/main/LICENSE";
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Warum Spielwörter? – Spielwörter.de" }];
}

export default function WarumPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-gray-800">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Warum Spielwörter?
      </h1>
      <p className="text-sm text-gray-500 mb-8">
        Eine freie, gepflegte deutsche Wortliste für Wortspiele — mit klarer
        Lizenz und mitwirkender Community. Die technische Entstehung der ersten
        Wortliste beschreiben wir separat unter{" "}
        <Link to="/entstehung" className="text-orange-600 hover:underline">
          Entstehung der Liste
        </Link>
        .
      </p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Das Problem: Lizenz und Verfügbarkeit
        </h2>
        <p className="text-sm leading-relaxed mb-3">
          Für kostenlose Spiele und Hobby-Projekte braucht man Wortlisten, die{" "}
          <strong>rechtlich unkritisch weiterverwendet</strong> werden dürfen.
          Klassische Wörterbücher und die offizielle Turnierliste des
          Scrabble-Verbandes sind oft{" "}
          <strong>nicht frei lizenziert</strong> oder an bestimmte Programme
          gebunden — das ist das Problem das ich mit meinem Projekt <Link to="https://wortopia.de" className="text-orange-600 hover:underline">Wortopia</Link> hatte.
        </p>
        <p className="text-sm leading-relaxed">
          Spielwörter soll genau diese Lücke schließen: eine{" "}
          <strong>große, nachvollziehbar erstellte Liste</strong>, die jeder
          nutzen, verarbeiten und weitergeben kann — ohne Lizenz-Stolperfallen.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          CC0 — wirklich gemeinfrei
        </h2>
        <p className="text-sm leading-relaxed mb-3">
          Die Wortformen und Metadaten im Projekt stehen unter{" "}
          <strong>CC0</strong> (
          <a
            href={CC0}
            className="text-orange-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Creative Commons Zero
          </a>
          , Public Domain). Kurz: Du darfst die Daten kopieren, anpassen,
          veröffentlichen und in kommerziellen Produkten verwenden — ohne
          Namensnennungspflicht (obwohl ein Hinweis auf die Quelle nett ist).
        </p>
        <p className="text-sm leading-relaxed">
          Den vollständigen Rechtstext findest du in der{" "}
          <a
            href={LICENSE}
            className="text-orange-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            LICENSE-Datei
          </a>{" "}
          im GitHub-Repository. Inhaltliche{" "}
          <Link to="/regeln" className="text-orange-600 hover:underline">
            Spielregeln
          </Link>{" "}
          (ORZ-orientiert) sind separat dokumentiert.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Die erste Liste ist nur der Anfang
        </h2>
        <p className="text-sm leading-relaxed mb-3">
          Die initiale Datenbank entsteht aus Korpusdaten und automatischer
          Klassifikation (siehe{" "}
          <Link to="/entstehung" className="text-orange-600 hover:underline">
            Entstehung der Liste
          </Link>
          ). Das liefert eine breite Ausgangsbasis — aber keine perfekte
          Wahrheit: Sprache ändert sich, und Computer können irren.
        </p>
        <p className="text-sm leading-relaxed mb-3">
          Auf <strong>Spielwörter.de</strong> kannst du deshalb{" "}
          <strong>aktiv mitgestalten</strong>: fehlende Wörter vorschlagen,
          falsche Einträge melden, Beschreibungen verbessern. Nach Prüfung fließen
          angenommene Änderungen in die Wortliste ein.
        </p>
        <p className="text-sm leading-relaxed text-gray-700">
          Kurz: Die offene Lizenz macht die Daten nützlich;{" "}
          <strong>Mitwirkende</strong> machen sie mit der Zeit{" "}
          <strong>besser und verlässlicher</strong>. {" "}
          <Link to="/mitmachen" className="text-orange-600 hover:underline">
            Mach mit!
          </Link>
          .
        </p>
      </section>

      <p className="text-sm text-gray-600 pt-4 border-t border-gray-200">
        <Link to="/entstehung" className="text-orange-600 hover:underline">
          Entstehung der Liste
        </Link>
        {" · "}
        <Link to="/mitmachen" className="text-orange-600 hover:underline">
          Mitmachen
        </Link>
        {" · "}
        <Link to="/" className="text-orange-600 hover:underline">
          Zur Startseite
        </Link>
      </p>
    </div>
  );
}
