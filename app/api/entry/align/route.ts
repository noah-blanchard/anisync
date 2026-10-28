import { NextResponse } from "next/server";
import { alignSchema } from "@/lib/api-schemas";
import { isAuthenticated, jsonError, parseBody, unauthorized } from "@/lib/auth";
import { ServiceError, userMessage } from "@/lib/errors";
import { alignEntry } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const body = await parseBody(req, alignSchema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(await alignEntry(body.data.malId, body.data.source));
  } catch (error) {
    const status = error instanceof ServiceError && error.status < 500 && error.status >= 400 ? error.status : 502;
    return jsonError(status, error instanceof ServiceError ? error.message : userMessage(error));
  }
}
