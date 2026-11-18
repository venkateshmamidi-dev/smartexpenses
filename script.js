/**
 * ============================================================
 *  SmartSpend – Smart Student Expense Tracker
 *  script.js  |  Vanilla JS, No frameworks
 *  LocalStorage key: 'smartExpenseData'
 * ============================================================
 */

'use strict';

/* ============================================================
   CONSTANTS & CONFIGURATION
   ============================================================ */

const LS_KEY = 'smartExpenseData';

const INCOME_CATEGORIES = [
  'Allowance',
  'Scholarship',
  'Part-time Work',
  'Other Income',
];

const EXPENSE_CATEGORIES = [
  'Food',
  'Transport',
  'Education',
  'Shopping',
  'Entertainment',
  'Bills',
  'Healthcare',
  'Other Expenses',
];

const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Net Banking', 'Other'];

/** Consistent hex colours per category */
const CATEGORY_COLORS = {
  Allowance:        '#6366f1',
  Scholarship:      '#8b5cf6',
  'Part-time Work': '#06b6d4',
  'Other Income':   '#10b981',
  Food:             '#f59e0b',
  Transport:        '#3b82f6',
  Education:        '#8b5cf6',
  Shopping:         '#ec4899',
  Entertainment:    '#f97316',
  Bills:            '#ef4444',
  Healthcare:       '#14b8a6',
  'Other Expenses': '#6b7280',
};

/** Section id → human-readable title */
const SECTION_TITLES = {
  dashboard:         'Dashboard',
  transactions:      'Transactions',
  budget:            'Budget',
  analytics:         'Analytics',
  history:           'Transaction History',
  'data-management': 'Data Management',
};

/* ============================================================
   MODULE-LEVEL STATE
   ============================================================ */

/** Cached data object – always call getData() to access */
let _cache = null;

/** Duplicate-submit guard: timestamp of last successful submit */
let _lastSubmitTime = 0;
let _lastSubmitKey  = '';

/** Current filter state for the Transactions section */
const currentFilters = {
  search:   '',
  type:     '',
  category: '',
  dateFrom: '',
  dateTo:   '',
  sort:     'date-desc',
};

/** Current filter state for the History section */
const historyFilters = {
  search:   '',
  type:     '',
  category: '',
  sort:     'date-desc',
};

/** Pending delete id */
let _pendingDeleteId = null;

/** Pending import JSON data */
let _pendingImportData = null;

/** Chart.js instances – stored to allow .destroy() before re-create */
const charts = {
  dashboard:   null,
  ieAnalytics: null,
  category:    null,
  monthly:     null,
  topCats:     null,
};

/* ============================================================
   1. DATA LAYER
   ============================================================ */

/**
 * generateId – timestamp + 6-char random hex
 * @returns {string}
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns a deep-cloned default data structure.
 * @returns {Object}
 */
function defaultData() {
  return {
    transactions: [],
    budgets: {
      monthly:    0,
      categories: {},
    },
    settings: {
      currency: '₹',
    },
  };
}

/**
 * loadData – read from localStorage, return default if missing/corrupt.
 * Always merges with defaultData so new keys are present on upgrade.
 * @returns {Object}
 */
function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultData();

    const parsed = JSON.parse(raw);

    // Basic structure validation
    if (typeof parsed !== 'object' || parsed === null) return defaultData();

    const def = defaultData();
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : def.transactions,
      budgets: {
        monthly:    (parsed.budgets && typeof parsed.budgets.monthly === 'number')
                      ? parsed.budgets.monthly
                      : def.budgets.monthly,
        categories: (parsed.budgets && typeof parsed.budgets.categories === 'object' && parsed.budgets.categories !== null)
                      ? parsed.budgets.categories
                      : def.budgets.categories,
      },
      settings: {
        currency: (parsed.settings && parsed.settings.currency) ? parsed.settings.currency : def.settings.currency,
      },
    };
  } catch (err) {
    console.warn('SmartSpend: failed to parse localStorage data –', err.message);
    return defaultData();
  }
}

/**
 * saveData – stringify and persist to localStorage.
 * @param {Object} data
 */
function saveData(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('SmartSpend: failed to save data –', err.message);
    showToast('Storage error – could not save data.', 'error');
  }
}

/**
 * getData – returns cached data, loading from localStorage on first call.
 * @returns {Object}
 */
function getData() {
  if (!_cache) _cache = loadData();
  return _cache;
}

/**
 * Invalidate cache and re-load from storage.
 */
function refreshCache() {
  _cache = loadData();
}

/* ============================================================
   2. NAVIGATION
   ============================================================ */

/**
 * showSection – hide all page sections, activate target, update nav.
 * @param {string} sectionId
 */
function showSection(sectionId) {
  // Hide all sections
  document.querySelectorAll('.page-section').forEach((sec) => {
    sec.classList.remove('active');
  });

  // Show target section
  const target = document.getElementById(sectionId);
  if (target) target.classList.add('active');

  // Update nav active state
  document.querySelectorAll('.nav-link').forEach((link) => {
    const isActive = link.dataset.section === sectionId;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  // Update topbar title
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = SECTION_TITLES[sectionId] || sectionId;

  // Close sidebar on mobile
  const sidebar = document.getElementById('sidebar');
  if (sidebar && window.innerWidth < 768) {
    sidebar.classList.remove('open');
    document.getElementById('overlay')?.classList.remove('active');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  // Refresh section-specific data on visibility
  if (sectionId === 'analytics')       updateAnalytics();
  if (sectionId === 'budget')          updateBudgetOverview();
  if (sectionId === 'data-management') updateStorageInfo();
}

/**
 * initNavigation – attach click handlers to all nav items.
 */
function initNavigation() {
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      if (section) showSection(section);
    });
  });

  // "View All" links on dashboard
  document.querySelectorAll('[data-section]').forEach((el) => {
    if (!el.classList.contains('nav-link')) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const section = el.dataset.section;
        if (section) showSection(section);
      });
    }
  });

  // Top-bar "Quick Add" button → go to transactions
  const addBtn = document.getElementById('topbar-add-btn');
  addBtn?.addEventListener('click', () => showSection('transactions'));

  // Sidebar toggle (hamburger)
  const toggleBtn = document.getElementById('sidebar-toggle');
  toggleBtn?.addEventListener('click', toggleSidebar);

  // Sidebar close button (mobile ×)
  document.getElementById('sidebar-close-btn')?.addEventListener('click', () => {
    closeSidebar();
  });

  // Overlay click closes sidebar
  document.getElementById('overlay')?.addEventListener('click', closeSidebar);

  // Set current-month label in sidebar
  const monthLabel = document.getElementById('current-month-label');
  if (monthLabel) {
    const now = new Date();
    monthLabel.textContent = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  // Set topbar date
  const dateDisplay = document.getElementById('topbar-date-display');
  if (dateDisplay) {
    const now = new Date();
    dateDisplay.textContent = now.toLocaleDateString('en-IN', {
      weekday: 'short',
      day:     'numeric',
      month:   'short',
      year:    'numeric',
    });
  }
}

/** toggleSidebar – open/close sidebar on mobile */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const btn     = document.getElementById('sidebar-toggle');

  if (!sidebar) return;

  const isOpen = sidebar.classList.toggle('open');
  overlay?.classList.toggle('active', isOpen);
  btn?.setAttribute('aria-expanded', String(isOpen));
}

