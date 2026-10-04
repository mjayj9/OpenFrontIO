/**
 * ViewModeController — forwards map view-mode toggles to the WebGL view.
 *
 * - AlternateViewEvent: space-hold (and the settings-modal toggle) drives the
 *   affiliation recolor + grid overlay + hides names.
 * - ToggleCoordinateGridEvent: persistent coordinate-grid toggle (M keybind);
 *   grid shows but names stay visible.
 */

import { EventBus } from "../../core/EventBus";
import { Controller } from "../Controller";
import { AlternateViewEvent, ToggleCoordinateGridEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";

export class ViewModeController implements Controller {
  private registered = false;
  private readonly onAlternateView = (e: AlternateViewEvent) =>
    this.view.setAltView(e.alternateView);
  private readonly onCoordinateGrid = (e: ToggleCoordinateGridEvent) =>
    this.view.setGridView(e.enabled);
  constructor(
    private eventBus: EventBus,
    private view: MapRenderer,
  ) {}

  init() {
    if (this.registered) return;
    this.registered = true;
    this.eventBus.on(AlternateViewEvent, this.onAlternateView);
    this.eventBus.on(ToggleCoordinateGridEvent, this.onCoordinateGrid);
  }

  dispose() {
    if (!this.registered) return;
    this.eventBus.off(AlternateViewEvent, this.onAlternateView);
    this.eventBus.off(ToggleCoordinateGridEvent, this.onCoordinateGrid);
    this.registered = false;
  }
}
