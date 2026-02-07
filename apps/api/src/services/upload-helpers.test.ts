import { describe, it, expect } from "bun:test";
import JSZip from "jszip";
import {
  SUPPORTED_MIME_TYPES,
  EXTENSION_TO_MIME,
  extractTextFromUpload,
} from "./upload-helpers";

describe("upload-helpers", () => {
  it("supports pptx uploads and extension mapping", () => {
    expect(
      SUPPORTED_MIME_TYPES["application/vnd.openxmlformats-officedocument.presentationml.presentation"]
    ).toBe("pptx");
    expect(EXTENSION_TO_MIME[".pptx"]).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
  });

  it("extracts text from a pptx slide deck", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:t>Hello</a:t>
        <a:t>World &amp; Team</a:t>
      </p:sld>`
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:t>Second Slide</a:t>
      </p:sld>`
    );

    const content = await zip.generateAsync({ type: "uint8array" });
    const text = await extractTextFromUpload(
      content,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "deck.pptx"
    );

    expect(text).toContain("## Slide 1");
    expect(text).toContain("Hello");
    expect(text).toContain("World & Team");
    expect(text).toContain("## Slide 2");
    expect(text).toContain("Second Slide");
  });

  it("rejects legacy xls uploads", async () => {
    await expect(
      extractTextFromUpload(new Uint8Array([1, 2, 3]), "application/vnd.ms-excel", "legacy.xls")
    ).rejects.toThrow("Legacy .xls format is not supported");
  });

  it("rejects legacy ppt uploads", async () => {
    await expect(
      extractTextFromUpload(new Uint8Array([1, 2, 3]), "application/vnd.ms-powerpoint", "legacy.ppt")
    ).rejects.toThrow("Legacy .ppt format is not supported");
  });
});
