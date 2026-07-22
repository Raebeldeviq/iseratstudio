import type { AddressOwner, ProjectInput, StudioState } from "../types";

export const ADDRESS_OWNERS: Array<{ id: AddressOwner; label: string }> = [
  { id: "fabian", label: "Fabian" },
  { id: "pascal", label: "Pascal" },
];

export function projectOwner(project: Partial<ProjectInput>): AddressOwner {
  return project.owner === "pascal" ? "pascal" : "fabian";
}

export function normalizeProjectOwners(state: StudioState): StudioState {
  return {
    ...state,
    promotionImage: state.promotionImage ?? null,
    promotionImageEnabled: state.promotionImageEnabled === true && Boolean(state.promotionImage),
    projects: state.projects.map((project) => ({
      ...project,
      owner: projectOwner(project),
    })),
  };
}
