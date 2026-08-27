import { getDatabase } from "@/lib/server/database";
import {
  listShortlist,
  removeShortlistEntry,
  upsertShortlistEntry,
  type ShortlistStatus,
} from "@/lib/extensions/store";

export const runtime = "nodejs";

const STATUSES: ShortlistStatus[] = ["candidate", "visiting", "posted", "passed"];

export async function GET() {
  return Response.json({ entries: listShortlist(getDatabase()) });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!id || !name)
      return Response.json(
        { error: "A shortlist entry needs an id and a name." },
        { status: 400 },
      );
    const status = STATUSES.includes(body.status as ShortlistStatus)
      ? (body.status as ShortlistStatus)
      : "candidate";
    upsertShortlistEntry(getDatabase(), {
      id,
      name,
      town: typeof body.town === "string" ? body.town.trim() : "",
      status,
      note: typeof body.note === "string" ? body.note.slice(0, 2_000) : "",
      payload: body.payload ?? null,
    });
    return Response.json({ entries: listShortlist(getDatabase()) });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not save the entry.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
  removeShortlistEntry(getDatabase(), id);
  return Response.json({ entries: listShortlist(getDatabase()) });
}
