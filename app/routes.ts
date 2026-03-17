import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("wort/:word", "routes/wort.$word.tsx"),
  route("login", "routes/login.tsx"),
  route("meine-vorschlaege", "routes/meine-vorschlaege.tsx"),
  route("moderation", "routes/moderation.tsx"),
  route("admin", "routes/admin.tsx"),
] satisfies RouteConfig;
