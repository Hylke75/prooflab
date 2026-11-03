import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { DataRequest } from "@/components/privacy/DataRequest";
import { getWorkspace } from "@/lib/data";
import { trackingSalts } from "@/lib/env";
import { NOT_SEARCHABLE } from "@/lib/domain/privacy";

export const metadata: Metadata = { title: "Privacyverzoeken" };

export default async function PrivacyPage() {
  const ws = await getWorkspace();
  if (!ws.org) redirect("/app");
  const isOwner = ws.org.role === "owner";
  const saltVersions = Object.keys(trackingSalts.all);

  return (
    <PageFrame crumbs={["Werkruimte", "Privacyverzoeken"]} coach="other">
      <div className="section-row">
        <div>
          <div className="eyebrow">AVG · INZAGE EN VERWIJDERING</div>
          <h1>Wat weten we van deze persoon?</h1>
          <p className="sub">
            Zoek één e-mailadres in alle dossiers van {ws.org.name}: uitnodigingen, enquêteantwoorden, aanmeldingen op testpagina&apos;s, de
            afmeldlijst, interviews en toegang. Download het resultaat als JSON voor een inzageverzoek, of verwijder de gegevens.
          </p>
        </div>
      </div>

      {!isOwner ? (
        <div className="note" role="note">
          <strong>Alleen voor eigenaren.</strong> Privacyverzoeken raken alle dossiers van de werkruimte. Vraag een eigenaar van {ws.org.name} om
          dit verzoek te behandelen.
        </div>
      ) : (
        <DataRequest hashReady={saltVersions.length > 0} saltVersions={saltVersions} />
      )}

      <div className="card mt-18">
        <h2 className="as-h3">Wat je hier niet vindt</h2>
        <ul style={{ margin: "8px 0 0 18px", fontSize: 13, lineHeight: 1.7 }}>
          {NOT_SEARCHABLE.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="tiny mt-8">
          Elke zoekactie en verwijdering wordt vastgelegd in de audittrail van de werkruimte, zonder het e-mailadres. Reageer binnen een maand
          op het verzoek (AVG art. 12).
        </p>
      </div>
    </PageFrame>
  );
}
