import { PlayerBuildableUnitType } from "../core/game/Game";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /** Only the new modern ruleset uses military selection; Classic is unchanged. */
  modernTargeting?: boolean;
  modernBranchesUsed?: string[];
  modernSelectedForceIds?: string[];
  modernCompletedStops?: number;
  modernCursorPreviewCount?: number;
  modernCameraMoves?: number;
  modernZoomChanges?: number;
  modernBoxSelections?: number;
  modernAdditionalSelections?: number;
  modernAdditiveSelection?: boolean;
  modernQueueCommand?: boolean;
  modernQueuedOrders?: number;
  modernClimatePreviewAdapted?: boolean;
  modernClimatePreviewHarsh?: boolean;
  modernAIInfoInspected?: boolean;
}
