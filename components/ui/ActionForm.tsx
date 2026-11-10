"use client";

import { cloneElement, createContext, isValidElement, startTransition, useActionState, useContext, useEffect, useRef, useState } from "react";
import { FormPendingOverlay, SavingOverlay } from "@/components/ui/SavingOverlay";
import { Why } from "@/components/ui/Why";
import { CopyButton } from "@/components/survey/CopyButton";

// copy: een waarde (bijv. een link) die de gebruiker zelf kan kopiëren, naast de bevestiging.
// warning: een waarschuwing naast de bevestiging (opgeslagen, maar controleer iets). fieldErrors: fout per veld,
// getoond bij dat veld via useFieldError.
export type FormState = {
  error: string | null;
  ok?: string | null;
  copy?: { label: string; value: string } | null;
  warning?: string | null;
  fieldErrors?: Record<string, string>;
};

const FieldErrorsContext = createContext<Record<string, string> | undefined>(undefined);

// De foutmelding van één veld uit de laatste poging, voor een veld binnen een ActionForm.
export function useFieldError(name: string): string | undefined {
  return useContext(FieldErrorsContext)?.[name];
}

// Of één van deze velden bij de laatste poging een fout had (bijv. om een ingeklapt blok met die velden te openen).
export function useHasFieldError(names: readonly string[]): boolean {
  const errors = useContext(FieldErrorsContext);
  return !!errors && names.some((n) => !!errors[n]);
}

