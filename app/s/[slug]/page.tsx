import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAnon } from "@/lib/supabase/server";
import { PublicSurveyConfigSchema, presentQuestions } from "@/lib/domain/survey";
import { visitorFromRequest } from "@/lib/public-test";
import { isSlug, isToken } from "@/lib/domain/survey-distribution";
import { tokenHash } from "@/lib/domain/survey-tokens";
import { SurveyForm } from "./SurveyForm";

export const metadata: Metadata = { title: "Enquête", robots: { index: false, follow: false } };

type PublicSurvey = { id: string; state: string; config: unknown; ends_at: string | null; invitation: { status: string } | null };

function Shell({ researcher, children }: { researcher?: string; children: React.ReactNode }) {
  return (
    <div className="tp">
      <main className="tp-main" id="inhoud">
        <div className="tp-card" style={{ textAlign: "left" }}>{children}</div>
      </main>
      <footer className="tp-foot">
        {researcher ? `Dit is een onderzoek van ${researcher}. ` : ""}Er worden geen cookies geplaatst en er wordt niets verkocht.
      </footer>
    </div>
  );
}

function Message({ title, text, researcher }: { title: string; text: string; researcher?: string }) {
  return (
    <Shell researcher={researcher}>
      <h1 style={{ fontSize: 34 }}>{title}</h1>
      <p>{text}</p>
    </Shell>
  );
}

// Public, brand-neutral survey page. No cookies, no third-party scripts. Personal invitations use ?u=<token>;
// open links carry ?utm_source=<channel>. The key question, its success options, the qualifying screening answers
// and the correct answers of attention checks are not sent to the browser. Options of shuffled questions appear in
// an order per respondent (seeded by the invitation token or the visitor code: a reload shows the same order).
export default async function SurveyPage({ params, searchParams }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  if (!isSlug(slug)) notFound();
  const rawToken = typeof sp.u === "string" ? sp.u : null;
  const token = rawToken && isToken(rawToken) ? rawToken : null;
  const { data } = await supabaseAnon().rpc("get_public_survey", { p_slug: slug, p_token_hash: token ? tokenHash(token) : null });
  if (!data) notFound();
  const survey = data as unknown as PublicSurvey;
  const parsed = PublicSurveyConfigSchema.safeParse(survey.config);
  if (!parsed.success) return <Message title="Deze enquête is niet beschikbaar." text="Er is iets mis met deze vragenlijst. De onderzoeker is op de hoogte gebracht als het probleem blijft." />;
  const c = parsed.data;

  const closed = ["ended", "analyzed", "decided"].includes(survey.state) || (survey.ends_at != null && new Date(survey.ends_at) < new Date());
  if (closed) return <Message title="Deze enquête is afgerond." text="Er worden geen antwoorden meer verzameld. Bedankt voor je belangstelling." researcher={c.researcher} />;
  if (survey.state === "paused") return <Message title="Deze enquête is tijdelijk gepauzeerd." text="Probeer het later nog eens via dezelfde link." researcher={c.researcher} />;
  if (rawToken) {
    if (!token || !survey.invitation) return <Message title="Deze persoonlijke link klopt niet." text="Controleer of je de hele link uit de e-mail hebt gebruikt. Werkt het niet, antwoord dan op de uitnodiging." researcher={c.researcher} />;
    if (survey.invitation.status === "responded") return <Message title="Je hebt deze enquête al ingevuld." text="Via deze persoonlijke link zijn de antwoorden al ontvangen. Dank je wel." researcher={c.researcher} />;
    if (survey.invitation.status === "unsubscribed") return <Message title="Je bent afgemeld." text="Je ontvangt geen e-mails meer over dit onderzoek en deze link werkt niet meer." researcher={c.researcher} />;
  }
  const live = survey.state === "live";
  const invited = !!token;
  const seed = token ?? (await visitorFromRequest(slug)).hash;

  return (
    <div className="tp">
      {!live && <div className="banner-preview" role="status">Voorbeeld: deze enquête is nog niet geopend. Antwoorden worden niet opgeslagen.</div>}
      <main className="tp-main" id="inhoud" style={{ placeItems: "start center" }}>
        <div className="tp-card" style={{ textAlign: "left" }}>
          <div className="eyebrow">{c.format === "interview" ? "Online interview (schriftelijk)" : "Enquête"} · Ongeveer {c.estimated_minutes} {c.estimated_minutes === 1 ? "minuut" : "minuten"}</div>
          <h1 style={{ fontSize: "clamp(30px,4.5vw,44px)" }}>{c.title}</h1>
          <p style={{ whiteSpace: "pre-line" }}>{c.intro}</p>
          <dl style={{ display: "grid", gap: 6, fontSize: 14, margin: "0 0 18px" }}>
            <div><dt style={{ display: "inline", fontWeight: 700 }}>Wie vraagt dit? </dt><dd style={{ display: "inline", margin: 0 }}>{c.researcher}</dd></div>
            <div><dt style={{ display: "inline", fontWeight: 700 }}>Tijd: </dt><dd style={{ display: "inline", margin: 0 }}>ongeveer {c.estimated_minutes} {c.estimated_minutes === 1 ? "minuut" : "minuten"}, {c.questions.length} {c.questions.length === 1 ? "vraag" : "vragen"} (sommige alleen als ze op je van toepassing zijn)</dd></div>
          </dl>
          <div className="note" style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
            <strong>Privacy.</strong> Er worden geen cookies geplaatst en er draait geen tracking.{" "}
            {invited
              ? `Je antwoorden worden gekoppeld aan je persoonlijke uitnodiging, zodat ${c.researcher} weet dat je hebt gereageerd en je geen herinnering krijgt. Je e-mailadres wordt na 180 dagen verwijderd.`
              : "Je antwoorden worden anoniem opgeslagen: zonder naam, e-mailadres of IP-adres, alleen met een onomkeerbare code die dubbel invullen voorkomt."}{" "}
            Antwoorden worden alleen voor dit onderzoek gebruikt en hooguit 12 maanden bewaard; lange open antwoorden worden daarna verwijderd.
          </div>
          <SurveyForm
            slug={slug}
            live={live}
            token={token}
            researcher={c.researcher}
            thankYou={c.thank_you}
            questions={presentQuestions(c.questions, seed)}
            screeningQuestion={c.screening?.question ?? null}
          />
        </div>
      </main>
      <footer className="tp-foot">Dit is een onderzoek van {c.researcher}. Er wordt niets verkocht.</footer>
    </div>
  );
}
