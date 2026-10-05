import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { Markdown } from "../components/Markdown";

describe("Markdown", () => {
  it("renders **bold** as <strong>", () => {
    const { container } = render(() => <Markdown source="hello **world**" />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("world");
  });

  it("renders inline `code`", () => {
    const { container } = render(() => <Markdown source="run `npm test` first" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("npm test");
  });

  it("renders bullet lists", () => {
    const { container } = render(() => (
      <Markdown source={"- one\n- two\n- three"} />
    ));
    const lis = container.querySelectorAll("li");
    expect(lis.length).toBe(3);
    expect(lis[1].textContent).toContain("two");
  });

  it("renders headings", () => {
    const { container } = render(() => <Markdown source="## A heading" />);
    expect(container.textContent).toContain("A heading");
  });

  it("renders pipe tables with alignment", () => {
    const { container } = render(() => (
      <Markdown source={"| Name | Count |\n| --- | ---: |\n| a \\| b | **3** |\n| c | 4 |"} />
    ));
    const ths = container.querySelectorAll("th");
    expect(ths.length).toBe(2);
    expect(ths[1].style.textAlign).toBe("right");
    const tds = container.querySelectorAll("td");
    expect(tds.length).toBe(4);
    expect(tds[0].textContent).toBe("a | b");
    expect(tds[1].querySelector("strong")!.textContent).toBe("3");
  });

  it("does not interpret raw HTML in source", () => {
    const { container } = render(() => (
      <Markdown source="<script>alert(1)</script>" />
    ));
    // Verbatim text, no actual <script> tag mounted.
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("rejects non-http link URLs", () => {
    const { container } = render(() => (
      <Markdown source="[click](javascript:alert(1))" />
    ));
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.getAttribute("href")).toBe("#");
  });
});
