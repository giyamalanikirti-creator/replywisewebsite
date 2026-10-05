export const BUSINESS_TYPES = ['Clothing / Fashion', 'Beauty / Salon', 'Food / Restaurant', 'Home Business', 'Electronics', 'Professional Services', 'Other'];
export const LIMIT_MESSAGE = "You've tried all 5 demo replies. Thanks for testing ReplyWise!";
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validateVisitor(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new AppError(400, 'Please refresh the page to start a new browser session.');
  return id;
}
export function validateInput(body) {
  if (!body || typeof body.customer_message !== 'string' || !body.customer_message.trim()) throw new AppError(400, 'Paste a customer message first.');
  if (body.customer_message.length > 1000) throw new AppError(400, 'Keep your customer message within 1,000 characters.');
  if (!BUSINESS_TYPES.includes(body.business_type)) throw new AppError(400, 'Choose your business type.');
  return { customer_message: body.customer_message.trim(), business_type: body.business_type, visitor_id: validateVisitor(body.visitor_id) };
}
export function validateOutput(value) {
  const limits = { detected_language: 60, request_type: 80, reply: 1600, follow_up_action: 500 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model output');
  const result = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > limit) throw new Error('Invalid model field');
    result[key] = value[key].trim();
  }
  return result;
}
