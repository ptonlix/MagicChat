export type WindowCloseAction = "allow" | "hide" | "quit"

interface WindowCloseState {
  appReady: boolean
  closeBehavior: "background" | "quit"
  quitting: boolean
}

export function resolveWindowCloseAction(state: WindowCloseState): WindowCloseAction {
  if (state.quitting) return "allow"
  if (state.closeBehavior === "background" && state.appReady) return "hide"
  return "quit"
}
