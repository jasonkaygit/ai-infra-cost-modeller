import type { CostComponent, Supplier, Scenario } from "../domain/types";
import { SEED_COMPONENTS, SEED_SUPPLIERS, SEED_SCENARIOS } from "../data/seed";
import { SQLiteRepository } from "./sqliteRepository";

export interface Repository {
  listComponents(): Promise<CostComponent[]>;
  getComponent(id: string): Promise<CostComponent | undefined>;
  upsertComponent(component: CostComponent): Promise<void>;

  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;

  listScenarios(): Promise<Scenario[]>;
  getScenario(id: string): Promise<Scenario | undefined>;
  saveScenario(scenario: Scenario): Promise<void>;
  deleteScenario(id: string): Promise<void>;
}

class InMemoryRepository implements Repository {
  private components = new Map<string, CostComponent>();
  private suppliers = new Map<string, Supplier>();
  private scenarios = new Map<string, Scenario>();

  constructor() {
    SEED_COMPONENTS.forEach((c) => this.components.set(c.id, c));
    SEED_SUPPLIERS.forEach((s) => this.suppliers.set(s.id, s));
    SEED_SCENARIOS.forEach((s) => this.scenarios.set(s.id, s));
  }

  async listComponents() { return [...this.components.values()]; }
  async getComponent(id: string) { return this.components.get(id); }
  async upsertComponent(c: CostComponent) { this.components.set(c.id, c); }
  async listSuppliers() { return [...this.suppliers.values()]; }
  async getSupplier(id: string) { return this.suppliers.get(id); }
  async listScenarios() { return [...this.scenarios.values()]; }
  async getScenario(id: string) { return this.scenarios.get(id); }
  async saveScenario(s: Scenario) { this.scenarios.set(s.id, { ...s, updatedAt: new Date().toISOString() }); }
  async deleteScenario(id: string) { this.scenarios.delete(id); }
}

let singleton: Repository | null = null;
export function getRepository(): Repository {
  if (!singleton) singleton = new SQLiteRepository();
  return singleton;
}
