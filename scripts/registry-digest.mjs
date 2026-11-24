import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import process from "node:process";

const tar = process.argv[2];
if (!tar) {
  process.stderr.write("usage: registry-digest.mjs image.oci.tar\n");
  process.exit(1);
}
const index = execFileSync("tar", ["-xOf", tar, "index.json"]);
const digest = createHash("sha256").update(index).digest("hex");
process.stdout.write(`sha256:${digest}\n`);
