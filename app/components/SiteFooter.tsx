import { Link } from "react-router";

export function SiteFooter() {
  return (
    <footer className="bg-gray-50 border-t py-8">
      <div className="max-w-6xl mx-auto px-6 text-center text-gray-600">
        <p className="text-sm">
          <Link to="/">Spielwoerter.de</Link>
          {" · "}
          <Link to="/regeln">Wortregeln</Link>
          {" · "}
          <Link to="/warum">Warum</Link>
          {" · "}
          <Link to="/entstehung">Entstehung</Link>
          {" · "}
          <Link to="/mitmachen">Mitmachen</Link>
          {" · "}
          <Link to="/aenderungen">Änderungen</Link>
          {" · "}
          <Link to="https://github.com/marekventur/spielwoerter/blob/main/LICENSE">CC0 Public Domain</Link>
          {" · "}
          <Link to="https://github.com/marekventur/spielwoerter">GitHub</Link>
          {" · "}
          <Link to="https://github.com/marekventur/spielwoerter/issues">Problem melden</Link>
          {" · "}
          <Link to="mailto:mail@wortopia.de">Kontakt</Link>
        </p>
      </div>
    </footer>
  );
}

