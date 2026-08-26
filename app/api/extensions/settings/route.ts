import {
  applyExtensionSettingsUpdate,
  readExtensionSettings,
  toPublicExtensionSettings,
} from "@/lib/extensions/settings";
import type { ExtensionSettingsUpdate } from "@/lib/extensions/types";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    toPublicExtensionSettings(await readExtensionSettings()),
  );
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<ExtensionSettingsUpdate>;
    return Response.json(await applyExtensionSettingsUpdate(body));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not save the extension settings.",
      },
      { status: 400 },
    );
  }
}