/** closeSidebar – force-close sidebar */
function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const btn     = document.getElementById('sidebar-toggle');

  sidebar?.classList.remove('open');
  overlay?.classList.remove('active');
  btn?.setAttribute('aria-expanded', 'false');
}

/* ============================================================
   3. DASHBOARD
   ============================================================ */

/**
 * updateDashboard – orchestrates all dashboard sub-updates.
 */
function updateDashboard() {
  updateSummaryCards();
  renderRecentTransactions();
  renderCategoryBreakdown();
  renderDashboardChart();
}

/**
 * updateSummaryCards – compute and display current-month totals.
 */
function updateSummaryCards() {
  const data            = getData();
  const currentMonth    = getCurrentMonth();
  const monthTxns       = getMonthTransactions(currentMonth);

  const totalIncome   = monthTxns
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = monthTxns
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalBalance      = totalIncome - totalExpenses;
  const monthlyBudget     = data.budgets.monthly || 0;
  const remainingBudget   = monthlyBudget - totalExpenses;

  setTextContent('total-balance',        formatCurrency(totalBalance));
  setTextContent('total-income',         formatCurrency(totalIncome));
  setTextContent('total-expenses',       formatCurrency(totalExpenses));
  setTextContent('monthly-budget-display', formatCurrency(monthlyBudget));
  setTextContent('remaining-budget',     formatCurrency(remainingBudget));

  // Colour cues
  const balanceEl = document.getElementById('total-balance');
  if (balanceEl) {
    balanceEl.classList.toggle('expense-text', totalBalance < 0);
    balanceEl.classList.toggle('income-text',  totalBalance >= 0);
  }

  const remEl = document.getElementById('remaining-budget');
  if (remEl) {
    remEl.classList.toggle('expense-text', remainingBudget < 0);
    remEl.classList.toggle('income-text',  remainingBudget >= 0 || monthlyBudget === 0);
  }

  // Balance trend (compare with previous month)
  const prevMonth     = getPrevMonth(currentMonth);
  const prevMonthTxns = getMonthTransactions(prevMonth);
  const prevIncome    = prevMonthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const prevExpenses  = prevMonthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const prevBalance   = prevIncome - prevExpenses;

  const trendEl = document.getElementById('balance-trend');
  if (trendEl) {
    if (prevBalance === 0) {
      trendEl.textContent = '';
    } else {
      const diff    = totalBalance - prevBalance;
      const pct     = Math.abs((diff / prevBalance) * 100).toFixed(1);
      const arrow   = diff >= 0 ? '▲' : '▼';
      const cls     = diff >= 0 ? 'trend-up' : 'trend-down';
      trendEl.innerHTML = `<span class="${cls}">${arrow} ${pct}% vs last month</span>`;
    }
  }
}

/**
 * renderRecentTransactions – last 5 transactions in dashboard list.
 */
function renderRecentTransactions() {
  const data = getData();
  const list = document.getElementById('recent-transactions-list');
  if (!list) return;

  const sorted = [...data.transactions].sort(
    (a, b) => new Date(b.date + 'T00:00:00') - new Date(a.date + 'T00:00:00')
            || new Date(b.createdAt) - new Date(a.createdAt)
  ).slice(0, 5);

  if (sorted.length === 0) {
    list.innerHTML = `
      <li class="empty-state-inline">
        <i class="fa-solid fa-inbox"></i>
        <span>No transactions yet</span>
      </li>`;
    return;
  }

  list.innerHTML = sorted.map((t) => {
    const color  = categoryColor(t.category);
    const sign   = t.type === 'income' ? '+' : '−';
    const cls    = t.type === 'income' ? 'income-text' : 'expense-text';
    return `
      <li class="recent-txn-item" data-id="${escHtml(t.id)}">
        <span class="recent-txn-dot" style="background:${color}"></span>
        <div class="recent-txn-info">
          <span class="recent-txn-desc">${escHtml(t.description || t.category)}</span>
          <span class="recent-txn-meta">${formatDate(t.date)} · ${escHtml(t.category)}</span>
        </div>
        <span class="recent-txn-amount ${cls}">${sign}${formatCurrency(t.amount)}</span>
      </li>`;
  }).join('');
}

/**
 * renderCategoryBreakdown – category totals with progress bars (current month).
 */
function renderCategoryBreakdown() {
  const list = document.getElementById('category-breakdown-list');
  if (!list) return;

  const currentMonth = getCurrentMonth();
  const monthTxns    = getMonthTransactions(currentMonth).filter((t) => t.type === 'expense');

  if (monthTxns.length === 0) {
    list.innerHTML = `
      <li class="empty-state-inline">
        <i class="fa-solid fa-inbox"></i>
        <span>No expense data</span>
      </li>`;
    return;
  }

  // Aggregate by category
  const catMap = {};
  monthTxns.forEach((t) => {
    catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  });

  const total = Object.values(catMap).reduce((s, v) => s + v, 0);

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  list.innerHTML = sorted.map(([cat, amount]) => {
    const pct   = total > 0 ? Math.round((amount / total) * 100) : 0;
    const color = categoryColor(cat);
    return `
      <li class="cat-breakdown-item">
        <div class="cat-breakdown-top">
          <span class="cat-breakdown-name">
            <span class="cat-dot" style="background:${color}"></span>
            ${escHtml(cat)}
          </span>
          <span class="cat-breakdown-amount">${formatCurrency(amount)}</span>
        </div>
        <div class="progress-wrap" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escHtml(cat)} spending">
          <div class="progress-bar" style="width:${pct}%; background:${color}"></div>
        </div>
        <span class="cat-breakdown-pct">${pct}%</span>
      </li>`;
  }).join('');
}

/**
 * renderDashboardChart – Chart.js bar chart of last 6 months income vs expenses.
 */
function renderDashboardChart() {
  const canvas = document.getElementById('dashboard-chart');
  if (!canvas) return;

  // Destroy previous instance
  if (charts.dashboard) {
    charts.dashboard.destroy();
    charts.dashboard = null;
  }

  const data   = getData();
  const months = getLast6Months();

  const incomeData  = months.map((ym) =>
    getMonthTransactions(ym)
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0)
  );

  const expenseData = months.map((ym) =>
    getMonthTransactions(ym)
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0)
  );

  const labels = months.map((ym) => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });

  charts.dashboard = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label:           'Income',
          data:            incomeData,
          backgroundColor: 'rgba(16, 185, 129, 0.75)',
          borderColor:     'rgba(16, 185, 129, 1)',
          borderWidth:     1,
          borderRadius:    6,
        },
        {
          label:           'Expenses',
          data:            expenseData,
          backgroundColor: 'rgba(239, 68, 68, 0.75)',
          borderColor:     'rgba(239, 68, 68, 1)',
          borderWidth:     1,
          borderRadius:    6,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => formatCurrency(v),
          },
        },
      },
    },
  });
}

/* ============================================================
   4. TRANSACTION FORM & MANAGEMENT
   ============================================================ */

/**
 * initTransactionForm – set up form listeners, default date, populate dropdown.
 */
