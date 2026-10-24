import { readFile } from "node:fs/promises";
import path from "node:path";

import { methodologyFromSource } from "./dossier";

function riskPaths(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "apps/api/src/sentinel/graph/risk.py"),
    path.resolve(cwd, "../api/src/sentinel/graph/risk.py"),
    path.resolve(cwd, "../../apps/api/src/sentinel/graph/risk.py"),
  ];
}

/** Server-only. Quotes sentinel/graph/risk.py when that module is present. */
export async function loadMethodology(): Promise<string> {
  for (const file of riskPaths()) {
    try {
      const source = await readFile(file, "utf8");
      return methodologyFromSource(source);
    } catch {
      continue;
    }
  }
  return methodologyFromSource(null);
}
