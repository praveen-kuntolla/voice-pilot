import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const values = Object.fromEntries(
  readFileSync(resolve(".local/supabase-loopback-source/docker/.env"), "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      return match ? [[match[1], match[2]]] : [];
    }),
);

if (values.SUPABASE_PUBLIC_URL !== "http://127.0.0.1:55421" || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) {
  throw new Error("Refusing to launch: the isolated local Supabase configuration is incomplete or non-loopback.");
}

const nextBinary = resolve("node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextBinary, "dev", "--hostname", "127.0.0.1", "--port", "3000"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: values.SUPABASE_PUBLIC_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
    VOICE_WORKER_ENABLED: "false",
    VOICE_REALTIME_ENABLED: "false",
    VOICE_OUTBOUND_ENABLED: "false",
  },
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => process.exitCode = code ?? 1);
