/** Read Node environment defaults without requiring a Node global in browsers. */
export function environmentValue(name) {
  return globalThis.process?.env?.[name];
}
