"use client";
import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Plus, Search, Edit, Trash2, DollarSign, TrendingUp, CheckCircle, Clock, XCircle } from 'lucide-react';
import { showToast, confirmAction } from '@/lib/toast';
import { apiFetch } from '@/lib/apiClient';
import NewBadge from '@/components/ui/NewBadge';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useCurrency } from '@/hooks/useCurrency';

interface Expenditure {
  id: number;
  category_id: number;
  category_name: string;
  wallet_id: number;
  wallet_name: string;
  amount: number;
  description: string;
  vendor_name: string;
  vendor_contact: string;
  invoice_number: string;
  expense_date: string;
  status: string;
  approved_by: number;
  approved_at: string;
  created_at: string;
}

export default function ExpendituresPage() {
  const { t } = useI18n();
  const { format, code } = useCurrency();
  // Supports a deep link from the balance sheet's "Amounts payable" line
  // (?status=pending) so a pending expenditure isn't a dead end there.
  const initialStatus = useSearchParams().get('status') || '';
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Expenditure | null>(null);
  const [formData, setFormData] = useState({
    category_id: '', amount: '', description: '', vendor_name: '', vendor_contact: '', invoice_number: '', expense_date: ''
  });
  const [expenditures, setExpenditures] = useState<{ data: Expenditure[], summary: any } | null>(null);

  // Expense categories. Both category dropdowns on this page were hardcoded
  // to a single placeholder option and never fetched anything, so there was
  // no selectable category and every expense failed on a required
  // category_id. finance_categories is empty for every school, so offering
  // the list is not enough on its own — a school has to be able to create the
  // first one from here, which is what the add button below is for.
  const [categories, setCategories] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catBusy, setCatBusy] = useState(false);

  const loadCategories = async () => {
    try {
      const res = await fetch('/api/finance/categories?type=expense', { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      const list = Array.isArray(j) ? j : (j?.data ?? j?.categories ?? []);
      setCategories(Array.isArray(list) ? list : []);
    } catch { setCategories([]); }
  };
  React.useEffect(() => { loadCategories(); }, []);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) return;
    setCatBusy(true);
    try {
      await apiFetch('/api/finance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'expense', name }),
        successMessage: `Category "${name}" added`,
      });
      setNewCatName('');
      setShowCatModal(false);
      await loadCategories();
    } catch { /* apiFetch already surfaced the error */ }
    finally { setCatBusy(false); }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const url = `/api/finance/expenditures?${categoryFilter ? `category_id=${categoryFilter}` : ''}${statusFilter ? `&status=${statusFilter}` : ''}${searchQuery ? `&search=${searchQuery}` : ''}`;
      const response = await apiFetch<{ data: Expenditure[], summary: any }>(url, { silent: true });
      setExpenditures(response);
    } catch (error) {
      showToast('error', 'Failed to load expenses');
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => { loadData(); }, [categoryFilter, statusFilter]);

  const entries = expenditures?.data || [];
  const summary = expenditures?.summary || {};

  const emptyForm = { category_id: '', amount: '', description: '', vendor_name: '', vendor_contact: '', invoice_number: '', expense_date: '' };

  const openAddModal = () => {
    setEditingItem(null);
    setFormData(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (item: Expenditure) => {
    setEditingItem(item);
    setFormData({
      category_id: String(item.category_id ?? ''),
      amount: String(item.amount ?? ''),
      description: item.description || '',
      vendor_name: item.vendor_name || '',
      vendor_contact: item.vendor_contact || '',
      invoice_number: item.invoice_number || '',
      expense_date: item.expense_date ? String(item.expense_date).slice(0, 10) : '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData(emptyForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await apiFetch('/api/finance/expenditures', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingItem.id, ...formData, amount: parseFloat(formData.amount) }),
          successMessage: 'Expense updated successfully',
        });
      } else {
        await apiFetch('/api/finance/expenditures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, amount: parseFloat(formData.amount) }),
          successMessage: 'Expense added successfully',
        });
      }
      closeModal();
      loadData();
    } catch (error) {
      // apiFetch already showed error toast
    }
  };

  const handleDelete = async (id: number) => {
    if (!await confirmAction('Delete expense?', 'This action cannot be undone.', 'Delete')) return;
    try {
      await apiFetch(`/api/finance/expenditures?id=${id}`, {
        method: 'DELETE',
        successMessage: 'Expense deleted',
      });
      loadData();
    } catch (error) {
      // apiFetch already showed error toast
    }
  };

  const handleApprove = async (id: number) => {
    if (!await confirmAction('Approve this expense?', 'This confirms the spending is authorized.', 'Approve')) return;
    try {
      await apiFetch('/api/finance/expenditures', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'approved' }),
        successMessage: 'Expense approved',
      });
      loadData();
    } catch (error) {
      // apiFetch already showed error toast
    }
  };

  const handleReject = async (id: number) => {
    if (!await confirmAction('Reject this expense?', 'This marks the expense as cancelled.', 'Reject')) return;
    try {
      await apiFetch('/api/finance/expenditures', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'cancelled' }),
        successMessage: 'Expense rejected',
      });
      loadData();
    } catch (error) {
      // apiFetch already showed error toast
    }
  };

  // Defensive: compare case-insensitively — a school's data can predate the
  // ENUM constraint (older imports) and store 'Pending'/'PENDING' instead.
  const getStatusColor = (status: string) => {
    switch ((status || '').toLowerCase()) {
      case 'approved': return 'text-green-600 bg-green-100';
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'paid': return 'text-blue-600 bg-blue-100';
      case 'cancelled': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-900">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">💰 {t('finance.expenses')}</h1>
              <NewBadge size="sm" animated />
            </div>
            <p className="text-gray-600 dark:text-gray-400">{entries.length} transactions • {format(Number(summary.total_amount || 0))} total</p>
          </div>
          <button onClick={() => setShowCatModal(true)} className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <Plus className="w-4 h-4" />Category
          </button>
          <button onClick={openAddModal} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
            <Plus className="w-4 h-4" />Add Expense
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Expenses</p><p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{format(Number(summary.total_amount || 0))}</p></div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center"><DollarSign className="w-6 h-6 text-white" /></div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved</p><p className="text-2xl font-bold text-green-600 mt-1">{format(Number(summary.approved_amount || 0))}</p></div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center"><CheckCircle className="w-6 h-6 text-white" /></div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending</p><p className="text-2xl font-bold text-yellow-600 mt-1">{format(Number(summary.pending_amount || 0))}</p></div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center"><Clock className="w-6 h-6 text-white" /></div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-600 dark:text-gray-400">Transactions</p><p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{summary.total_count || 0}</p></div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center"><TrendingUp className="w-6 h-6 text-white" /></div>
            </div>
          </motion.div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg mb-8 p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg" />
            </div>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg"><option value="">All Status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="paid">Paid</option></select>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {isLoading ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div><p className="text-gray-500">Loading...</p></td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center"><DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" /><p className="text-gray-500">No expenses found</p></td></tr>
              ) : entries.map((item, index) => (
                <motion.tr key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 20) * 0.02 }} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">{item.expense_date}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">{item.category_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">{item.description}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{item.vendor_name || '-'}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white text-right">{format(Number(item.amount))}</td>
                  <td className="px-6 py-4 text-center"><span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}>{item.status}</span></td>
                  <td className="px-6 py-4"><div className="flex items-center justify-center gap-2">
                    {(item.status || '').toLowerCase() === 'pending' && (
                      <>
                        <button onClick={() => handleApprove(item.id)} className="p-2 rounded text-green-600 hover:bg-green-50" title="Approve"><CheckCircle className="w-4 h-4" /></button>
                        <button onClick={() => handleReject(item.id)} className="p-2 rounded text-orange-600 hover:bg-orange-50" title="Reject"><XCircle className="w-4 h-4" /></button>
                      </>
                    )}
                    <button onClick={() => openEditModal(item)} className="p-2 rounded text-blue-600 hover:bg-blue-50" title="Edit"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(item.id)} className="p-2 rounded text-red-600 hover:bg-red-50" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


      {/* Add expense category — reachable from the expense form AND on its own,

           because the first category has to exist before any expense can be

           saved, and a school should not have to open a form it cannot submit

           in order to find the way to create one. */}

      {showCatModal && (

        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setShowCatModal(false)}>

          <form onSubmit={handleAddCategory} onClick={e => e.stopPropagation()}

            className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-5">

            <h2 className="font-bold text-gray-900 dark:text-white mb-1">New expense category</h2>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Categories group spending — e.g. Salaries, Utilities, Transport, Maintenance.</p>

            <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)}

              placeholder="Category name" maxLength={100}

              className="w-full mb-3 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white" />

            <div className="flex gap-2">

              <button type="button" onClick={() => setShowCatModal(false)}

                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300">Cancel</button>

              <button type="submit" disabled={catBusy || !newCatName.trim()}

                className="flex-1 rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-semibold disabled:opacity-50">

                {catBusy ? 'Saving…' : 'Add category'}

              </button>

            </div>

          </form>

        </div>

      )}


      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">{editingItem ? 'Edit Expense' : 'Add Expense'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">Category</label>
                  <button type="button" onClick={() => setShowCatModal(true)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">+ New category</button>
                </div>
                <select required value={formData.category_id} onChange={(e) => setFormData({ ...formData, category_id: e.target.value })} className="w-full px-4 py-2 border rounded-lg">
                  <option value="">Select Category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {categories.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    No expense categories yet — add one first, or the expense cannot be saved.
                  </p>
                )}
              </div>
              <div><label className="block text-sm font-medium mb-1">Amount ({code})</label><input type="number" required value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="w-full px-4 py-2 border rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">Description</label><textarea required value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-2 border rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">Vendor Name</label><input type="text" value={formData.vendor_name} onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })} className="w-full px-4 py-2 border rounded-lg" /></div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={closeModal} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">{editingItem ? 'Save Changes' : 'Add'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
