export function validateSendEmailInput(input: any) {
  if (!input.recipient) {
    throw new Error("recipient is required");
  }

  if (!input.subject) {
    throw new Error("subject is required");
  }

  if (!input.body) {
    throw new Error("body is required");
  }

  return input;
}
