import type { PgPoolLike } from './pool.js';
import type { PurgeSummary } from './repository.js';

export interface PurgeSchedulerHandle {
  stop(): void;
  runOnce(): Promise<PurgeSummary>;
}

/**
 * Deletes all non-demo plans whose `expires_at` has passed.
 * Relies on `ON DELETE CASCADE` to clean up all related rows atomically.
 */
export async function purgeExpiredPlansSql(
  pool: PgPoolLike,
  now = new Date()
): Promise<PurgeSummary> {
  const executedAt = now.toISOString();
  const result = await pool.query(
    `
      DELETE FROM plans
      WHERE is_demo = FALSE
        AND expires_at IS NOT NULL
        AND expires_at <= $1::timestamptz
    `,
    [executedAt]
  );

  return {
    deletedCount: result.rowCount ?? 0,
    executedAt,
  };
}

/**
 * Starts a low-frequency background purge timer (default: every 12h).
 * Designed to avoid waking up serverless PostgreSQL instances needlessly.
 * Pass `intervalHours <= 0` when using an external Northflank Cron Job instead.
 */
export function startPurgeScheduler(
  pool: PgPoolLike,
  options: {
    intervalHours: number;
    logger?: Pick<Console, 'info' | 'error'>;
  }
): PurgeSchedulerHandle {
  const logger = options.logger ?? console;
  let running = false;

  const runOnce = async (): Promise<PurgeSummary> => {
    if (running) {
      return { deletedCount: 0, executedAt: new Date().toISOString() };
    }
    running = true;
    try {
      const summary = await purgeExpiredPlansSql(pool);
      if (summary.deletedCount > 0) {
        logger.info(
          `[shalendar:purge] Eliminadas ${summary.deletedCount} quedadas caducadas (${summary.executedAt})`
        );
      }
      return summary;
    } catch (err) {
      logger.error('[shalendar:purge] Error al purgar quedadas caducadas:', err);
      throw err;
    } finally {
      running = false;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  if (options.intervalHours > 0) {
    const intervalMs = options.intervalHours * 60 * 60 * 1000;
    timer = setInterval(() => {
      void runOnce().catch(() => {
        // Already logged inside runOnce
      });
    }, intervalMs);
    // Allow graceful process exit even if timer is active
    timer.unref?.();
  }

  return {
    runOnce,
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
