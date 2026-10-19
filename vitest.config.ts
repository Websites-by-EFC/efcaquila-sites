import { defineConfig } from "vitest/config";

// Tests exercise window/localStorage/document.cookie (attribution capture).
export default defineConfig({
    test: { environment: "jsdom" },
});
