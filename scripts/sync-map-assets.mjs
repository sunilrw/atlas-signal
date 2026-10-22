import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("maplibre-gl/package.json");
const packageDirectory = dirname(packagePath);
const destination = fileURLToPath(new URL("../public/data/maplibre/", import.meta.url));
const { version } = JSON.parse(await readFile(packagePath, "utf8"));

// The module worker imports ./maplibre-gl-shared.mjs. Always copy the pair
// from the installed package so its message protocol matches the bundled main.
const assets = [
  ["dist/maplibre-gl-worker.mjs", "maplibre-gl-worker.mjs"],
  ["dist/maplibre-gl-shared.mjs", "maplibre-gl-shared.mjs"],
  ["LICENSE.txt", "LICENSE.txt"],
];

await mkdir(destination, { recursive: true });
let updated = 0;

for (const [sourceName, targetName] of assets) {
  const source = join(packageDirectory, sourceName);
  const target = join(destination, targetName);
  const sourceBytes = await readFile(source);
  let unchanged = false;

  try {
    unchanged = sourceBytes.equals(await readFile(target));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (!unchanged) {
    await copyFile(source, target);
    updated += 1;
  }
}

const interDirectory = dirname(require.resolve("@fontsource-variable/inter/package.json"));
const fontNotices = fileURLToPath(new URL("../public/data/fonts/", import.meta.url));
await mkdir(fontNotices, { recursive: true });
await copyFile(join(interDirectory, "LICENSE"), join(fontNotices, "INTER-LICENSE.txt"));

console.log(
  `MapLibre ${version}: verified ${assets.length} local worker assets (${updated} updated); preserved Inter font license.`,
);
