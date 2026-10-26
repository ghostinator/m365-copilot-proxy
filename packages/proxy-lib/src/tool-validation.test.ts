import { describe, expect, it } from "vitest";
import { compileToolContracts, ToolContractError } from "./tool-validation.js";

const tool = (parameters?: unknown, name = "edit") => ({ function: { name, parameters } });
const call = (args: unknown, name = "edit") => ({ function: { name, arguments: JSON.stringify(args) } });
const schema = {
  type: "object", required: ["edits", "enabled"], additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    edits: { type: "array", minItems: 1, items: { $ref: "#/$defs/edit" } },
    mode: { enum: ["replace", "append"] },
    contact: { type: "string", format: "email" },
    optional: { anyOf: [{ type: "string", minLength: 2 }, { type: "null" }] },
  },
  $defs: { edit: { type: "object", properties: { text: { type: "string" }, line: { type: "integer", minimum: 1 } }, required: ["text", "line"], additionalProperties: false } },
};
const valid = { enabled: true, edits: [{ text: "\r\n  雪\t  \n", line: 1 }] };

describe("tool contracts", () => {
  it("supports refs and unions and preserves arguments byte for byte", () => {
    const input = call({ ...valid, optional: null });
    const before = input.function.arguments;
    expect(compileToolContracts([tool(schema)]).validate([input])).toEqual([]);
    expect(input.function.arguments).toBe(before);
  });
  it.each([
    { ...valid, enabled: "true" },
    { ...valid, edits: "[]" },
    { ...valid, edits: [{ text: false, line: 1 }] },
    { ...valid, edits: [{ text: "okay", line: 0 }] },
    { ...valid, edits: [{ line: 1 }] },
    { ...valid, edits: [{ text: "okay", line: 1, extra: "secret" }] },
    { ...valid, mode: "other" },
    { ...valid, contact: "invalid" },
    { ...valid, optional: "x" },
    { ...valid, extra: "secret" },
    { edits: valid.edits },
    [], null, true, "value",
  ])("rejects malformed or schema-incompatible objects %#", args => {
    const issues = compileToolContracts([tool(schema)]).validate([call(args)]);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("secret");
    expect(issues[0].path).toMatch(/^\/tool_calls\/0\/function\/arguments/);
  });
  it("does not insert defaults or remove properties", () => {
    const contracts = compileToolContracts([tool({ type: "object", properties: { x: { type: "string", default: "default" } }, required: ["x"], additionalProperties: false })]);
    expect(contracts.validate([call({})])).not.toEqual([]);
    expect(contracts.validate([call({ x: "x", extra: true })])).not.toEqual([]);
  });
  it("treats property names and examples as data rather than schema keywords", () => {
    const parameters = { type: "object", properties: { $ref: { type: "string" } }, examples: [{ $ref: "https://example.test/data", $async: true }] };
    expect(compileToolContracts([tool(parameters)]).validate([call({ $ref: "value" })])).toEqual([]);
  });
  it("rejects invalid JSON and undeclared tool names", () => {
    const contracts = compileToolContracts([tool(schema)]);
    expect(contracts.validate([{ function: { name: "edit", arguments: "{" } }])).not.toEqual([]);
    expect(contracts.validate([call(valid, "missing")])[0].reason).toBe("tool is not declared");
    expect(compileToolContracts().validate([call(valid)])[0].reason).toBe("tool is not declared");
  });
  it.each([
    null, { type: "invalid" }, { type: "array", items: 5 }, { type: "string", pattern: "[" },
    { $ref: "https://example.test/schema" }, { $ref: "other.json#/thing" },
    { $async: true, type: "object" }, { properties: { x: { $ref: "#/$defs/missing" } } },
    { description: "x".repeat(256_000) },
  ])("rejects invalid or unsupported schema %#", parameters => {
    expect(() => compileToolContracts([tool(parameters)])).toThrow(ToolContractError);
  });
  it("rejects duplicate/empty names and undeclared named choices", () => {
    expect(() => compileToolContracts([tool(), tool()])).toThrow(/duplicate/);
    expect(() => compileToolContracts([tool({}, " ")])).toThrow(/empty/);
    expect(() => compileToolContracts([tool()], { function: { name: "missing" } })).toThrow(/not declared/);
    expect(compileToolContracts([tool({}, "a"), tool({}, "b")], { function: { name: "a" } }).validate([call({}, "b")])).not.toEqual([]);
  });
});