// Dunne laag om een server action. Tijdens het opslaan: knop uit met de laadtekst en (na een moment) de
// opslaan-overlay. Daarna het resultaat bij de knop, waar de gebruiker net klikte: de bevestiging, of de fout met
// een samenvatting van de velden die nog niet kloppen (elk met een knop naar dat veld). De melding per veld staat
// bij het veld zelf (useFieldError / Field). Getypte waarden blijven staan bij een fout; resetOnSuccess maakt het
// formulier na succes leeg.
// noValidate: de server controleert (verplichte velden krijgen wel required/aria-required), zodat de melding per
// veld en bij de knop in de eigen vorm verschijnt in plaats van als browserballon.
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Opslaan…",
  className,
  resetOnSuccess = false,
  submitClass = "btn primary",
  footer,
  disabled = false,
  describedBy,
  noValidate = false,
  submitStyle,
  submitIcon,
  draftKey,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitClass?: string;
  footer?: React.ReactNode;
  // Nooit stil uitgeschakeld: wie disabled zet, toont de reden ernaast en verwijst ernaar met describedBy.
  disabled?: boolean;
  describedBy?: string;
  noValidate?: boolean;
  submitStyle?: React.CSSProperties;
  submitIcon?: React.ReactNode;
  // Voorstel "ProofLab eenvoudiger" (NN/g: automatisch bewaren): met een sleutel bewaart het formulier wat je typt als
  // concept op dit apparaat en zet het terug na herladen. Na opslaan wordt het concept gewist. Alleen voor formulieren
  // die iets nieuws toevoegen, niet voor formulieren die bestaande waarden bewerken.
  draftKey?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null, ok: null });
  const ref = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const draft = useFormDraft(ref, draftKey);
  useEffect(() => {
    if (resetOnSuccess && state.ok && !state.error) ref.current?.reset();
    if (state.ok && !state.error) draft.clear();
    // GOV.UK-foutoverzicht: na een mislukte poging gaat de focus naar het overzicht, zodat je ziet wat er mis is.
    if (state.error) summaryRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resetOnSuccess]);
  const fieldErrors = state.error ? Object.entries(state.fieldErrors ?? {}) : [];
  const focusField = (name: string) => {
    const el = ref.current?.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  return (
    <form ref={ref} action={formAction} className={className} noValidate={noValidate || undefined} onSubmit={(e) => keepValuesOnSubmit(e, formAction)}>
      <FieldErrorsContext.Provider value={state.error ? state.fieldErrors : undefined}>{children}</FieldErrorsContext.Provider>
      <div className="form-feedback">
        {state.error && (
          <div className="form-error" role="alert" ref={summaryRef} tabIndex={-1}>
            {fieldErrors.length > 0 && <p style={{ margin: "0 0 4px", fontWeight: 700 }}>Er is een probleem</p>}
            <p style={{ margin: 0 }}>{state.error}</p>
            {fieldErrors.length > 0 && (
              <ul style={{ margin: "6px 0 0 18px", padding: 0, fontWeight: 400 }}>
                {fieldErrors.map(([name, message]) => (
                  <li key={name}>
                    <button type="button" className="text-link" onClick={() => focusField(name)}>{message}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {state.ok && !state.error && <div className="form-ok" role="status">{state.ok}</div>}
        {state.warning && !state.error && <div className="note" role="alert"><strong>Let op:</strong> {state.warning}</div>}
        {state.copy && !state.error && (
          <div className="row mt-8" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="field" readOnly value={state.copy.value} aria-label={state.copy.label} onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 240px", marginTop: 0 }} />
            <CopyButton text={state.copy.value} label="Kopieer link" />
          </div>
        )}
      </div>
      <div className="row mt-12">
        <button className={submitClass} style={submitStyle} disabled={pending || disabled} aria-busy={pending || undefined} aria-describedby={describedBy}>
          {pending ? pendingLabel : submitLabel}
          {!pending && submitIcon ? <> {submitIcon}</> : null}
        </button>
        {footer}
        {draftKey && draft.savedAt && (
          <span className="tiny draft-note" role="status">
            Concept bewaard op dit apparaat ({draft.savedAt}).{" "}
            <button type="button" className="text-link" onClick={() => { ref.current?.reset(); draft.clear(); }}>
              Concept wissen
            </button>
          </span>
        )}
      </div>
      <SavingOverlay active={pending} label={pendingLabel} />
    </form>
  );
}

type FieldControlProps = {
  id?: string;
  name?: string;
  required?: boolean;
  "aria-required"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

// Eén veld binnen een ActionForm: label (met "(verplicht)" bij een verplicht veld), het invoerveld, de foutmelding
// van de laatste poging en een hint. Zet id, name, required/aria-required, aria-invalid en aria-describedby op het
// invoerveld, zodat een schermlezer de fout en de hint bij het veld voorleest.
export function Field({
  name,
  id,
  label,
  required = false,
  hint,
  why,
  className = "form-line",
  labelClassName,
  children,
}: {
  name: string;
  id: string;
  label: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  // "Waarom vragen we dit?": korte uitleg die je zelf openklapt.
  why?: React.ReactNode;
  // Standaard het patroon form-line; met className="" en labelClassName="field-label" het losse labelpatroon.
  className?: string;
  labelClassName?: string;
  children: React.ReactElement<FieldControlProps>;
}) {
  const error = useFieldError(name);
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const child = resolveLazyElement(children);
  const control = isValidElement<FieldControlProps>(child) ? cloneElement(child, {
    id,
    name,
    required: required || undefined,
    "aria-required": required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  }) : (child as React.ReactNode);
  return (
    <div className={className || undefined}>
      <label htmlFor={id} className={labelClassName}>
        {label}
        {required && <RequiredMark />}
      </label>
      {why && <Why>{why}</Why>}
      {control}
      {error && <p className="field-error" id={errId} role="alert">{error}</p>}
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
    </div>
  );
}

// Een invoerveld dat een servercomponent als children aan Field geeft, kan in productie als "lazy" verwijzing
// aankomen (React Flight zet grotere of herhaalde elementen apart). cloneElement op zo'n verwijzing geeft een
// element zonder type ("Element type is invalid", React #130) en liet de pagina crashen. Pak de verwijzing eerst
// uit; lukt dat niet, toon het veld dan zonder extra eigenschappen in plaats van te crashen.
const REACT_LAZY = Symbol.for("react.lazy");
type LazyNode = { $$typeof: symbol; _payload: unknown; _init: (payload: unknown) => unknown };
export function resolveLazyElement(node: unknown): unknown {
  let current = node;
  for (let i = 0; i < 5 && current && typeof current === "object" && (current as LazyNode).$$typeof === REACT_LAZY; i++) {
    const lazy = current as LazyNode;
    current = lazy._init(lazy._payload);
  }
  return current;
}

// Zichtbare markering van een verplicht veld, in de tekst van het label (dus ook voorgelezen).
export function RequiredMark() {
  return <span className="req"> (verplicht)</span>;
}

// Een selectievakje binnen een ActionForm, met "(verplicht)" en de foutmelding van de laatste poging.
export function CheckField({ name, id, label, required = false }: { name: string; id: string; label: React.ReactNode; required?: boolean }) {
  const error = useFieldError(name);
  const errId = `${id}-err`;
  return (
    <>
      <label className="check-row" htmlFor={id}>
        <input
          type="checkbox"
          id={id}
          name={name}
          required={required || undefined}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
        />{" "}
        <span>
          {label}
          {required && <RequiredMark />}
        </span>
      </label>
      {error && <p className="field-error" id={errId} role="alert" style={{ marginTop: 0 }}>{error}</p>}
    </>
  );
}

// React resets a form after every action, also when validation fails. Submitting through
// startTransition keeps what the user typed; buttons with their own formAction keep the default path.
export function keepValuesOnSubmit(e: React.FormEvent<HTMLFormElement>, run: (fd: FormData) => void) {
  const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.getAttribute("formaction")) return;
  e.preventDefault();
  const fd = new FormData(e.currentTarget, submitter ?? undefined);
  startTransition(() => run(fd));
}

export function ConfirmButton({ action, label, confirm, className = "btn white sm" }: { action: () => Promise<void>; label: string; confirm: string; className?: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      <button className={className}>{label}</button>
      <FormPendingOverlay />
    </form>
  );
}

// Concept van een formulier op dit apparaat (localStorage). Bewaart tekstvelden, keuzelijsten en vinkjes 0,6 s na het
// typen; zet ze bij het laden terug in lege velden. Bestanden, wachtwoorden en verborgen velden nooit. Alles in
// try/catch: zonder opslag (privévenster) werkt het formulier gewoon zonder concept.
function useFormDraft(ref: React.RefObject<HTMLFormElement | null>, key?: string) {
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Per pagina (adres) en per formulier, zodat het concept van het ene idee niet in het andere opduikt.
  const keyRef = useRef<string | null>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form || !key) return;
    const storageKey = `prooflab:concept:${window.location.pathname}:${key}`;
    keyRef.current = storageKey;
    const fields = () =>
      [...form.elements].filter(
        (el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
          (el instanceof HTMLInputElement && !["hidden", "file", "password", "submit", "button"].includes(el.type)) ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement,
      ).filter((el) => !!el.name);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw) as { at: string; values: Record<string, string | boolean> };
        let restored = false;
        for (const el of fields()) {
          const v = data.values[el.name];
          if (v === undefined) continue;
          if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
            if (el.type === "checkbox" && typeof v === "boolean") el.checked = v;
            if (el.type === "radio" && typeof v === "string") el.checked = el.value === v;
          } else if (typeof v === "string" && v !== "" && el.value === "") {
            el.value = v;
            restored = true;
          }
        }
        // Na het terugzetten de melding tonen (buiten de effectronde, om een dubbele render te voorkomen).
        if (restored) window.setTimeout(() => setSavedAt(data.at), 0);
      }
    } catch {
      /* geen opslag beschikbaar */
    }
    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const values: Record<string, string | boolean> = {};
        let any = false;
        for (const el of fields()) {
          if (el instanceof HTMLInputElement && el.type === "checkbox") values[el.name] = el.checked;
          else if (el instanceof HTMLInputElement && el.type === "radio") {
            if (el.checked) values[el.name] = el.value;
          } else {
            values[el.name] = el.value;
            if (el.value.trim()) any = true;
          }
        }
        try {
          if (!any) {
            window.localStorage.removeItem(storageKey);
            setSavedAt(null);
            return;
          }
          const at = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
          window.localStorage.setItem(storageKey, JSON.stringify({ at, values }));
          setSavedAt(at);
        } catch {
          /* geen opslag beschikbaar */
        }
      }, 600);
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return () => {
      window.clearTimeout(timer);
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [ref, key]);
  return {
    savedAt,
    clear: () => {
      const storageKey = keyRef.current;
      if (!storageKey) return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* geen opslag beschikbaar */
      }
      setSavedAt(null);
    },
  };
}
