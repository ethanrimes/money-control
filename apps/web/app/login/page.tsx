import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
