import { AsyncLocalStorage } from "node:async_hooks";
import type { BudgetGate, BudgetReservation } from "./providers/types";

// Budget van een onderzoeksrun, bewaakt vóór elke modelaanroep (ook vóór elke ronde van een zoeklus).
//
// Vóór een aanroep wordt een kostenschatting gereserveerd (lib/ai/providers/config.ts estimateCostUsd: invoer
// tot nu toe plus het maximale aantal uitvoertokens, maal de prijs, plus 20% marge). Past de schatting niet meer
// binnen wat de run nog mag uitgeven, dan gaat de aanroep niet door: een zoeklus geeft terug wat er al binnen is,
// andere aanroepen gooien AiBudgetError. Na de aanroep vervangt de werkelijke kostprijs de reservering.
// Parallelle aanroepen (ensemble) reserveren elk apart van hetzelfde budget, zodat ze samen niet over het
// maximum kunnen gaan.

export class RunBudget implements BudgetGate {
  private spentUsd = 0;
  private reservedUsd = 0;
  // Gezet zodra een aanroep is tegengehouden; de runner legt dan "budget bereikt" vast.
  hit: string | null = null;

  constructor(
    readonly limitUsd: number,
    readonly alreadySpentUsd: number,
  ) {}

  // Wat deze taak tot nu toe werkelijk uitgaf (wordt op de run geboekt).
  get spent(): number {
    return this.spentUsd;
  }

  get remaining(): number {
    return this.limitUsd - this.alreadySpentUsd - this.spentUsd - this.reservedUsd;
  }

  reserve(estimateUsd: number, label: string): BudgetReservation | null {
    const est = Math.max(0, estimateUsd);
    if (est > this.remaining + 1e-9) {
      this.hit ??= `Budget van deze run bereikt: ${label} zou naar schatting $${est.toFixed(2)} kosten, er resteert $${Math.max(0, this.remaining).toFixed(2)}.`;
      return null;
    }
    this.reservedUsd += est;
    let settled = false;
    return {
      settle: (actualUsd: number) => {
        if (settled) return;
        settled = true;
        this.reservedUsd -= est;
        this.spentUsd += Math.max(0, actualUsd);
      },
    };
  }
}

const store = new AsyncLocalStorage<RunBudget>();

// Runs fn with this budget as the active run budget for every model call inside it.
export function withRunBudget<T>(budget: RunBudget, fn: () => Promise<T>): Promise<T> {
  return store.run(budget, fn);
}

export function currentRunBudget(): RunBudget | undefined {
  return store.getStore();
}
