// Heading arrows for the YOU blip and live presence dots.
//
// UE yaw 0 = +X = map east. The arrow SVG points up (map north = world −Y).
// cssDeg = atan2(cos(yaw), −sin(yaw)) in degrees.

export function ueYawToMapDeg(yawDeg) {
  if (!Number.isFinite(yawDeg)) return null;
  const rad = (yawDeg * Math.PI) / 180;
  const deg = (Math.atan2(Math.cos(rad), -Math.sin(rad)) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export function headingArrowHtml(color, mapDeg, extraClass) {
  const rot = Number.isFinite(mapDeg) ? mapDeg : 0;
  const cls = extraClass || "player-arrow";
  return (
    '<div class="' + cls + '" style="transform:rotate(' + rot.toFixed(1) + 'deg)">' +
    '<svg viewBox="0 0 28 28" aria-hidden="true">' +
    '<circle cx="14" cy="14" r="12.5" fill="rgba(12,10,8,.55)" stroke="#f0e6d4" stroke-width="2"/>' +
    '<path d="M14 4 L22 20 L14 16 L6 20 Z" fill="' + color + '" stroke="#1a1510" stroke-width="1.2" stroke-linejoin="round"/>' +
    "</svg></div>"
  );
}
