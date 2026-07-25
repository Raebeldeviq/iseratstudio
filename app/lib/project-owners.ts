import type { AddressOwner, ProjectInput, StudioState } from "../types";
import { normalizePromotionLibrary } from "../../promotion-images.mjs";

export const ADDRESS_OWNERS: Array<{ id: AddressOwner; label: string }> = [
  { id: "fabian", label: "Fabian" },
  { id: "pascal", label: "Pascal" },
];

export function projectOwner(project?: Partial<ProjectInput>): AddressOwner {
  return project?.owner === "pascal" ? "pascal" : "fabian";
}

export function normalizeProjectOwners(state: StudioState): StudioState {
  const promotion = normalizePromotionLibrary(state);
  return {
    ...state,
    ...promotion,
    uploadHistory: Array.isArray(state.uploadHistory) ? state.uploadHistory.slice(-5000) : [],
    projects: state.projects.map((project) => ({
      ...project,
      owner: projectOwner(project),
    })),
  };
}
