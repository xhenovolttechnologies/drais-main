'use client';

/**
 * Balance Sheet — a point-in-time statement of what the school owns and owes.
 *
 *   ASSETS        cash across money locations + outstanding fees receivable
 *   LIABILITIES   pending expenditures payable + student advance deposits
 *   EQUITY        net school funds (assets − liabilities)
 *
 * The accounting identity ASSETS = LIABILITIES + NET SCHOOL FUNDS is asserted
 * visibly on the statement rather than assumed. If it ever fails a director
 * must see it immediately — a balance sheet that silently does not balance is
 * worse than no balance sheet at all.
 *
 * Replaces a 13-line "Coming Soon" stub. The API already existed; nothing
 * rendered it, and its receivables query was leaking across tenants (now fixed).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { useCurrency } from '@/hooks/useCurrency';
import { useI18n } from '@/components/i18n/I18nProvider';
import { CheckCircle2, AlertTriangle, Users } from 'lucide-react';
import { ReportShell, ReportLoading, ReportError, Line, SectionTitle } from '@/components/finance/ReportShell';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function BalanceSheetPage() {
  const { t } = useI18n();
  const { format } = useCurrency();
  const [asOf, setAsOf] = useState(todayIso);

  const { data, error, isLoading, mutate } = useSWR(
    `/api/finance/reports/balance-sheet?as_of_date=${asOf}`,
    fetcher,
  );

  if (isLoading) return <ReportLoading />;
  if (error) {
    const status = (error as any)?.status;
    return (
      <ReportError
        message={String((error as Error)?.message ?? error)}
        onRetry={() => mutate()}
        accessDenied={status === 401 || status === 403}
      />
    );
  }
  if (data && data.success === false) return <ReportError message={data.error} onRetry={() => mutate()} />;

  const d = data?.data;
  const assets = d?.assets ?? {};
  const liabilities = d?.liabilities ?? {};
  const equity = d?.equity ?? {};

  const wallets = assets.cash_and_equivalents?.wallets ?? [];
  const totalCash = Number(assets.cash_and_equivalents?.total ?? 0);
  const receivable = assets.accounts_receivable ?? {};
  const totalReceivable = Number(receivable.total ?? 0);
  const totalAssets = Number(assets.total_assets ?? 0);

  const payable = liabilities.accounts_payable ?? {};
  const totalPayable = Number(payable.total ?? 0);
  const deposits = Number(liabilities.student_deposits?.total ?? 0);
  const totalLiabilities = Number(liabilities.total_liabilities ?? 0);

  const netAssets = Number(equity.net_assets ?? 0);

  // Assert the identity here rather than trusting the API flag: a float
  // comparison needs a tolerance, and the API compares with ===.
  const balances = Math.abs(totalAssets - (totalLiabilities + netAssets)) < 0.01;

  return (
    <ReportShell
      title={t('finance.balanceSheet', 'Balance Sheet')}
      subtitle={t('finance.balanceSheetSub', 'What the school owns and owes, at a point in time')}
      periodLabel={`${t('finance.asOf', 'As of')} ${asOf}`}
      actions={
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200"
        />
      }
    >
      {/* Headline */}
      <div className="grid gap-3 sm:grid-cols-3 mb-2">
        <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
            {t('finance.totalAssets', 'Total assets')}
          </p>
          <p className="text-xl font-extrabold text-sky-900 dark:text-sky-200 mt-1 tabular-nums">
            {format(totalAssets)}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {t('finance.totalLiabilities', 'Total liabilities')}
          </p>
          <p className="text-xl font-extrabold text-amber-900 dark:text-amber-200 mt-1 tabular-nums">
            {format(totalLiabilities)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            {t('finance.netAssets', 'Net school funds')}
          </p>
          <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">
            {format(netAssets)}
          </p>
        </div>
      </div>

      {/* Assets */}
      <SectionTitle>{t('finance.assets', 'Assets')}</SectionTitle>

      <Line label={t('finance.cashAndEquivalents', 'Cash and equivalents')} value={format(totalCash)} />
      {wallets.length === 0 ? (
        <Line
          indent={1}
          emphasis="muted"
          label={t('finance.noWallets', 'No money locations configured')}
          value={format(0)}
        />
      ) : (
        wallets.map((w: any) => (
          <Line
            key={w.id ?? w.name}
            indent={1}
            emphasis="muted"
            label={w.name}
            hint={w.type ?? undefined}
            value={format(Number(w.current_balance ?? 0), w.currency)}
          />
        ))
      )}

      <Line
        label={t('finance.accountsReceivable', 'Fees receivable')}
        hint={t('finance.outstandingFees', 'Outstanding student fees not yet collected')}
        value={format(totalReceivable)}
      />
      {totalReceivable > 0 && (
        <>
          <Line
            indent={1}
            emphasis="muted"
            label={
              <span className="inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {t('finance.learnersOwing', 'Learners with a balance')}
              </span>
            }
            value={String(receivable.total_students ?? 0)}
          />
          <Line
            indent={1}
            emphasis="muted"
            label={t('finance.partiallyPaid', 'Partially paid')}
            value={format(Number(receivable.partial_outstanding ?? 0))}
          />
          <Line
            indent={1}
            emphasis="muted"
            label={t('finance.nothingPaid', 'Nothing paid yet')}
            value={format(Number(receivable.full_outstanding ?? 0))}
          />
        </>
      )}

      <Line label={t('finance.totalAssets', 'Total assets')} value={format(totalAssets)} emphasis="subtotal" />

      {/* Liabilities */}
      <SectionTitle>{t('finance.liabilities', 'Liabilities')}</SectionTitle>

      <Line
        label={
          // This statement is read-only — approving/editing pending expenditures
          // happens on the Expenditures page, not here. Link straight to it so
          // "1 pending expenditure" isn't a dead end.
          Number(payable.count ?? 0) > 0 ? (
            <Link href="/finance/expenditures?status=pending" className="hover:underline text-amber-700 dark:text-amber-400">
              {t('finance.accountsPayable', 'Amounts payable')}
            </Link>
          ) : (
            t('finance.accountsPayable', 'Amounts payable')
          )
        }
        hint={`${Number(payable.count ?? 0)} ${t('finance.pendingExpenditures', 'pending expenses awaiting payment')} — click to review`}
        value={format(totalPayable)}
      />
      <Line
        label={t('finance.studentDeposits', 'Student deposits')}
        hint={t('finance.advancePayments', 'Advance payments held on behalf of learners')}
        value={format(deposits)}
      />
      <Line
        label={t('finance.totalLiabilities', 'Total liabilities')}
        value={format(totalLiabilities)}
        emphasis="subtotal"
      />

      {/* Net school funds (assets less liabilities — the nonprofit equivalent of equity) */}
      <SectionTitle>{t('finance.equity', 'Net School Funds')}</SectionTitle>
      <Line
        label={t('finance.accumulatedValue', 'Net school funds')}
        hint={t('finance.assetsMinusLiabilities', 'Assets less liabilities')}
        value={format(netAssets)}
      />
      <Line
        label={t('finance.totalEquity', 'Total net school funds')}
        value={format(Number(equity.total_equity ?? netAssets))}
        emphasis="subtotal"
      />

      <div className="mt-4">
        <Line
          label={t('finance.liabilitiesPlusEquity', 'Liabilities + net school funds')}
          value={format(totalLiabilities + netAssets)}
          emphasis="total"
        />
      </div>

      {/* The identity, asserted visibly */}
      <div
        className={`mt-6 rounded-xl border p-4 flex items-start gap-3 ${
          balances
            ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40'
            : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40'
        }`}
      >
        {balances ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
        )}
        <div>
          <p
            className={`text-sm font-bold ${
              balances ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'
            }`}
          >
            {balances
              ? t('finance.balanced', 'Balanced — assets equal liabilities plus net school funds')
              : t('finance.notBalanced', 'This statement does not balance')}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 tabular-nums">
            {format(totalAssets)} = {format(totalLiabilities)} + {format(netAssets)}
          </p>
          {!balances && (
            <p className="text-xs text-rose-700 dark:text-rose-300 mt-1.5 leading-relaxed">
              {t(
                'finance.notBalancedHint',
                'Do not rely on these figures. Report this to DRAIS support with the date above — it indicates a data problem, not a rounding difference.',
              )}
            </p>
          )}
        </div>
      </div>
    </ReportShell>
  );
}
