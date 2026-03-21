import { Button } from "~/components/ui/button";

export type CC0LicenseActionState = "idle" | "loading" | "done" | "error" | "license";

type CC0LicenseConfirmProps = {
  actionState: CC0LicenseActionState;
  onAccept: () => void | Promise<void>;
  onCancel: () => void;
};

export function CC0LicenseConfirm({
  actionState,
  onAccept,
  onCancel,
}: CC0LicenseConfirmProps) {
  return (
    <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 max-w-md text-left">
      <h3 className="font-bold text-gray-900 mb-2">CC0-Lizenz bestätigen</h3>
      <p className="text-sm text-gray-600 mb-4">
        Beiträge zu Spielwörter.de werden unter der{" "}
        <a
          href="https://creativecommons.org/publicdomain/zero/1.0/deed.de"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-orange-600"
        >
          CC0-Lizenz (Public Domain)
        </a>{" "}
        veröffentlicht. Mit dem Absenden verzichtest du auf alle Urheberrechte an deinem Beitrag.
      </p>
      <div className="flex gap-3">
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-white"
          onClick={() => onAccept()}
          disabled={actionState !== "license"}
        >
          Ich stimme zu
        </Button>
        <Button variant="outline" onClick={() => onCancel()}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