function initTransactionForm() {
  const form = document.getElementById('transaction-form');
  if (!form) return;

  // Set today's date
  const dateInput = document.getElementById('txn-date');
  if (dateInput) dateInput.value = getTodayISO();

  // Populate category dropdown based on initial type (income)
  updateCategoryDropdown('income');

  // Listen to type radio changes
  document.querySelectorAll('input[name="txn-type"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const val = document.querySelector('input[name="txn-type"]:checked')?.value || 'income';
      // Sync hidden select
      const hiddenSel = document.getElementById('txn-type');
      if (hiddenSel) hiddenSel.value = val;
      updateCategoryDropdown(val);
    });
  });

  // Also handle the hidden select (for any direct manipulation)
  const typeSel = document.getElementById('txn-type');
  typeSel?.addEventListener('change', () => {
    updateCategoryDropdown(typeSel.value);
  });

  // Form submit
  form.addEventListener('submit', handleTransactionSubmit);

  // Reset clears errors and resets category dropdown
  form.addEventListener('reset', () => {
    setTimeout(() => {
      clearFormErrors();
      updateCategoryDropdown('income');
      const dateEl = document.getElementById('txn-date');
      if (dateEl) dateEl.value = getTodayISO();
    }, 0);
  });
}

/**
 * updateCategoryDropdown – populate #txn-category based on type.
 * @param {string} type  'income' | 'expense'
 */
function updateCategoryDropdown(type) {
  const sel = document.getElementById('txn-category');
  if (!sel) return;

  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  sel.innerHTML = `<option value="" disabled selected>Select category…</option>` +
    cats.map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
}

/**
 * handleTransactionSubmit – validate, deduplicate, save, refresh UI.
 * @param {Event} e
 */
function handleTransactionSubmit(e) {
  e.preventDefault();
  clearFormErrors();

  // Gather form data
  const typeRadio = document.querySelector('input[name="txn-type"]:checked');
  const type        = typeRadio ? typeRadio.value : (document.getElementById('txn-type')?.value || 'income');
  const amountRaw   = document.getElementById('txn-amount')?.value.trim() || '';
  const category    = document.getElementById('txn-category')?.value.trim() || '';
  const description = document.getElementById('txn-description')?.value.trim() || '';
  const date        = document.getElementById('txn-date')?.value.trim() || '';
  const payment     = document.getElementById('txn-payment')?.value.trim() || '';

  const formData = { type, amount: amountRaw, category, description, date, paymentMethod: payment };

  // Validate
  const { valid, errors } = validateTransaction(formData);
  if (!valid) {
    displayFormErrors(errors);
    return;
  }

  const amount = parseFloat(amountRaw);

  // Duplicate prevention (same key within 5 seconds)
  const submitKey = `${type}|${amount}|${category}|${description}|${date}`;
  const now       = Date.now();
  if (submitKey === _lastSubmitKey && now - _lastSubmitTime < 5000) {
    showToast('Duplicate submission detected. Please wait a moment.', 'warning');
    return;
  }
  _lastSubmitKey  = submitKey;
  _lastSubmitTime = now;

  // Future date warning
  if (date > getTodayISO()) {
    showToast('Note: You have selected a future date.', 'warning');
  }

  const txn = {
    id:            generateId(),
    type,
    amount,
    category,
    description,
    date,
    paymentMethod: payment,
    createdAt:     new Date().toISOString(),
  };

  addTransaction(txn);

  // Reset form
  document.getElementById('transaction-form')?.reset();
  setTimeout(() => {
    updateCategoryDropdown('income');
    const dateEl = document.getElementById('txn-date');
    if (dateEl) dateEl.value = getTodayISO();
  }, 0);

  showToast(`${type === 'income' ? 'Income' : 'Expense'} added successfully!`, 'success');
}

/**
 * validateTransaction – returns {valid, errors[]}
 * @param {Object} fd  { type, amount, category, description, date }
 * @returns {{ valid: boolean, errors: Array<{field:string, msg:string}> }}
 */
