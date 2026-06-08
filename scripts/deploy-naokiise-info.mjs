import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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

  const infoDir = join(workDir, "info");
  if (existsSync(infoDir)) {
    rmSync(infoDir, { recursive: true, force: true });
  }

  cpSync(dist, infoDir, { recursive: true });

  execSync("git add info", { cwd: workDir, stdio: "inherit" });

  const status = execSync("git status --porcelain", {
    cwd: workDir,
    encoding: "utf8",
  }).trim();

  if (!status) {
    console.log("No changes to deploy.");
  } else {
    execSync('git commit -m "Deploy info site to /info"', {
      cwd: workDir,
      stdio: "inherit",
    });
    execSync("git push origin main", { cwd: workDir, stdio: "inherit" });
    console.log("Deployed to https://naokiise.com/info/");
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
