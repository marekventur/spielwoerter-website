import { useRef, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronDown, Search, User } from "lucide-react";
import { Button } from "~/components/ui/button";

type NavUser = {
  email: string;
  isModerator: boolean;
  isAdmin: boolean;
};

type Props = {
  user: NavUser | null;
};

export function NavBar({ user }: Props) {
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = search.trim();
    if (!term) return;
    navigate(`/wort/${encodeURIComponent(term.toUpperCase())}`);
    setSearch("");
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t)) {
        setOpen(false);
      }
      if (infoRef.current && !infoRef.current.contains(t)) {
        setInfoOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  const navText =
    "text-sm font-medium leading-5 text-gray-600 hover:text-orange-600 whitespace-nowrap";

  return (
    <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4 min-h-[3rem]">
        {/* Logo */}
        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
          <Link
            to="/"
            className="flex items-center gap-2 shrink-0 text-sm font-bold leading-5 text-gray-800"
          >
            <div className="flex gap-1 shrink-0" aria-hidden>
              <div className="size-8 bg-orange-500 rounded flex items-center justify-center text-white text-sm leading-none">
                S
              </div>
              <div className="size-8 bg-orange-400 rounded flex items-center justify-center text-white text-sm leading-none">
                W
              </div>
            </div>
            <span className="hidden sm:inline text-base leading-5">
              Spielwoerter.de
            </span>
          </Link>

          {/* lg+: separate info links */}
          <div className="hidden lg:flex items-center gap-5 xl:gap-6">
            <Link to="/regeln" className={navText}>
              Regeln
            </Link>
            <Link to="/warum" className={navText}>
              Warum
            </Link>
            <Link to="/entstehung" className={navText}>
              Entstehung
            </Link>
            <Link to="/mitmachen" className={navText}>
              Mitmachen
            </Link>
          </div>

          {/* &lt; lg: Menü (Regeln, Warum, Entstehung, Mitmachen) */}
          <div className="flex lg:hidden items-center">
            <div className="relative" ref={infoRef}>
              <button
                type="button"
                onClick={() => setInfoOpen((o) => !o)}
                className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium leading-5 text-gray-700 hover:bg-gray-100 transition-colors"
                aria-expanded={infoOpen}
                aria-haspopup="menu"
                aria-label="Weitere Seiten"
              >
                Menü
                <ChevronDown
                  className={`size-4 text-gray-400 transition-transform shrink-0 ${infoOpen ? "rotate-180" : ""}`}
                />
              </button>
              {infoOpen && (
                <div
                  className="absolute left-0 mt-2 w-52 rounded-md border bg-white shadow-lg py-1 z-50"
                  role="menu"
                >
                  <Link
                    to="/regeln"
                    className="flex px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setInfoOpen(false)}
                    role="menuitem"
                  >
                    Regeln
                  </Link>
                  <Link
                    to="/warum"
                    className="flex px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setInfoOpen(false)}
                    role="menuitem"
                  >
                    Warum
                  </Link>
                  <Link
                    to="/entstehung"
                    className="flex px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setInfoOpen(false)}
                    role="menuitem"
                  >
                    Entstehung
                  </Link>
                  <Link
                    to="/mitmachen"
                    className="flex px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setInfoOpen(false)}
                    role="menuitem"
                  >
                    Mitmachen
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search — available on every page so you can look up another word directly */}
        <form
          onSubmit={handleSearch}
          role="search"
          className="relative min-w-0 flex-1 max-w-xs"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
            placeholder="Wort nachschlagen…"
            aria-label="Wort nachschlagen"
            className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm leading-5 text-gray-800 transition-colors placeholder:text-gray-400 focus:border-orange-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </form>

        {/* Right side */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <div className="relative" ref={ref}>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium leading-5 text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <User className="size-4 shrink-0 text-gray-500" />
                <span className="hidden sm:inline max-w-[160px] truncate leading-5">
                  {user.email}
                </span>
                <ChevronDown
                  className={`hidden sm:block size-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>

              {open && (
                <div className="absolute right-0 mt-1 w-56 rounded-md border bg-white shadow-lg py-1 z-50">
                  <Link
                    to="/meine-vorschlaege"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    Meine Vorschläge
                  </Link>
                  <Link
                    to="/konto"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    Konto
                  </Link>
                  <Link
                    to="/power-edit"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    Power Edit
                  </Link>
                  <Link
                    to="/aenderungen"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    Änderungen
                  </Link>
                  {user.isModerator && (
                    <Link
                      to="/moderation"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                      onClick={() => setOpen(false)}
                    >
                      Moderation
                    </Link>
                  )}
                  {user.isModerator && (
                    <Link
                      to="/diskussion"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                      onClick={() => setOpen(false)}
                    >
                      Diskussion
                    </Link>
                  )}
                  {user.isAdmin && (
                    <Link
                      to="/admin"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                      onClick={() => setOpen(false)}
                    >
                      Admin
                    </Link>
                  )}
                  <div className="my-1 border-t" />
                  <button
                    onClick={handleLogout}
                    className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Abmelden
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Button
              to="/login"
              variant="outline"
              className="h-9 min-h-0 border-orange-500 px-3 py-0 text-sm font-medium leading-5 text-orange-600 hover:bg-orange-50"
            >
              Anmelden
            </Button>
          )}
        </div>
      </div>
    </nav>
  );
}