function validateTransaction(fd) {
  const errors = [];

  // Amount
  const amount = parseFloat(fd.amount);
  if (!fd.amount || isNaN(amount) || amount <= 0) {
    errors.push({ field: 'amount', msg: 'Amount must be a positive number.' });
  }

  // Category
  const validCats = fd.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!fd.category || !validCats.includes(fd.category)) {
    errors.push({ field: 'category', msg: 'Please select a valid category.' });
  }

  // Description (optional but min 2 if provided)
  if (fd.description && fd.description.length < 2) {
    errors.push({ field: 'description', msg: 'Description must be at least 2 characters.' });
  }

  // Date
  if (!fd.date) {
    errors.push({ field: 'date', msg: 'Please select a date.' });
  } else {
    const d = new Date(fd.date + 'T00:00:00');
    if (isNaN(d.getTime())) {
      errors.push({ field: 'date', msg: 'Invalid date format.' });
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Display form validation errors */
function displayFormErrors(errors) {
  errors.forEach(({ field, msg }) => {
    const errEl = document.getElementById(`${field}-error`);
    if (errEl) errEl.textContent = msg;

    const inputEl = document.getElementById(`txn-${field}`);
    inputEl?.classList.add('input-error');
  });
}

/** Clear all field-level errors */
function clearFormErrors() {
  document.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
  document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
}

/* ============================================================
   5. TRANSACTION FILTERS
   ============================================================ */

/**
 * initFilters – attach event listeners for filter controls.
 */
function initFilters() {
  // Populate filter category dropdown with ALL categories
  const filterCatSel = document.getElementById('filter-category');
  if (filterCatSel) {
    filterCatSel.innerHTML =
      `<option value="">All</option>` +
      ALL_CATEGORIES.map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }

  document.getElementById('apply-filters-btn')?.addEventListener('click', () => {
    currentFilters.search   = document.getElementById('txn-search')?.value.trim()       || '';
    currentFilters.type     = document.getElementById('filter-type')?.value             || '';
    currentFilters.category = document.getElementById('filter-category')?.value         || '';
    currentFilters.dateFrom = document.getElementById('filter-date-from')?.value        || '';
    currentFilters.dateTo   = document.getElementById('filter-date-to')?.value          || '';
    currentFilters.sort     = document.getElementById('filter-sort')?.value             || 'date-desc';
    renderTransactionsList();
  });

  document.getElementById('clear-filters-btn')?.addEventListener('click', clearFilters);

  // Live search
  document.getElementById('txn-search')?.addEventListener('input', (e) => {
    currentFilters.search = e.target.value.trim();
    renderTransactionsList();
  });

  // Sort live
  document.getElementById('filter-sort')?.addEventListener('change', (e) => {
    currentFilters.sort = e.target.value;
    renderTransactionsList();
  });
}

/**
 * applyFilters – filter + sort transactions array.
 * @param {Array} transactions
 * @returns {Array}
 */
function applyFilters(transactions) {
  let result = [...transactions];

  if (currentFilters.search) {
    const q = currentFilters.search.toLowerCase();
    result   = result.filter(
      (t) =>
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q) ||
        String(t.amount).includes(q)
    );
  }

  if (currentFilters.type)     result = result.filter((t) => t.type     === currentFilters.type);
  if (currentFilters.category) result = result.filter((t) => t.category === currentFilters.category);
  if (currentFilters.dateFrom) result = result.filter((t) => t.date >= currentFilters.dateFrom);
  if (currentFilters.dateTo)   result = result.filter((t) => t.date <= currentFilters.dateTo);

  return sortTransactions(result, currentFilters.sort);
}

/**
 * clearFilters – reset all filter values and re-render.
 */
function clearFilters() {
  currentFilters.search   = '';
  currentFilters.type     = '';
  currentFilters.category = '';
  currentFilters.dateFrom = '';
  currentFilters.dateTo   = '';
  currentFilters.sort     = 'date-desc';

  const ids = ['txn-search', 'filter-type', 'filter-category', 'filter-date-from', 'filter-date-to'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sortEl = document.getElementById('filter-sort');
  if (sortEl) sortEl.value = 'date-desc';

  renderTransactionsList();
}

/**
 * sortTransactions – returns sorted copy.
 * @param {Array}  arr
 * @param {string} sortKey
 * @returns {Array}
 */
function sortTransactions(arr, sortKey) {
  return [...arr].sort((a, b) => {
    switch (sortKey) {
      case 'date-asc':    return a.date.localeCompare(b.date) || new Date(a.createdAt) - new Date(b.createdAt);
      case 'amount-desc': return b.amount - a.amount;
      case 'amount-asc':  return a.amount - b.amount;
      case 'date-desc':
      default:            return b.date.localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt);
    }
  });
}

/* ============================================================
   6. TRANSACTION RENDERING
   ============================================================ */

/**
 * renderTransactionsList – apply current filters and render table body.
 */
function renderTransactionsList() {
  const tbody = document.getElementById('txn-table-body');
  if (!tbody) return;

  const data     = getData();
  const filtered = applyFilters(data.transactions);

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          <div class="empty-state">
            <i class="fa-solid fa-inbox empty-icon"></i>
            <p class="empty-title">No transactions found</p>
            <p class="empty-desc">Try adjusting your filters, or add a new transaction.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((t) => buildTransactionRow(t)).join('');
}

/**
 * buildTransactionRow – returns <tr> HTML string for a transaction.
 * @param {Object} t  transaction
 * @returns {string}
 */
function buildTransactionRow(t) {
  const color  = categoryColor(t.category);
  const sign   = t.type === 'income' ? '+' : '−';
  const amtCls = t.type === 'income' ? 'income-text' : 'expense-text';
  const badge  = t.type === 'income'
    ? `<span class="badge badge-income">Income</span>`
    : `<span class="badge badge-expense">Expense</span>`;

  return `
    <tr data-id="${escHtml(t.id)}">
      <td>${formatDate(t.date)}</td>
      <td>${badge}</td>
      <td>
        <span class="cat-pill" style="border-left: 3px solid ${color}; padding-left: 6px;">
          ${escHtml(t.category)}
        </span>
      </td>
      <td class="desc-cell">${escHtml(t.description || '—')}</td>
      <td>${escHtml(t.paymentMethod || '—')}</td>
      <td class="text-right ${amtCls} amount-cell">${sign}${formatCurrency(t.amount)}</td>
      <td class="text-center">
        <div class="action-btns">
          <button class="btn-icon edit-btn"   data-id="${escHtml(t.id)}" aria-label="Edit transaction" title="Edit">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon delete-btn" data-id="${escHtml(t.id)}" aria-label="Delete transaction" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
}

/* ============================================================
   7. TRANSACTION CRUD
   ============================================================ */

/**
 * addTransaction – add to data, save, updateAll.
 * @param {Object} txnData
 */
function addTransaction(txnData) {
  const data = getData();
  data.transactions.unshift(txnData);
  saveData(data);
  updateAll();
}

/**
 * editTransaction – open edit modal populated with transaction data.
 * @param {string} id
 */
function editTransaction(id) {
  openEditModal(id);
}

/**
 * updateTransaction – find and update transaction by id, save, updateAll.
 * @param {string} id
 * @param {Object} newData
 */
function updateTransaction(id, newData) {
  const data = getData();
  const idx  = data.transactions.findIndex((t) => t.id === id);
  if (idx === -1) {
    showToast('Transaction not found.', 'error');
    return;
  }
  data.transactions[idx] = { ...data.transactions[idx], ...newData };
  saveData(data);
  updateAll();
}

/**
 * deleteTransaction – open confirm modal; actual removal on confirm.
 * @param {string} id
 */
function deleteTransaction(id) {
  openDeleteModal(id);
}

/**
 * updateAll – refresh every dynamic area of the UI.
 */
function updateAll() {
  updateDashboard();
  renderTransactionsList();
  renderHistory();
  updateBudgetOverview();
  // Analytics only if section is visible
  const analyticsSection = document.getElementById('analytics');
  if (analyticsSection?.classList.contains('active')) updateAnalytics();
  updateStorageInfo();
}

/* ============================================================
   8. BUDGET
   ============================================================ */

/**
 * initBudgetForms – attach submit handlers; populate category dropdown.
 */
function initBudgetForms() {
  // Populate category budget select (expense categories only)
  const catSel = document.getElementById('cat-budget-select');
  if (catSel) {
    catSel.innerHTML =
      `<option value="" disabled selected>Select category…</option>` +
      EXPENSE_CATEGORIES.map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }

  // Set default budget month to current month
  const monthSel = document.getElementById('budget-month-select');
  if (monthSel) monthSel.value = getCurrentMonth();

  // Monthly budget form
  document.getElementById('budget-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveBudget();
  });

  // Category budget form
  document.getElementById('cat-budget-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveCategoryBudget();
  });

  // Month change → refresh overview
  monthSel?.addEventListener('change', updateBudgetOverview);
}

/**
 * saveBudget – persist monthly budget value.
 */
function saveBudget() {
  const input = document.getElementById('monthly-budget-input');
  const val   = parseFloat(input?.value || '0');

  if (!val || val <= 0) {
    showToast('Please enter a valid budget amount.', 'error');
    return;
  }

  const data = getData();
  data.budgets.monthly = val;
  saveData(data);
  updateAll();
  showToast('Monthly budget saved!', 'success');
}

/**
 * saveCategoryBudget – persist category spending limit.
 */
function saveCategoryBudget() {
  const catEl = document.getElementById('cat-budget-select');
  const amtEl = document.getElementById('cat-budget-amount');
  const cat   = catEl?.value;
  const amt   = parseFloat(amtEl?.value || '0');

  if (!cat) {
    showToast('Please select a category.', 'error');
    return;
  }
  if (!amt || amt <= 0) {
    showToast('Please enter a valid limit amount.', 'error');
    return;
  }

  const data = getData();
  if (!data.budgets.categories) data.budgets.categories = {};
  data.budgets.categories[cat] = amt;
  saveData(data);
  updateBudgetOverview();
  showToast(`Budget limit for "${cat}" saved!`, 'success');
}

/**
 * getBudgetMonth – returns YYYY-MM from the month selector (or current month).
 * @returns {string}
 */
function getBudgetMonth() {
  const sel = document.getElementById('budget-month-select');
  return (sel && sel.value) ? sel.value : getCurrentMonth();
}

/**
 * updateBudgetOverview – render category budget progress for selected month.
 */
function updateBudgetOverview() {
  const data         = getData();
  const ym           = getBudgetMonth();
  const monthTxns    = getMonthTransactions(ym).filter((t) => t.type === 'expense');
  const totalExpenses = monthTxns.reduce((s, t) => s + t.amount, 0);
  const monthlyBudget = data.budgets.monthly || 0;
  const remaining     = monthlyBudget - totalExpenses;
  const pct           = monthlyBudget > 0 ? Math.min(Math.round((totalExpenses / monthlyBudget) * 100), 100) : 0;

  // Overall stats
  setTextContent('total-budget-used',      formatCurrency(totalExpenses));
  setTextContent('total-budget-remaining', formatCurrency(remaining));

  const progBar  = document.getElementById('total-budget-progress');
  const pctLabel = document.getElementById('total-budget-pct-label');
  const progWrap = progBar?.parentElement;

  if (progBar) progBar.style.width = `${pct}%`;
  if (pctLabel) pctLabel.textContent = `${pct}% used`;
  if (progWrap) {
    progWrap.setAttribute('aria-valuenow', pct);
    // Visual warning
    progBar?.classList.toggle('progress-bar--warning', pct >= 80 && pct < 100);
    progBar?.classList.toggle('progress-bar--danger',  pct >= 100);
    progBar?.classList.remove(...(pct < 80 ? ['progress-bar--warning', 'progress-bar--danger'] : []));
  }

  // Populate monthly budget input
  const budgetInput = document.getElementById('monthly-budget-input');
  if (budgetInput && !budgetInput.value) budgetInput.value = monthlyBudget || '';

  // Category breakdown
  const container = document.getElementById('budget-overview-container');
  if (!container) return;

  const catBudgets = data.budgets.categories || {};
  if (Object.keys(catBudgets).length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-inbox empty-icon"></i>
        <p class="empty-title">No category limits set</p>
        <p class="empty-desc">Use the form to set a spending limit per category.</p>
      </div>`;
    return;
  }

  // Build category spent map
  const catSpent = {};
  monthTxns.forEach((t) => {
    catSpent[t.category] = (catSpent[t.category] || 0) + t.amount;
  });

  container.innerHTML = Object.entries(catBudgets).map(([cat, limit]) => {
    const spent    = catSpent[cat] || 0;
    const rem      = limit - spent;
    const catPct   = limit > 0 ? Math.min(Math.round((spent / limit) * 100), 100) : 0;
    const color    = categoryColor(cat);
    const isOver   = spent > limit;
    const isWarn   = !isOver && catPct >= 80;
    const statusCls = isOver ? 'budget-card--over' : (isWarn ? 'budget-card--warn' : '');

    return `
      <div class="budget-cat-card ${statusCls}">
        <div class="budget-cat-header">
          <span class="budget-cat-name">
            <span class="cat-dot" style="background:${color}"></span>
            ${escHtml(cat)}
          </span>
          ${isOver
            ? `<span class="budget-badge budget-badge--over"><i class="fa-solid fa-triangle-exclamation"></i> Over Budget</span>`
            : (isWarn
              ? `<span class="budget-badge budget-badge--warn"><i class="fa-solid fa-circle-exclamation"></i> Near Limit</span>`
              : '')
          }
        </div>
        <div class="budget-cat-row">
          <span>Spent: <strong class="${isOver ? 'expense-text' : ''}">${formatCurrency(spent)}</strong></span>
          <span>Limit: <strong>${formatCurrency(limit)}</strong></span>
          <span>Remaining: <strong class="${rem < 0 ? 'expense-text' : 'income-text'}">${formatCurrency(rem)}</strong></span>
        </div>
        <div class="progress-wrap" role="progressbar" aria-valuenow="${catPct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar ${isOver ? 'progress-bar--danger' : (isWarn ? 'progress-bar--warning' : '')}"
               style="width:${catPct}%; background:${isOver ? '#ef4444' : (isWarn ? '#f59e0b' : color)}"></div>
        </div>
        <div class="budget-cat-footer">
          <span>${catPct}% used</span>
          <button class="btn-icon delete-btn" data-cat="${escHtml(cat)}" title="Remove limit" aria-label="Remove budget limit for ${escHtml(cat)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`;
  }).join('');

  // Delete category budget
  container.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat  = btn.dataset.cat;
      const data = getData();
      delete data.budgets.categories[cat];
      saveData(data);
      updateBudgetOverview();
      showToast(`Budget limit for "${cat}" removed.`, 'info');
    });
  });
}

