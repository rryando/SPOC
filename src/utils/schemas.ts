import { z } from "zod";

export const fileRefSchema = z.object({
  path: z.string().describe("Relative path from workspace root"),
  anchor: z.string().optional().describe("Stable identifier: function/class/export name"),
});

export type FileRef = z.infer<typeof fileRefSchema>;
