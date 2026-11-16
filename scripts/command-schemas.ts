/** Strict native command envelopes; callers own the command whitelist and request-ID policy. */
import { z } from "zod";

const wire = z.object({
  $defs: z.record(z.string(), z.unknown()),
  "x-rpc": z.object({ commands: z.array(z.object({ name: z.string(), params: z.string().nullable() })) }),
});
const parameterDefinition = z.object({
  properties: z.record(z.string(), z.unknown()), required: z.array(z.string()).default([]),
});
interface CommandPolicy { requireId?: boolean; maxIdLength?: number }

export function makeCommandSchemas(bundle: unknown, names: readonly string[], policy: CommandPolicy = {}) {
  const schema = wire.parse(bundle);
  return schema["x-rpc"].commands.filter(command => names.includes(command.name)).map(command => {
    const params = command.params === null ? { properties: {}, required: [] }
      : parameterDefinition.parse(schema.$defs[command.params]);
    const id = { type: "string", minLength: 1, ...(policy.maxIdLength === undefined ? {} : { maxLength: policy.maxIdLength }) };
    return { type: "object", additionalProperties: false,
      required: [...(policy.requireId === false ? [] : ["id"]), "type", ...params.required],
      properties: { id, type: { const: command.name }, ...params.properties } };
  });
}
