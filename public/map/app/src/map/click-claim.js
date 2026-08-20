/*
 * One feature at a time may claim the empty-map click.
 *
 * The click gesture has two owners: with bookmark edit mode OFF it copies the
 * world coordinate to the clipboard (that is how calibration anchors are taken
 * — docs/map-coordinates.md), and with edit mode ON it places a bookmark.
 *
 * Before the split those two lived in one handler, which meant the map core
 * referenced bookmark internals (`bookmarkEditMode`, `bmCreateAt`). The
 * dependency now points the other way: the map offers a claim slot, and the
 * bookmark layer fills it. The map knows nothing about bookmarks.
 */
let claim = null;

/** Registers the claimant. Pass null to release. */
export function setMapClickClaim(fn) {
  claim = fn;
}

/** True when a claimant handled this click and the default must not run. */
export function mapClickClaimed(latlng) {
  return claim ? claim(latlng) === true : false;
}
