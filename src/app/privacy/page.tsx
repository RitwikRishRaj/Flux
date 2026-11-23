export const metadata = { title: "Privacy · Flux" };

// Short on purpose: Flux has no accounts. Invisible Turnstile requires referencing Cloudflare's addendum here.
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-[15px] leading-relaxed text-primary/85">
      <a href="/" className="text-sm text-primary/50 transition-colors hover:text-primary">← Flux</a>
      <h1 className="mt-6 text-3xl font-medium tracking-tight text-primary">Privacy</h1>

      <h2 className="mt-10 text-lg font-medium text-primary">No accounts</h2>
      <p className="mt-2">Flux has no sign-up or sign-in. The name and colour you pick are kept in your browser and shown to people in the same room.</p>

      <h2 className="mt-8 text-lg font-medium text-primary">Rooms</h2>
      <p className="mt-2">
        A room&apos;s code, input, test cases and run results are stored on Cloudflare so the room survives reloads, and are deleted a couple of
        minutes after the last person leaves. Anyone with a room&apos;s link can open it, so don&apos;t put secrets in a room.
      </p>

      <h2 className="mt-8 text-lg font-medium text-primary">Running code</h2>
      <p className="mt-2">
        When someone presses Run, the room&apos;s code and input are sent to{" "}
        <a className="underline underline-offset-4" href="https://onlinecompiler.io">onlinecompiler.io</a> to be run, and the output comes back to the room.
      </p>

      <h2 className="mt-8 text-lg font-medium text-primary">Cloudflare Turnstile</h2>
      <p className="mt-2">
        Creating a new room uses Cloudflare Turnstile to check that the request comes from a person, without a visible challenge. Turnstile&apos;s use of data
        is described in Cloudflare&apos;s{" "}
        <a className="underline underline-offset-4" href="https://www.cloudflare.com/turnstile-privacy-policy/">Turnstile Privacy Addendum</a>.
      </p>
    </main>
  );
}
