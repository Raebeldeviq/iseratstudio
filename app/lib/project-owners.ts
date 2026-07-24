import type { AddressOwner, ProjectInput, StudioState } from "../types";
import {
  projectPromotionCount,
  reconcilePromotionAssignments,
} from "./promotion-images.js";

export const ADDRESS_OWNERS: Array<{ id: AddressOwner; label: string }> = [
  { id: "fabian", label: "Fabian" },
  { id: "pascal", label: "Pascal" },
];

export function projectOwner(project: Partial<ProjectInput>): AddressOwner {
  return project.owner === "pascal" ? "pascal" : "fabian";
}

export function normalizeProjectOwners(state: StudioState): StudioState {
  const legacyPromotionImage = state.promotionImage ?? null;
  const promotionImages = Array.isArray(state.promotionImages)
    ? state.promotionImages
    : legacyPromotionImage ? [legacyPromotionImage] : [];
  const promotionImageIds = promotionImages.map((image) => image.id);
  const legacyEnabled = state.promotionImageEnabled === true && Boolean(legacyPromotionImage);
  return {
    ...state,
    promotionImages,
    promotionImage: null,
    promotionImageEnabled: false,
    projects: state.projects.map((project) => {
      const selectedHouseIds = project.selectedHouseIds ?? [];
      const promotionImageCount = project.promotionImageCount === undefined && legacyEnabled
        ? 1
        : projectPromotionCount(project);
      const promotionAssignments = reconcilePromotionAssignments(
        selectedHouseIds,
        promotionImageIds,
        promotionImageCount,
        project.promotionAssignments,
      );
      return {
        ...project,
        selectedHouseIds,
        listings: (project.listings ?? []).map((listing) => ({
          ...listing,
          promotionImageId: listing.promotionImageId
            ?? promotionAssignments[listing.templateId],
        })),
        owner: projectOwner(project),
        promotionImageCount,
        promotionAssignments,
      };
    }),
  };
}
