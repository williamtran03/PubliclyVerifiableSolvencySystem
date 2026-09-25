import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";

export default defineConfig({
  root: "open-solvency",
  base: "./",
  plugins: [{
    name: "completed-deployments-only",
    buildStart() {
      const directory = resolve(import.meta.dirname, "deployments");
      if (!existsSync(directory)) return;
      for (const name of readdirSync(directory).filter(name => name.endsWith(".json"))) {
        const record = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
        if (record && Object.hasOwn(record, "pending")) {
          throw new Error(`${name}: resolve and remove the pending transaction before building or serving the website.`);
        }
      }
    },
  }, {
    name: "local-demo-connections",
    configureServer(server) {
      server.middlewares.use("/demo-config.json", (_request, response) => {
        const config = process.env.OPENSOLVENCY_DEMO_CONFIG;
        if (!config) { response.statusCode = 404; response.end(); return; }
        try {
          const parsed = JSON.parse(readFileSync(config, "utf8"));
          const solutions = Object.fromEntries(Object.entries(parsed.solutions).map(([id, value]) => {
            const connection = value as { rpc: string; registry: string; chainId: number };
            return [id, { rpc: connection.rpc, registry: connection.registry, chainId: connection.chainId }];
          }));
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ version: 1, solutions }));
        } catch { response.statusCode = 500; response.end("Demo configuration unavailable"); }
      });
    },
  }],
  resolve: { alias: { "@shared": resolve(import.meta.dirname, "shared"), "@arms": resolve(import.meta.dirname, "arms") } },
  server: { port: 5175, fs: { allow: [".."] } },
});
