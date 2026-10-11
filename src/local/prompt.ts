export function translationInstruction(targetLanguage: string): string {
  return `Translate the following text into ${targetLanguage}. Note that you should only output the translated result without any additional explanation. Preserve meaning, negation, numbers, names, Markdown formatting, code and URLs exactly. Use standard Japanese technical terminology when translating into Japanese:\n`;
}
