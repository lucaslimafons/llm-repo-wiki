// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHAT_WIDTH, WikiShell } from "./WikiShell";

const shell = () => render(<WikiShell sidebar={<nav />} chat={<div>chat</div>}>page</WikiShell>);
const handle = () => screen.getByRole("separator", { name: "Resize chat panel" });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("WikiShell chat resizing", () => {
  it("starts at the default width", () => {
    shell();
    expect(handle().getAttribute("aria-valuenow")).toBe(String(CHAT_WIDTH.default));
  });

  it("widens with the keyboard and remembers it", () => {
    shell();
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    const wider = CHAT_WIDTH.default + CHAT_WIDTH.step;
    expect(handle().getAttribute("aria-valuenow")).toBe(String(wider));
    expect(window.localStorage.getItem("llm-repo-wiki:chat-width")).toBe(String(wider));
  });

  it("clamps to the allowed range and resets on double-click", () => {
    shell();
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(handle().getAttribute("aria-valuenow")).toBe(String(CHAT_WIDTH.max));
    fireEvent.doubleClick(handle());
    expect(handle().getAttribute("aria-valuenow")).toBe(String(CHAT_WIDTH.default));
  });

  it("ignores a stored width outside the range", () => {
    window.localStorage.setItem("llm-repo-wiki:chat-width", "99999");
    shell();
    expect(handle().getAttribute("aria-valuenow")).toBe(String(CHAT_WIDTH.max));
  });
});
