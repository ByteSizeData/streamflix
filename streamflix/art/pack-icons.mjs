// Packs the desktop app's icon PNGs (make-art.ps1 draws them into overlay/app/images/sizes) into the
// files electron-builder wants: icon.ico for Windows, icon.icns for macOS, and icon.png, icon-256.png
// and icon-512.png beside them (Linux, the window and the notifications). Both icon formats can hold
// PNG data as it is, so nothing here draws or resizes: it only lays the PNGs out.
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const images = join(dirname(fileURLToPath(import.meta.url)), "overlay", "app", "images");
const sizes = join(images, "sizes");
const png = (n) => readFileSync(join(sizes, `icon-${n}.png`));

// .ico: a 6-byte header, a 16-byte entry per picture, then the pictures (a width of 256 is written as 0)
const ico = [16, 24, 32, 48, 64, 128, 256].map((n) => ({ n, data: png(n) }));
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let at = head.length;
ico.forEach(({ n, data }, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(n >= 256 ? 0 : n, e);
  head.writeUInt8(n >= 256 ? 0 : n, e + 1);
  head.writeUInt8(0, e + 2);
  head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(data.length, e + 8);
  head.writeUInt32LE(at, e + 12);
  at += data.length;
});
writeFileSync(join(images, "icon.ico"), Buffer.concat([head, ...ico.map((x) => x.data)]));

// .icns: "icns" and the file's length, then each picture as a four-letter type, its length and its PNG
const types = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024], ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512]];
const parts = types.map(([type, n]) => {
  const data = png(n);
  const h = Buffer.alloc(8);
  h.write(type, 0, "ascii");
  h.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([h, data]);
});
const body = Buffer.concat(parts);
const top = Buffer.alloc(8);
top.write("icns", 0, "ascii");
top.writeUInt32BE(body.length + 8, 4);
writeFileSync(join(images, "icon.icns"), Buffer.concat([top, body]));

copyFileSync(join(sizes, "icon-512.png"), join(images, "icon.png"));
copyFileSync(join(sizes, "icon-256.png"), join(images, "icon-256.png"));
copyFileSync(join(sizes, "icon-512.png"), join(images, "icon-512.png"));
rmSync(sizes, { recursive: true, force: true });
console.log("app/images: icon.ico, icon.icns, icon.png, icon-256.png, icon-512.png");
