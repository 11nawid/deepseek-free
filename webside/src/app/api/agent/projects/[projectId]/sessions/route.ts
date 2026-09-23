import { getSessions, createSession, getProject } from "@/lib/agent-store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  // ensure project exists
  const proj = getProject(projectId);
  if (!proj) return Response.json({ error: "Project not found" }, { status: 404 });
  const sessions = getSessions(projectId);
  return Response.json(sessions);
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const proj = getProject(projectId);
  if (!proj) return Response.json({ error: "Project not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const { name } = body;
  const sess = createSession(projectId, name);
  return Response.json(sess);
}
