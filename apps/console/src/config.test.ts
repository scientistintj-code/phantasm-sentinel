import { expect, it } from "vitest";
import { loadConfig, parseOriginList } from "./config";

it("defaults the console env and keeps an empty stream allow-list", () => {
  const config = loadConfig({});
  expect(config.apiBase).toBe("/api/sentinel");
  expect(config.labUrls).toBe("");
  expect(config.streamOrigins).toEqual([]);
  expect(config.defaultMode).toBe("replay");
  expect(config.agentToggles).toBe(false);
});

it("parses mode, toggles, and http(s) stream origins", () => {
  const config = loadConfig({
    VITE_API_BASE: "https://console.example/api/sentinel",
    VITE_LAB_URLS: "https://lab-a.example",
    VITE_STREAM_ORIGINS: "https://stream.example/view, javascript:alert(1), data:text/html,hi, https://other.example",
    VITE_DEFAULT_MODE: "live",
    VITE_ENABLE_AGENT_TOGGLES: "true",
  });
  expect(config.apiBase).toBe("https://console.example/api/sentinel");
  expect(config.defaultMode).toBe("live");
  expect(config.agentToggles).toBe(true);
  expect(config.streamOrigins).toEqual(["https://stream.example", "https://other.example"]);
  expect(parseOriginList("http://stream.example")).toEqual(["http://stream.example"]);
});

it("rejects a mode outside replay or live", () => {
  expect(() => loadConfig({ VITE_DEFAULT_MODE: "demo" })).toThrow();
});
