import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("regeln", "routes/regeln.tsx"),
  route("warum", "routes/warum.tsx"),
  route("entstehung", "routes/entstehung.tsx"),
  route("mitmachen", "routes/mitmachen.tsx"),
  route("wort/:word", "routes/wort.$word.tsx"),
  route("aenderungen", "routes/aenderungen.tsx"),
  route("login", "routes/login.tsx"),
  route("meine-vorschlaege", "routes/meine-vorschlaege.tsx"),
  route("konto", "routes/konto.tsx"),
  route("moderation", "routes/moderation.tsx"),
  route("diskussion", "routes/diskussion.tsx"),
  route("diskussion/:id", "routes/diskussion.$id.tsx"),
  route("admin", "routes/admin.tsx"),
  route("power-edit", "routes/power-edit.tsx"),
] satisfies RouteConfig;
