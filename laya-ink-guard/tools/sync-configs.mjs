import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../ink-guard/assets/resources/configs");
const target = join(here, "../assets/resources/configs");
mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  if (!name.endsWith(".json")) {
    continue;
  }
  copyFileSync(join(source, name), join(target, name));
  console.log(`synced ${name}`);
}
