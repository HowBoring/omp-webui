import { z } from "zod";

const imageFields = { type: z.literal("image"), data: z.string(), mimeType: z.string(),
  detail: z.enum(["auto", "low", "high", "original"]).optional(), url: z.string().optional(),
  providerFile: z.record(z.string(), z.unknown()).optional() };
const inputFields = <Image extends z.ZodType>(image: Image) => ({
  text: z.string(), images: z.array(image).optional(),
});
const queueFields = <Input extends z.ZodType>(input: Input) => ({
  steering: z.array(input), followUp: z.array(input),
  imagesDropped: z.literal(true).optional(), truncated: z.literal(true).optional(),
});

const withdrawnInput = z.object(inputFields(z.object(imageFields)));
/** Public Native AbortAndRestoreQueueResult. The decoder accepts unknown fields. */
export const queueWithdrawalSchema = z.object(queueFields(withdrawnInput));

const restoredInput = z.strictObject(inputFields(z.strictObject(imageFields)));
/** Browser presentation of withdrawn input, with an explicit unsent-only rule. */
export const restoredQueueSchema = z.strictObject({ ...queueFields(restoredInput), unsentOnly: z.literal(true) });
