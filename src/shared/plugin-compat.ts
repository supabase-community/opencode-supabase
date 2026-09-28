// Compatibility layer for modules written against the V1 plugin API
// (`@opencode-ai/plugin`). V2 plugins receive options via `ctx.options` and
// register tools through `ctx.tool.transform` with JSON Schema inputs, so the
// V1-shaped `PluginOptions`, `PluginInput`, and `tool()` helper are reproduced
// here without depending on the V1 package.

export type PluginOptions = Record<string, unknown> | undefined;

export type PluginInput = {
  directory: string;
  worktree?: string;
};

export type ToolArgSchema = {
  type: "string";
  description?: string;
  isOptional?: boolean;
};

type ToolArgSchemaBuilder = ToolArgSchema & {
  describe(description: string): ToolArgSchemaBuilder;
  optional(): ToolArgSchemaBuilder;
};

// Erased definition shape handed to the V2 tool transform; execute params are
// widened because concrete arg/context types are inferred by `tool()`.
export type ToolDefinition = {
  description: string;
  args: Record<string, ToolArgSchema>;
  execute: (args: unknown, context: unknown) => Promise<unknown>;
};

type InferToolArgs<TArgs extends Record<string, ToolArgSchema>> = {
  [K in keyof TArgs]: TArgs[K] extends { isOptional: true } ? string | undefined : string;
};

function stringSchema(): ToolArgSchemaBuilder {
  const make = (overrides: Partial<ToolArgSchema>): ToolArgSchemaBuilder => ({
    type: "string",
    ...overrides,
    describe: (description) => make({ ...overrides, description }),
    optional: () => make({ ...overrides, isOptional: true }),
  });
  return make({});
}

function toolDefinition<TArgs extends Record<string, ToolArgSchema>, TContext>(definition: {
  description: string;
  args: TArgs;
  execute: (args: InferToolArgs<TArgs>, context: TContext) => Promise<unknown>;
}): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

export const tool = Object.assign(toolDefinition, { schema: { string: stringSchema } });

export function toJsonSchemaInput(args: Record<string, ToolArgSchema>): {
  type: "object";
  properties: Record<string, { type: "string"; description?: string }>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, { type: "string"; description?: string }> = {};
  const required: string[] = [];
  for (const [name, schema] of Object.entries(args)) {
    properties[name] = schema.description
      ? { type: "string", description: schema.description }
      : { type: "string" };
    if (!schema.isOptional) required.push(name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
