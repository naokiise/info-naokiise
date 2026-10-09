import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const targetRepo = "https://github.com/naokiise/naokiise.github.io.git";

if (!existsSync(join(dist, "index.html"))) {
  console.error("Missing dist/index.html. Run `npm run build` first.");
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "naokiise-info-deploy-"));

try {
  execSync(`git clone --depth 1 ${targetRepo} ${workDir}`, { stdio: "inherit" });

  // Publish at the site root (https://naokiise.com/).
  // Replace only what the build owns; keep CNAME, c/, and other files.
  for (const name of ["index.html", "_astro", "work", "timeline", "images"]) {
    const p = join(workDir, name);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  cpSync(dist, workDir, { recursive: true });

  // Old /info/ URL redirects to the top page.
  const infoDir = join(workDir, "info");
  if (existsSync(infoDir)) rmSync(infoDir, { recursive: true, force: true });
  mkdirSync(infoDir);
  writeFileSync(
    join(infoDir, "index.html"),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/"><link rel="canonical" href="https://naokiise.com/"><a href="/">naokiise.com</a>\n',
  );

  // GitHub Pages runs Jekyll by default and ignores paths like _astro/.
  const noJekyll = join(workDir, ".nojekyll");
  if (!existsSync(noJekyll)) {
    writeFileSync(noJekyll, "");
  }

  execSync("git add -A", { cwd: workDir, stdio: "inherit" });

  const status = execSync("git status --porcelain", {
    cwd: workDir,
    encoding: "utf8",
  }).trim();

  if (!status) {
    console.log("No changes to deploy.");
  } else {
    execSync('git commit -m "Deploy info site to top"', {
      cwd: workDir,
      stdio: "inherit",
    });
    execSync("git push origin main", { cwd: workDir, stdio: "inherit" });
    console.log("Deployed to https://naokiise.com/");
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