/* ============================================================
   9. ANALYTICS
   ============================================================ */

/**
 * updateAnalytics – update all 4 charts and stat cards.
 */
function updateAnalytics() {
  renderIncomeExpenseChart();
  renderCategoryChart();
  renderMonthlyTrendChart();
  renderTopCategoriesChart();

  // Stat cards
  const { category: highCat, amount: highAmt } = getHighestSpendingCategory();
  setTextContent('stat-highest-category', highCat ? `${highCat} (${formatCurrency(highAmt)})` : '—');
  setTextContent('stat-avg-daily', formatCurrency(getAvgDailySpending()));
}

/**
 * renderIncomeExpenseChart – bar chart for current month income vs expenses by week.
 */
function renderIncomeExpenseChart() {
  const canvas = document.getElementById('chart-income-expense');
  if (!canvas) return;

  if (charts.ieAnalytics) { charts.ieAnalytics.destroy(); charts.ieAnalytics = null; }

  const months = getLast6Months();
  const labels = months.map((ym) => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });

  const incomeData  = months.map((ym) =>
    getMonthTransactions(ym).filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  );
  const expenseData = months.map((ym) =>
    getMonthTransactions(ym).filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  );

  charts.ieAnalytics = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label:           'Income',
          data:            incomeData,
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderColor:     '#10b981',
          borderWidth:     1,
          borderRadius:    6,
        },
        {
          label:           'Expenses',
          data:            expenseData,
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderColor:     '#ef4444',
          borderWidth:     1,
          borderRadius:    6,
        },
      ],
    },
    options: chartOptions('Income vs Expenses (Last 6 Months)'),
  });
}

/**
 * renderCategoryChart – doughnut chart of expense categories (current month).
 */
function renderCategoryChart() {
  const canvas = document.getElementById('chart-category');
  if (!canvas) return;

  if (charts.category) { charts.category.destroy(); charts.category = null; }

  const monthTxns = getMonthTransactions(getCurrentMonth()).filter((t) => t.type === 'expense');
  const catMap    = {};
  monthTxns.forEach((t) => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });

  const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    renderEmptyChart(canvas, 'No expense data for this month');
    return;
  }

  charts.category = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels:   entries.map(([c]) => c),
      datasets: [{
        data:            entries.map(([, v]) => v),
        backgroundColor: entries.map(([c]) => categoryColor(c)),
        borderWidth:     2,
        borderColor:     '#1e293b',
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

/**
 * renderMonthlyTrendChart – line chart for last 6 months total spending.
 */
function renderMonthlyTrendChart() {
  const canvas = document.getElementById('chart-monthly');
  if (!canvas) return;

  if (charts.monthly) { charts.monthly.destroy(); charts.monthly = null; }

  const months = getLast6Months();
  const labels = months.map((ym) => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });
  const spendData = months.map((ym) =>
    getMonthTransactions(ym).filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  );

  charts.monthly = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:           'Total Spending',
        data:            spendData,
        borderColor:     '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        borderWidth:     2,
        fill:            true,
        tension:         0.4,
        pointBackgroundColor: '#6366f1',
        pointRadius:     4,
      }],
    },
    options: chartOptions('Monthly Spending Trend'),
  });
}

/**
 * renderTopCategoriesChart – horizontal bar for top 5 spending categories.
 */
