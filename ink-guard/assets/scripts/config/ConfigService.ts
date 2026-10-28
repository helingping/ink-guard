import { JsonAsset, resources } from 'cc';
import { CONFIG_FILES, GameConfig } from './ConfigTypes';
import { normalizeConfig } from './validateConfig';

function loadJson(name: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    resources.load(`configs/${name}`, JsonAsset, (err, asset) => {
      if (err || !asset || asset.json == null) {
        reject(new Error(`读不到 resources/configs/${name}.json`));
        return;
      }
      resolve(asset.json);
    });
  });
}

/** Loads and validates every tuning file. Gameplay code reads the result, not the raw assets. */
export async function loadGameConfig(): Promise<GameConfig> {
  const raw: Record<string, unknown> = {};
  const loaded = await Promise.all(CONFIG_FILES.map(async (name) => ({ name, data: await loadJson(name) })));
  for (const entry of loaded) {
    raw[entry.name] = entry.data;
  }
  return normalizeConfig(raw);
}
