import { HELP_SECTIONS } from '@wealthpilot/shared';

/** S24 Help and disclosures. Reachable signed in or out. */
export function HelpPage() {
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div data-testid="help-screen" className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Help sections" className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">On this page</p>
        <ul className="flex flex-col gap-1 text-sm">
          {HELP_SECTIONS.map((s) => (
            <li key={s.title}>
              <a href={`#${slug(s.title)}`} className="text-link hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-semibold tracking-tight">Help &amp; disclosures</h1>
        {HELP_SECTIONS.map((s) => (
          <section key={s.title} id={slug(s.title)} className="scroll-mt-24 rounded-xl border bg-card p-6 shadow-card">
            <h2 className="mb-3 text-lg font-semibold">{s.title}</h2>
            <div className="flex flex-col gap-2 text-sm leading-relaxed">
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
