export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";
  const errored = params.error === "1";

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-neutral-50 p-4">
      <form
        action="/api/auth/login"
        method="POST"
        className="w-full max-w-sm space-y-3 rounded border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <h1 className="font-serif text-xl font-semibold text-neutral-900">
          Conato
        </h1>
        <p className="text-sm text-neutral-500">
          Ingresa el secreto compartido para continuar.
        </p>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="secret"
          autoFocus
          autoComplete="current-password"
          placeholder="secreto"
          required
          className="w-full rounded border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-500"
        />
        {errored && (
          <p className="text-xs text-red-600">secreto inválido</p>
        )}
        <button
          type="submit"
          className="w-full rounded bg-neutral-900 px-3 py-2 text-white"
        >
          entrar
        </button>
      </form>
    </main>
  );
}
