import { CONFIG_FILES, type GameConfig } from "./ConfigTypes";
import { normalizeConfig } from "./validateConfig";

/**
 * Preview page (`preview/index.html`) can see the shared Cocos JSON.
 * The IDE dev server usually maps `assets/resources` to `resources/` or to
 * `../assets/resources` from `bin/index.html`. The first base that answers wins,
 * so a repo-root server keeps the Laya port on the same balance as Creator.
 */
export const RESOURCE_BASES = [
  "../../ink-guard/assets/resources/",
  "../assets/resources/",
  "resources/",
];

export async function loadGameConfig(): Promise<GameConfig> {
  let last: unknown = null;
  for (const base of RESOURCE_BASES) {
    try {
      const raw: Record<string, unknown> = {};
      for (const name of CONFIG_FILES) {
        raw[name] = await fetchJson(`${base}configs/${name}.json`);
      }
      return normalizeConfig(raw);
    } catch (error) {
      last = error;
    }
  }
  const detail = last instanceof Error ? last.message : String(last ?? "unknown");
  throw new Error(`配置没有读出来：${detail}`);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(url);
  }
  return response.json() as Promise<unknown>;
}
