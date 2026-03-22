import { Link } from "react-router";
import type { Route } from "./+types/entstehung";

const README =
  "https://github.com/marekventur/spielwoerter/blob/main/README.md";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Entstehung der Liste – Spielwörter.de" }];
}

export default function EntstehungPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-gray-800">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Wie die Wortliste entsteht
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Hier geht es um den <strong>technischen Aufbau</strong> der Daten — von
        den Rohkandidaten bis zur fertigen JSONL-Datei. Hintergrund zum Projekt,
        Lizenz und Community findest du unter{" "}
        <Link to="/warum" className="text-orange-600 hover:underline">
          Warum Spielwörter?
        </Link>
        .
      </p>
      <p className="text-sm text-gray-500 mb-8">
        Spielwörter umfasst über 200.000 Einträge und steht unter{" "}
        <strong>CC0</strong> (Public Domain). Die reproduzierbare Pipeline ist
        im{" "}
        <a
          href={README}
          className="text-orange-600 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          README
        </a>{" "}
        dokumentiert; folgend die Kurzfassung.
      </p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Download und Regeln
        </h2>
        <p className="text-sm leading-relaxed mb-3">
          Du kannst die ganze Liste{" "}
          <a
            href="https://github.com/marekventur/spielwoerter/blob/main/wordlist_accepted.jsonl"
            className="text-orange-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            hier herunterladen
          </a>
          .
        </p>
        <p className="text-sm leading-relaxed">
          Zur Einhaltung der Spielregeln dient{" "}
          <Link to="/regeln" className="text-orange-600 hover:underline">
            REGELN.md
          </Link>{" "}
          (angelehnt an die offiziellen ORZ-Regeln von Scrabble Deutschland
          e.V.).
        </p>
      </section>

      <section className="mb-10">
        <p className="text-sm leading-relaxed">
          Die Wortliste wurde in mehreren Stufen erstellt:
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Stufe 1: Kandidaten
        </h2>
        <p className="text-sm leading-relaxed mb-3">
          Rund <strong>970.000</strong> Kandidaten (2–9 Buchstaben, Kleinbuchstaben
          a–z plus ä/ö/ü/ß) stammen aus neun frei nutzbaren deutschsprachigen
          Quellen. Jedes Wort wird mit den nachweisenden Quellen versehen — der
          Rohsatz hatte hohe Recall gegenüber Turnierlisten, aber niedrige
          Präzision (viele Eigennamen, Abkürzungen, Fremdwörter).
        </p>
        <ul className="text-sm leading-relaxed space-y-1.5 list-disc pl-5 mb-3">
          <li>
            <a
              href="https://kaikki.org/dictionary/German/"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Kaikki
            </a>{" "}
            — Wiktionary-basierte Kopf- und Flexionsformen (
            <a
              href="https://de.wiktionary.org/"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              deutschsprachiges Wiktionary
            </a>
            )
          </li>
          <li>
            <a
              href="https://extensions.libreoffice.org/en/extensions/show/german-de-de-frami-dictionaries"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              hunspell de_DE
            </a>{" "}
            (Affix-Expansion, z. B. mit spylls)
          </li>
          <li>
            <a
              href="https://de.wikipedia.org/"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Wikipedia auf Deutsch
            </a>{" "}
            (Seitentitel und Textauszüge)
          </li>
          <li>
            <a
              href="https://www.gutenberg.org/browse/languages/de"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Project Gutenberg
            </a>{" "}
            (deutschsprachige Texte)
          </li>
          <li>
            <a
              href="https://www.openthesaurus.de/"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenThesaurus
            </a>
          </li>
          <li>
            <a
              href="https://wortschatz.uni-leipzig.de/"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Leipzig Wortschatz
            </a>{" "}
            (Korpora)
          </li>
          <li>
            NE-Kontraktionen (regelbasiert, z. B.{" "}
            <code className="text-xs bg-gray-100 px-1 rounded">*Cene → *Cne</code>
            ) — ohne externes Korpus
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Stufe 2: KI-Klassifikation
        </h2>
        <p className="text-sm leading-relaxed mb-3">
          Alle Kandidaten werden mit einem Sprachmodell (
          <a
            href="https://www.deepseek.com/"
            className="text-orange-600 hover:underline font-semibold"
            target="_blank"
            rel="noopener noreferrer"
          >
            DeepSeek V3
          </a>
          ) nach den ORZ-Regeln bewertet: zwei
          unabhängige Durchläufe in normaler und umgekehrter Batch-Reihenfolge.
          Stimmen sie überein, gilt das Ergebnis als sicher; bei Widerspruch
          entscheidet ein dritter Durchlauf (Tiebreaker). Dem Modell wird nur die
          Wortform gegeben — ohne Quellen-Herkunft, um Verzerrungen zu vermeiden.
          Als unsicher markierte Einträge landen nicht in der Hauptliste.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Stufe 3: Morphologische Erweiterung
        </h2>
        <p className="text-sm leading-relaxed">
          Akzeptierte Lemmata werden anhand der{" "}
          <a
            href="https://kaikki.org/dictionary/German/"
            className="text-orange-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Kaikki-Wiktionary
          </a>
          -Daten zu weiteren Beugungsformen expandiert. Neu hinzukommende Formen
          werden nachvollziehbar mit Basiswort verknüpft — das erhöht die
          Abdeckung messbar gegenüber dem Turnier-Oracle.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Stufe 4: Kurze Wörter
        </h2>
        <p className="text-sm leading-relaxed">
          Zwei- und Dreibuchstaben-Wörter sind im Spiel besonders kritisch; hier
          neigen Klassifikatoren zu Fehlannahmen (Abkürzungen, Ländercodes).
          Diese Worte wurden deshalb manuell kuratiert.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Bewertung und andere Listen
        </h2>
        <p className="text-sm leading-relaxed mb-3">
          Die Qualität wird u.a. mit einem <strong>Black-Box-Oracle</strong>{" "}
          gegen eine autoritative Turnierliste gemessen (nur aggregierte
          Kennzahlen, keine Einzelvergleiche zum Schutz der Referenzliste). Als
          Referenz dient u.a. die mit{" "}
          <a
            href="https://scrabble3d.info/"
            className="text-orange-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Scrabble3D
          </a>{" "}
          ausgelieferte deutsche Turnierliste (SuperDic); siehe README.
        </p>
        <p className="text-sm leading-relaxed text-gray-700 mb-3">
          Vor dem Aufbau von Spielwörter wurden andere öffentliche Wortlisten
          geprüft — Lizenzgründe oder fehlende Methodik haben sie als Grundlage
          ausgeschlossen. Verwandte Projekte (ohne Übernahme der Daten):
        </p>
        <ul className="text-sm leading-relaxed space-y-2 list-disc pl-5 text-gray-700">
          <li>
            <strong>SuperDic</strong> / Scrabble Deutschland e.V.: die
            turnierübliche Liste ist an{" "}
            <a
              href="https://scrabble3d.info/"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Scrabble3D
            </a>{" "}
            gebündelt; die Lizenz erlaubt keine freie Weiterverwendung als
            eigenes Korpus.
          </li>
          <li>
            <a
              href="https://scrabble-info.de/wortlisten/turnier-checker/"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              SDeV-Turnier-Checker
            </a>{" "}
            — Online-Prüfung einzelner Wörter (gleiche zugrunde liegende Liste).
          </li>
          <li>
            <a
              href="https://github.com/gottcode/tanglet"
              className="text-orange-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              ENZ / Tanglet
            </a>{" "}
            (CC0, große freie Liste) — unsichere Datenlage und Methodik.
          </li>
          <li>
            Community-Forks der ENZ-Liste (z.B. Hippler) — gleiche
            Lizenz, ähnliche Einschränkungen.
          </li>
        </ul>
        <p className="text-sm leading-relaxed text-gray-600 mt-3">
          Details und Begründungen stehen im{" "}
          <a
            href={README}
            className="text-orange-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            README
          </a>{" "}
          unter „Related word lists“.
        </p>
      </section>

      <p className="text-sm text-gray-600 pt-4 border-t border-gray-200">
        <Link to="/warum" className="text-orange-600 hover:underline">
          Warum Spielwörter?
        </Link>
        {" · "}
        <Link to="/" className="text-orange-600 hover:underline">
          Zur Startseite
        </Link>
        {" · "}
        <Link to="/mitmachen" className="text-orange-600 hover:underline">
          Mitmachen
        </Link>
      </p>
    </div>
  );
}
