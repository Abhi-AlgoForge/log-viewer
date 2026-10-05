import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { JsonPreview } from "../components/DocPreview";

describe("JsonPreview", () => {
  it("renders keys and scalars of a document", () => {
    const { container } = render(() => (
      <JsonPreview text={'{"name":"log-viewer","ok":true,"n":3,"none":null}'} />
    ));
    const text = container.textContent ?? "";
    expect(text).toContain('"name"');
    expect(text).toContain('"log-viewer"');
    expect(text).toContain("true");
    expect(text).toContain("3");
    expect(text).toContain("null");
  });

  it("collapses and re-expands a container on click", () => {
    const { container } = render(() => <JsonPreview text={'{"a":{"b":1}}'} />);
    expect(container.textContent).toContain('"b"');
    // Second toggle button belongs to the nested "a" object.
    const toggle = container.querySelectorAll("button")[1];
    fireEvent.click(toggle);
    expect(container.textContent).not.toContain('"b"');
    expect(container.textContent).toContain("1 key");
    fireEvent.click(toggle);
    expect(container.textContent).toContain('"b"');
  });

  it("starts deep levels collapsed", () => {
    const { container } = render(() => (
      <JsonPreview text={'{"l1":{"l2":{"deep":1}}}'} />
    ));
    expect(container.textContent).toContain('"l2"');
    expect(container.textContent).not.toContain('"deep"');
  });

  it("pages long arrays", () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const { container } = render(() => <JsonPreview text={JSON.stringify(items)} />);
    expect(container.textContent).toContain("Show 50 more");
  });

  it("falls back to one value per line", () => {
    const { container } = render(() => (
      <JsonPreview text={'{"id":1}\n{"id":2}\n'} />
    ));
    expect(container.textContent).toContain("Line-delimited JSON");
    expect(container.textContent).toContain('"id": 1');
    expect(container.textContent).toContain('"id": 2');
  });

  it("reports invalid JSON instead of throwing", () => {
    const { container } = render(() => <JsonPreview text={"{ not json"} />);
    expect(container.textContent).toContain("Not valid JSON");
  });
});
