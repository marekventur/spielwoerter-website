import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    rollupOptions: isSsrBuild
      ? {
          input: "./server/app.ts",
        }
      : undefined,
  },
  server: {
    allowedHosts: ["dev.spielwoerter.de"],
    // Vite's defaults plus the database; server.js only passes /@fs/ through.
    fs: {
      allow: ["app", "lib", "node_modules", "public"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/data/**", "**/*.db*"],
    },
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
}));
