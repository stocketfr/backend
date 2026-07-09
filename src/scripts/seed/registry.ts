import type { SeedContext, Seeder } from './seeder.interface';

class SeederRegistry {
  private seeders = new Map<string, Seeder>();

  register(seeder: Seeder): void {
    if (this.seeders.has(seeder.name)) {
      throw new Error(`Seeder "${seeder.name}" is already registered`);
    }
    this.seeders.set(seeder.name, seeder);
  }

  resolve(): Seeder[] {
    // Validate all dependencies exist
    for (const [name, seeder] of this.seeders) {
      for (const dep of seeder.dependencies) {
        if (!this.seeders.has(dep)) {
          throw new Error(
            `Seeder "${name}" depends on "${dep}", which is not registered`,
          );
        }
      }
    }

    // Kahn's algorithm — BFS topological sort
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const [name, seeder] of this.seeders) {
      inDegree.set(name, seeder.dependencies.length);
      for (const dep of seeder.dependencies) {
        const list = dependents.get(dep) ?? [];
        list.push(name);
        dependents.set(dep, list);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: Seeder[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(this.seeders.get(name)!);

      for (const dependent of dependents.get(name) ?? []) {
        const newDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    if (sorted.length !== this.seeders.size) {
      const stuck = [...inDegree.entries()]
        .filter(([, d]) => d > 0)
        .map(([n]) => n);
      throw new Error(
        `Circular dependency detected among: ${stuck.join(', ')}`,
      );
    }

    return sorted;
  }

  async runAll(ctx: SeedContext): Promise<void> {
    const ordered = this.resolve();

    for (const seeder of ordered) {
      await seeder.run(ctx);
    }
  }
}

export const registry = new SeederRegistry();
