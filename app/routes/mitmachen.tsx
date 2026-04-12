import { Link } from "react-router";
import type { Route } from "./+types/mitmachen";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Mitmachen – Spielwoerter.de" },
    { name: "description", content: "Fehler gefunden oder ein Wort vermisst? Melde dich an und verbessere das offene deutsche Wortspiel-Wörterbuch." },
  ];
}

export default function MitmachenPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-gray-800">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Vorschläge einreichen
      </h1>
      <p className="text-sm text-gray-500 mb-8">
        Die Datenbank auf Spielwoerter.de wird aus dem gleichen öffentlichen
        Datenstand wie das GitHub-Projekt gespeist. Über die Website kann die
        Community fehlende oder falsche Einträge melden und Beschreibungen
        verbessern — mit klarem Prüf- und Freigabeprozess.
      </p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Account und Lizenz
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed">
          <li>
            Du meldest dich mit deiner <strong>E-Mail-Adresse</strong> an; du
            erhältst einen kurzen Login-Code.
          </li>
          <li>
            Beim <strong>ersten Vorschlag</strong> bestätigst du die{" "}
            <strong>CC0-Lizenz</strong>.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Was du auf der Wortseite tun kannst
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed">
          <li>
            <strong>Hinzufügen:</strong> Für Wörter, die noch nicht in der Liste
            sind, kannst du eine Wörterbuch-artige Beschreibung und ggf. die
            Grundform angeben. Entwurf speichern, später unter „Meine Vorschläge“
            anpassen.
          </li>
          <li>
            <strong>Entfernen melden:</strong> Für Wörter, die fälschlich als
            gültig geführt werden (nach den{" "}
            <Link to="/regeln" className="text-orange-600 hover:underline">
              Wortregeln
            </Link>
            ).
          </li>
          <li>
            <strong>Beschreibung ändern:</strong> Korrektur oder Verbesserung des
            Kurztexts zu einem bestehenden Eintrag.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Entwürfe und „Meine Vorschläge“
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed">
          <li>
            Neue Vorschläge landen zuerst als <strong>Entwurf</strong>. Du kannst
            die Beschreibung dort per Dialog bearbeiten oder den Entwurf
            löschen.
          </li>
          <li>
            Wird ein Entwurf <strong>60 Minuten lang nicht geändert</strong>, wird
            er automatisch zur <strong>Prüfung</strong> vorgelegt.
          </li>
          <li>
            Jede Änderung am Entwurf setzt diese Frist zurück — so hast du Zeit,
            Texte zu verfeinern.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Prüfung und Freigabe
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed">
          <li>
            <strong>Moderator:innen</strong> sehen eingereichte Vorschläge auf der
            Moderationsseite und können sie <strong>annehmen</strong> oder{" "}
            <strong>ablehnen</strong>.
          </li>
          <li>
            Bei <strong>Annahme</strong> werden die Änderungen in einem
            Hintergrundjob in die <strong>GitHub-Wortlisten</strong> (
            <code className="text-xs bg-gray-100 px-1">wordlist_*.jsonl</code>)
            geschrieben und mit dem Repository abgeglichen.
          </li>
          <li>
            Die <strong>Website</strong> lädt die Wortdaten regelmäßig aus dem
            Repository nach — sichtbare Einträge aktualisieren sich mit dem
            nächsten solchen Sync.
          </li>
          <li>
            Zu Entscheidungen kann eine <strong>E-Mail-Zusammenfassung</strong>{" "}
            geschickt werden (z.B. nach Freigabe oder Ablehnung).
          </li>
        </ul>
        <p className="text-sm leading-relaxed mt-3 text-gray-600">
          Ablehnungen können dazu führen, dass ein Wort für bestimmte Aktionen
          blockiert wird, damit nicht dieselbe Änderung endlos wiederholt wird.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Technische oder Daten-Fragen
        </h2>
        <p className="text-sm leading-relaxed">
          Fehler in der Pipeline oder in den Dateien im Repo kannst du als Issue
          auf{" "}
          <a
            href="https://github.com/marekventur/spielwoerter"
            className="text-orange-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>{" "}
          melden; inhaltliche Korrekturen laufen über Vorschläge auf dieser
          Website.
        </p>
      </section>

    </div>
  );
}
