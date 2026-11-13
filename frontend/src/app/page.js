import { getBackendStatus } from '../lib/backend-status.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const backend = await getBackendStatus();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-zinc-100">
      <section className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">
          Plantilla PERN
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Entorno local de desarrollo
        </h1>
        <p className="mt-3 text-zinc-300">
          Frontend Next.js conectado a la API Express por la red de Compose.
        </p>
        <p
          className="mt-8 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm"
          role="status"
        >
          {backend.connected
            ? `Backend conectado: ${backend.message}`
            : 'Backend sin conexión. Revisa el estado de los servicios.'}
        </p>
      </section>
    </main>
  );
}
