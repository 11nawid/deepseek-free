import fs from "fs";
import path from "path";

export const runtime = "nodejs";

// GET /api/agent/filesystem?path=C:/Projects/foo   -> list
// GET /api/agent/filesystem?path=&action=drives      -> list windows drives
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let dirPath = searchParams.get("path") || "";
  const readFile = searchParams.get("readFile");

  // If client asks to read a file preview
  if (readFile) {
    const filePath = path.resolve(dirPath, readFile);
    // Security: prevent traversal outside project? For browsing we allow any, but limit to file read 30k
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return Response.json({ error: "Is a directory" }, { status: 400 });
      const content = fs.readFileSync(filePath, "utf-8").slice(0, 30000);
      return Response.json({ path: filePath, content, size: stat.size });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 400 });
    }
  }

  try {
    if (!dirPath) {
      // List drives on Windows, or root on Unix
      if (process.platform === "win32") {
        const drives: string[] = [];
        for (let code = 65; code <= 90; code++) {
          const drive = String.fromCharCode(code) + ":/";
          try {
            if (fs.existsSync(drive)) drives.push(drive);
          } catch {}
        }
        // Also list common locations
        const home = process.env.USERPROFILE || process.env.HOME || "C:/";
        return Response.json({
          path: "",
          entries: drives.map((d) => ({ name: d, isDirectory: true, path: d })),
          home,
          cwd: process.cwd(),
        });
      } else {
        dirPath = "/";
      }
    }

    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      return Response.json({ error: `Path does not exist: ${resolved}`, path: resolved }, { status: 400 });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      // If it's a file, return its parent listing
      const parent = path.dirname(resolved);
      const entries = fs.readdirSync(parent, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(parent, e.name),
      }));
      return Response.json({ path: parent, entries, isFile: true });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      // hide noisy internals optionally but show all
      path: path.join(resolved, e.name),
    }));

    // Sort dirs first
    entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));

    const parent = path.dirname(resolved);
    return Response.json({
      path: resolved,
      parent: resolved !== parent ? parent : null,
      entries,
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
