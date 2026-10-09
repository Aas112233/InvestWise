// Says hi to every available agent in this workspace.
// Run: node scripts/say-hi-to-agents.mjs
// Discovery: Task subagents (platform-defined) + repo skills in .agents/skills.
// ponytail: stdlib only, no deps, no UI strings (dev script, 4-locale rule N/A).
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Platform-defined Task subagents available to this session.
const TASK_SUBAGENTS = ["explore", "general"];

function repoSkills() {
  try {
    return readdirSync(join(root, ".agents", "skills"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

const skills = repoSkills();
const agents = [
  ...TASK_SUBAGENTS.map((name) => ({ kind: "task-subagent", name })),
  ...skills.map((name) => ({ kind: "repo-skill", name })),
];

for (const agent of agents) {
  console.log(`hi, ${agent.kind}:${agent.name}`);
}
console.log(`greeted ${agents.length} agents (${TASK_SUBAGENTS.length} task-subagents + ${skills.length} repo-skills)`);
