import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { generateQrMatrix, generateQrSvg } from "../lib/qr-code";

test("generateQrSvg generates valid high-contrast SVG with 4-module quiet zone", () => {
  const url = "http://192.168.0.36:3000/";
  const svg = generateQrSvg(url);

  assert.ok(svg.startsWith("<svg"), "SVG should begin with <svg");
  assert.ok(svg.includes('fill="#ffffff"'), "SVG should include crisp white background");
  assert.ok(svg.includes('fill="#000000"'), "SVG should include high-contrast black modules");
  assert.ok(svg.includes('shape-rendering="crispEdges"'), "SVG should specify crispEdges rendering");
});

test("generateQrMatrix returns non-empty boolean grid", () => {
  const url = "http://192.168.0.36:3000/";
  const matrix = generateQrMatrix(url);

  assert.ok(matrix.length >= 21, "Matrix size should be at least Version 1 (21x21)");
  assert.equal(matrix.length, matrix[0].length, "Matrix should be square");
  const darkCount = matrix.flat().filter(Boolean).length;
  assert.ok(darkCount > 50, "Matrix should contain dark modules");
});

test("QR code renders and decodes perfectly back to Whole Desktop OS URL", () => {
  const expectedUrl = "http://192.168.0.36:3000/";
  const qr = QRCode.create(expectedUrl, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const margin = 4;
  const width = size + margin * 2;
  const scale = 4;
  const imgW = width * scale;
  const imgH = width * scale;

  const data = new Uint8ClampedArray(imgW * imgH * 4);
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const modX = Math.floor(x / scale) - margin;
      const modY = Math.floor(y / scale) - margin;
      const isDark =
        modX >= 0 && modX < size && modY >= 0 && modY < size
          ? qr.modules.get(modY, modX)
          : 0;
      const val = isDark ? 0 : 255;
      const idx = (y * imgW + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }

  const decoded = jsQR(data, imgW, imgH);
  assert.ok(decoded, "QR code must be recognized by optical decoder");
  assert.equal(decoded.data, expectedUrl, "Decoded text must match original URL");
});
