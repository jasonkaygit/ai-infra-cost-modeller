/**
 * SQLite-backed Repository using sql.js (SQLite compiled to WebAssembly).
 * Implements the Repository interface and persists the database file to IndexedDB.
 */
import type { CostComponent, Supplier, Scenario } from "../domain/types";
import type { Repository } from "./repository";
import { SEED_COMPONENTS, SEED_SUPPLIERS, SEED_SCENARIOS } from "../data/seed";

let initPromise: Promise<any> | null = null;

async function getSQL() {
  if (!initPromise) {
    initPromise = import("sql.js").then(async (m) => {
      const SQL = await m.default({
        locateFile: () => "/sql-wasm-browser.wasm",
      });
      return SQL;
    });
  }
  return initPromise;
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ai-cost-modeller-sqlite", 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("db")) {
        req.result.createObjectStore("db");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadDB(): Promise<Uint8Array | null> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction("db", "readonly");
      const req = tx.objectStore("db").get("sqlite");
      req.onsuccess = () => resolve(req.result ?? null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function saveDB(data: Uint8Array): Promise<void> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction("db", "readwrite");
      tx.objectStore("db").put(data, "sqlite");
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  } catch { /* IndexedDB unavailable */ }
}

export class SQLiteRepository implements Repository {
  private db: any = null;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init() {
    const SQL = await getSQL();
    const saved = await loadDB();
    this.db = new SQL.Database(saved);
    this.db.run("CREATE TABLE IF NOT EXISTS components (id TEXT PRIMARY KEY, data TEXT)");
    this.db.run("CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, data TEXT)");
    this.db.run("CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, data TEXT)");

    // Seed if empty
    const count = this.db.exec("SELECT COUNT(*) as c FROM components");
    if (!count.length || count[0].values[0][0] === 0) {
      const seed = (table: string, items: any[]) => {
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?, ?)`);
        for (const item of items) {
          stmt.run([item.id, JSON.stringify(item)]);
        }
        stmt.free();
      };
      seed("components", SEED_COMPONENTS);
      seed("suppliers", SEED_SUPPLIERS);
      seed("scenarios", SEED_SCENARIOS);
      this.persist();
    }
  }

  private persist() {
    if (!this.db) return;
    const data = this.db.export();
    saveDB(data).catch(() => {});
  }

  private async ensureReady() { await this.ready; }

  async listComponents(): Promise<CostComponent[]> {
    await this.ensureReady();
    const r = this.db.exec("SELECT data FROM components");
    return (r[0]?.values ?? []).map((row: any) => JSON.parse(row[0]));
  }

  async getComponent(id: string): Promise<CostComponent | undefined> {
    await this.ensureReady();
    const r = this.db.exec("SELECT data FROM components WHERE id = ?", [id]);
    return r[0]?.values?.[0] ? JSON.parse(r[0].values[0][0]) : undefined;
  }

  async upsertComponent(component: CostComponent): Promise<void> {
    await this.ensureReady();
    this.db.run("INSERT OR REPLACE INTO components VALUES (?, ?)", [component.id, JSON.stringify(component)]);
    this.persist();
  }

  async listSuppliers(): Promise<Supplier[]> {
    await this.ensureReady();
    const r = this.db.exec("SELECT data FROM suppliers");
    return (r[0]?.values ?? []).map((row: any) => JSON.parse(row[0]));
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    await this.ensureReady();
    const r = this.db.exec("SELECT data FROM suppliers WHERE id = ?", [id]);
    return r[0]?.values?.[0] ? JSON.parse(r[0].values[0][0]) : undefined;
  }

  async listScenarios(): Promise<Scenario[]> {
    await this.ensureReady();
    const r = this.db.exec("SELECT data FROM scenarios");
    return (r[0]?.values ?? []).map((row: any) => JSON.parse(row[0]));
  }

  async getScenario(id: string): Promise<Scenario | undefined> {
    await this.ensureReady();
    const r = this.db.exec("SELECT data FROM scenarios WHERE id = ?", [id]);
    return r[0]?.values?.[0] ? JSON.parse(r[0].values[0][0]) : undefined;
  }

  async saveScenario(scenario: Scenario): Promise<void> {
    await this.ensureReady();
    const s = { ...scenario, updatedAt: new Date().toISOString() };
    this.db.run("INSERT OR REPLACE INTO scenarios VALUES (?, ?)", [s.id, JSON.stringify(s)]);
    this.persist();
  }

  async deleteScenario(id: string): Promise<void> {
    await this.ensureReady();
    this.db.run("DELETE FROM scenarios WHERE id = ?", [id]);
    this.persist();
  }
}
