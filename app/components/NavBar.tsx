import { useRef, useState, useEffect } from "react";
import { Link } from "react-router";
import { ChevronDown, User } from "lucide-react";
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center text-white font-bold text-sm">
              S
            </div>
            <div className="w-8 h-8 bg-orange-400 rounded flex items-center justify-center text-white font-bold text-sm">
              W
            </div>
          </div>
          <span className="hidden sm:inline text-xl font-bold text-gray-800">Spielwörter.de</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="relative" ref={ref}>
              <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <User className="w-4 h-4 text-gray-500" />
                <span className="hidden sm:inline max-w-[160px] truncate">{user.email}</span>
                <ChevronDown className={`hidden sm:block w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>

              {open && (
                <div className="absolute right-0 mt-1 w-56 rounded-xl border bg-white shadow-lg py-1 z-50">
                  <Link
                    to="/meine-vorschlaege"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    Meine Vorschläge
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
            <Link to="/login">
              <Button
                variant="outline"
                className="border-orange-500 text-orange-600 hover:bg-orange-50"
              >
                Anmelden
              </Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
