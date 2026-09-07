import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/db';

import { getSessionSchoolId } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { checkModule } from '@/lib/auth/requireModule';
import { errorResponse } from '@/lib/apiError';
// GET /api/finance/reports/income-statement
// Get income statement report
export async function GET(req: NextRequest) {
  let connection;
  
  try {
    // Enforce multi-tenant isolation: derive school_id from session
    const session = await getSessionSchoolId(req);
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    // Financial statements have their own permission, but `finance.view` is the
    // legacy module-wide code that existing roles actually hold. Requiring ONLY
    // the granular code 403s every current user, because expandPermissionChain
    // maps 'finance.reports.view' to
    //   [finance.reports.view, finance.reports.*, finance.*, *]
    // which does not include the legacy 'finance.view'.
    //
    // So accept EITHER: schools can adopt the finer permission when they choose
    // without losing access today. Drop the fallback once `finance.reports.view`
    // has been granted everywhere.
    try {
      await requirePermission(session.userId, session.schoolId, 'finance.reports.view', session.isSuperAdmin);
    } catch {
      await requirePermission(session.userId, session.schoolId, 'finance.view', session.isSuperAdmin);
    }
    const schoolId = session.schoolId;

    const { searchParams } = new URL(req.url);
    // school_id derived from session below
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const academicYear = searchParams.get('academic_year');
    
    connection = await getConnection();
    
    // Get income categories
    const [incomeCategories] = await connection.execute(`
      SELECT id, name, color, icon
      FROM finance_categories 
      WHERE (school_id = ? OR school_id IS NULL) 
        AND category_type = 'income' 
        AND is_active = 1
      ORDER BY name
    `, [schoolId]);
    
    // Get expense categories
    const [expenseCategories] = await connection.execute(`
      SELECT id, name, color, icon
      FROM finance_categories 
      WHERE (school_id = ? OR school_id IS NULL) 
        AND category_type = 'expense' 
        AND is_active = 1
      ORDER BY name
    `, [schoolId]);
    
    // Get income transactions
    let incomeSql = `
      SELECT 
        fc.id as category_id,
        fc.name as category_name,
        COALESCE(SUM(l.amount), 0) as total_amount,
        COUNT(l.id) as transaction_count
      FROM finance_categories fc
      LEFT JOIN ledger l ON fc.id = l.category_id
        -- ledger has NO status / deleted_at / transaction_date columns; the
        -- date is created_at. Referencing them threw "Unknown column" and 500'd
        -- this route on every request since it was written.
        AND l.school_id = ?          -- global categories must not pull in
                                     -- other schools' ledger rows
        ${startDate ? 'AND DATE(l.created_at) >= ?' : ''}
        ${endDate ? 'AND DATE(l.created_at) <= ?' : ''}
      WHERE fc.category_type = 'income'
        AND (fc.school_id = ? OR fc.school_id IS NULL)
      GROUP BY fc.id, fc.name
      ORDER BY total_amount DESC
    `;
    
    const incomeParams: any[] = [schoolId];   // join scope
    if (startDate) incomeParams.push(startDate);
    if (endDate) incomeParams.push(endDate);
    incomeParams.push(schoolId);              // category scope
    
    const [incomeTransactions] = await connection.execute(incomeSql, incomeParams);
    
    // Get expense transactions
    let expenseSql = `
      SELECT 
        fc.id as category_id,
        fc.name as category_name,
        COALESCE(SUM(src.amount), 0) as total_amount,
        COUNT(src.amount) as transaction_count
      FROM finance_categories fc
      -- Expenses have TWO sources, same as income: manually categorised ledger
      -- rows AND the expenditures workflow (add/approve/reject). Previously
      -- only ledger counted, so recording an expenditure never reduced net
      -- income — it only ever showed up as an "accounts payable" liability on
      -- the balance sheet while status = 'pending', then vanished entirely once
      -- approved/paid. Cancelled expenditures never happened, so they're excluded.
      LEFT JOIN (
        SELECT category_id, amount FROM ledger
         WHERE school_id = ?
           ${startDate ? 'AND DATE(created_at) >= ?' : ''}
           ${endDate ? 'AND DATE(created_at) <= ?' : ''}
        UNION ALL
        SELECT category_id, amount FROM expenditures
         WHERE school_id = ? AND status <> 'cancelled' AND (deleted_at IS NULL OR deleted_at = '')
           ${startDate ? 'AND expense_date >= ?' : ''}
           ${endDate ? 'AND expense_date <= ?' : ''}
      ) src ON fc.id = src.category_id
      WHERE fc.category_type = 'expense'
        AND (fc.school_id = ? OR fc.school_id IS NULL)
      GROUP BY fc.id, fc.name
      ORDER BY total_amount DESC
    `;
    
    const expenseParams: any[] = [schoolId];  // ledger join scope
    if (startDate) expenseParams.push(startDate);
    if (endDate) expenseParams.push(endDate);
    expenseParams.push(schoolId);             // expenditures join scope
    if (startDate) expenseParams.push(startDate);
    if (endDate) expenseParams.push(endDate);
    expenseParams.push(schoolId);             // category scope
    
    const [expenseTransactions] = await connection.execute(expenseSql, expenseParams);
    
    // ── Fee collections ──────────────────────────────────────────────────────
    // SECURITY (2026-08): this query previously had NO school_id filter, so one
    // school's income statement summed EVERY school's fee payments. It also read
    // the retired `fee_payments` table (its own route returns 410), so for any
    // school on the canonical path it reported zero regardless.
    //
    // Now reads finance_payments — written by the canonical recordPayment path
    // in src/lib/services/FinanceLedger.ts — and is school-scoped.
    const [feeSummary] = await connection.execute(`
      SELECT
        COALESCE(SUM(fp.amount), 0) as total_collected,
        COUNT(fp.id) as total_transactions,
        COALESCE(SUM(CASE WHEN fp.method = 'cash' THEN fp.amount ELSE 0 END), 0) as cash_collected,
        COALESCE(SUM(CASE WHEN fp.method = 'mpesa' THEN fp.amount ELSE 0 END), 0) as mpesa_collected,
        COALESCE(SUM(CASE WHEN fp.method = 'bank_transfer' THEN fp.amount ELSE 0 END), 0) as bank_collected,
        COALESCE(SUM(CASE WHEN fp.method NOT IN ('cash','mpesa','bank_transfer') THEN fp.amount ELSE 0 END), 0) as other_collected
      FROM finance_payments fp
      WHERE fp.school_id = ?
        AND DATE(fp.created_at) BETWEEN ? AND ?
    `, [schoolId, startDate || '2020-01-01', endDate || new Date().toISOString().split('T')[0]]);

    // ── Totals ───────────────────────────────────────────────────────────────
    // Revenue has TWO sources and both must count, or tuition — the largest
    // income a school has — is missing from net income entirely:
    //   1. general ledger income categories (`ledger`, manually categorised)
    //   2. student fee collections (`finance_payments`, the canonical path)
    const ledgerIncome = (incomeTransactions as any[]).reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);
    const totalExpenses = (expenseTransactions as any[]).reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);
    const feeIncome = parseFloat((feeSummary as any[])[0]?.total_collected || 0);
    const totalIncome = ledgerIncome + feeIncome;
    const netIncome = totalIncome - totalExpenses;

    // Get expenditure summary
    const [expenditureSummary] = await connection.execute(`
      SELECT 
        COALESCE(SUM(e.amount), 0) as total_expenditure,
        COUNT(*) as total_transactions,
        COALESCE(SUM(CASE WHEN e.status = 'approved' THEN e.amount ELSE 0 END), 0) as approved_expenditure
      FROM expenditures e
      WHERE e.school_id = ? AND (e.deleted_at IS NULL OR e.deleted_at = '')
        AND e.expense_date BETWEEN ? AND ?
    `, [schoolId, startDate || '2020-01-01', endDate || new Date().toISOString().split('T')[0]]);
    
    return NextResponse.json({
      success: true,
      data: {
        report_period: {
          start_date: startDate,
          end_date: endDate,
          academic_year: academicYear
        },
        income: {
          categories: incomeCategories,
          transactions: incomeTransactions,
          total: totalIncome,
          // Split so the UI can show WHERE revenue came from. Fee collections
          // are usually the overwhelming majority for a school.
          ledger_income: ledgerIncome,
          fee_income: feeIncome
        },
        expenses: {
          categories: expenseCategories,
          transactions: expenseTransactions,
          total: totalExpenses
        },
        summary: {
          total_income: totalIncome,
          ledger_income: ledgerIncome,
          fee_income: feeIncome,
          total_expenses: totalExpenses,
          net_income: netIncome,
          profit_margin: totalIncome > 0 ? ((netIncome / totalIncome) * 100).toFixed(2) : 0
        },
        fee_collections: feeSummary[0] || {},
        expenditures: expenditureSummary[0] || {}
      }
    });
    
  } catch (error: any) {
    console.error('Income statement error:', error);
    return errorResponse(error, 'Failed to generate income statement');
  } finally {
    if (connection) await connection.end();
  }
}
