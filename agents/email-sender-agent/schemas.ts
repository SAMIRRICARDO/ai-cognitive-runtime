import { z } from "zod";

const emailTypeEnum = z.enum(["cold-outreach", "follow-up", "re-engagement"]);

export const sendEmailSchema = z.object({
  company:         z.string().min(1, "company is required"),
  contactName:     z.string().min(1, "contactName is required"),
  recipientEmail:  z.string().email("recipientEmail must be a valid email address"),
  subject:         z.string().min(1, "subject is required"),
  bodyText:        z.string().min(1, "bodyText is required"),
  bodyHtml:        z.string().optional(),
  emailType:       emailTypeEnum.optional(),
  sequenceNumber:  z.number().int().positive().optional(),
  attachmentPath:  z.string().optional(),
});

export type ValidatedSendEmailInput = z.infer<typeof sendEmailSchema>;

export function validateSendEmailInput(input: unknown) {
  return sendEmailSchema.safeParse(input);
}
