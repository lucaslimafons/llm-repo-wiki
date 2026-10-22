/**
 * Retrieved repo/wiki text is DATA. It reaches the model only inside these tags, and a closing
 * tag inside the payload is escaped so a file can't end the block and speak as instructions.
 */
export function escapeRetrieved(text: string): string {
  return text.replace(/<\s*\/\s*retrieved/gi, "<\\/retrieved").replace(/<\s*retrieved/gi, "<\\retrieved");
}

function escapeAttr(value: string): string {
  return value.replace(/[&"<>\n\r]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function wrapRetrieved(source: string, content: string): string {
  return `<retrieved source="${escapeAttr(source)}">\n${escapeRetrieved(content)}\n</retrieved>`;
}
