/*
 * A v4 UUID generator, shared by every source that mints its own row ids
 * client-side (bookmarks, and pins' create-here flow — poi/editor.js used to
 * carry its own hand-rolled copy of exactly this beside it; there is no
 * reason for two).
 */
export function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  const buf = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 16; i++) { buf[i] = Math.floor(Math.random() * 256); }
  }
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = [];
  for (let i = 0; i < 16; i++) { hex.push((buf[i] + 0x100).toString(16).slice(1)); }
  return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
    hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" + hex.slice(10, 16).join("");
}
