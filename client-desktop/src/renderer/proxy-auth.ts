declare global {
  interface Window { proxyAuth: { cancel(): void; submit(username: string, password: string): void } }
}

export {}

const form = document.querySelector<HTMLFormElement>("#form")!
const username = document.querySelector<HTMLInputElement>("#username")!
const password = document.querySelector<HTMLInputElement>("#password")!
document.querySelector<HTMLButtonElement>("#cancel")!.addEventListener("click", () => window.proxyAuth.cancel())
form.addEventListener("submit", (event) => {
  event.preventDefault()
  window.proxyAuth.submit(username.value, password.value)
  password.value = ""
})
