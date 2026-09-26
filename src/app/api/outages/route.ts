/**
 * GET /api/outages?storm=helene&fips=13245   (county)
 * GET /api/outages?storm=helene&state=GA     (state total)
 * GET /api/outages?storm=helene              (GA + SC total)
 *
 * Hourly customers-out curve. Live from Tiger Data (TimescaleDB continuous
 * aggregate) when TIGER_DATABASE_URL is set; otherwise static JSON from
 * public/data, flagged source: "static".
 */
import type { NextRequest } from "next/server";
import { BadRequestError, outageCurve, parseQuery } from "@/lib/integrations/server/outages";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const query = await parseQuery(request.nextUrl.searchParams);
    const curve = await outageCurve(query);
    if (!curve) {
      return Response.json({ error: `No outage data for storm "${query.storm}"` }, { status: 404 });
    }
    return Response.json(curve, {
      headers: { "Cache-Control": curve.source === "tiger" ? "no-store" : "public, max-age=300" },
    });
  } catch (err) {
    if (err instanceof BadRequestError) return Response.json({ error: err.message }, { status: 400 });
    console.error("[outages]", err);
    return Response.json({ error: "Could not load outages" }, { status: 500 });
  }
}
