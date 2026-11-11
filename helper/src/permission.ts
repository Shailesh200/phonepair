import { execFile } from 'node:child_process'

export const ACCESSIBILITY_HELP = [
  'Accessibility permission is off.',
  'Grant it in System Settings > Privacy & Security > Accessibility.',
  'Enable the app that launched this helper (Terminal or iTerm), then start the helper again.',
].join('\n')

const SCRIPT = 'tell application "System Events" to get value of attribute "AXFocusedUIElement" of (first application process whose frontmost is true)'

export function accessibilityArgs(): string[] {
  return ['-e', SCRIPT]
}

export async function probeAccessibility(run: (args: string[]) => Promise<void>): Promise<boolean> {
  try {
    await run(accessibilityArgs())
    return true
  } catch {
    return false
  }
}

export async function probeInput(noop: () => Promise<void>): Promise<boolean> {
  try {
    await noop()
    return true
  } catch {
    return false
  }
}

/** macOS only. Asks System Events, which fails closed without Accessibility. */
export function checkWithOsascript(): Promise<boolean> {
  return probeAccessibility((args) => new Promise((resolve, reject) => {
    execFile('osascript', args, { timeout: 4000 }, (err) => (err ? reject(err) : resolve()))
  }))
}
