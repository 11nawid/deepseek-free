import { getSession, deleteSession, updateSessionName, addAgentMessage } from "@/lib/agent-store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sess = getSession(sessionId);
  if (!sess) return Response.json({ error: "Session not found" }, { status: 404 });
  return Response.json(sess);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const ok = deleteSession(sessionId);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ success: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = await req.json().catch(() => ({}));
  const { name } = body;
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  const sess = updateSessionName(sessionId, name);
  if (!sess) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(sess);
}

// Optional: push messages from client after streaming finishes (for persistence)
// POST /api/agent/sessions/[sessionId] { role, content, toolCalls }
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = await req.json().catch(() => ({}));
  const { role, content, toolCalls } = body;
  if (!role || !content) return Response.json({ error: "role and content required" }, { status: 400 });
  const sess = addAgentMessage(sessionId, { role, content, toolCalls });
  if (!sess) return Response.json({ error: "Session not found" }, { status: 404 });
  return Response.json(sess);
}
