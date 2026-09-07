'use client';

/**
 * Control Center — SMS Financial Control Center (P5).
 * Provider balance + estimated capacity, per-school allocation vs used vs
 * remaining, and the internal-cost-vs-retail-price economics (profit per SMS).
 * Allocate credits so one school can't burn another's.
 */
import React, { useState } from 'react';
import useSWR from 'swr';
import { MessageSquare, Loader2, Wallet, Save, TrendingUp } from 'lucide-react';

const fetcher = (u: string) => fetch(u, { cache: 'no-store' }).then(r => r.json());
const nf = (n: any) => Number(n || 0).toLocaleString();
const money = (n: any) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function ControlSms() {
  const { data, isLoading, mutate } = useSWR<any>('/api/control-center/sms', fetcher, { refreshInterval: 60_000 });
  const provider = data?.provider;
  const pricing = data?.pricing;
  const totals = data?.totals;
  const rows = data?.rows || [];

  const [edits, setEdits] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const [priceEdits, setPriceEdits] = useState<{ internal_cost?: string; retail_price?: string }>({});
  const [savingPrice, setSavingPrice] = useState(false);

  const save = async (schoolId: number) => {
    const val = edits[schoolId];
    if (val === undefined) return;
    setSaving(schoolId);
    try {
      await fetch('/api/control-center/sms', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school_id: schoolId, quota: Number(val) }),
      });
      setEdits((e) => { const n = { ...e }; delete n[schoolId]; return n; });
      await mutate();
    } finally { setSaving(null); }
  };

  const savePricing = async () => {
    const internalCost = priceEdits.internal_cost !== undefined ? Number(priceEdits.internal_cost) : pricing?.internal_cost;
    const retailPrice = priceEdits.retail_price !== undefined ? Number(priceEdits.retail_price) : pricing?.retail_price;
    if (!Number.isFinite(internalCost) || internalCost <= 0 || !Number.isFinite(retailPrice) || retailPrice <= 0) return;
    setSavingPrice(true);
    try {
      await fetch('/api/control-center/sms', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ internal_cost: internalCost, retail_price: retailPrice }),
      });
      setPriceEdits({});
      await mutate();
    } finally { setSavingPrice(false); }
  };

  const priceDirty = priceEdits.internal_cost !== undefined || priceEdits.retail_price !== undefined;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">SMS economics — provider balance, per-school allocation & usage, and internal cost vs retail price profit.</p>

      {/* Provider overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1"><span className="text-xs text-slate-400">Provider balance</span><Wallet className="w-4 h-4 text-emerald-400" /></div>
          <div className="text-2xl font-bold text-slate-100 tabular-nums">
            {provider?.ok ? `${provider.currency} ${nf(provider.amount)}` : (isLoading ? '…' : '—')}
          </div>
          <div className="text-[11px] text-slate-500">
            Africa&apos;s Talking{provider?.source === 'school' ? ` · via school #${provider.source_school_id} credentials` : ' (platform)'}
          </div>
          {provider && !provider.ok && <div className="text-[11px] text-rose-400 mt-1">{provider.error}</div>}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Estimated capacity</div>
          <div className="text-2xl font-bold text-sky-300 tabular-nums">{provider?.estimated_sms != null ? nf(provider.estimated_sms) : '—'}</div>
          <div className="text-[11px] text-slate-500">SMS @ UGX {provider?.unit_cost ?? '—'}/unit (internal cost)</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Allocated</div>
          <div className="text-2xl font-bold text-indigo-300 tabular-nums">{nf(totals?.allocated)}</div>
          <div className="text-[11px] text-slate-500">across {totals?.schools ?? 0} schools</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Used (segments)</div>
          <div className="text-2xl font-bold text-amber-300 tabular-nums">{nf(totals?.used)}</div>
          <div className="text-[11px] text-slate-500">from SMS_SENT audit</div>
        </div>
      </div>

      {/* Pricing & profit */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><TrendingUp className="w-4 h-4 text-emerald-400" /> Pricing & profit per SMS</div>
          <button onClick={savePricing} disabled={!priceDirty || savingPrice}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs disabled:opacity-40">
            {savingPrice ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save pricing
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Internal cost (UGX/SMS) — what Africa&apos;s Talking charges us</label>
            <input type="number" min="0" step="0.01"
              value={priceEdits.internal_cost ?? (pricing?.internal_cost ?? '')}
              onChange={(e) => setPriceEdits((p) => ({ ...p, internal_cost: e.target.value }))}
              className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm tabular-nums" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Retail price (UGX/SMS) — what schools are charged</label>
            <input type="number" min="0" step="0.01"
              value={priceEdits.retail_price ?? (pricing?.retail_price ?? '')}
              onChange={(e) => setPriceEdits((p) => ({ ...p, retail_price: e.target.value }))}
              className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm tabular-nums" />
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Profit / SMS</div>
            <div className="text-lg font-bold text-emerald-300 tabular-nums">UGX {money(pricing?.profit_per_sms)}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Margin</div>
            <div className="text-lg font-bold text-emerald-300 tabular-nums">{money(pricing?.margin_pct)}%</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-slate-800">
          <div><div className="text-[11px] text-slate-500">Total revenue</div><div className="text-sm font-semibold text-slate-200 tabular-nums">UGX {money(totals?.revenue)}</div></div>
          <div><div className="text-[11px] text-slate-500">Total cost</div><div className="text-sm font-semibold text-slate-200 tabular-nums">UGX {money(totals?.cost)}</div></div>
          <div><div className="text-[11px] text-slate-500">Total profit</div><div className="text-sm font-semibold text-emerald-300 tabular-nums">UGX {money(totals?.profit)}</div></div>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">Africa&apos;s Talking&apos;s actual per-SMS charge varies by network/sender-ID/volume — verify against the live rate on the AT account and correct it here rather than guessing.</p>
      </div>

      {/* Per-school allocation */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-500 border-b border-slate-800 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">School</th>
              <th className="px-3 py-2 text-right">Allocated</th>
              <th className="px-3 py-2 text-right">Used</th>
              <th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2 text-right">Revenue</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {isLoading && <tr><td colSpan={8} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-indigo-400 inline" /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No schools.</td></tr>}
            {rows.map((r: any) => {
              const editing = edits[r.school_id] ?? (r.quota ?? '');
              const dirty = edits[r.school_id] !== undefined && Number(edits[r.school_id]) !== (r.quota ?? 0);
              const over = r.quota != null && r.used > r.quota;
              return (
                <tr key={r.school_id}>
                  <td className="px-3 py-2 text-slate-200">{r.name}</td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min="0" value={editing}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [r.school_id]: e.target.value }))}
                      placeholder="unlimited"
                      className="w-24 px-2 py-1 text-right rounded bg-slate-800 border border-slate-700 text-slate-100 text-xs tabular-nums" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-300">{nf(r.used)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${over ? 'text-rose-400 font-semibold' : 'text-emerald-300'}`}>
                    {r.remaining == null ? '∞' : nf(r.remaining)}{over ? ' (over)' : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{money(r.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{money(r.cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300 font-medium">{money(r.profit)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => save(r.school_id)} disabled={!dirty || saving === r.school_id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs disabled:opacity-40">
                      {saving === r.school_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">Allocation caps how many SMS segments a school may consume; usage is counted from audited SMS_SENT events. Leave blank for unlimited. Enforcement blocks a send once a school exceeds its allocation. Revenue/cost/profit are computed from used segments × retail price / internal cost.</p>
    </div>
  );
}
