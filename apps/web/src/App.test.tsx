import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the app shell", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { level: 1, name: "DiffSentinel" })).toBeVisible();
});
