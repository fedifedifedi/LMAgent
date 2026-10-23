import { z } from "zod";

/**
 * Formes de l'API Cominty, d'après le SDK officiel (github.com/cominty/python-sdk) et des flux enregistrés.
 * Schémas tolérants (champs inconnus ignorés) : l'API ajoute des champs et des événements au fil du temps.
 */

export const QuestionSchema = z.object({
  prompt: z.string(),
  options: z.array(z.string()).default([]),
});
export type ComintyQuestion = z.infer<typeof QuestionSchema>;

/** Montants envoyés en chaînes décimales ("0.12323775"). */
const Amount = z.union([z.string(), z.number()]).transform(Number);

export const CostSchema = z.object({
  failed: z.boolean().default(false),
  input_tokens: z.number().default(0),
  cached_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  input_cost: Amount.default(0),
  output_cost: Amount.default(0),
  total: Amount.default(0),
});
export type ComintyCost = z.infer<typeof CostSchema>;

export const FileSchema = z.object({ id: z.string(), name: z.string(), mimetype: z.string().optional() });

export const MessageStatusSchema = z.enum(["pending", "running", "success", "failed", "cancelled"]);

/** Message de la conversation ; le message assistant final arrive en dernière ligne du flux. */
export const MessageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  role: z.string(),
  content: z.string().default(""),
  status: MessageStatusSchema,
  error_code: z.string().nullish(),
  questions: z.array(QuestionSchema).nullish(),
  structured_output: z.record(z.string(), z.unknown()).nullish(),
  files: z.array(FileSchema).default([]),
});
export type ComintyMessage = z.infer<typeof MessageSchema>;

export const ThreadSchema = z.object({
  id: z.string(),
  messages: z.array(MessageSchema),
});
export type ComintyThread = z.infer<typeof ThreadSchema>;

const EventBase = z.object({
  id: z.string(),
  correlation_id: z.number(),
  at: z.string(),
  status: z.enum(["running", "success", "error"]),
});

const LlmData = z.object({ description: z.string().default(""), model: z.string().optional() });
const ToolCallData = z.object({ name: z.string(), description: z.string().default(""), message: z.string().nullish(), error: z.string().nullish() });
const UpdateData = z.object({ message: z.string() });
const UploadData = z.object({ filename: z.string() });
const ResultData = z.object({
  reply: z.string().default(""),
  files: z.array(FileSchema).default([]),
  questions: z.array(QuestionSchema).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  cost: CostSchema,
});

/** Événements connus ; un nom inconnu devient { name: "other" } plutôt que de casser le flux. */
export const EventSchema = z.union([
  EventBase.extend({ name: z.literal("waiting_for_start") }),
  EventBase.extend({ name: z.literal("setting_up_sandbox") }),
  EventBase.extend({ name: z.literal("uploading_file"), data: UploadData }),
  EventBase.extend({ name: z.literal("llm"), data: LlmData }),
  EventBase.extend({ name: z.literal("intermediary_update"), data: UpdateData }),
  EventBase.extend({ name: z.literal("tool_call"), data: ToolCallData }),
  EventBase.extend({ name: z.literal("result"), data: ResultData }),
]);
export type ComintyEvent = z.infer<typeof EventSchema> | (z.infer<typeof EventBase> & { name: "other"; rawName: string });
