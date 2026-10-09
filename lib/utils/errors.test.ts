import { describe, it, expect } from "vitest";
import { readJsonBody, readJsonUnknown, ValidationError } from "./errors";

/** Build a Request whose body is the given raw string. */
function req(raw: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

describe("readJsonBody", () => {
  it("returns the parsed object for a valid body", async () => {
    await expect(readJsonBody(req('{"name":"x","n":1}'))).resolves.toEqual({ name: "x", n: 1 });
  });

  it("throws ValidationError (400) on malformed JSON", async () => {
    await expect(readJsonBody(req("{"))).rejects.toBeInstanceOf(ValidationError);
    await expect(readJsonBody(req(""))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws ValidationError (400) on a JSON null body", async () => {
    // `null` is valid JSON, so the parse succeeds — but destructuring it later
    // is the classic 500. The helper must reject it up front.
    await expect(readJsonBody(req("null"))).rejects.toBeInstanceOf(ValidationError);
    await expect(readJsonBody(req("null"))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws ValidationError (400) on a non-object body", async () => {
    await expect(readJsonBody(req('"a string"'))).rejects.toBeInstanceOf(ValidationError);
    await expect(readJsonBody(req("42"))).rejects.toBeInstanceOf(ValidationError);
    await expect(readJsonBody(req("[1,2,3]"))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("readJsonUnknown", () => {
  it("passes any parseable value through untouched", async () => {
    await expect(readJsonUnknown(req('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJsonUnknown(req("null"))).resolves.toBeNull();
    await expect(readJsonUnknown(req("[1,2]"))).resolves.toEqual([1, 2]);
  });

  it("throws ValidationError (400) on malformed JSON", async () => {
    await expect(readJsonUnknown(req("{"))).rejects.toBeInstanceOf(ValidationError);
    await expect(readJsonUnknown(req(""))).rejects.toMatchObject({ statusCode: 400 });
  });
});
