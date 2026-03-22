import { Link } from "react-router";
import type { Route } from "./+types/regeln";

const REGELN_SOURCE =
  "https://github.com/marekventur/spielwoerter/blob/main/REGELN.md";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Wortregeln – Spielwörter.de" }];
}

export default function RegelnPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-gray-800">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Spielwoerter.de Wortregeln
      </h1>
      <p className="text-sm text-gray-500 mb-8">
        Kurzfassung der Regeln zur Zulässigkeit von Wörtern. Die vollständige Fassung mit allen Details steht in{" "}
        <a
          href={REGELN_SOURCE}
          className="text-orange-600 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          REGELN.md
        </a>{" "}
        im Projekt-Repository.
      </p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Zulässig (gültige Wörter)
        </h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">
          <li>
            <strong>Stichwörter und Ableitungen:</strong> Als Stichwort
            verzeichnete Wörter sowie grammatisch korrekte Beugungen,
            alternative Schreibweisen und aufgeführte Varianten.
          </li>
          <li>
            <strong>Register und Stilebenen:</strong> Fach-, Umgangs-, veraltete,
            seltene und landschaftliche Begriffe — gültig, sofern als Stichwort
            verzeichnet.
          </li>
          <li>
            <strong>Interjektionen</strong> (z.B. brr, ha, hü) — gültig
            unabhängig von Satzzeichen.
          </li>
          <li>
            <strong>Fremdwörter</strong> nur, wenn sie als eigenständige
            Stichwörter im deutschen Wörterbuch stehen und im Alltag gebräuchlich
            sind; bloße Fremdheit reicht nicht.
          </li>
          <li>
            <strong>Alte Rechtschreibung</strong>, wenn als Stichwort geführt
            (z.B. rauh neben rau).
          </li>
          <li>
            <strong>Ausgeschriebene Buchstabennamen</strong> (griechisch/deutsch,
            z.B. Xi, Omega, Zett, Eszett).
          </li>
          <li>
            <strong>Kurzwörter</strong> mit Kennzeichnung „kurz für“ o.Ä.
            (z.B. Kita, Aids).
          </li>
          <li>
            <strong>Religiöse und mythologisch-literarische Begriffe</strong> nach
            den im Regelwerk genannten Einschränkungen (u.a. Pluralangabe,
            übertragene Bedeutung, Ableitungen).
          </li>
          <li>
            <strong>Produktnamen mit ®</strong>, sofern Pluralbildung möglich;
            Ableitungen (z.B. googeln) sind möglich.
          </li>
          <li>
            <strong>Zusammensetzungen und Verschmelzungen</strong>, wenn als
            Stichwort eingetragen.
          </li>
          <li>
            <strong>Namen als Gattungsbezeichnungen</strong> mit Plural oder
            übertragener Bedeutung (z.B. Krösus, Riviera).
          </li>
          <li>
            <strong>Einwohner-, Sprach- und Ortsadjektive</strong> sowie
            Völker-/Stammesnamen, wenn verzeichnet.
          </li>
          <li>
            <strong>Staatsorgane, Institutionen, Epochen, historische
            Ereignisse, politische Bewegungen, Titel/Anreden, geo- und
            klimatische Zonen</strong> — jeweils mit den im Original genannten
            Beispielen und Einschränkungen.
          </li>
        </ol>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Unzulässig (ungültige Wörter)
        </h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">
          <li>
            <strong>Eigennamen</strong> (Personen, Orte, Himmelskörper, Firmen,
            einzigartige Organisationen) — außer mit Gattungsbedeutung und
            Plural wie in den Zulässig-Regeln beschrieben.
          </li>
          <li>
            <strong>Abkürzungen</strong> (Punkte, buchstabenweise Aussprache,
            Großbuchstaben-Kürzel, chemische Zeichen, Währungscodes usw.).
          </li>
          <li>
            <strong>Sonderzeichen</strong> im Stichwort (Bindestrich, Apostroph
            usw.).
          </li>
          <li>
            <strong>Vor- und Nachsilben</strong> alleinstehend.
          </li>
          <li>
            <strong>Teile von Wortgruppen</strong> ohne eigenen Eintrag (z.B.
            „se“ aus „per se“).
          </li>
          <li>
            <strong>Tierfabelnamen</strong>, bestimmte mythologische Einzelnamen
            ohne Plural/Übertragung, <strong>Produktnamen ohne Plural</strong>,
            <strong> zusammengesetzte Geo-Eigenname-Gebiete</strong>, nur im
            Plural stehende Personengruppen ohne passenden Eintrag,{" "}
            <strong>geschlechtsspezifische Ableitungen</strong> ohne eigenen
            Stichwortnachweis, nicht verzeichnete Verschmelzungen mit „es“.
          </li>
        </ol>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Beugungsregeln (Auszug)
        </h2>

        <h3 className="text-base font-semibold text-gray-900 mt-4 mb-2">
          Verben
        </h3>
        <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed">
          <li>
            Grammatisch korrekte Konjugationen inkl. Konjunktiv; umgangssprachliche
            und veraltete Formen, wenn belegbar.
          </li>
          <li>
            Trennbare und untrennbare Verben, defektive und unpersönliche Verben
            nach den im Regelwerk festgelegten Grenzen (Partizipien, Infinitive,
            Gerundiv usw.).
          </li>
          <li>
            Ausführliche Regeln zu <strong>e-Tilgung</strong>, Infinitiv auf
            Vokal, Verben auf -el/-er und englischstämmigen Verben — siehe
            vollständige REGELN.md.
          </li>
        </ul>

        <h3 className="text-base font-semibold text-gray-900 mt-4 mb-2">
          Substantive
        </h3>
        <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed">
          <li>Alle grammatisch korrekten Deklinationsformen.</li>
          <li>
            <strong>Dativ-e</strong> nach den dortigen Bedingungen (u.a.
            Genitiv -es, Stamm, Fremdwörter mit Umlaut als Eindeutschung).
          </li>
          <li>
            Bei Zusammensetzungen richtet sich das Dativ-e nach dem letzten
            Bestandteil-Eintrag.
          </li>
        </ul>

        <h3 className="text-base font-semibold text-gray-900 mt-4 mb-2">
          Adjektive
        </h3>
        <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed">
          <li>
            Deklination und Steigerung nur, wenn sinngemäß möglich; Ausnahmen für
            absolute Grade, Endzustände, nur attributiv/prädikativ usw.
          </li>
          <li>
            Besondere Regeln für un-/-los-, Fremdwortadjektive, indeklinabel
            markierte Wörter, trendig/happy/sexy/unsexy, Farbadjektive und
            Elativformen.
          </li>
          <li>
            <strong>Zahlenadjektive:</strong> Ordinalbildung, Zusammensetzungen
            mit -fach, -jährig usw., Zehner substantivierbar, Adverbien auf
            -tens/-stens.
          </li>
        </ul>

        <h3 className="text-base font-semibold text-gray-900 mt-4 mb-2">
          e-Tilgung bei Adjektiven
        </h3>
        <p className="text-sm leading-relaxed text-gray-700">
          Unterschiedliche Regeln für Endungen -el, -en, deutsche vs. lateinische
          -er, -auer/-euer, -ere — jeweils mit klaren Ja/Nein-Fällen in der
          ausführlichen Fassung.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-3 border-b border-orange-200 pb-2">
          Grenzfälle
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed">
          <li>
            Wörter mit <strong>Eigenname und Gattungsbedeutung</strong> (z.B.
            „mark“) können wegen der Gattungsbedeutung zulässig sein.
          </li>
        </ul>
      </section>
    </div>
  );
}
