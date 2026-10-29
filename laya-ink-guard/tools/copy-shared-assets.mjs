/**
 * Replaces the art symlinks with real copies so LayaAir IDE can import them
 * on a machine that does not follow symlinks. Safe to run more than once.
 */
import { cpSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, "../../ink-guard/assets/resources");
const target = join(here, "../assets/resources");
const folders = ["textures", "pose", "fx", "foes", "fonts"];

mkdirSync(target, { recursive: true });
for (const folder of folders) {
  const dest = join(target, folder);
  const src = join(shared, folder);
  try {
    if (lstatSync(dest).isSymbolicLink()) {
      rmSync(dest);
    }
  } catch {
    /* not there yet */
  }
  cpSync(src, dest, { recursive: true, dereference: true });
  console.log(`copied ${folder}`);
}
