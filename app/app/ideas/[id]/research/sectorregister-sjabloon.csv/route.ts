import { NextResponse } from "next/server";
import { getUser } from "@/lib/data";
import { registerTemplateCsv } from "@/lib/domain/sector-register";

// Het CSV-sjabloon voor een sectorregister: alleen de kolomkoppen (verplicht: uitgever, bron_url, peildatum,
// categorie, grootteklasse, regio, aantal; optioneel: opmerking). Geen voorbeeldregels, dus geen verzonnen aantallen.
export async function GET(_: Request, ctx: RouteContext<"/app/ideas/[id]/research/sectorregister-sjabloon.csv">) {
  await ctx.params;
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  // Met BOM, zodat Excel de UTF-8-tekens (ë, é) goed leest.
  return new NextResponse(`﻿${registerTemplateCsv()}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="sectorregister-sjabloon.csv"',
      "cache-control": "no-store",
    },
  });
}
