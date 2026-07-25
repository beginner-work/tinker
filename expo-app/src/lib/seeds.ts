/**
 * seeds — a place the founder reflects from ("Kitchen counter, 7am").
 * Mirrors the web app's seeds.js contract (name + usageCount + lastUsed),
 * persisted with AsyncStorage under the same tinker.seeds.v1 key shape.
 * Kept deliberately small for the core Expo experience: add, remove, list.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "tinker.seeds.v1";

export type Seed = {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number;
  usageCount: number;
};

function nextId() {
  return "seed_" + Math.random().toString(36).slice(2, 10);
}

function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function listSeeds(): Promise<Seed[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Seed[]) : [];
    if (!Array.isArray(arr)) return [];
    return arr.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  } catch {
    return [];
  }
}

async function writeAll(list: Seed[]) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export async function addSeed(name: string): Promise<Seed[]> {
  const trimmed = name.trim();
  const list = await listSeeds();
  if (!trimmed) return list;
  const key = normalize(trimmed);
  const existing = list.find((s) => normalize(s.name) === key);
  if (existing) {
    existing.lastUsed = Date.now();
    existing.usageCount += 1;
    await writeAll(list);
    return list;
  }
  const next: Seed[] = [
    {
      id: nextId(),
      name: trimmed,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      usageCount: 1,
    },
    ...list,
  ];
  await writeAll(next);
  return next;
}

export async function touchSeed(name: string): Promise<void> {
  const list = await listSeeds();
  const s = list.find((x) => normalize(x.name) === normalize(name));
  if (!s) {
    await addSeed(name);
    return;
  }
  s.lastUsed = Date.now();
  s.usageCount += 1;
  await writeAll(list);
}

export async function removeSeed(id: string): Promise<Seed[]> {
  const list = await listSeeds();
  const next = list.filter((s) => s.id !== id);
  await writeAll(next);
  return next;
}
