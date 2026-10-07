import type { ProjectInput } from "../types";

/** Keep the workspace reachable while operative selection awaits approval. */
export function workspaceProject(
  projects: ProjectInput[],
  eligibleProjects: ProjectInput[],
  activeProjectId: string,
): ProjectInput {
  return eligibleProjects.find(project => project.id === activeProjectId)
    ?? eligibleProjects[0]
    ?? projects.find(project => project.id === activeProjectId)
    ?? projects[0];
}
