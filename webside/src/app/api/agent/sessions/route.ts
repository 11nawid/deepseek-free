import { getSessions, createSession, getAllSessions } from "@/lib/agent-store";

export const runtime = "nodejs";

// GET /api/agent/sessions?projectId=xxx   -> sessions for project
// GET /api/agent/sessions                  -> all sessions (grouped)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (projectId) {
    const sessions = getSessions(projectId);
    return Response.json(sessions);
  }
  return Response.json(getAllSessions());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, name } = body;
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
  const sess = createSession(projectId, name);
  return Response.json(sess);
}
