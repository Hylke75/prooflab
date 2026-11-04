import { randomUUID } from "node:crypto";

// Een kleine in-memory nabootsing van de Supabase-client, net genoeg voor de onderzoeksrunner in unittests:
// from(tabel).select/insert/update + eq/in/gte/order/limit/single/maybeSingle, en rpc() met eigen functies.
// Geen RLS (dat testen de DB-tests in tests/db); joins in select() worden genegeerd.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type Rpc = (args: Record<string, unknown>, db: FakeDb) => unknown;
export type FakeDb = Record<string, Row[]>;

class Query implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private returning = false;
  private head = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gte(col: string, v: string | number) {
    this.filters.push((r) => (r[col] as string | number) >= v);
    return this;
  }
  lt(col: string, v: string | number) {
    this.filters.push((r) => (r[col] as string | number) < v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  // not(kolom, "is", null) en not(kolom, "eq", waarde); andere operatoren zijn niet nagebootst.
  not(col: string, op: string, v: unknown) {
    if (op === "is") this.filters.push((r) => (r[col] ?? null) !== v);
    else if (op === "eq") this.filters.push((r) => r[col] !== v);
    return this;
  }
  // or("a.eq.1,b.is.null"): alleen eq en is.null; andere voorwaarden laten de rij door.
  or(expr: string) {
    const parts = expr.split(",").map((p) => p.trim().split("."));
    this.filters.push((r) =>
      parts.some(([col, op, ...rest]) => {
        const v = rest.join(".");
        if (op === "is" && v === "null") return (r[col] ?? null) === null;
        if (op === "eq") return String(r[col]) === v;
        return true;
      }),
    );
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private rows(): Row[] {
    return (this.db[this.table] ??= []);
  }

  private run(): { data: unknown; error: null; count?: number } {
    let out: Row[];
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      out = list.map((p) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...p }));
      this.rows().push(...out);
      if (!this.returning) return { data: null, error: null };
    } else {
      out = this.rows().filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of out) Object.assign(r, this.payload);
        if (!this.returning) return { data: null, error: null };
      } else if (this.op === "delete") {
        this.db[this.table] = this.rows().filter((r) => !out.includes(r));
        return { data: null, error: null };
      }
    }
    for (const o of [...this.orderBy].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[o.col] as string | number;
        const y = b[o.col] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
      });
    }
    if (this.max != null) out = out.slice(0, this.max);
    const copy = out.map((r) => ({ ...r }));
    if (this.head) return { data: null, error: null, count: copy.length };
    if (this.mode === "single") return { data: copy[0] ?? null, error: null };
    if (this.mode === "maybe") return { data: copy[0] ?? null, error: null };
    return { data: copy, error: null, count: copy.length };
  }

  then<A = { data: unknown; error: null }, B = never>(
    onfulfilled?: ((v: { data: unknown; error: null; count?: number }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(db: FakeDb, rpcs: Record<string, Rpc> = {}) {
  return {
    db,
    from: (table: string) => new Query(db, table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      const fn = rpcs[name];
      if (!fn) return { data: null, error: { code: "PGRST202", message: `onbekende rpc ${name}` } };
      return { data: await fn(args, db), error: null };
    },
  };
}

// De rpc's die de onderzoeksrunner gebruikt, met dezelfde betekenis als in de migraties.
export const runnerRpcs: Record<string, Rpc> = {
  org_ai_spend: () => [{ spent: 0, cap: 100 }],
  add_research_cost: (args, db) => {
    const task = db.research_tasks.find((t) => t.id === args.p_task)!;
    task.cost_usd = Number(task.cost_usd ?? 0) + Number(args.p_cost);
    const run = db.research_runs.find((r) => r.id === task.run_id)!;
    run.cost_usd = Number(run.cost_usd ?? 0) + Number(args.p_cost);
    return run.cost_usd;
  },
};
