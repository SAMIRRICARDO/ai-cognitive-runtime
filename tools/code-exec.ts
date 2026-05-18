import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolHandler } from "../agents/_base/types.js";

const execAsync = promisify(exec);

export const codeExecTool: ToolHandler = {
  name: "execute_code",
  schema: {
    name: "execute_code",
    description: "Execute a TypeScript or Python code snippet and return the output.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The code to execute" },
        language: {
          type: "string",
          enum: ["typescript", "python"],
          description: "The language of the code snippet",
        },
      },
      required: ["code", "language"],
    },
  },
  execute: async (input) => {
    const { code, language } = input as { code: string; language: "typescript" | "python" };
    const ext = language === "typescript" ? "ts" : "py";
    const tmpFile = join(tmpdir(), `agent-exec-${Date.now()}.${ext}`);

    try {
      await writeFile(tmpFile, code, "utf8");

      const cmd = language === "typescript"
        ? `npx tsx ${tmpFile}`
        : `python3 ${tmpFile}`;

      const { stdout, stderr } = await execAsync(cmd, { timeout: 15_000 });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: any) {
      return { error: err.message, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  },
};
