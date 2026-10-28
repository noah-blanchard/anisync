import { NextResponse } from "next/server";
import { isAuthenticated, jsonError, parseBody, unauthorized } from "@/lib/auth";
import { entryDeleteSchema, entryWriteSchema } from "@/lib/api-schemas";
import { userMessage } from "@/lib/errors";
import { removeEntry, writeEntry } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const body = await parseBody(req, entryWriteSchema);
  if (!body.ok) return body.response;
  try {
    const result = await writeEntry({
      malId: body.data.malId ?? null,
      anilistId: body.data.anilistId ?? null,
      patch: body.data.patch,
      targets: body.data.targets,
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(502, userMessage(error));
  }
}

export async function DELETE(req: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const body = await parseBody(req, entryDeleteSchema);
  if (!body.ok) return body.response;
  try {
    const result = await removeEntry({
      malId: body.data.malId ?? null,
      anilistId: body.data.anilistId ?? null,
      targets: body.data.targets,
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(502, userMessage(error));
  }
}