function renderTopCategoriesChart() {
  const canvas = document.getElementById('chart-top-categories');
  if (!canvas) return;

  if (charts.topCats) { charts.topCats.destroy(); charts.topCats = null; }

  const data    = getData();
  const catMap  = {};
  data.transactions
    .filter((t) => t.type === 'expense')
    .forEach((t) => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (sorted.length === 0) {
    renderEmptyChart(canvas, 'No expense data yet');
    return;
  }

  charts.topCats = new Chart(canvas, {
    type: 'bar',
    data: {
      labels:   sorted.map(([c]) => c),
      datasets: [{
        label:           'Total Spent',
        data:            sorted.map(([, v]) => v),
        backgroundColor: sorted.map(([c]) => categoryColor(c)),
        borderWidth:     1,
        borderRadius:    6,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive:          true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatCurrency(ctx.parsed.x)}`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: (v) => formatCurrency(v) },
        },
      },
    },
  });
}

/**
 * getHighestSpendingCategory – returns {category, amount} for all-time top expense category.
 * @returns {{ category: string, amount: number }}
 */
function getHighestSpendingCategory() {
  const data   = getData();
  const catMap = {};
  data.transactions
    .filter((t) => t.type === 'expense')
    .forEach((t) => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });

  if (Object.keys(catMap).length === 0) return { category: '', amount: 0 };

  const [category, amount] = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
  return { category, amount };
}

/**
 * getAvgDailySpending – total expenses for current month / unique spending days.
 * @returns {number}
 */
function getAvgDailySpending() {
  const monthTxns = getMonthTransactions(getCurrentMonth()).filter((t) => t.type === 'expense');
  if (monthTxns.length === 0) return 0;

  const total      = monthTxns.reduce((s, t) => s + t.amount, 0);
  const uniqueDays = new Set(monthTxns.map((t) => t.date)).size;
  return uniqueDays > 0 ? total / uniqueDays : 0;
}

/** Shared Chart.js options factory */
function chartOptions(title) {
  return {
    responsive:          true,
    maintainAspectRatio: true,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${formatCurrency(ctx.parsed.y ?? ctx.parsed)}`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { callback: (v) => formatCurrency(v) },
      },
    },
  };
}

/** Render a placeholder "no data" message on a canvas */
function renderEmptyChart(canvas, msg) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle    = '#94a3b8';
  ctx.font         = '14px Inter, sans-serif';
  ctx.textAlign    = 'center';
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2 || 80);
}

/* ============================================================
   10. HISTORY
   ============================================================ */

/**
 * initHistoryFilters – attach event listeners for history filters.
 */
function initHistoryFilters() {
  // Populate category dropdown
  const catSel = document.getElementById('history-filter-category');
  if (catSel) {
    catSel.innerHTML =
      `<option value="">All</option>` +
      ALL_CATEGORIES.map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }

  document.getElementById('history-search')?.addEventListener('input', (e) => {
    historyFilters.search = e.target.value.trim();
    renderHistory();
  });

  document.getElementById('history-filter-type')?.addEventListener('change', (e) => {
    historyFilters.type = e.target.value;
    renderHistory();
  });

  document.getElementById('history-filter-category')?.addEventListener('change', (e) => {
    historyFilters.category = e.target.value;
    renderHistory();
  });

  document.getElementById('history-sort')?.addEventListener('change', (e) => {
    historyFilters.sort = e.target.value;
    renderHistory();
  });
}

/**
 * renderHistory – full history with search/filter/sort.
 */
function renderHistory() {
  const tbody = document.getElementById('history-list');
  if (!tbody) return;

  const data = getData();
  let txns   = [...data.transactions];

  // Apply history filters
  if (historyFilters.search) {
    const q = historyFilters.search.toLowerCase();
    txns    = txns.filter(
      (t) =>
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q) ||
        String(t.amount).includes(q)
    );
  }
  if (historyFilters.type)     txns = txns.filter((t) => t.type     === historyFilters.type);
  if (historyFilters.category) txns = txns.filter((t) => t.category === historyFilters.category);

  txns = sortTransactions(txns, historyFilters.sort);

  // Count badge
  const countEl = document.getElementById('history-count');
  if (countEl) countEl.textContent = `${txns.length} record${txns.length !== 1 ? 's' : ''}`;

  if (txns.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          <div class="empty-state">
            <i class="fa-solid fa-inbox empty-icon"></i>
            <p class="empty-title">No history found</p>
            <p class="empty-desc">Your transaction history will appear here.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = txns.map((t) => buildTransactionRow(t)).join('');
}

/* ============================================================
   11. DATA MANAGEMENT
   ============================================================ */

/**
 * exportJSON – download all data as .json
 */
function exportJSON() {
  const data = getData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  triggerDownload(blob, `smartspend-backup-${getTodayISO()}.json`);
  showToast('JSON exported successfully!', 'success');
}

/**
 * exportCSV – convert transactions to CSV and download.
 */
function exportCSV() {
  const data = getData();

  if (data.transactions.length === 0) {
    showToast('No transactions to export.', 'warning');
    return;
  }

  const headers = ['ID', 'Type', 'Amount', 'Category', 'Description', 'Date', 'Payment Method', 'Created At'];
  const rows    = data.transactions.map((t) => [
    t.id,
    t.type,
    t.amount,
    csvEscape(t.category),
    csvEscape(t.description || ''),
    t.date,
    csvEscape(t.paymentMethod || ''),
    t.createdAt,
  ]);

  const csv  = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `smartspend-transactions-${getTodayISO()}.csv`);
  showToast('CSV exported successfully!', 'success');
}

/** CSV-safe cell: wrap in quotes if contains comma/newline/quote */
function csvEscape(str) {
  const s = String(str);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Programmatically trigger a file download */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * importJSON – read file, validate structure, show confirm modal.
 * @param {File} file
 */
function importJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);

      // Structural validation
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Not an object');
      if (!Array.isArray(parsed.transactions))             throw new Error('Missing transactions array');
      if (typeof parsed.budgets !== 'object')             throw new Error('Missing budgets object');

      // Validate each transaction has required fields
      const requiredFields = ['id', 'type', 'amount', 'category', 'date'];
      const invalid = parsed.transactions.find(
        (t) => !requiredFields.every((f) => f in t)
      );
      if (invalid) throw new Error('Some transactions are missing required fields');

      _pendingImportData = parsed;

      // Show preview in import modal
      const previewEl = document.getElementById('import-preview');
      if (previewEl) {
        previewEl.innerHTML = `
          <div class="import-stats">
            <span><i class="fa-solid fa-right-left"></i> ${parsed.transactions.length} transactions</span>
            <span><i class="fa-solid fa-piggy-bank"></i> ${Object.keys(parsed.budgets?.categories || {}).length} category budgets</span>
          </div>`;
      }

      openModal('import-modal');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
      _pendingImportData = null;
    }
  };
  reader.onerror = () => {
    showToast('Could not read file.', 'error');
  };
  reader.readAsText(file);
}

/**
 * Merge imported data into existing data.
 */
