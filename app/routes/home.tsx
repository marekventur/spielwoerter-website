import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Search } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import type { Route } from "./+types/home";

export async function loader({ context }: Route.LoaderArgs) {
  return { user: context.user };
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Spielwörter.de – Das offene deutsche Wortspiel-Wörterbuch" }];
}

export default function Home({}: Route.ComponentProps) {
  const [searchWord, setSearchWord] = useState("");
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchWord.trim()) {
      navigate(`/wort/${encodeURIComponent(searchWord.trim().toUpperCase())}`);
    }
  };

  return (
    <div>
      

      {/* Hero Section */}
      <div className="max-w-4xl mx-auto px-6 pt-10 pb-16 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Das freie Wortspiel-Wörterbuch
        </h1>
        <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">
          <Link to="https://creativecommons.org/public-domain/cc0/" className="text-orange-600">Offen lizenzierte</Link>, kostenlos und ohne Einschränkungen verfügbar
        </p>

        {/* Search Box – single combined unit; button inset with padding; focus state transitions */}
        <form onSubmit={handleSearch} className="mb-16">
          <div
            className="relative max-w-2xl mx-auto h-16 rounded-xl border-2 shadow-lg bg-gray-50 transition-[border-color,box-shadow,background-color] duration-200 ease-out border-orange-300 focus-within:border-gray-300 focus-within:bg-white focus-within:shadow-md"
          >
            <Input
              type="text"
              value={searchWord}
              onChange={(e) => setSearchWord(e.target.value.toUpperCase())}
              placeholder="Wort nachschlagen..."
              className="h-full w-full text-2xl pl-6 pr-[4rem] border-0 bg-gray-50 rounded-xl  placeholder:text-gray-500 focus:ring-0 focus:ring-offset-0 focus:border-0 focus:bg-white shadow-none transition-colors duration-200 "
            />
            <Button
              type="submit"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              <Search className="h-6 w-6 shrink-0" />
            </Button>
          </div>
        </form>

        {/* Scrabble Tiles Decoration */}
        <div className="flex justify-center gap-2 mb-12">
          {["O", "F", "F", "E", "N"].map((letter, i) => (
            <div
              key={i}
              className="w-14 h-14 bg-gradient-to-br from-amber-100 to-orange-200 rounded shadow-md flex items-center justify-center relative border-2 border-orange-300"
            >
              <span className="text-2xl font-bold text-gray-800">{letter}</span>
              <span className="absolute bottom-1 right-1 text-xs font-semibold text-gray-600">
                {[1, 4, 4, 1, 1][i]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Features Section */}
      <div className="bg-white py-16 border-t border-b">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-orange-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2 text-gray-800">
                Open Source
              </h3>
              <p className="text-gray-600">
                Frei verfügbar unter offener Lizenz. Keine Einschränkungen,
                keine Gebühren.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-orange-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2 text-gray-800">
                Community-getrieben
              </h3>
              <p className="text-gray-600">
                Jeder kann beitragen. Gemeinsam erstellen wir das beste
                Wortspiel-Wörterbuch.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-orange-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2 text-gray-800">
                Geprüfte Qualität
              </h3>
              <p className="text-gray-600">
                Alle Vorschläge werden automatisch überprüft und validiert.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="space-y-8">
          <div className="flex gap-6 items-start">
            <div className="flex-shrink-0 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center text-white font-bold text-xl">
              1
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2 text-gray-800">
                Warum nicht einfach ein Wörterbuch verwenden?
              </h3>
              <p className="text-gray-600">
                Duden und Co. sind prima, aber für non-kommerzielle Wortspiele gibt es keine guten Wortlisten unter einer offenen Lizenz.
              </p>
            </div>
          </div>

          <div className="flex gap-6 items-start">
            <div className="flex-shrink-0 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center text-white font-bold text-xl">
              2
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2 text-gray-800">
                Wie kann ich einen Fehler korrigieren?
              </h3>
              <p className="text-gray-600">
                Melde dich an und korrigiere den Fehler auf der entsprechenden Wortseite. Sobald deine Entfehlung akzeptiert wurde, schicken wir dir eine E-Mail.
              </p>
            </div>
          </div>

          <div className="flex gap-6 items-start">
            <div className="flex-shrink-0 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center text-white font-bold text-xl">
              3
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2 text-gray-800">
                Was sind die Wortregeln?
              </h3>
              <p className="text-gray-600">
                Wir haben eine eigene <Link to="/regeln" className="text-orange-600 hover:underline">Wortregel-Liste</Link>, die im größtenteils an die offiziellen ORZ-Regeln von Scrabble Deutschland e.V. angelehnt ist.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-orange-500 to-orange-600 py-16 text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Bereit mitzumachen?</h2>
          <p className="text-xl mb-8 text-orange-50">
            Hilf uns, das beste deutsche Wortspiel-Wörterbuch aufzubauen.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button
              to="/login"
              size="lg"
              variant="secondary"
              className="bg-white text-orange-600 hover:bg-orange-50"
            >
              Jetzt beitragen
            </Button>
            <Button
              to="/warum"
              size="lg"
              variant="outline"
              className="border-white text-white hover:bg-orange-600"
            >
              Mehr erfahren
            </Button>
          </div>
        </div>
      </div>

      
    </div>
  );
}
