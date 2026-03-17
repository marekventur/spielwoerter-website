import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("wort/:word", "routes/wort.$word.tsx"),
] satisfies RouteConfig;
