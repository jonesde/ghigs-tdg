/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePagesBase } from "../../vite.config";

// PAGES_BASE_PATH is exactly what actions/configure-pages sets `base_path` to:
// siteUrl.pathname with the trailing slash removed. A project site yields
// "/ghigs-tdg", a user site or custom domain yields "".
describe("resolvePagesBase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves dev at the site root so local work is not under the repo path", () => {
    vi.stubEnv("PAGES_BASE_PATH", "/ghigs-tdg");
    expect(resolvePagesBase({ command: "serve", isPreview: false })).toBe("/");
  });

  it("keeps the build base in preview so dist/ serves the same URLs it deploys", () => {
    expect(resolvePagesBase({ command: "serve", isPreview: true })).toBe("/ghigs-tdg/");
  });

  it("defaults a production build to the project Pages path", () => {
    expect(resolvePagesBase({ command: "build" })).toBe("/ghigs-tdg/");
  });

  it("normalizes the no-trailing-slash base_path configure-pages emits", () => {
    vi.stubEnv("PAGES_BASE_PATH", "/ghigs-tdg");
    expect(resolvePagesBase({ command: "build" })).toBe("/ghigs-tdg/");
  });

  it("passes an already-normalized base_path through unchanged", () => {
    vi.stubEnv("PAGES_BASE_PATH", "/ghigs-tdg/");
    expect(resolvePagesBase({ command: "build" })).toBe("/ghigs-tdg/");
  });

  it("serves a user site or custom domain at the root", () => {
    vi.stubEnv("PAGES_BASE_PATH", "");
    expect(resolvePagesBase({ command: "build" })).toBe("/");
    vi.stubEnv("PAGES_BASE_PATH", "/");
    expect(resolvePagesBase({ command: "build" })).toBe("/");
  });
});
