import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const remote = execSync("git remote get-url origin", {
  cwd: root,
  encoding: "utf8",
}).trim();

const workDir = mkdtempSync(join(tmpdir(), "info-naokiise-deploy-"));

try {
  cpSync(dist, workDir, { recursive: true });
  execSync("git init", { cwd: workDir, stdio: "inherit" });
  execSync("git checkout -b gh-pages", { cwd: workDir, stdio: "inherit" });
  execSync("git add -A", { cwd: workDir, stdio: "inherit" });
  execSync('git commit -m "Deploy site to GitHub Pages"', {
    cwd: workDir,
    stdio: "inherit",
  });
  execSync(`git remote add origin ${JSON.stringify(remote)}`, {
    cwd: workDir,
    stdio: "inherit",
  });
  execSync("git push -f origin gh-pages", { cwd: workDir, stdio: "inherit" });
  console.log("Deployed dist/ to gh-pages branch.");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
