import neo4j, { type Driver, type Session, type QueryResult, type Integer, isInt } from "neo4j-driver";

const uri = import.meta.env.VITE_NEO4J_URI ?? "bolt://localhost:7687";
const user = import.meta.env.VITE_NEO4J_USER ?? "neo4j";
const password = import.meta.env.VITE_NEO4J_PASSWORD ?? "";

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      // Disable encrypted connection for local dev; unibrain runs plain bolt.
      encrypted: false,
      // Surface connection errors quickly during dev.
      connectionTimeout: 5000,
    });
  }
  return driver;
}

export async function runQuery(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<QueryResult> {
  const session: Session = getDriver().session({ database: "neo4j" });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

// Call once on app shutdown (page unload) to cleanly close the bolt connection.
export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// Coerce a neo4j Integer or plain number to a JS number.
export function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (isInt(value)) return (value as Integer).toNumber();
  if (typeof value === "number") return value;
  return undefined;
}

// Coerce a neo4j DateTime/Date/LocalDateTime to an ISO string.
export function toIsoString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  // neo4j temporal types expose .toString() as ISO 8601.
  if (typeof (value as { toString?(): string }).toString === "function") {
    return (value as { toString(): string }).toString();
  }
  return undefined;
}
