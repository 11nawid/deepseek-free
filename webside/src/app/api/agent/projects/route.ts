import { getProjects, createProject, deleteProject } from "@/lib/agent-store";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  const projects = getProjects();
  // Enrich with real existence check
  const enriched = projects.map((p) => ({
    ...p,
    exists: fs.existsSync(p.path),
  }));
  return Response.json(enriched);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { name, path: folderPath, color } = body;
  if (!folderPath || typeof folderPath !== "string") {
    return Response.json({ error: "path is required (absolute folder path)" }, { status: 400 });
  }
  const resolved = path.resolve(folderPath);
  if (!fs.existsSync(resolved)) {
    return Response.json({ error: `Path does not exist: ${resolved}` }, { status: 400 });
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return Response.json({ error: "Path is not a directory" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
  const proj = createProject(name || path.basename(resolved), resolved, color);
  return Response.json(proj);
}
