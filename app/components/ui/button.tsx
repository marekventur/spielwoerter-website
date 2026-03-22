import * as React from "react";
import { Link, type LinkProps } from "react-router";

type Variant = "default" | "outline" | "secondary";
type Size = "default" | "lg" | "icon" | "icon-lg";

type Shared = {
  variant?: Variant;
  size?: Size;
  className?: string;
};

export type ButtonProps = Shared &
  (
    | ({ to?: undefined } & React.ButtonHTMLAttributes<HTMLButtonElement>)
    | ({ to: LinkProps["to"] } & Omit<LinkProps, "className">)
  );

const Button = React.forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = "default",
      size = "default",
      className = "",
      to,
      ...rest
    } = props;

    const base =
      "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 rounded-lg";
    const variants = {
      default: "bg-orange-500 text-white hover:bg-orange-600",
      outline: "border bg-transparent hover:bg-gray-50",
      secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    };
    const sizes = {
      default: "h-10 px-4 py-2",
      lg: "h-12 px-8 text-lg",
      icon: "h-10 w-10",
      "icon-lg": "h-16 w-16",
    };
    const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

    if (to !== undefined) {
      const {
        type: _t,
        disabled: _d,
        form: _f,
        formAction: _fa,
        formEncType: _fe,
        formMethod: _fm,
        formNoValidate: _fnv,
        formTarget: _ft,
        name: _n,
        value: _v,
        ...linkRest
      } = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          to={to}
          className={classes}
          {...(linkRest as Omit<LinkProps, "to" | "className" | "ref">)}
        />
      );
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={classes}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
