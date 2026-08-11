import type { CostComponent, Supplier, Scenario } from "../domain/types";
import { SEED_COMPONENTS, SEED_SUPPLIERS, SEED_SCENARIOS } from "../data/seed";

/**
 * Repository abstraction. Phase 1 ships an in-memory implementation seeded from
 * JSON-shaped data. Because every consumer depends on this interface rather than
 * a concrete store, a SQLite or Postgres implementation can be dropped in later
 * without touching the engine or UI.
 */
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

export class InMemoryRepository implements Repository {
  private components = new Map<string, CostComponent>();
  private suppliers = new Map<string, Supplier>();
  private scenarios = new Map<string, Scenario>();

  constructor() {
    SEED_COMPONENTS.forEach((c) => this.components.set(c.id, c));
    SEED_SUPPLIERS.forEach((s) => this.suppliers.set(s.id, s));
    SEED_SCENARIOS.forEach((s) => this.scenarios.set(s.id, s));
  }

  async listComponents() {
    return [...this.components.values()];
  }
  async getComponent(id: string) {
    return this.components.get(id);
  }
  async upsertComponent(component: CostComponent) {
    this.components.set(component.id, component);
  }

  async listSuppliers() {
    return [...this.suppliers.values()];
  }
  async getSupplier(id: string) {
    return this.suppliers.get(id);
  }

  async listScenarios() {
    return [...this.scenarios.values()];
  }
  async getScenario(id: string) {
    return this.scenarios.get(id);
  }
  async saveScenario(scenario: Scenario) {
    this.scenarios.set(scenario.id, { ...scenario, updatedAt: new Date().toISOString() });
  }
  async deleteScenario(id: string) {
    this.scenarios.delete(id);
  }
}

let singleton: Repository | null = null;
export function getRepository(): Repository {
  if (!singleton) singleton = new InMemoryRepository();
  return singleton;
}