function executeImport() {
  if (!_pendingImportData) return;

  const existing = getData();

  // Merge transactions (avoid duplicates by id)
  const existingIds = new Set(existing.transactions.map((t) => t.id));
  const newTxns     = _pendingImportData.transactions.filter((t) => !existingIds.has(t.id));
  existing.transactions = [...existing.transactions, ...newTxns];

  // Merge category budgets
  if (_pendingImportData.budgets?.categories) {
    existing.budgets.categories = {
      ...existing.budgets.categories,
      ..._pendingImportData.budgets.categories,
    };
  }

  // Merge monthly budget (use imported if existing is 0)
  if (!existing.budgets.monthly && _pendingImportData.budgets?.monthly) {
    existing.budgets.monthly = _pendingImportData.budgets.monthly;
  }

  saveData(existing);
  refreshCache();
  updateAll();
  _pendingImportData = null;

  // Reset file input
  const fileInput = document.getElementById('import-file');
  if (fileInput) fileInput.value = '';
  setTextContent('import-file-name', 'No file chosen');
  const importBtn = document.getElementById('import-btn');
  if (importBtn) importBtn.disabled = true;

  showToast(`Import successful! ${newTxns.length} new transactions added.`, 'success');
}

/**
 * clearAllData – open confirm modal.
 */
function clearAllData() {
  openModal('clear-modal');
  // Clear the confirmation input
  const inp = document.getElementById('clear-confirm-input');
  if (inp) inp.value = '';
  const confirmBtn = document.getElementById('clear-data-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;
}

/** Execute data clear after double-confirmation */
function executeClearData() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch (err) {
    console.error('SmartSpend: failed to clear localStorage –', err);
  }
  _cache = null;
  refreshCache();
  updateAll();
  showToast('All data cleared.', 'info');
}

/**
 * updateStorageInfo – refresh the storage info panel.
 */
function updateStorageInfo() {
  const data = getData();
  setTextContent('storage-txn-count',   data.transactions.length);
  setTextContent('storage-budget-count', Object.keys(data.budgets?.categories || {}).length);

  // Approximate size
  try {
    const raw  = localStorage.getItem(LS_KEY) || '';
    const kb   = (new Blob([raw]).size / 1024).toFixed(2);
    setTextContent('storage-size', `${kb} KB`);
  } catch {
    setTextContent('storage-size', '—');
  }

  const lastTxn = data.transactions.length > 0
    ? [...data.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    : null;

  setTextContent(
    'storage-last-updated',
    lastTxn ? new Date(lastTxn.createdAt).toLocaleString('en-IN') : '—'
  );
}

/** attachDataManagementHandlers – wire up all data management buttons. */
function attachDataManagementHandlers() {
  document.getElementById('export-json-btn')?.addEventListener('click', exportJSON);
  document.getElementById('export-csv-btn')?.addEventListener('click',  exportCSV);
  document.getElementById('clear-data-btn')?.addEventListener('click',  clearAllData);

  // File input
  const fileInput = document.getElementById('import-file');
  fileInput?.addEventListener('change', (e) => {
    const file     = e.target.files?.[0];
    const nameSpan = document.getElementById('import-file-name');
    const importBtn = document.getElementById('import-btn');
    if (file) {
      if (nameSpan)  nameSpan.textContent = file.name;
      if (importBtn) importBtn.disabled   = false;
    } else {
      if (nameSpan)  nameSpan.textContent = 'No file chosen';
      if (importBtn) importBtn.disabled   = true;
    }
  });

  document.getElementById('import-btn')?.addEventListener('click', () => {
    const file = document.getElementById('import-file')?.files?.[0];
    if (file) importJSON(file);
  });

  // Import modal confirm
  document.getElementById('import-confirm-btn')?.addEventListener('click', () => {
    closeModal('import-modal');
    executeImport();
  });
  document.getElementById('import-cancel-btn')?.addEventListener('click', () => closeModal('import-modal'));
  document.getElementById('import-cancel-btn-footer')?.addEventListener('click', () => closeModal('import-modal'));

  // Clear modal confirm
  const clearConfirmInput = document.getElementById('clear-confirm-input');
  clearConfirmInput?.addEventListener('input', (e) => {
    const btn = document.getElementById('clear-data-confirm-btn');
    if (btn) btn.disabled = e.target.value.trim() !== 'DELETE';
  });

  document.getElementById('clear-data-confirm-btn')?.addEventListener('click', () => {
    closeModal('clear-modal');
    executeClearData();
  });
  document.getElementById('clear-cancel-btn')?.addEventListener('click',        () => closeModal('clear-modal'));
  document.getElementById('clear-cancel-btn-footer')?.addEventListener('click', () => closeModal('clear-modal'));
}

/* ============================================================
   12. MODALS
   ============================================================ */

/**
 * openModal – show a modal by id.
 * @param {string} modalId
 */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.hidden = false;
  modal.classList.add('modal-open');
  document.body.style.overflow = 'hidden';

  // Focus first focusable element
  setTimeout(() => {
    const focusable = modal.querySelector('button, input, select, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
  }, 50);
}

/**
 * closeModal – hide a modal by id.
 * @param {string} modalId
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove('modal-open');
  document.body.style.overflow = '';
}

/**
 * openEditModal – populate edit form with existing transaction data.
 * @param {string} id
 */
function openEditModal(id) {
  const data = getData();
  const txn  = data.transactions.find((t) => t.id === id);
  if (!txn) { showToast('Transaction not found.', 'error'); return; }

  // Populate fields
  setVal('edit-txn-id',          txn.id);
  setVal('edit-txn-type',        txn.type);
  setVal('edit-txn-amount',      txn.amount);
  setVal('edit-txn-description', txn.description || '');
  setVal('edit-txn-date',        txn.date);
  setVal('edit-txn-payment',     txn.paymentMethod || '');

  // Populate category dropdown based on type
  const catSel = document.getElementById('edit-txn-category');
  if (catSel) {
    const cats = txn.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    catSel.innerHTML =
      `<option value="" disabled>Select category…</option>` +
      cats.map((c) => `<option value="${escHtml(c)}" ${c === txn.category ? 'selected' : ''}>${escHtml(c)}</option>`).join('');
  }

  // Update category on type change inside edit modal
  const editTypeSel = document.getElementById('edit-txn-type');
  editTypeSel?.removeEventListener('change', onEditTypeChange);
  editTypeSel?.addEventListener('change', onEditTypeChange);

  openModal('edit-modal');
}

function onEditTypeChange() {
  const type   = document.getElementById('edit-txn-type')?.value || 'expense';
  const catSel = document.getElementById('edit-txn-category');
  if (!catSel) return;
  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  catSel.innerHTML =
    `<option value="" disabled selected>Select category…</option>` +
    cats.map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
}

/** closeEditModal */
function closeEditModal() {
  closeModal('edit-modal');
}

/**
 * openDeleteModal – store pending delete id, show preview, open modal.
 * @param {string} id
 */
function openDeleteModal(id) {
  _pendingDeleteId = id;

  const data = getData();
  const txn  = data.transactions.find((t) => t.id === id);
  const preview = document.getElementById('delete-txn-preview');

  if (preview && txn) {
    const sign = txn.type === 'income' ? '+' : '−';
    const cls  = txn.type === 'income' ? 'income-text' : 'expense-text';
    preview.innerHTML = `
      <div class="delete-preview-row">
        <span>${formatDate(txn.date)}</span>
        <span>${escHtml(txn.category)}</span>
        <span>${escHtml(txn.description || '—')}</span>
        <span class="${cls}">${sign}${formatCurrency(txn.amount)}</span>
      </div>`;
  }

  openModal('delete-modal');
}

/** closeDeleteModal */
function closeDeleteModal() {
  _pendingDeleteId = null;
  closeModal('delete-modal');
}

/**
 * handleEditSave – validate edit form and save.
 */
function handleEditSave() {
  const id          = document.getElementById('edit-txn-id')?.value;
  const type        = document.getElementById('edit-txn-type')?.value.trim() || '';
  const amountRaw   = document.getElementById('edit-txn-amount')?.value.trim() || '';
  const category    = document.getElementById('edit-txn-category')?.value.trim() || '';
  const description = document.getElementById('edit-txn-description')?.value.trim() || '';
  const date        = document.getElementById('edit-txn-date')?.value.trim() || '';
  const payment     = document.getElementById('edit-txn-payment')?.value.trim() || '';

  const { valid, errors } = validateTransaction({ type, amount: amountRaw, category, description, date });
  if (!valid) {
    showToast(errors.map((e) => e.msg).join(' '), 'error');
    return;
  }

  if (date > getTodayISO()) {
    showToast('Note: Future date selected.', 'warning');
  }

  updateTransaction(id, {
    type,
    amount:        parseFloat(amountRaw),
    category,
    description,
    date,
    paymentMethod: payment,
  });

  closeEditModal();
  showToast('Transaction updated!', 'success');
}

/**
 * handleDeleteConfirm – remove transaction and close modal.
 */
function handleDeleteConfirm() {
  if (!_pendingDeleteId) return;

  const id   = _pendingDeleteId;
  const data = getData();
  const idx  = data.transactions.findIndex((t) => t.id === id);

  if (idx === -1) {
    showToast('Transaction not found.', 'error');
    closeDeleteModal();
    return;
  }

  data.transactions.splice(idx, 1);
  saveData(data);
  closeDeleteModal();
  updateAll();
  showToast('Transaction deleted.', 'info');
}

/**
 * attachModalHandlers – wire up all modal open/close/save/delete buttons.
 */
function attachModalHandlers() {
  // Edit modal
  document.getElementById('edit-cancel-btn')?.addEventListener('click',        closeEditModal);
  document.getElementById('edit-cancel-btn-footer')?.addEventListener('click', closeEditModal);
  document.getElementById('edit-save-btn')?.addEventListener('click',          handleEditSave);
  document.getElementById('edit-form')?.addEventListener('submit', (e) => { e.preventDefault(); handleEditSave(); });

  // Delete modal
  document.getElementById('delete-cancel-btn')?.addEventListener('click',        closeDeleteModal);
  document.getElementById('delete-cancel-btn-footer')?.addEventListener('click', closeDeleteModal);
  document.getElementById('delete-confirm-btn')?.addEventListener('click',       handleDeleteConfirm);

  // Close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        // Find the modal id and close it
        closeModal(backdrop.id);
        if (backdrop.id === 'delete-modal') _pendingDeleteId = null;
      }
    });
  });

  // Global keydown: Escape closes any open modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop:not([hidden])').forEach((modal) => {
        closeModal(modal.id);
      });
      _pendingDeleteId   = null;
      _pendingImportData = null;
    }
  });

  // Delegate edit/delete button clicks from transaction tables
  document.addEventListener('click', (e) => {
    const editBtn   = e.target.closest('.edit-btn[data-id]');
    const deleteBtn = e.target.closest('.delete-btn[data-id]');

    if (editBtn)   editTransaction(editBtn.dataset.id);
    if (deleteBtn) deleteTransaction(deleteBtn.dataset.id);
  });
}

