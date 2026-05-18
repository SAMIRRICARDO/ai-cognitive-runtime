import type { ToolHandler } from "../agents/_base/types.js";
import { RedisMemory } from "../memory/short-term/redis.js";

const memory = new RedisMemory();

export const memoryReadTool: ToolHandler = {
  name: "memory_read",
  schema: {
    name: "memory_read",
    description: "Read a value from agent short-term memory by key.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The memory key to retrieve" },
      },
      required: ["key"],
    },
  },
  execute: async (input) => {
    const { key } = input as { key: string };
    const value = await memory.get(key);
    return value ? { key, value } : { key, value: null, message: "Key not found" };
  },
};

export const memoryWriteTool: ToolHandler = {
  name: "memory_write",
  schema: {
    name: "memory_write",
    description: "Write a value to agent short-term memory.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The memory key" },
        value: { type: "string", description: "The value to store" },
        ttl_seconds: { type: "number", description: "Time to live in seconds (optional)" },
      },
      required: ["key", "value"],
    },
  },
  execute: async (input) => {
    const { key, value, ttl_seconds } = input as {
      key: string;
      value: string;
      ttl_seconds?: number;
    };
    await memory.set(key, value, ttl_seconds);
    return { success: true, key };
  },
};
