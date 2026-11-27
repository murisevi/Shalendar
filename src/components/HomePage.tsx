import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarHeart,
  CalendarRange,
  CheckCircle2,
  Clock,
  EyeOff,
  MapPin,
  Moon,
  Sun,
  Users,
  Vote,
} from 'lucide-react';
import { api, type PublicPlanSummary } from '../lib/api';
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  PLAN_EMOJIS,
  formatDateLongEs,
} from '../../shared/dates';
import { HOLIDAY_COUNTRIES } from '../../shared/holidays';
import type { HolidayCountry, PlanGranularity } from '../../shared/types';
import {
  getRecentPlans,
  rememberPlan,
  saveAdminToken,
  saveParticipantId,
  saveParticipantToken,
  type ThemeMode,
} from '../lib/storage';

interface HomePageProps {
  onOpenPlan: (slug: string) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}

export function HomePage({ onOpenPlan, theme, onToggleTheme }: HomePageProps) {
  const [title, setTitle] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('🍕');
  const [maxVotes, setMaxVotes] = useState<number>(3);
  const [granularity, setGranularity] = useState<PlanGranularity>('day');
  const [durationDays, setDurationDays] = useState<number>(1);
  const [holidayCountry, setHolidayCountry] = useState<HolidayCountry>('ES');
  const [blindVoting, setBlindVoting] = useState(false);
  const [votingDeadline, setVotingDeadline] = useState('');
  const [organizerPin, setOrganizerPin] = useState('');
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoPlans, setDemoPlans] = useState<PublicPlanSummary[]>([]);
  const [myRecentPlans, setMyRecentPlans] = useState<PublicPlanSummary[]>([]);

  useEffect(() => {
    api
      .listPublicPlans()
      .then((res) => setDemoPlans(res.plans))
      .catch(() => {});

    const localRecent = getRecentPlans();
    if (localRecent.length > 0) {
      api
        .lookupPlans(localRecent.map((r) => r.slug))
        .then((res) => setMyRecentPlans(res.plans))
        .catch(() => {
          // Offline fallback using local cache
          setMyRecentPlans(
            localRecent.map((r) => ({
              slug: r.slug,
              title: r.title,
              emoji: r.emoji,
              location: '',
              participantCount: 1,
              confirmedDate: null,
              createdAt: r.lastVisitedAt,
            }))
          );
        });
    }
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !organizerName.trim()) {
      setError('Ponle un nombre a la quedada y dinos cómo te llamas.');
      return;
    }
    if (organizerPin.trim() && organizerPin.trim().length < 4) {
      setError('El PIN opcional debe tener al menos 4 caracteres.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createPlan({
        title: title.trim(),
        organizerName: organizerName.trim(),
        location: location.trim(),
        description: description.trim(),
        emoji,
        organizerColor: AVATAR_COLORS[0],
        organizerEmoji: AVATAR_EMOJIS[0],
        organizerPin: organizerPin.trim() || undefined,
        maxVotesPerUser: maxVotes,
        granularity,
        durationDays,
        holidayCountry,
        blindVoting,
        votingDeadline: votingDeadline ? new Date(votingDeadline).toISOString() : null,
      });
      saveParticipantId(created.plan.slug, created.participant.id);
      saveParticipantToken(created.plan.slug, created.participantToken);
      saveAdminToken(created.plan.slug, created.adminToken);
      rememberPlan({
        slug: created.plan.slug,
        title: created.plan.title,
        emoji: created.plan.emoji,
      });
      onOpenPlan(created.plan.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la quedada');
    } finally {
      setSubmitting(false);
    }
  }

  const demoPlan = demoPlans.find((p) => p.slug === 'cena-reencuentro') ?? demoPlans[0];

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0E1318] text-stone-900 dark:text-slate-100">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px] opacity-60 dark:opacity-25"
        style={{
          background:
            'radial-gradient(ellipse 65% 55% at 50% -10%, rgba(20, 184, 166, 0.22), transparent 70%)',
        }}
      />

      {/* Header */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm shadow-teal-600/20">
            <CalendarHeart className="h-5 w-5" />
          </div>
          <span className="font-display text-xl font-extrabold tracking-tight">
            Shalendar
          </span>
        </div>

        <div className="flex items-center gap-2">
          {demoPlan && (
            <button
              type="button"
              onClick={() => onOpenPlan(demoPlan.slug)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-teal-200 dark:border-teal-800/70 bg-teal-50/80 dark:bg-teal-950/50 px-3.5 py-1.5 text-sm font-medium text-teal-800 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition cursor-pointer"
            >
              <span>{demoPlan.emoji}</span>
              <span>Ver ejemplo en vivo</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Cambiar tema"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-stone-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 pt-4 pb-20 sm:px-6 lg:pt-10">
        <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-12">
          {/* Left Hero Column */}
          <div className="lg:col-span-6 lg:pt-4 space-y-6 animate-fade-up">
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-stone-900 dark:text-white sm:text-5xl leading-[1.1]">
              Ponerse de acuerdo para quedar{' '}
              <span className="bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-500 bg-clip-text text-transparent">
                por fin es fácil.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-stone-600 dark:text-slate-300 leading-relaxed max-w-xl">
              Crea un calendario privado en segundos, pásale el enlace o QR a tus amigos, pintad los
              días o franjas que podéis, votad fecha y lugar, y organizad coches y tareas sin salir
              del mismo link.
            </p>

            {/* 3 Visual Value Pills */}
            <div className="grid gap-3 sm:grid-cols-3 pt-2">
              <div className="rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-4 shadow-2xs">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                  <CalendarHeart className="h-4.5 w-4.5" />
                </div>
                <p className="font-display text-sm font-bold">Días, franjas y escapadas</p>
                <p className="mt-1 text-xs text-stone-500 dark:text-slate-400">
                  Pinta deslizando, añade notas por día o busca puentes de varios días.
                </p>
              </div>

              <div className="rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-4 shadow-2xs">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300">
                  <Vote className="h-4.5 w-4.5" />
                </div>
                <p className="font-display text-sm font-bold">Votación inteligente</p>
                <p className="mt-1 text-xs text-stone-500 dark:text-slate-400">
                  Voto oculto, fecha límite, imprescindibles y ranking equilibrado.
                </p>
              </div>

              <div className="rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-4 shadow-2xs">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">
                  <Users className="h-4.5 w-4.5" />
                </div>
                <p className="font-display text-sm font-bold">Logística resuelta</p>
                <p className="mt-1 text-xs text-stone-500 dark:text-slate-400">
                  RSVP con +1, encuestas de sitio, checklist y reparto de coches.
                </p>
              </div>
            </div>

            {/* Live Demo Callout */}
            {demoPlan && (
              <div className="rounded-2xl border border-teal-200/80 dark:border-teal-800/50 bg-gradient-to-br from-teal-50/90 to-emerald-50/50 dark:from-teal-950/40 dark:to-slate-900/70 p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white dark:bg-slate-800 text-2xl shadow-xs">
                    {demoPlan.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                      Ejemplo interactivo listo para probar
                    </p>
                    <p className="font-display font-bold text-stone-900 dark:text-white truncate">
                      {demoPlan.title}
                    </p>
                    <p className="text-xs text-stone-600 dark:text-slate-400">
                      {demoPlan.participantCount} amigos apuntados · votación y logística activas
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenPlan(demoPlan.slug)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition cursor-pointer"
                >
                  Explorar
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* Right Column — Create Form Card */}
          <div className="lg:col-span-6 animate-fade-up">
            <form
              onSubmit={handleCreate}
              className="rounded-3xl border border-stone-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 sm:p-8 shadow-xl shadow-stone-900/5 dark:shadow-black/30 space-y-5"
            >
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight">
                  Crea una nueva quedada
                </h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-slate-400">
                  Enlace privado listo para compartir en 10 segundos. Sin registros.
                </p>
              </div>

              {/* Emoji picker */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400 mb-2">
                  Icono del plan
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {PLAN_EMOJIS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setEmoji(item)}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition cursor-pointer ${
                        emoji === item
                          ? 'bg-teal-100 dark:bg-teal-900/70 ring-2 ring-teal-500 scale-105'
                          : 'bg-stone-100/80 dark:bg-slate-800 hover:bg-stone-200/80 dark:hover:bg-slate-700'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="plan-title"
                    className="block text-sm font-medium text-stone-700 dark:text-slate-200 mb-1.5"
                  >
                    ¿Qué plan queréis hacer?
                  </label>
                  <input
                    id="plan-title"
                    type="text"
                    required
                    maxLength={80}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej: Escapada a la sierra, Cena de viernes, Partida de Catan..."
                    className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15 transition"
                  />
                </div>

                <div>
                  <label
                    htmlFor="organizer-name"
                    className="block text-sm font-medium text-stone-700 dark:text-slate-200 mb-1.5"
                  >
                    Tu nombre
                  </label>
                  <input
                    id="organizer-name"
                    type="text"
                    required
                    maxLength={32}
                    value={organizerName}
                    onChange={(e) => setOrganizerName(e.target.value)}
                    placeholder="Ej: Alex"
                    className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15 transition"
                  />
                </div>

                <div>
                  <label
                    htmlFor="plan-location"
                    className="block text-sm font-medium text-stone-700 dark:text-slate-200 mb-1.5"
                  >
                    Lugar <span className="text-stone-400 font-normal">(opcional)</span>
                  </label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      id="plan-location"
                      type="text"
                      maxLength={120}
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Ej: Centro, Casa de Ana..."
                      className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-800/70 pl-9 pr-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15 transition"
                    />
                  </div>
                </div>
              </div>

              {/* Optional toggle for advanced options */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowMoreOptions((v) => !v)}
                  className="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer"
                >
                  {showMoreOptions
                    ? '− Ocultar opciones avanzadas'
                    : '+ Franjas horarias, escapada multi-día, voto oculto o fecha límite'}
                </button>

                {showMoreOptions && (
                  <div className="mt-3 space-y-4 rounded-2xl border border-stone-200/70 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-800/40 p-4 animate-pop">
                    <div>
                      <label
                        htmlFor="plan-desc"
                        className="block text-xs font-medium text-stone-600 dark:text-slate-300 mb-1.5"
                      >
                        Descripción o detalles para el grupo
                      </label>
                      <textarea
                        id="plan-desc"
                        rows={2}
                        maxLength={400}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ej: Apuntad los días que tenéis libres este mes y votad vuestro favorito."
                        className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15 transition resize-none"
                      />
                    </div>

                    {/* Granularity & Multi-day Duration */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <span className="flex items-center gap-1 text-xs font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                          <Clock className="h-3.5 w-3.5 text-teal-600" />
                          Modo de calendario
                        </span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { id: 'day' as const, label: 'Días' },
                            { id: 'slots' as const, label: 'M / T / N' },
                          ].map((g) => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => setGranularity(g.id)}
                              className={`rounded-xl py-2 text-xs font-semibold border transition cursor-pointer ${
                                granularity === g.id
                                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                                  : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-stone-600 dark:text-slate-300'
                              }`}
                            >
                              {g.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="flex items-center gap-1 text-xs font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                          <CalendarRange className="h-3.5 w-3.5 text-teal-600" />
                          Duración del plan
                        </span>
                        <select
                          value={durationDays}
                          onChange={(e) => setDurationDays(Number(e.target.value))}
                          className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
                        >
                          <option value={1}>1 día (quedada puntual)</option>
                          <option value={2}>2 días seguidos (finde)</option>
                          <option value={3}>3 días seguidos (puente)</option>
                          <option value={4}>4 días seguidos (escapada)</option>
                          <option value={5}>5 días seguidos (viaje)</option>
                          <option value={7}>7 días seguidos (semana)</option>
                        </select>
                      </div>
                    </div>

                    {/* Votes & Holidays */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <span className="block text-xs font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                          Votos por persona
                        </span>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            { value: 1, label: '1' },
                            { value: 2, label: '2' },
                            { value: 3, label: '3' },
                            { value: 0, label: '∞' },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setMaxVotes(opt.value)}
                              className={`rounded-xl py-2 text-xs font-semibold border transition cursor-pointer ${
                                maxVotes === opt.value
                                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200'
                                  : 'border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-stone-600 dark:text-slate-300'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                          Festivos en calendario
                        </label>
                        <select
                          value={holidayCountry}
                          onChange={(e) => setHolidayCountry(e.target.value as HolidayCountry)}
                          className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-500"
                        >
                          {HOLIDAY_COUNTRIES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Deadline + Blind voting + Optional PIN */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                          Cierre automático votación <span className="text-stone-400">(opcional)</span>
                        </label>
                        <input
                          type="datetime-local"
                          value={votingDeadline}
                          onChange={(e) => setVotingDeadline(e.target.value)}
                          className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs outline-none focus:border-teal-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-stone-600 dark:text-slate-300 mb-1.5">
                          Tu PIN multi-dispositivo <span className="text-stone-400">(opcional)</span>
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={12}
                          value={organizerPin}
                          onChange={(e) => setOrganizerPin(e.target.value)}
                          placeholder="Ej: 1234 (para entrar desde otro móvil)"
                          className="w-full rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2.5 text-xs font-medium text-stone-700 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={blindVoting}
                        onChange={(e) => setBlindVoting(e.target.checked)}
                        className="h-4 w-4 rounded accent-teal-600"
                      />
                      <EyeOff className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      <span>Voto oculto hasta cerrar votación (evita el efecto rebaño)</span>
                    </label>
                  </div>
                )}
              </div>

              {error && (
                <p className="rounded-xl bg-rose-50 dark:bg-rose-950/50 px-3.5 py-2.5 text-sm text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 disabled:opacity-60 px-5 py-3.5 font-display text-base font-bold text-white shadow-md shadow-teal-600/20 transition cursor-pointer"
              >
                {submitting ? 'Creando calendario...' : 'Crear calendario y compartir'}
                <ArrowRight className="h-4.5 w-4.5" />
              </button>
            </form>
          </div>
        </div>

        {/* User's Own Recent Plans (private to this browser, hydrated safely via lookup) */}
        {myRecentPlans.length > 0 && (
          <section className="mt-16 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-stone-800 dark:text-slate-100">
                Tus quedadas recientes
              </h2>
              <span className="text-xs text-stone-500 dark:text-slate-400">
                Solo visibles en este navegador
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {myRecentPlans.map((plan) => (
                <button
                  key={plan.slug}
                  type="button"
                  onClick={() => onOpenPlan(plan.slug)}
                  className="group text-left rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-md transition cursor-pointer flex items-start gap-3.5"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100 dark:bg-slate-800 text-2xl group-hover:scale-105 transition">
                    {plan.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-bold text-stone-900 dark:text-white truncate group-hover:text-teal-700 dark:group-hover:text-teal-300 transition">
                      {plan.title}
                    </p>
                    {plan.location && (
                      <p className="text-xs text-stone-500 dark:text-slate-400 truncate mt-0.5">
                        {plan.location}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-xs text-stone-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {plan.participantCount} {plan.participantCount === 1 ? 'persona' : 'personas'}
                      </span>
                      {plan.confirmedDate && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {formatDateLongEs(plan.confirmedDate)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
