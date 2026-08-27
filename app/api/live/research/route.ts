import { getDatabase } from "@/lib/server/database";
import { readSettings } from "@/lib/server/settings";
import { AiNotConfiguredError } from "@/lib/server/ai";
import { researchLocalBusinesses } from "@/lib/server/extensions/research";
import { listShortlist } from "@/lib/extensions/store";
import { briefIsUsable, type ResearchBrief } from "@/lib/extensions/research";

export const runtime = "nodejs";

function cleanBrief(body: unknown): ResearchBrief {
  const raw = (body ?? {}) as Partial<ResearchBrief>;
  return {
    towns: Array.isArray(raw.towns)
      ? raw.towns
          .filter((town): town is string => typeof town === "string")
          .map((town) => town.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [],
    category: typeof raw.category === "string" ? raw.category.slice(0, 200) : "",
    criteria: typeof raw.criteria === "string" ? raw.criteria.slice(0, 500) : "",
  };
}

// POST rather than GET: a run costs an AI call plus a fetch per candidate, so
// it must never fire from a page load or a prefetch.
export async function POST(request: Request) {
  const brief = cleanBrief(await request.json().catch(() => ({})));
  if (!briefIsUsable(brief))
    return Response.json(
      { error: "Add at least one town to search." },
      { status: 400 },
    );

  try {
    // Skip anything already shortlisted so repeat runs surface new places.
    const known = listShortlist(getDatabase()).map(
      (entry) => `${entry.name} (${entry.town})`,
    );
    return Response.json(
      await researchLocalBusinesses(await readSettings(), brief, known),
    );
  } catch (error) {
    if (error instanceof AiNotConfiguredError)
      return Response.json({ error: error.message }, { status: 400 });
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "The research run failed.",
      },
      { status: 502 },
    );
  }
}
