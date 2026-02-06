// open-mem: Persistent memory plugin for OpenCode
// This is the plugin entry point — will be fully wired in task 18

export default async function plugin(input: { project: unknown; directory: string; worktree: string }) {
  console.log("[open-mem] Plugin loaded for project at:", input.directory);
  return {};
}
