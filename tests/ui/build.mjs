// Bundles the real app against the Firebase stand-ins for browser testing. TEST ONLY.
import { build } from "esbuild"; import { resolve } from "node:path"; import { mkdirSync, writeFileSync } from "node:fs";
const out = resolve("tests/.ui-dist"); mkdirSync(out, { recursive: true });
const env = { VITE_FIREBASE_API_KEY: "k", VITE_FIREBASE_AUTH_DOMAIN: "d", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "a", VITE_FIREBASE_MESSAGING_SENDER_ID: "m", VITE_ENABLE_GOOGLE_SIGNIN: "true" };
await build({ entryPoints: ["src/main.jsx"], bundle: true, splitting: true, format: "esm", outdir: out, jsx: "automatic", loader: { ".js": "jsx", ".css": "css" }, logLevel: "error",
  alias: { "firebase/firestore": resolve("tests/fakes/firestore.js"), "firebase/auth": resolve("tests/fakes/auth.js"), "firebase/app": resolve("tests/fakes/app.js") },
  define: Object.fromEntries(Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])) });
writeFileSync(resolve(out, "index.html"), '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>');
console.log("built", out);
