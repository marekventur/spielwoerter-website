/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [
    {
      name: "default-app",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      // VPS: set DATABASE_PATH if you want DB outside app dir, e.g. /var/lib/myapp/data/app.db
      // env: { DATABASE_PATH: "/var/lib/default-app/data/app.db" },
    },
  ],
};
