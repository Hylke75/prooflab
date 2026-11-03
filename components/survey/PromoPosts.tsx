"use client";

import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { PROMO_MIN, PROMO_PLATFORMS, PROMO_PLATFORM_KEYS, postLink, promoWarnings, type PromoPlatform } from "@/lib/domain/promo";
import { CHANNELS } from "@/lib/domain/tracking";
import { deletePromoPost, generatePromo, savePromoPost } from "@/app/app/ideas/[id]/experiments/[expId]/survey-actions";
import { ExpandiPush, type ExpandiHook } from "./ExpandiPush";

export type PromoPostRow = { id: string; platform: string; body: string; origin: string; code: string };

type Props = {
  ideaId: string;
  expId: string;
  kind: "survey" | "landing" | "pricing";
  aiReady: boolean;
  posts: PromoPostRow[];
  links: Record<PromoPlatform, string>; // channel link per platform; each post adds its own utm_content
  expandi: ExpandiHook | null;
};

const ORIGIN = { ai: { label: "AI-concept", pill: "blue" }, template: { label: "Sjabloon", pill: "gray" }, manual: { label: "Aangepast", pill: "green" } } as const;

function PostCard({ p, platform, post, incentive, dmIncludesLink, busy, run }: {
  p: Props;
  platform: PromoPlatform;
  post: PromoPostRow | undefined;
  incentive: string;
  dmIncludesLink: boolean;
  busy: boolean;
  run: (fn: () => Promise<{ error?: string | null; ok?: string | null }>) => Promise<void>;
}) {
  const meta = PROMO_PLATFORMS[platform];
  const [draft, setDraft] = useState(post?.body ?? "");
  const [base, setBase] = useState(post?.body ?? "");
  // A new version from the server (generated or saved) replaces the local draft.
  if ((post?.body ?? "") !== base) {
    setBase(post?.body ?? "");
    setDraft(post?.body ?? "");
  }
  const changed = draft.trim() !== (post?.body ?? "");
  const warnings = draft ? promoWarnings(platform, draft, { kind: p.kind, incentive: incentive.trim() || null }) : [];
  const id = `promo-${platform}`;
  const regen = (mode: "ai" | "template") => run(() => generatePromo(p.ideaId, p.expId, { mode, platform, incentive: incentive.trim() || undefined, dmIncludesLink }));
  const origin = post ? ORIGIN[post.origin as keyof typeof ORIGIN] ?? ORIGIN.manual : null;
  return (
    <div className="card tight">
      <div className="section-title" style={{ marginBottom: 8 }}>
        <h4 style={{ fontSize: 14, margin: 0 }} id={`${id}-h`}>{meta.label}</h4>
        {origin && <span className={`pill ${origin.pill}`}>{origin.label}</span>}
      </div>
      <p className="tiny">
        {meta.hint} Kanaal: {CHANNELS[meta.channel as keyof typeof CHANNELS] ?? meta.channel} (utm_source={meta.channel}
        {post ? <>, postcode <span className="mono">{post.code}</span> als utm_content</> : null}).
      </p>
      {post ? (
        <>
          <label className="sr-only" htmlFor={id}>Tekst voor {meta.label}</label>
          <textarea
            id={id}
            className="field mt-8"
            rows={platform === "x" || platform === "linkedin_dm" ? 5 : 9}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={`${id}-count${warnings.length ? ` ${id}-warn` : ""}`}
            style={{ fontSize: 13 }}
          />
          <p id={`${id}-count`} className="field-hint num" style={{ color: draft.length > meta.max ? "var(--color-risk-text)" : undefined, fontWeight: draft.length > meta.max ? 800 : undefined }}>
            {draft.length} / {meta.max} tekens
          </p>
          {warnings.length > 0 && (
            <ul id={`${id}-warn`} className="note" style={{ margin: "8px 0 0", paddingLeft: 28 }}>
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <div className="row mt-8">
            <CopyButton text={draft} label="Kopieer" className="btn dark sm" describedBy={`${id}-h`} />
            <CopyButton text={postLink(p.links[platform], post.code)} label="Alleen de link" className="btn white sm" describedBy={`${id}-h`} />
            {changed && (
              <button type="button" className="btn white sm" disabled={busy || draft.trim().length < PROMO_MIN || draft.length > meta.max} onClick={() => run(() => savePromoPost(p.ideaId, p.expId, post.id, draft))}>
                Opslaan
              </button>
            )}
            <button type="button" className="btn soft sm" disabled={busy} onClick={() => regen(p.aiReady ? "ai" : "template")}>Opnieuw genereren</button>
            <button type="button" className="text-link" style={{ minHeight: 36 }} disabled={busy} onClick={() => run(() => deletePromoPost(p.ideaId, p.expId, post.id))}>Verwijder</button>
          </div>
          {platform === "linkedin_dm" && (
            <ExpandiPush ideaId={p.ideaId} expId={p.expId} postId={post.id} hook={p.expandi} link={postLink(p.links[platform], post.code)} unsaved={changed} />
          )}
        </>
      ) : (
        <div className="row mt-8">
          <span className="tiny">Nog geen bericht.</span>
          <button type="button" className="btn white sm" disabled={busy} onClick={() => regen(p.aiReady ? "ai" : "template")}>Maak bericht</button>
        </div>
      )}
    </div>
  );
}

// Invitation posts per platform, each with its own channel link so responses are attributed per channel.
export function PromoPosts(p: Props) {
  const [incentive, setIncentive] = useState("");
  const [dmIncludesLink, setDmIncludesLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string | null; ok?: string | null } | null>(null);
  const byPlatform = new Map(p.posts.map((x) => [x.platform, x]));

  const run = async (fn: () => Promise<{ error?: string | null; ok?: string | null }>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch {
      setMsg({ error: "Er ging iets mis. Probeer het opnieuw." });
    } finally {
      setBusy(false);
    }
  };

  const all = (mode: "ai" | "template") => {
    if (p.posts.length && !window.confirm("Alle berichten opnieuw maken? Je eigen aanpassingen gaan dan verloren.")) return;
    void run(() => generatePromo(p.ideaId, p.expId, { mode, incentive: incentive.trim() || undefined, dmIncludesLink }));
  };

  return (
    <div className="card mt-18">
      <div className="section-title">
        <div>
          <h3>Berichten om mensen uit te nodigen</h3>
          <p className="sub" style={{ fontSize: 13 }}>
            {p.kind === "survey"
              ? "Eerlijk: het is onderzoek, er wordt niets verkocht. Geen nep-schaarste en geen beloning tenzij je die echt geeft."
              : "Nodig mensen uit het aanbod te bekijken. Noem het geen test (dat beïnvloedt de uitkomst), maar beloof ook niets wat er nog niet is."}
          </p>
        </div>
        <span className={`pill ${p.aiReady ? "blue" : "gray"}`}>{p.aiReady ? "AI beschikbaar" : "AI niet verbonden: sjablonen"}</span>
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="promo-incentive">Beloning (optioneel)</label>
          <input id="promo-incentive" className="field" maxLength={160} value={incentive} onChange={(e) => setIncentive(e.target.value)} placeholder="Alleen invullen als die er echt is" aria-describedby="promo-incentive-hint" />
          <p id="promo-incentive-hint" className="field-hint">Bijvoorbeeld &quot;we delen de uitkomsten met iedereen die meedoet&quot;. Leeg = geen beloning noemen.</p>
        </div>
        <div className="form-line">
          <span className="field-label" style={{ marginTop: 20 }}>LinkedIn-DM</span>
          <label className="check-row" style={{ marginTop: 0 }}>
            <input type="checkbox" checked={dmIncludesLink} onChange={(e) => setDmIncludesLink(e.target.checked)} />
            <span>Link al in het eerste bericht (standaard: eerst vragen of je de link mag sturen)</span>
          </label>
        </div>
      </div>
      <div className="row">
        {p.aiReady && <button type="button" className="btn primary" disabled={busy} onClick={() => all("ai")}>{busy ? "Bezig…" : p.posts.length ? "Alles opnieuw met AI" : "Maak berichten met AI"}</button>}
        <button type="button" className={`btn ${p.aiReady ? "white" : "primary"}`} disabled={busy} onClick={() => all("template")}>{p.posts.length ? "Alles opnieuw uit sjablonen" : "Maak berichten uit sjablonen"}</button>
      </div>
      <div aria-live="polite">
        {msg?.error && <div className="form-error mt-12" role="alert">{msg.error}</div>}
        {msg?.ok && !msg.error && <div className="form-ok mt-12">{msg.ok}</div>}
      </div>
      {p.aiReady && <p className="tiny mt-8">AI-teksten zijn concepten: lees ze na. Een AI-tekst is nooit bewijs; alleen de reacties van echte mensen tellen.</p>}
      <div className="grid-2 mt-18">
        {PROMO_PLATFORM_KEYS.map((k) => (
          <PostCard key={`${k}-${byPlatform.get(k)?.id ?? "none"}`} p={p} platform={k} post={byPlatform.get(k)} incentive={incentive} dmIncludesLink={dmIncludesLink} busy={busy} run={run} />
        ))}
      </div>
    </div>
  );
}