/* ============================================================
   13. TOAST NOTIFICATIONS
   ============================================================ */

/**
 * showToast – display a notification toast.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration  ms (default 3500)
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `
    <i class="fa-solid ${icons[type] || icons.info} toast-icon"></i>
    <span class="toast-message">${escHtml(message)}</span>
    <button class="toast-close" aria-label="Close notification">
      <i class="fa-solid fa-xmark"></i>
    </button>`;

  // Manual close
  toast.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(toast));

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  // Auto dismiss
  const timer = setTimeout(() => dismissToast(toast), duration);
  toast._timer = timer;
}

function dismissToast(toast) {
  clearTimeout(toast._timer);
  toast.classList.remove('toast-visible');
  toast.classList.add('toast-hiding');
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  // Fallback remove
  setTimeout(() => toast.remove(), 600);
}

/* ============================================================
   14. UTILITIES
   ============================================================ */

/**
 * formatCurrency – format a number with ₹ prefix and Indian locale.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  const data     = getData();
  const symbol   = data.settings?.currency || '₹';
  const absAmount = Math.abs(amount || 0);
  const formatted = absAmount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

/**
 * formatDate – "18 Nov 2026" from "2026-11-18".
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * getCurrentMonth – returns "YYYY-MM" for today.
 * @returns {string}
 */
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * getPrevMonth – returns YYYY-MM for the month before given.
 * @param {string} ym
 * @returns {string}
 */
function getPrevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * getLast6Months – returns array of YYYY-MM strings, oldest first.
 * @returns {string[]}
 */
function getLast6Months() {
  const months = [];
  const now    = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * getMonthTransactions – filter transactions for a given YYYY-MM.
 * @param {string} yearMonth
 * @returns {Array}
 */
function getMonthTransactions(yearMonth) {
  const data = getData();
  return data.transactions.filter((t) => t.date && t.date.startsWith(yearMonth));
}

/**
 * categoryColor – consistent hex color per category.
 * @param {string} category
 * @returns {string}
 */
function categoryColor(category) {
  return CATEGORY_COLORS[category] || '#94a3b8';
}

/**
 * getTodayISO – returns today as "YYYY-MM-DD".
 * @returns {string}
 */
function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * escHtml – escape HTML special characters for safe DOM insertion.
 * @param {*} str
 * @returns {string}
 */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * setTextContent – safely set textContent on an element by id.
 * @param {string} id
 * @param {*}      value
 */
function setTextContent(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value ?? '');
}

/**
 * setVal – safely set .value on an input/select by id.
 * @param {string} id
 * @param {*}      value
 */
function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = String(value ?? '');
}

/* ============================================================
   15. INITIALIZATION
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Hide loading overlay
  const loadingOverlay = document.getElementById('loading-overlay');

  // Load data into cache
  getData();

  // Navigation
  initNavigation();

  // Forms & filters
  initTransactionForm();
  initFilters();
  initHistoryFilters();
  initBudgetForms();

  // Modal handlers
  attachModalHandlers();

  // Data management
  attachDataManagementHandlers();

  // Set today's date as default in all date inputs
  const today = getTodayISO();
  document.querySelectorAll('input[type="date"]').forEach((el) => {
    if (!el.value) el.value = today;
  });

  // Set current month in budget month selector
  const budgetMonth = document.getElementById('budget-month-select');
  if (budgetMonth) budgetMonth.value = getCurrentMonth();

  // Initial render of all sections
  updateDashboard();
  renderTransactionsList();
  renderHistory();
  updateBudgetOverview();
  updateAnalytics();
  updateStorageInfo();

  // Hide loading overlay after init
  if (loadingOverlay) {
    setTimeout(() => {
      loadingOverlay.style.opacity = '0';
      loadingOverlay.style.transition = 'opacity 0.4s';
      setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);
    }, 300);
  }

  console.log('%cSmartSpend Initialized ✓', 'color:#10b981; font-weight:bold; font-size:14px;');
});
