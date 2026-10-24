import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseUnitCost } from "../scripts/sync-unit-costs.mjs";

const load = file => JSON.parse(fs.readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));

test("cost parser reads Courage, Rage Cost, and the wiki's Rage Drop label", () => {
  for (const [label, resource] of [["Courage Cost", "courage"], ["Rage Cost", "rage"], ["Rage Drop", "rage"]]) {
    const markdown = `Main Stats\n\n[![Icon](https://example.com/icon.png)](https://example.com) ${label}\n\n15\n\nBehavior Stats\n\nAgility\n\n60`;
    assert.deepEqual(parseUnitCost(markdown), { amount: 15, resource });
  }
});

test("cost parser rejects missing, unrelated, and invalid values", () => {
  for (const markdown of ["", "Main Stats\n\nHealth\n\n150\n\nBehavior Stats\n\nCourage Cost\n\n15", "Main Stats\n\nCourage Cost\n\n0\n\nBehavior Stats", "Main Stats\n\nRage Cost\n\n101\n\nBehavior Stats"]) {
    assert.throws(() => parseUnitCost(markdown));
  }
});

test("all 52 existing units have sourced, valid base costs", () => {
  const characters = load("personagens.json").characters;
  const profiles = load("unit-profiles.json");
  const costs = load("unit-costs.json");
  assert.equal(characters.length, 52);
  assert.deepEqual(Object.keys(costs.units).sort(), characters.map(c => c.name).sort());
  for (const character of characters) {
    const cost = costs.units[character.name];
    assert.ok(Number.isInteger(cost.amount) && cost.amount > 0 && cost.amount <= 100, character.name);
    assert.ok(costs.resources[cost.resource], character.name);
    assert.equal(cost.source, profiles[character.name].source);
  }
  assert.deepEqual(Object.keys(costs.units).filter(name => costs.units[name].resource === "rage").sort(), ["Austin", "Berserker", "Queen", "Saw", "Welder"]);
  assert.equal(costs.units.Redneck.amount, 15);
  assert.equal(costs.units.Cap.amount, 30);
  assert.equal(costs.units.Berserker.amount, 13);
  assert.equal(costs.units.Welder.amount, 50);
});

test("the two exact resource sprites are available locally as PNGs", () => {
  for (const resource of Object.values(load("unit-costs.json").resources)) {
    const png = fs.readFileSync(new URL(`../${resource.image}`, import.meta.url));
    assert.deepEqual([...png.subarray(0,8)], [137,80,78,71,13,10,26,10]);
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
    assert.match(resource.sourceImage, /^https:\/\/deadahead\.wiki\.gg\/images\//);
  }
});
