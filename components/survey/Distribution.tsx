import { supabaseServer } from "@/lib/supabase/server";
import { aiConfigured, emailConfigured, env, trackingConfigured } from "@/lib/env";
import { SurveyConfigSchema } from "@/lib/domain/survey";
import { CHANNELS } from "@/lib/domain/tracking";
import { channelLink, defaultInvitation, defaultReminder, invitationCounts, publicPath } from "@/lib/domain/survey-distribution";
import { PROMO_PLATFORMS, PROMO_PLATFORM_KEYS, type PromoPlatform } from "@/lib/domain/promo";
import { maskCampaignUrl } from "@/lib/integrations/expandi-push";
import { latestSurveyJob } from "@/lib/survey-jobs";
import { CopyButton } from "./CopyButton";
import { Invitations } from "./Invitations";
import { PromoPosts } from "./PromoPosts";

// The channels a survey link is shared through; LinkedIn DMs via Expandi count as outreach.
const SHARE_CHANNELS = ["network", "linkedin", "outreach", "meta", "newsletter", "other"] as const;
const SHARE_LABELS: Partial<Record<keyof typeof CHANNELS, string>> = { outreach: "LinkedIn-DM via Expandi (outreach)" };

type Exp = { id: string; type: string; state: string; public_slug: string | null; config: unknown };

// "Verspreiden" on the experiment page: share links per channel, personal e-mail invitations (surveys) and
// invitation posts (every test with a public link). Consultants only; from approval on.
export async function Distribution({ ideaId, exp, canWrite }: { ideaId: string; exp: Exp; canWrite: boolean }) {
  if (!canWrite || !exp.public_slug || !["survey", "landing", "pricing"].includes(exp.type)) return null;
  const open = ["approved", "live", "paused"].includes(exp.state);
  const survey = exp.type === "survey";
  if (!open && !survey) return null;
  const supabase = await supabaseServer();
  const slug = exp.public_slug;

  const [{ data: posts }, { data: invitations }, { data: hook }, job] = await Promise.all([
    open ? supabase.from("promo_posts").select("id, platform, body, origin, code").eq("experiment_id", exp.id).order("created_at") : Promise.resolve({ data: [] }),
    survey ? supabase.from("survey_invitations").select("status, sent_at, reminded_at, error, delivery_issue").eq("experiment_id", exp.id).limit(20000) : Promise.resolve({ data: [] }),
    open ? supabase.from("expandi_campaign_hooks").select("url, pushed_count, last_push_at").eq("experiment_id", exp.id).maybeSingle() : Promise.resolve({ data: null }),
    survey ? latestSurveyJob(exp.id) : Promise.resolve(null),
  ]);
  const counts = invitationCounts(invitations ?? []);
  const config = survey ? SurveyConfigSchema.safeParse(exp.config) : null;
  const c = config?.success ? config.data : null;
  const live = exp.state === "live";
  const links = Object.fromEntries(PROMO_PLATFORM_KEYS.map((k) => [k, channelLink(env.appUrl, exp.type, slug, PROMO_PLATFORMS[k].channel)])) as Record<PromoPlatform, string>;

  return (
    <section className="mt-24" aria-labelledby="dist-h">
      <div className="section-title">
        <h2 id="dist-h">Verspreiden</h2>
        <span className={`pill ${live ? "green" : "orange"}`}>{live ? "Links tellen mee" : exp.state === "approved" ? "Nog niet live: reacties tellen nog niet" : exp.state === "paused" ? "Gepauzeerd" : "Afgerond"}</span>
      </div>

      {survey && open && (
        <div className="card">
          <h3>Open link per kanaal</h3>
          <p className="sub" style={{ fontSize: 13 }}>
            Iedereen met de link kan invullen, ook bots die enquêtes overtuigend invullen. Antwoorden via een open link zijn anoniem en
            worden apart geteld van persoonlijke uitnodigingen. Elke link meet zijn eigen kanaal.
          </p>
          {SHARE_CHANNELS.map((ch) => {
            const url = channelLink(env.appUrl, exp.type, slug, ch);
            const label = SHARE_LABELS[ch] ?? CHANNELS[ch];
            return (
              <div className="form-line" key={ch}>
                <label htmlFor={`share-${ch}`} id={`share-${ch}-l`}>{label}</label>
                <div className="copy-url" style={{ marginTop: 0 }}>
                  <input className="field" id={`share-${ch}`} readOnly value={url} />
                  <CopyButton text={url} label="Kopieer link" className="btn dark sm" describedBy={`share-${ch}-l`} />
                </div>
              </div>
            );
          })}
          <p className="field-hint">
            Voorbeeld bekijken: <a className="text-link" href={publicPath(exp.type, slug)} target="_blank" rel="noopener">{publicPath(exp.type, slug)}</a>
            {live ? " (let op: als je hem invult, telt je antwoord mee)" : " (antwoorden worden nog niet opgeslagen)"}.
          </p>
        </div>
      )}

      {survey && c && (
        <Invitations
          ideaId={ideaId}
          expId={exp.id}
          live={live}
          stateNote={live ? null : exp.state === "approved" ? "Uitnodigen kan zodra de enquête live staat; anders landen mensen op een gesloten enquête." : exp.state === "paused" ? "De enquête is gepauzeerd. Hervat hem voordat je (meer) mensen uitnodigt." : "De enquête is afgerond; er worden geen uitnodigingen meer verstuurd."}
          emailReady={emailConfigured()}
          trackingReady={trackingConfigured()}
          surveyUrl={`${env.appUrl.replace(/\/+$/, "")}/s/${slug}`}
          researcher={c.researcher}
          invite={defaultInvitation({ researcher: c.researcher, title: c.title, intro: c.intro, minutes: c.estimated_minutes })}
          reminder={defaultReminder({ researcher: c.researcher, title: c.title, minutes: c.estimated_minutes })}
          counts={counts}
          job={job}
        />
      )}

      {survey && c && (
        <p className="tiny mt-8" role="note">
          {env.resendWebhookSecret
            ? `Bounces en spammeldingen: ${counts.bounced} onbestelbaar, ${counts.complained} als spam gemeld (via de Resend-webhook; die adressen worden niet opnieuw gemaild).`
            : "Bounces en spammeldingen worden niet bijgehouden: de Resend-webhook is niet gekoppeld (RESEND_WEBHOOK_SECRET ontbreekt). Onbestelbare adressen blijven dan als verstuurd staan."}
        </p>
      )}

      {open && (
        <PromoPosts
          ideaId={ideaId}
          expId={exp.id}
          kind={exp.type as "survey" | "landing" | "pricing"}
          aiReady={aiConfigured()}
          posts={posts ?? []}
          links={links}
          expandi={hook ? { masked: maskCampaignUrl(hook.url), pushed: hook.pushed_count, lastPush: hook.last_push_at } : null}
        />
      )}
    </section>
  );
}
