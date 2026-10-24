import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(root, ".tmp", "unit-cost-pages");
const resources = {
  courage: {
    name: "Courage",
    image: "assets/resources/courage.png",
    source: "https://deadahead.wiki.gg/wiki/Courage",
    sourceImage: "https://deadahead.wiki.gg/images/Courage_Icon.png?741d64",
  },
  rage: {
    name: "Rage",
    image: "assets/resources/rage.png",
    source: "https://deadahead.wiki.gg/wiki/Rage",
    sourceImage: "https://deadahead.wiki.gg/images/Rage_Icon.png?afb9bc",
  },
};

export function parseUnitCost(markdown) {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "");
  const stats = text.match(/Main Stats\s*\n([\s\S]*?)(?:Behavior Stats|Morale Stats|Abilities|Unlock Requirements)/i)?.[1];
  const match = stats?.match(/(?:^|\n)\s*(Courage Cost|Rage Cost|Rage Drop)\s*\n\s*(\d+)\s*(?=\n|$)/i);
  if (!match) throw new Error("Deployment cost not found in Main Stats");
  const amount = Number(match[2]);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100) throw new Error(`Invalid deployment cost: ${amount}`);
  return { amount, resource: /^rage/i.test(match[1]) ? "rage" : "courage" };
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(50000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  throw lastError;
}

let nextRequestAt = 0;
async function getPage(name, source) {
  if (new URL(source).hostname !== "deadahead.wiki.gg") throw new Error(`Unexpected source: ${source}`);
  const cached = path.join(cacheDir, encodeURIComponent(name) + ".md");
  if (!process.argv.includes("--refresh")) {
    try {
      const stat = await fs.stat(cached);
      if (Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000) return await fs.readFile(cached, "utf8");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const delay = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Math.max(nextRequestAt, Date.now()) + 3100;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  const markdown = await fetchText(`https://r.jina.ai/http://deadahead.wiki.gg${new URL(source).pathname}`);
  // Only cache pages from which the cost can actually be parsed.
  parseUnitCost(markdown);
  await fs.writeFile(cached, markdown, "utf8");
  return markdown;
}

async function downloadResource(resource) {
  const response = await fetch(`https://images.weserv.nl/?url=${encodeURIComponent(resource.sourceImage.replace(/^https?:\/\//, ""))}&output=png`, { signal: AbortSignal.timeout(50000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${resource.sourceImage}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Invalid PNG: ${resource.sourceImage}`);
  await fs.writeFile(path.join(root, resource.image), bytes);
}

async function main() {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(path.join(root, "assets", "resources"), { recursive: true });
  const characters = JSON.parse(await fs.readFile(path.join(root, "data", "personagens.json"), "utf8")).characters;
  const profiles = JSON.parse(await fs.readFile(path.join(root, "data", "unit-profiles.json"), "utf8"));
  const costs = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < characters.length) {
      const character = characters[cursor++];
      const source = profiles[character.name].source;
      const cost = parseUnitCost(await getPage(character.name, source));
      costs.set(character.name, { ...cost, source });
      console.log(`${costs.size}/${characters.length} ${character.name}: ${cost.amount} ${cost.resource}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), ...Object.values(resources).map(downloadResource)]);
  const units = Object.fromEntries(characters.map(c => [c.name, costs.get(c.name)]));
  const data = {
    verifiedOn: new Date().toISOString().slice(0, 10),
    note: "Base deployment costs before item, team, or other in-battle reductions. Skins do not change the base cost.",
    resources,
    units,
  };
  await fs.writeFile(path.join(root, "data", "unit-costs.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Verified all ${characters.length} unit costs.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
