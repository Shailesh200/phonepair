/** Up to three phones share the laptop's code. The laptop is the manager. */
export function hostAcceptsAnotherPhone(openCount: number): boolean {
  return openCount < 3
}
