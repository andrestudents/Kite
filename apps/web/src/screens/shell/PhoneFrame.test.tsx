// T037 — the frame's machine-checkable half: without a window the children
// render (the device branch is the T039 user gate — desktop shows the frame
// + QR, and no ceremony is ever attempted there).

import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { id } from "../../locales/id.js";
import { isHandoffDevice, PhoneFrame } from "./PhoneFrame.js";

describe("PhoneFrame", () => {
  test("children render when there is no window (SSR smoke)", () => {
    expect(isHandoffDevice()).toBe(false);
    const html = renderToString(
      <PhoneFrame locale={id}>
        <p>probe-marker</p>
      </PhoneFrame>,
    );
    expect(html).toContain("probe-marker");
    expect(html).not.toContain(id.desktop.title);
  });
});
