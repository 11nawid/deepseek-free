import { getProject, deleteProject } from "@/lib/agent-store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const proj = getProject(projectId);
  if (!proj) return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(proj);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ok = deleteProject(projectId);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ success: true });
}
