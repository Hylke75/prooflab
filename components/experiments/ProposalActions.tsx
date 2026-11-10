"use client";

// Microsoft HAX G8/G9 en NN/g: een voorstel per stuk overnemen, aanpassen of weggooien. Werkt op de velden van de
// leerkaart (ids lc-l-<kaart> en lc-t-<kaart>) en de goedkeurknop (in #lc-approve-<kaart>). Weggooien maakt de
// velden leeg zodat je zelf schrijft; er wordt pas iets bewaard als je opslaat of goedkeurt.
export function ProposalActions({ cardId }: { cardId: string }) {
  const fields = () => [document.getElementById(`lc-l-${cardId}`), document.getElementById(`lc-t-${cardId}`)].filter((x): x is HTMLTextAreaElement => x instanceof HTMLTextAreaElement);
  const focus = (el: HTMLElement | null | undefined) => {
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  };
  return (
    <div className="row mt-8" style={{ gap: 8, flexWrap: "wrap" }} role="group" aria-label="Wat doe je met het voorstel?">
      <button type="button" className="btn white sm" onClick={() => focus(document.querySelector<HTMLButtonElement>(`#lc-approve-${CSS.escape(cardId)} button`))}>
        Overnemen
      </button>
      <button type="button" className="btn white sm" onClick={() => focus(fields()[0])}>
        Aanpassen
      </button>
      <button
        type="button"
        className="btn white sm"
        onClick={() => {
          const f = fields();
          for (const el of f) el.value = "";
          focus(f[0]);
        }}
      >
        Weggooien en zelf schrijven
      </button>
    </div>
  );
}
