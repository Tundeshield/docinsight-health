// Bundles the functions source (and ../shared) into lib/index.js. npm packages stay external
// and are installed by Cloud Build from package.json.
import { build } from "esbuild";
const common = { bundle: true, platform: "node", target: "node20", format: "esm", packages: "external", sourcemap: true, logLevel: "info" };
await build({ ...common, entryPoints: ["src/index.ts"], outfile: "lib/index.js" });
await build({ ...common, entryPoints: ["src/ops/cli.ts"], outfile: "lib/ops.js" });
