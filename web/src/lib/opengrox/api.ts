import { createServerFn } from "@tanstack/react-start";
import type { CommandResult, ConnectionTest, ModelKey } from "./logic.ts";

export type CommandRequest = {
  text: string;
  model: ModelKey;
  baseUrl: string;
  token: string;
  opId: string;
};

export const runCommand = createServerFn({ method: "POST" })
  .validator((input: CommandRequest) => {
    const text = typeof input?.text === "string" ? input.text.trim().slice(0, 500) : "";
    if (!text) throw new Error("Say or type a command first.");
    return {
      text,
      model: input.model,
      baseUrl: typeof input.baseUrl === "string" ? input.baseUrl.trim().slice(0, 300) : "",
      token: typeof input.token === "string" ? input.token.slice(0, 2000) : "",
      opId: typeof input.opId === "string" ? input.opId.slice(0, 80) : "",
    };
  })
  .handler(async ({ data }): Promise<CommandResult> => {
    const { executeCommand, parseModel } = await import("./engine.server.ts");
    return executeCommand({ ...data, model: parseModel(data.model) });
  });

export const stopCommand = createServerFn({ method: "POST" })
  .validator((input: { opId?: string }) => ({
    opId: typeof input?.opId === "string" ? input.opId.slice(0, 80) : "",
  }))
  .handler(async ({ data }) => {
    const { cancelOp } = await import("./engine.server.ts");
    return { stopped: data.opId ? cancelOp(data.opId) : false };
  });

export const testPhone = createServerFn({ method: "POST" })
  .validator((input: { baseUrl?: string; token?: string; label?: string }) => {
    const baseUrl = typeof input?.baseUrl === "string" ? input.baseUrl.trim().slice(0, 300) : "";
    if (!baseUrl) throw new Error("Enter the phone's Droid-MCP URL.");
    const label = (typeof input?.label === "string" ? input.label : "My Phone").trim().slice(0, 40) || "My Phone";
    return {
      baseUrl,
      token: typeof input?.token === "string" ? input.token.slice(0, 2000) : "",
      label,
    };
  })
  .handler(async ({ data }): Promise<ConnectionTest> => {
    const { testConnection } = await import("./engine.server.ts");
    return testConnection(data);
  });
