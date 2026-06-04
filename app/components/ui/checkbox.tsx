import { useEffect, useRef } from "react";

type Props = {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
};

export function Checkbox({ checked, indeterminate, onChange, disabled, label }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate ?? false;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-pointer rounded border-gray-300 text-sky-600 accent-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
