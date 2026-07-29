import type { AddressOwner, ProjectInput, StudioState } from "../types";
import { fillMissingProjectingDefaults } from "../../listing-copy.mjs";
import {
  projectPromotionCount,
  reconcilePromotionAssignments,
} from "./promotion-images.js";

import {
  legacyUserId,
  projectOrganizationUnitId,
  projectResponsibleUserId,
} from "./responsibility.ts";

export function projectOwner(project: Partial<ProjectInput>): AddressOwner {
  return projectResponsibleUserId(project) ?? legacyUserId(project.owner) ?? project.owner ?? "user-fabian";
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
          projectingSettings: fillMissingProjectingDefaults(listing.projectingSettings),
        })),
        // Keep the legacy field readable for old backups while all new logic uses
        // the stable responsibleUserId.
        owner: project.owner || "fabian",
        responsibleUserId: projectResponsibleUserId(project) ?? projectOwner(project),
        organizationUnitId: projectOrganizationUnitId(project, state.management),
        promotionImageCount,
        promotionAssignments,
      };
    }),
  };
}
