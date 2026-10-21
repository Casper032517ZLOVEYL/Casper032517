import { analyze } from "../dist/core.mjs";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
try {
  const p = JSON.parse(raw);
  console.log(
    JSON.stringify(analyze(p.rows, p.question, p.plan, { channel: p.channel })),
  );
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message }));
}
