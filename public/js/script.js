import { db, auth } from './firebase-init.js';
import { collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, query, where, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";


const transactionsCol = collection(db, 'transacoes');

let currentUser = null;
let unsubscribeSnapshot = null;
let pendingPhotoBase64 = null;
let currentGoalForDeposit = null;
let currentBudgetForEdit = null;
let transactions = [];
let creditCards = [];
let budgets = [];
let goals = [];
let debts = [];
let recurringRules = [];
let investments = [];
let filteredTransactions = [];
let editingId = null;
let myLineChart = null;
let myPieChart = null;
let isFirstLoad = true;

// Definições de Datas Iniciais
const initDate = new Date();
let currentStartDate = new Date(initDate.getFullYear(), initDate.getMonth(), 1).toISOString().split('T')[0];
let currentEndDate = new Date(initDate.getFullYear(), initDate.getMonth() + 1, 0).toISOString().split('T')[0];

let selectedTransactionIds = new Set();
let searchQuery = "";
let isPrivacyMode = false;
let accountBeingEdited = null;
let currentAccountBalance = 0;
const oneSignalAppId = '309c8689-b4b6-44ad-a708-36dbbc842cfe';
let oneSignalInitialized = false;
let oneSignalUserId = null;
let oneSignalPlugin = null;

// Categorias base e dinâmicas
let customCategories = { income: [], expense: [] };
const baseCategories = {
    income: ["Vendas / Receitas", "Prestação de Serviços", "Salários / Pró-labore", "Rendimentos", "Abreu Treinamentos", "Bônus", "Outros"],
    expense: ["Luz", "Água", "Internet", "Bicicleta Elétrica", "Compras Online", "Cartão de Credito", "Farmácia", "Mercado", "Restaurante", "Alimentação", "Pets", "Pessoal", "Cursos", "IPVA", "IPTU", "Seguro", "Diversos", "Gasolina", "Manutenção Carro", "Telefone", "Pensão Alimentícia", "Outros"]
};

// ================= VALIDAÇÃO DE FORMULÁRIO FRONT-END =================
window.validateForm = function (formId) {
    const form = document.getElementById(formId);
    if (!form) return true;
    let valid = true;
    form.querySelectorAll('input[required], select[required]').forEach(input => {
        if (!input.value || !input.value.toString().trim() || !input.checkValidity()) {
            input.classList.add('input-error');
            valid = false;
        } else {
            input.classList.remove('input-error');
        }
    });
    if (!valid) window.showToast("Preencha todos os campos obrigatórios corretamente.", "error");
    return valid;
};

window.toggleTransferFields = function () {
    const selectedType = document.querySelector('input[name="type"]:checked')?.value || 'income';
    const isTransfer = selectedType === 'transfer';
    const transferSection = document.getElementById('transferSection');
    const categoryGroup = document.getElementById('categoryGroup');
    const categoryInput = document.getElementById('categoryInput');
    const transferFrom = document.getElementById('transferFromAccount');
    const transferTo = document.getElementById('transferToAccount');

    if (transferSection) transferSection.style.display = isTransfer ? 'block' : 'none';
    if (categoryGroup) categoryGroup.style.display = isTransfer ? 'none' : 'block';
    if (categoryInput) {
        categoryInput.required = !isTransfer;
        if (isTransfer) categoryInput.value = 'Transferência';
    }
    if (transferFrom) transferFrom.required = isTransfer;
    if (transferTo) transferTo.required = isTransfer;
};

function loadRecurringRules() {
    try {
        const stored = localStorage.getItem('kaizenRecurringRules');
        recurringRules = stored ? JSON.parse(stored) : [];
    } catch (error) {
        recurringRules = [];
    }
}

function persistRecurringRules() {
    localStorage.setItem('kaizenRecurringRules', JSON.stringify(recurringRules));
}

// ================= GESTÃO DE SESSÃO & PERFIL =================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        oneSignalUserId = user.uid;
        loginOneSignalUser();
        const emailDisplay = document.getElementById('userEmailDisplay');
        if (emailDisplay) emailDisplay.innerText = user.email;
        try {
            await loadUserProfile();
            loadUserData();
        } catch (err) {
            console.error("Erro ao carregar dados do utilizador:", err);
        }
    } else {
        if (!window.location.pathname.includes('login.html')) {
            window.location.href = "/login.html";
        }
    }
});

function getOneSignal() {
    if (oneSignalPlugin) return oneSignalPlugin;

    oneSignalPlugin = window.Capacitor?.Plugins?.OneSignalCapacitor
        || window.Capacitor?.Plugins?.OneSignal
        || window.OneSignal
        || window.plugins?.OneSignal
        || null;

    if (!oneSignalPlugin && typeof window.Capacitor?.registerPlugin === 'function') {
        oneSignalPlugin = window.Capacitor.registerPlugin('OneSignalCapacitor');
    }

    return oneSignalPlugin;
}

function initializeOneSignal() {
    const oneSignal = getOneSignal();
    if (!oneSignal || oneSignalInitialized) return;

    const isCapacitorPlugin = !oneSignal.Notifications && typeof oneSignal.getPermission === 'function';
    const initialize = () => isCapacitorPlugin
        ? oneSignal.initialize({ appId: oneSignalAppId })
        : oneSignal.initialize(oneSignalAppId);
    const login = () => isCapacitorPlugin
        ? oneSignal.login({ externalId: oneSignalUserId })
        : oneSignal.login(oneSignalUserId);

    Promise.resolve(initialize())
        .then(() => requestOneSignalPermissionOnLaunch(oneSignal))
        .catch(error => console.error("Erro no registro do OneSignal:", error));
    oneSignalInitialized = true;
    loginOneSignalUser();
}

function loginOneSignalUser() {
    const oneSignal = getOneSignal();
    if (!oneSignal || !oneSignalInitialized || !oneSignalUserId) return;

    const isCapacitorPlugin = !oneSignal.Notifications && typeof oneSignal.getPermission === 'function';
    const login = isCapacitorPlugin
        ? oneSignal.login({ externalId: oneSignalUserId })
        : oneSignal.login(oneSignalUserId);

    Promise.resolve(login).catch(error => console.error("Erro ao associar usuário ao OneSignal:", error));
}

document.addEventListener('deviceready', () => {
    initializeOneSignal();
});

if (window.Capacitor?.isNativePlatform?.()) {
    initializeOneSignal();
}

async function requestOneSignalPermissionOnLaunch(oneSignal) {
    try {
        if (oneSignal.Notifications) {
            if (await oneSignal.Notifications.getPermissionAsync()) return;
            if (await oneSignal.Notifications.canRequestPermission()) {
                await oneSignal.Notifications.requestPermission(false);
            }
            return;
        }

        const permission = await oneSignal.getPermission();
        const canRequest = await oneSignal.canRequestPermission();
        if (!permission.permission && canRequest.canRequest) {
            await oneSignal.requestPermission({ fallbackToSettings: false });
        }
    } catch (error) {
        console.error("Erro ao solicitar permissão do OneSignal:", error);
    }
}

async function loadUserProfile() {
    try {
        const docSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.nome) {
                const nameInput = document.getElementById('usernameInput');
                if (nameInput) nameInput.value = data.nome;
                const dashWelcome = document.getElementById('welcomeUserText');
                if (dashWelcome) dashWelcome.innerText = `Olá, ${data.nome.split(' ')[0]}!`;
            }
            if (data.foto) {
                const profAv = document.getElementById('profileAvatar');
                if (profAv) profAv.src = data.foto;
                const dashAv = document.getElementById('dashProfileImg');
                if (dashAv) dashAv.src = data.foto;
                pendingPhotoBase64 = data.foto;
            }
            if (data.customCategories) {
                customCategories = data.customCategories;
            }
        }
        updateCategoryDropdowns();
    } catch (e) { console.error("Erro ao carregar perfil", e); }
}

window.handlePhotoUpload = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const MAX_SIZE = 250;
            let width = img.width, height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            const profAv = document.getElementById('profileAvatar');
            if (profAv) profAv.src = dataUrl;
            pendingPhotoBase64 = dataUrl;
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
};

window.saveProfile = async function () {
    const btn = document.getElementById('btnSaveProfile');
    if (btn) { btn.innerText = "Salvando..."; btn.disabled = true; }
    const nome = document.getElementById('usernameInput')?.value.trim() || "";
    try {
        await setDoc(doc(db, 'usuarios', currentUser.uid), {
            nome: nome,
            foto: pendingPhotoBase64 || null,
            customCategories: customCategories
        }, { merge: true });
        const dashWelcome = document.getElementById('welcomeUserText');
        if (nome && dashWelcome) dashWelcome.innerText = `Olá, ${nome.split(' ')[0]}!`;
        const dashAv = document.getElementById('dashProfileImg');
        if (pendingPhotoBase64 && dashAv) dashAv.src = pendingPhotoBase64;
        window.showToast("Perfil atualizado com sucesso!");
    } catch (e) {
        window.showToast("Erro ao salvar perfil.", "error");
    }
    if (btn) { btn.innerHTML = '<i class="fas fa-save"></i> Salvar Perfil'; btn.disabled = false; }
};

// ================= GESTÃO DINÂMICA DE CATEGORIAS =================
function updateCategoryDropdowns() {
    const typeIncome = document.getElementById('typeIncome')?.checked;
    const catsIncome = [...baseCategories.income, ...(customCategories.income || [])];
    const catsExpense = [...baseCategories.expense, ...(customCategories.expense || [])];

    const catInput = document.getElementById('categoryInput');
    const budgetCatInput = document.getElementById('budgetCategoryInput');
    const recurringCatInput = document.getElementById('ruleCategoryInput');

    if (catInput) {
        catInput.innerHTML = '';
        (typeIncome ? catsIncome : catsExpense).forEach(cat => {
            catInput.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
    }

    if (recurringCatInput) {
        recurringCatInput.innerHTML = '';
        const allCats = [...new Set([...catsIncome, ...catsExpense])];
        allCats.forEach(cat => {
            recurringCatInput.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
    }

    if (budgetCatInput) {
        budgetCatInput.innerHTML = '';
        catsExpense.forEach(cat => {
            budgetCatInput.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
    }

    const filterCat = document.getElementById('filterCategory');
    if (filterCat) {
        filterCat.innerHTML = '<option value="">Todas as Categorias</option>';
        [...new Set([...catsIncome, ...catsExpense])].forEach(cat => {
            filterCat.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
    }
}

window.addCustomCategory = async function () {
    const name = document.getElementById('newCategoryName').value.trim();
    const type = document.getElementById('newCategoryType').value;
    if (!name) {
        window.showToast("Digite o nome da categoria.", "error");
        return;
    }

    if (!customCategories[type]) customCategories[type] = [];
    if (customCategories[type].includes(name) || baseCategories[type].includes(name)) {
        window.showToast("Esta categoria já existe.", "error");
        return;
    }

    customCategories[type].push(name);

    try {
        await setDoc(doc(db, 'usuarios', currentUser.uid), { customCategories }, { merge: true });
        document.getElementById('newCategoryName').value = '';
        updateCategoryDropdowns();
        window.showToast("Categoria adicionada com sucesso!");
    } catch (e) {
        window.showToast("Erro ao salvar categoria.", "error");
    }
};

document.getElementById('typeIncome')?.addEventListener('change', () => updateCategoryDropdowns());
document.getElementById('typeExpense')?.addEventListener('change', () => updateCategoryDropdowns());

// ================= DADOS E SKELETON LOADERS =================
function loadUserData() {
    const q = query(transactionsCol, where("userId", "==", currentUser.uid));
    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        transactions = []; budgets = []; goals = []; debts = []; investments = []; creditCards = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const item = { id: docSnap.id, ...data };
            if (data.type === 'budget') budgets.push(item);
            else if (data.type === 'goal') goals.push(item);
            else if (data.type === 'debt') debts.push(item);
            else if (data.type === 'investment') investments.push(item);
            else if (data.type === 'creditCard') creditCards.push(item);
            else transactions.push(item);
        });
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (isFirstLoad) {
            document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));
            isFirstLoad = false;
        }

        if (typeof renderBudgets === 'function') renderBudgets();
        if (typeof renderGoals === 'function') renderGoals();
        if (typeof renderDebts === 'function') renderDebts();
        if (typeof renderInvestments === 'function') renderInvestments();
        if (typeof renderCreditCards === 'function') renderCreditCards();
        if (typeof checkGamificationAndInsights === 'function') checkGamificationAndInsights();

        if (document.getElementById('annual') && document.getElementById('annual').classList.contains('active')) {
            window.renderAnnualReport();
        }
        renderDashboard();
        checkAlerts();
        schedulePendingDueNotifications();
    }, (error) => {
        console.error("Erro ao carregar dados financeiros:", error);
        window.showToast("Não foi possível carregar seus dados. Verifique sua conexão.", "error");
    });
}

// ================= TEMA & PRIVACIDADE =================
function applyTheme(isDark) {
    const iconDesktop = document.getElementById('themeIconDesktop');
    if (isDark) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
        if (iconDesktop) iconDesktop.className = 'fas fa-sun';
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
        if (iconDesktop) iconDesktop.className = 'fas fa-moon';
    }
}
window.toggleTheme = () => applyTheme(!document.body.classList.contains('dark-mode'));

window.togglePrivacyMode = function () {
    isPrivacyMode = !isPrivacyMode;
    const icon = document.getElementById('privacyIcon');
    const text = document.getElementById('privacyText');
    const dashIcon = document.getElementById('dashPrivacyIcon');

    if (isPrivacyMode) {
        document.body.classList.add('privacy-active');
        if (icon) icon.className = 'fas fa-eye';
        if (text) text.innerText = 'Exibir Valores';
        if (dashIcon) dashIcon.className = 'fas fa-eye';
    } else {
        document.body.classList.remove('privacy-active');
        if (icon) icon.className = 'fas fa-eye-slash';
        if (text) text.innerText = 'Ocultar Valores';
        if (dashIcon) dashIcon.className = 'fas fa-eye-slash';
    }
    renderDashboard();
    if (typeof renderBudgets === 'function') renderBudgets();
    if (typeof renderGoals === 'function') renderGoals();
    if (typeof renderDebts === 'function') renderDebts();
    if (typeof renderInvestments === 'function') renderInvestments();
    if (typeof renderCreditCards === 'function') renderCreditCards();
};

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
loadRecurringRules();
applyTheme(savedTheme === 'dark' || (!savedTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
updateCategoryDropdowns();
window.toggleTransferFields();
initCharts();
renderRecurringRules();
renderCashFlowForecast();
renderFinancialHealth();

const startInput = document.getElementById('startDateFilter');
    const endInput = document.getElementById('endDateFilter');
    if (startInput) startInput.value = currentStartDate;
    if (endInput) endInput.value = currentEndDate;

    const periodLabel = document.getElementById('periodLabel');
    if (periodLabel) {
        periodLabel.innerText = `${formatDateBR(currentStartDate)} até ${formatDateBR(currentEndDate)}`;
    }
});

window.handleSearch = function () {
    searchQuery = document.getElementById('searchInput')?.value.toLowerCase().trim() || "";
    renderDashboard();
};

const formatMoney = (value) => {
    if (isPrivacyMode) return 'R$ •••••';
    return parseFloat(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
const formatDateBR = (dateString) => { if (!dateString) return ''; const [year, month, day] = dateString.split('-'); return `${day}/${month}/${year}`; };

// ================= RENDERIZADORES COMPLEMENTARES =================
function renderBudgets() {
    const container = document.getElementById('budgetsList');
    if (!container) return;
    container.innerHTML = '';
    if (budgets.length === 0) { container.innerHTML = '<div class="text-center" style="font-size:0.85rem;">Nenhum orçamento definido.</div>'; return; }

    const today = new Date();
    const currMonthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const expensesThisMonth = {};

    transactions.forEach(t => {
        if (t.type === 'expense' && t.date && t.date.startsWith(currMonthPrefix) && (t.status === 'pago' || !t.status)) {
            expensesThisMonth[t.category] = (expensesThisMonth[t.category] || 0) + parseFloat(t.value || t.amount);
        }
    });

    budgets.forEach(b => {
        const spent = expensesThisMonth[b.category] || 0;
        const limit = parseFloat(b.limit);
        const percent = Math.min((spent / limit) * 100, 100);

        container.innerHTML += `
        <div class="budget-item">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <strong style="font-size:0.9rem;">${b.category}</strong>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-icon text-primary" onclick="window.openEditBudgetModal('${b.id}', '${b.category}', ${limit})" style="font-size:0.8rem;" title="Editar Orçamento"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon text-danger" onclick="window.deleteSystemDoc('${b.id}', 'Orçamento')" style="font-size:0.8rem;" title="Excluir"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-light);">
                <span>${formatMoney(spent)} gastos</span>
                <span>Limite: ${formatMoney(limit)}</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${percent}%; background: var(--primary);"></div>
            </div>
        </div>`;
    });
}

function renderGoals() {
    const container = document.getElementById('goalsList');
    if (!container) return;
    container.innerHTML = '';
    if (goals.length === 0) { container.innerHTML = '<div class="text-center" style="font-size:0.85rem;">Nenhuma meta definida.</div>'; return; }

    goals.forEach(g => {
        const current = parseFloat(g.current || 0); const target = parseFloat(g.target);
        const percent = Math.min((current / target) * 100, 100);
        let deadlineMsg = '';

        if (g.deadline) {
            const due = new Date(g.deadline + 'T00:00:00');
            const now = new Date();
            const monthsLeft = (due.getFullYear() - now.getFullYear()) * 12 + (due.getMonth() - now.getMonth());
            if (monthsLeft > 0 && current < target) {
                const requiredPerMonth = (target - current) / monthsLeft;
                deadlineMsg = `<div style="font-size:0.72rem; color:var(--warning); margin-top:4px;"><i class="fas fa-clock"></i> Guardar R$ ${requiredPerMonth.toFixed(2)}/mês</div>`;
            }
        }

        container.innerHTML += `
        <div class="goal-item">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="font-size:0.9rem;">${g.title}</strong>
                <div style="display:flex; gap: 8px;">
                    <button class="btn-icon" style="color:var(--primary); font-size:1.1rem;" onclick="window.openAddFundsModal('${g.id}', ${current}, ${target})" title="Depositar"><i class="fas fa-plus-circle"></i></button>
                    <button class="btn-icon text-danger" onclick="window.deleteSystemDoc('${g.id}', 'Meta')" style="font-size:0.9rem;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-light);">
                <span class="text-success" style="font-weight:600;">${formatMoney(current)}</span>
                <span>Meta: ${formatMoney(target)}</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${percent}%; background: var(--success);"></div>
            </div>
            ${deadlineMsg}
        </div>`;
    });
}

function renderDebts() {
    const container = document.getElementById('debtsList');
    if (!container) return;
    container.innerHTML = '';
    if (debts.length === 0) {
        container.innerHTML = '<div class="text-center" style="font-size:0.85rem;">Nenhuma dívida registrada.</div>';
        return;
    }

    debts.forEach(d => {
        const total = parseFloat(d.total || 0);
        const paid = parseFloat(d.paid || 0);
        const remaining = Math.max(total - paid, 0);
        const percent = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
        const statusLabel = remaining <= 0 ? 'Quitada' : 'Em andamento';

        container.innerHTML += `
        <div class="goal-item">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="font-size:0.9rem;">${d.title}</strong>
                <div style="display:flex; gap: 8px;">
                    <button class="btn-icon" style="color:var(--warning); font-size:1.1rem;" onclick="window.addDebtPayment('${d.id}', ${remaining})" title="Pagar parcela"><i class="fas fa-hand-holding-usd"></i></button>
                    <button class="btn-icon text-danger" onclick="window.deleteSystemDoc('${d.id}', 'Dívida')" style="font-size:0.9rem;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-light);">
                <span class="text-warning" style="font-weight:600;">Pago: ${formatMoney(paid)}</span>
                <span>Total: ${formatMoney(total)}</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${percent}%; background: var(--warning);"></div>
            </div>
            <div style="font-size:0.72rem; color:var(--text-light); margin-top:4px;">${statusLabel} · Restante: ${formatMoney(remaining)}</div>
        </div>`;
    });
}

function renderRecurringRules() {
    const container = document.getElementById('recurringRulesList');
    if (!container) return;
    container.innerHTML = '';

    if (recurringRules.length === 0) {
        container.innerHTML = '<div class="text-center" style="font-size:0.85rem;">Nenhuma regra de recorrência cadastrada.</div>';
        return;
    }

    container.className = 'recurrence-list';
    recurringRules.forEach(rule => {
        const badge = rule.type === 'income' ? 'text-success' : 'text-danger';
        const cadenceLabel = rule.cadence === 'monthly' ? 'Mensal' : rule.cadence === 'weekly' ? 'Semanal' : 'Anual';
        container.innerHTML += `
            <div class="recurring-rule-item">
                <div class="rule-meta">
                    <strong>${rule.title}</strong>
                    <span>${rule.category} · ${cadenceLabel}</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="${badge}" style="font-weight:800;">${formatMoney(rule.amount)}</span>
                    <button class="btn-icon text-danger" onclick="window.removeRecurringRule('${rule.id}')" title="Excluir regra"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    });
}

function renderCashFlowForecast() {
    const container = document.getElementById('cashFlowForecast');
    if (!container) return;

    const currentMonth = new Date();
    const months = [];
    let currentBalance = Object.values((function () {
        const acc = {};
        transactions.forEach(item => {
            if (!item.account) return;
            const val = parseFloat(item.value || item.amount || 0);
            if (item.type === 'income' || item.type === 'entrada') {
                acc[item.account] = (acc[item.account] || 0) + val;
            } else if (item.type === 'expense' || item.type === 'saida') {
                acc[item.account] = (acc[item.account] || 0) - val;
            }
        });
        return acc;
    })()).reduce((sum, value) => sum + value, 0);

    for (let i = 0; i < 6; i++) {
        const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + i, 1);
        const monthLabel = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
        const yearLabel = date.getFullYear();

        let monthlyIncome = 0;
        let monthlyExpense = 0;

        transactions.forEach(item => {
            if (!item.date || item.status === 'pendente') return;
            const itemDate = new Date(item.date + 'T00:00:00');
            if (itemDate.getFullYear() === date.getFullYear() && itemDate.getMonth() === date.getMonth()) {
                const value = parseFloat(item.value || item.amount || 0);
                if (item.type === 'income' || item.type === 'entrada') monthlyIncome += value;
                else if (item.type === 'expense' || item.type === 'saida') monthlyExpense += value;
            }
        });

        recurringRules.forEach(rule => {
            const occursThisMonth = rule.cadence === 'monthly' ||
                (rule.cadence === 'weekly' && date.getMonth() === currentMonth.getMonth()) ||
                (rule.cadence === 'yearly' && date.getMonth() === new Date(rule.startDate || new Date()).getMonth() && date.getFullYear() % 1 === 0);

            if (rule.cadence === 'monthly') {
                if (rule.type === 'income') monthlyIncome += rule.amount;
                else monthlyExpense += rule.amount;
            } else if (rule.cadence === 'weekly') {
                const weeklyAmount = rule.amount * 4.33;
                if (rule.type === 'income') monthlyIncome += weeklyAmount;
                else monthlyExpense += weeklyAmount;
            } else if (rule.cadence === 'yearly' && date.getMonth() === (new Date(rule.startDate || new Date()).getMonth())) {
                if (rule.type === 'income') monthlyIncome += rule.amount;
                else monthlyExpense += rule.amount;
            }
        });

        const net = monthlyIncome - monthlyExpense;
        currentBalance += net;

        months.push({
            label: `${monthLabel}/${String(yearLabel).slice(-2)}`,
            income: monthlyIncome,
            expense: monthlyExpense,
            net,
            balance: currentBalance
        });
    }

    container.innerHTML = months.map(item => `
        <div class="forecast-item">
            <strong>${item.label}</strong>
            <span class="text-success">Entradas: ${formatMoney(item.income)}</span>
            <span class="text-danger">Saídas: ${formatMoney(item.expense)}</span>
            <span class="forecast-amount ${item.net >= 0 ? 'text-success' : 'text-danger'}">${item.net >= 0 ? '+' : '-'}${formatMoney(Math.abs(item.net))}</span>
            <span style="font-size:0.75rem; color: var(--text-light);">Saldo previsto: ${formatMoney(item.balance)}</span>
        </div>
    `).join('');
}

function renderFinancialHealth() {
    const container = document.getElementById('financialHealthGrid');
    if (!container) return;

    const paidTransactions = transactions.filter(item => item.status === 'pago' || !item.status);
    const incomeTotal = paidTransactions.filter(item => item.type === 'income' || item.type === 'entrada').reduce((sum, item) => sum + parseFloat(item.value || item.amount || 0), 0);
    const expenseTotal = paidTransactions.filter(item => item.type === 'expense' || item.type === 'saida').reduce((sum, item) => sum + parseFloat(item.value || item.amount || 0), 0);
    const debtTotal = debts.reduce((sum, item) => sum + parseFloat(item.total || 0), 0);
    const debtRemaining = debts.reduce((sum, item) => sum + Math.max(parseFloat(item.total || 0) - parseFloat(item.paid || 0), 0), 0);
    const liquidity = incomeTotal > 0 ? ((incomeTotal - expenseTotal) / incomeTotal) * 100 : 0;
    const currentBalance = paidTransactions.reduce((sum, item) => {
        const value = parseFloat(item.value || item.amount || 0);
        if (item.type === 'income' || item.type === 'entrada') return sum + value;
        if (item.type === 'expense' || item.type === 'saida') return sum - value;
        return sum;
    }, 0);
    const reserve = Math.max(currentBalance, 0);
    const averageMonthlyExpense = expenseTotal / Math.max(new Set(paidTransactions.map(item => item.date?.slice(0, 7)).filter(Boolean)).size, 1);
    const reserveMonths = averageMonthlyExpense > 0 ? reserve / averageMonthlyExpense : 0;
    const debtRatio = debtTotal > 0 ? (debtRemaining / Math.max(incomeTotal, 1)) * 100 : 0;

    const items = [
        { label: 'Taxa de economia', value: `${Math.max(Math.min(liquidity, 100), -100).toFixed(0)}%`, meta: liquidity >= 20 ? 'Saudável' : liquidity >= 0 ? 'Estável' : 'Atenção', tone: liquidity >= 20 ? 'text-success' : liquidity >= 0 ? 'text-warning' : 'text-danger' },
        { label: 'Reserva', value: formatMoney(reserve), meta: reserve > 0 ? `${reserveMonths.toFixed(1)} meses de despesas` : 'Sem folga', tone: reserve > 0 ? 'text-success' : 'text-warning' },
        { label: 'Endividamento', value: `${Math.min(debtRatio, 100).toFixed(0)}%`, meta: debtRatio <= 35 ? 'Controlado' : 'Elevado', tone: debtRatio <= 35 ? 'text-success' : 'text-danger' }
    ];

    container.innerHTML = items.map(item => `
        <div class="health-item">
            <span class="health-label">${item.label}</span>
            <span class="health-value ${item.tone}">${item.value}</span>
            <span class="health-meta">${item.meta}</span>
        </div>
    `).join('');
}

function renderInvestments() {
    const tableBody = document.getElementById('investmentsTableBody');
    const totalEl = document.getElementById('totalInvestments');
    if (!tableBody || !totalEl) return;
    tableBody.innerHTML = '';
    let totalPatrimony = 0;
    if (investments.length === 0) { tableBody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2rem;">Nenhum investimento cadastrado.</td></tr>'; totalEl.innerText = formatMoney(0); return; }
    investments.forEach(inv => {
        const qty = parseFloat(inv.qty); const price = parseFloat(inv.price); const currentVal = parseFloat(inv.currentVal);
        const investedTotal = qty * price; const profitLoss = currentVal - investedTotal;
        totalPatrimony += currentVal;
        const isPositive = profitLoss >= 0;
        tableBody.innerHTML += `<tr><td><strong>${inv.name}</strong></td><td><span class="account-badge">${inv.class}</span></td><td>${qty}</td><td>${formatMoney(price)}</td><td style="font-weight: 700;">${formatMoney(currentVal)}</td><td class="${isPositive ? 'text-success' : 'text-danger'}" style="font-weight: 700;">${isPositive ? '+' : ''}${formatMoney(Math.abs(profitLoss))}</td><td><button class="btn-icon text-danger" onclick="window.deleteSystemDoc('${inv.id}', 'Ativo')"><i class="fas fa-trash"></i></button></td></tr>`;
    });
    totalEl.innerText = formatMoney(totalPatrimony);
}

window.renderAnnualReport = function () {
    const yearSelect = document.getElementById('selectAnnualYear');
    const tableBody = document.getElementById('annualTableBody');
    if (!yearSelect || !tableBody) return;
    const availableYears = [...new Set([
        new Date().getFullYear().toString(),
        ...transactions
            .map(transaction => transaction.date?.slice(0, 4))
            .filter(year => /^\d{4}$/.test(year))
    ])].sort((a, b) => Number(b) - Number(a));
    const selectedBeforeRefresh = yearSelect.value;
    yearSelect.innerHTML = availableYears.map(year => `<option value="${year}">${year}</option>`).join('');
    yearSelect.value = availableYears.includes(selectedBeforeRefresh) ? selectedBeforeRefresh : availableYears[0];
    const selectedYear = yearSelect.value;
    tableBody.innerHTML = '';
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthlySummary = Array(12).fill(0).map(() => ({ income: 0, expense: 0 }));
    transactions.forEach(t => {
        if (!t.date || t.category === 'Ajuste de Saldo' || t.type === 'transfer' || t.status === 'pendente') return;
        if (!t.date.startsWith(selectedYear)) return;
        const monthIndex = parseInt(t.date.split('-')[1], 10) - 1;
        const val = parseFloat(t.value || t.amount || 0);
        if (t.type === 'income' || t.type === 'entrada') monthlySummary[monthIndex].income += val;
        else if (t.type === 'expense' || t.type === 'saida') monthlySummary[monthIndex].expense += val;
    });
    monthlySummary.forEach((data, index) => {
        const netResult = data.income - data.expense;
        const monthNum = String(index + 1).padStart(2, '0');
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = `Clique para ver o histórico de ${monthNames[index]}/${selectedYear}`;
        tr.onclick = () => {
            window.switchTab('history');
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = `${selectedYear}-${monthNum}`;
                window.handleSearch();
            }
        };
        tr.innerHTML = `<td><strong><i class="fas fa-calendar-alt text-primary"></i> ${monthNames[index]}</strong></td><td class="text-success">${formatMoney(data.income)}</td><td class="text-danger">${formatMoney(data.expense)}</td><td class="${netResult >= 0 ? 'text-success' : 'text-danger'}">${formatMoney(netResult)}</td>`;
        tableBody.appendChild(tr);
    });
};

// ================= SALVANDO DADOS NO BANCO =================
window.saveInvestment = async function () {
    if (!window.validateForm('investmentForm')) return;
    const name = document.getElementById('invNameInput').value.trim();
    const invClass = document.getElementById('invClassInput').value;
    const qty = parseFloat(document.getElementById('invQtyInput').value);
    const price = parseFloat(document.getElementById('invPriceInput').value);
    const currentVal = parseFloat(document.getElementById('invCurrentValInput').value);

    try {
        await addDoc(transactionsCol, {
            userId: currentUser.uid,
            type: 'investment',
            name,
            class: invClass,
            qty,
            price,
            currentVal,
            date: new Date().toISOString().split('T')[0]
        });
        window.showToast("Ativo cadastrado com sucesso!");
        window.closeInvestmentModal();
        document.getElementById('investmentForm').reset();
    } catch (e) {
        window.showToast("Erro ao salvar ativo.", "error");
    }
};

window.saveBudget = async function () {
    const category = document.getElementById('budgetCategoryInput').value;
    const limit = parseFloat(document.getElementById('budgetLimitInput').value);
    if (isNaN(limit) || !category) { window.showToast("Preencha o valor.", "error"); return; }
    try {
        await addDoc(transactionsCol, { userId: currentUser.uid, type: 'budget', category, limit, date: new Date().toISOString().split('T')[0] });
        window.showToast("Orçamento salvo!");
        window.closeBudgetModal();
    } catch (error) { window.showToast("Erro ao salvar orçamento", "error"); }
};

window.saveGoal = async function () {
    if (!window.validateForm('formGoal')) return;
    const title = document.getElementById('goalTitleInput').value;
    const target = parseFloat(document.getElementById('goalTargetInput').value);
    const deadline = document.getElementById('goalDeadlineInput').value || null;

    try {
        await addDoc(transactionsCol, { userId: currentUser.uid, type: 'goal', title, target, current: 0, deadline, date: new Date().toISOString().split('T')[0] });
        window.showToast("Meta criada com sucesso!");
        window.closeGoalModal();
        document.getElementById('formGoal').reset();
    } catch (error) { window.showToast("Erro ao criar meta", "error"); }
};

window.openDebtModal = function () {
    document.getElementById('debtModal')?.classList.add('active');
};
window.closeDebtModal = function () {
    document.getElementById('debtModal')?.classList.remove('active');
    document.getElementById('debtForm')?.reset();
};

window.openRecurringRuleModal = function () {
    updateCategoryDropdowns();
    document.getElementById('recurringRuleModal')?.classList.add('active');
};
window.closeRecurringRuleModal = function () {
    document.getElementById('recurringRuleModal')?.classList.remove('active');
    document.getElementById('recurringRuleForm')?.reset();
};

window.saveRecurringRule = function () {
    const form = document.getElementById('recurringRuleForm');
    if (!form || !window.validateForm('recurringRuleForm')) return;

    const title = document.getElementById('ruleTitleInput').value.trim();
    const type = document.getElementById('ruleTypeInput').value;
    const cadence = document.getElementById('ruleCadenceInput').value;
    const category = document.getElementById('ruleCategoryInput').value;
    const amount = parseFloat(document.getElementById('ruleAmountInput').value);

    if (!title || Number.isNaN(amount) || amount <= 0) {
        window.showToast('Preencha os dados da regra de recorrência.', 'error');
        return;
    }

    recurringRules.push({
        id: `rule-${Date.now()}`,
        title,
        type,
        cadence,
        category,
        amount,
        startDate: new Date().toISOString().split('T')[0]
    });

    persistRecurringRules();
    renderRecurringRules();
    renderCashFlowForecast();
    window.showToast('Regra de recorrência salva com sucesso!');
    window.closeRecurringRuleModal();
};

window.removeRecurringRule = function (id) {
    recurringRules = recurringRules.filter(rule => rule.id !== id);
    persistRecurringRules();
    renderRecurringRules();
    renderCashFlowForecast();
    window.showToast('Regra removida com sucesso!');
};

window.saveDebt = async function () {
    if (!window.validateForm('debtForm')) return;
    const title = document.getElementById('debtTitleInput').value.trim();
    const total = parseFloat(document.getElementById('debtTotalInput').value);
    const paid = parseFloat(document.getElementById('debtPaidInput').value || 0);
    const interest = parseFloat(document.getElementById('debtInterestInput').value || 0);
    const dueDate = document.getElementById('debtDueDateInput').value || null;

    if (isNaN(total) || total <= 0) {
        window.showToast("Informe um valor válido para a dívida.", "error");
        return;
    }

    try {
        await addDoc(transactionsCol, {
            userId: currentUser.uid,
            type: 'debt',
            title,
            total,
            paid: Math.min(Math.max(paid, 0), total),
            interest,
            dueDate,
            status: paid >= total ? 'quitada' : 'em_andamento',
            date: new Date().toISOString().split('T')[0]
        });
        window.showToast("Dívida salva com sucesso!");
        window.closeDebtModal();
    } catch (error) {
        console.error(error);
        window.showToast("Erro ao salvar dívida.", "error");
    }
};

let debtPaymentContext = null;

window.addDebtPayment = function (id, remaining) {
    const debt = debts.find(item => item.id === id);
    if (!debt) {
        window.showToast("Dívida não encontrada.", "error");
        return;
    }

    debtPaymentContext = { id, remaining: parseFloat(remaining || 0) };
    const description = document.getElementById('debtPaymentDescription');
    const amountInput = document.getElementById('debtPaymentAmountInput');
    if (description) description.innerText = `${debt.title} · Saldo restante: ${formatMoney(debtPaymentContext.remaining)}`;
    if (amountInput) {
        amountInput.value = debtPaymentContext.remaining > 0 ? debtPaymentContext.remaining.toFixed(2) : '';
        amountInput.max = debtPaymentContext.remaining.toFixed(2);
    }
    document.getElementById('debtPaymentModal')?.classList.add('active');
};

window.closeDebtPaymentModal = function () {
    debtPaymentContext = null;
    document.getElementById('debtPaymentModal')?.classList.remove('active');
    const amountInput = document.getElementById('debtPaymentAmountInput');
    if (amountInput) amountInput.value = '';
};

window.saveDebtPayment = async function () {
    if (!debtPaymentContext) return;
    const debt = debts.find(item => item.id === debtPaymentContext.id);
    const inputValue = document.getElementById('debtPaymentAmountInput')?.value.replace(',', '.');
    const value = Number(inputValue);
    if (!debt || Number.isNaN(value) || value <= 0) {
        window.showToast("Informe um valor de pagamento válido.", "error");
        return;
    }
    if (value > debtPaymentContext.remaining) {
        window.showToast("O pagamento não pode ultrapassar o saldo restante.", "error");
        return;
    }

    const nextPaid = Math.min(parseFloat(debt.paid || 0) + value, parseFloat(debt.total || 0));
    try {
        await updateDoc(doc(db, 'transacoes', debtPaymentContext.id), {
            paid: nextPaid,
            status: nextPaid >= parseFloat(debt.total || 0) ? 'quitada' : 'em_andamento'
        });
        window.showToast("Pagamento registrado com sucesso!");
        window.closeDebtPaymentModal();
    } catch (error) {
        console.error(error);
        window.showToast("Erro ao registrar pagamento.", "error");
    }
};

window.markTransactionPaid = async function (id) {
    const transaction = transactions.find(item => item.id === id);
    if (!transaction) {
        window.showToast("Conta não encontrada.", "error");
        return;
    }

    try {
        await updateDoc(doc(db, 'transacoes', id), {
            status: 'pago',
            paidAt: new Date().toISOString().split('T')[0]
        });
        window.showToast(transaction.type === 'income' || transaction.type === 'entrada'
            ? "Recebimento lançado com sucesso!"
            : "Pagamento lançado com sucesso!");
    } catch (error) {
        console.error(error);
        window.showToast("Erro ao lançar a conta como paga.", "error");
    }
};

// ================= FORMULÁRIO DE TRANSAÇÕES (Com Validação Definitiva) =================
document.getElementById('transactionForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!window.validateForm('transactionForm')) return;

    const type = document.querySelector('input[name="type"]:checked').value;
    const statusEl = document.querySelector('input[name="status"]:checked');
    const status = statusEl ? statusEl.value : 'pago';
    const desc = document.getElementById('descInput').value;
    const baseValue = parseFloat(document.getElementById('valueInput').value);
    const currency = parseFloat(document.getElementById('currencyInput')?.value || 1);
    const value = baseValue * currency;
    const tagsRaw = document.getElementById('tagsInput')?.value || '';
    const tags = tagsRaw.split(',').map(tag => tag.trim().toLowerCase()).filter(t => t);
    const category = document.getElementById('categoryInput').value;
    const baseDateStr = document.getElementById('dateInput').value;
    const dueDateStr = document.getElementById('dueDateInput')?.value || null;
    const account = document.getElementById('accountInput').value;
    const transferFrom = document.getElementById('transferFromAccount')?.value || account;
    const transferTo = document.getElementById('transferToAccount')?.value || account;

    if (type === 'transfer' && transferFrom === transferTo) {
        window.showToast("Selecione contas diferentes para a transferência.", "error");
        return;
    }

    const isRecurring = document.getElementById('isRecurring')?.checked || false;
    const freq = document.getElementById('recurrenceFreq')?.value || 'monthly';
    const times = parseInt(document.getElementById('recurrenceTimes')?.value) || 2;

    const allocationGoalId = document.getElementById('allocationGoalId')?.value || '';
    const allocationAmount = parseFloat(document.getElementById('allocationAmount')?.value) || 0;

    try {
        if (editingId) {
            await updateDoc(doc(db, 'transacoes', editingId), {
                type,
                status,
                desc: type === 'transfer' ? `Transferência: ${transferFrom} → ${transferTo}` : desc,
                value,
                category: type === 'transfer' ? 'Transferência' : category,
                date: baseDateStr,
                dueDate: dueDateStr,
                account,
                fromAccount: type === 'transfer' ? transferFrom : null,
                toAccount: type === 'transfer' ? transferTo : null
            });
            window.showToast("Transação atualizada!");
        } else {
            if (type === 'transfer') {
                await addDoc(transactionsCol, {
                    userId: currentUser.uid,
                    type,
                    status,
                    desc: `Transferência: ${transferFrom} → ${transferTo}`,
                    value,
                    category: 'Transferência',
                    date: baseDateStr,
                    dueDate: dueDateStr,
                    account: transferFrom,
                    fromAccount: transferFrom,
                    toAccount: transferTo
                });
            } else {
                let currentDate = new Date(baseDateStr + 'T00:00:00');
                let currentDueDate = dueDateStr ? new Date(dueDateStr + 'T00:00:00') : null;
                const totalIterations = isRecurring ? times : 1;

                for (let i = 0; i < totalIterations; i++) {
                    if (i > 0) {
                        if (freq === 'monthly') {
                            currentDate.setMonth(currentDate.getMonth() + 1);
                            if (currentDueDate) currentDueDate.setMonth(currentDueDate.getMonth() + 1);
                        } else if (freq === 'weekly') {
                            currentDate.setDate(currentDate.getDate() + 7);
                            if (currentDueDate) currentDueDate.setDate(currentDueDate.getDate() + 7);
                        } else if (freq === 'yearly') {
                            currentDate.setFullYear(currentDate.getFullYear() + 1);
                            if (currentDueDate) currentDueDate.setFullYear(currentDueDate.getFullYear() + 1);
                        }
                    }

                    const formattedDate = currentDate.toISOString().split('T')[0];
                    const formattedDueDate = currentDueDate ? currentDueDate.toISOString().split('T')[0] : null;

                    await addDoc(transactionsCol, {
                        userId: currentUser.uid,
                        type,
                        status: i === 0 ? status : 'pendente',
                        desc: i === 0 ? desc : `${desc} (${i + 1}ª Recorrência)`,
                        value,
                        category,
                        date: formattedDate,
                        dueDate: formattedDueDate,
                        account,
                        tags
                    });
                }
            }

            if (type === 'income' && allocationGoalId && allocationAmount > 0) {
                const targetGoal = goals.find(g => g.id === allocationGoalId);
                if (targetGoal) {
                    const newCurrent = parseFloat(targetGoal.current || 0) + allocationAmount;
                    await updateDoc(doc(db, 'transacoes', allocationGoalId), { current: newCurrent });
                }
            }

            window.showToast("Transação salva com sucesso!");
        }

        window.closeModal();
        document.getElementById('transactionForm').reset();
        window.toggleTransferFields();
    } catch (error) {
        console.error(error);
        window.showToast("Erro ao processar operação.", "error");
    }
});

// ================= AJUSTE DE SALDO =================
window.openEditBalanceModal = function (account, currentBalance) {
    accountBeingEdited = account;
    currentAccountBalance = parseFloat(currentBalance);
    const modal = document.getElementById('editBalanceModal');
    const label = document.getElementById('editBalanceAccountLabel');
    const input = document.getElementById('newBalanceInput');
    if (label) label.innerText = `Conta: ${account}`;
    if (input) input.value = currentAccountBalance.toFixed(2);
    if (modal) modal.classList.add('active');
};

window.closeEditBalanceModal = function () {
    accountBeingEdited = null;
    const modal = document.getElementById('editBalanceModal');
    if (modal) modal.classList.remove('active');
};

window.saveNewBalance = async function () {
    if (!accountBeingEdited) return;
    const newBalanceInput = document.getElementById('newBalanceInput').value;
    const newBalance = parseFloat(newBalanceInput.replace(',', '.'));
    if (isNaN(newBalance)) { window.showToast("Valor inválido.", "error"); return; }

    const difference = newBalance - currentAccountBalance;
    if (difference === 0) { window.closeEditBalanceModal(); return; }

    const type = difference > 0 ? 'income' : 'expense';
    const value = Math.abs(difference);

    try {
        await addDoc(transactionsCol, {
            userId: currentUser.uid, type, status: 'pago',
            desc: 'Ajuste de Saldo Manual', value,
            category: 'Ajuste de Saldo',
            date: new Date().toISOString().split('T')[0],
            account: accountBeingEdited
        });
        window.showToast("Saldo ajustado com sucesso!");
        window.closeEditBalanceModal();
    } catch (e) {
        window.showToast("Erro ao ajustar saldo.", "error");
    }
};

// ================= RENDERIZAR DASHBOARD E FILTROS COMBINADOS =================
function renderDashboard() {
    const typeF = document.getElementById('filterType')?.value;
    const statusF = document.getElementById('filterStatus')?.value;
    const catF = document.getElementById('filterCategory')?.value;
    const isHistoryTabActive = document.getElementById('history')?.classList.contains('active');

    filteredTransactions = transactions.filter(t => {
        if (!t.date) return false;
        if (!isHistoryTabActive && currentStartDate && currentEndDate && (t.date < currentStartDate || t.date > currentEndDate)) return false;

        if (typeF && t.type !== typeF) return false;
        if (statusF && (statusF === 'pago' ? (t.status === 'pendente') : (t.status !== 'pendente'))) return false;
        if (catF && t.category !== catF) return false;

        if (searchQuery) {
            const desc = (t.desc || "").toLowerCase();
            const acc = (t.account || "").toLowerCase();
            const cat = (t.category || "").toLowerCase();
            const date = t.date.toLowerCase();
            if (!desc.includes(searchQuery) && !acc.includes(searchQuery) && !cat.includes(searchQuery) && !date.includes(searchQuery)) return false;
        }
        return true;
    });

    const tableBody = document.getElementById('historyTableBody');
    if (tableBody) tableBody.innerHTML = '';

    let totalIncome = 0; let totalExpense = 0;
    let pendingIncTotal = 0; let pendingExpTotal = 0;
    const accountsBalance = {};

    const pendingIncomeList = document.getElementById('pendingIncomeList');
    const pendingExpenseList = document.getElementById('pendingExpenseList');
    if (pendingIncomeList) pendingIncomeList.innerHTML = '';
    if (pendingExpenseList) pendingExpenseList.innerHTML = '';

    filteredTransactions.forEach(item => {
        const isPaid = item.status === 'pago' || !item.status;
        const acc = item.account || 'Outros';
        const val = parseFloat(item.value || item.amount || 0);
        const isIncome = item.type === 'income' || item.type === 'entrada';
        const isTransfer = item.type === 'transfer';

        if (isTransfer) {
            const source = item.fromAccount || acc;
            const target = item.toAccount || acc;
            if (!accountsBalance[source]) accountsBalance[source] = 0;
            if (!accountsBalance[target]) accountsBalance[target] = 0;
            if (isPaid) {
                accountsBalance[source] -= val;
                accountsBalance[target] += val;
            }
            if (tableBody) {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><input type="checkbox" class="row-checkbox" value="${item.id}" ${selectedTransactionIds.has(item.id) ? 'checked' : ''}></td>
                    <td>${formatDateBR(item.date)}</td>
                    <td>${item.desc}</td>
                    <td><span class="account-badge">${source}</span></td>
                    <td>Transferência</td>
                    <td>Transferência</td>
                    <td class="text-primary">${formatMoney(val)}</td>
                    <td>${isPaid ? 'Pago' : 'Pendente'}</td>
                    <td>
                        <div style="display: flex; gap: 8px;">
                            <button onclick="window.editTransaction('${item.id}')" class="btn-icon text-primary" title="Editar"><i class="fas fa-edit"></i></button>
                            <button onclick="window.deleteTransaction('${item.id}')" class="btn-icon text-danger" title="Excluir"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                `;
                tableBody.appendChild(row);
            }
            return;
        }

        if (!accountsBalance[acc]) accountsBalance[acc] = 0;

        if (isPaid) {
            if (isIncome) { accountsBalance[acc] += val; totalIncome += val; }
            else { accountsBalance[acc] -= val; totalExpense += val; }
        } else {
            const targetDate = item.dueDate || item.date;
            let dueDateStr = targetDate ? ` (Venc: ${formatDateBR(targetDate)})` : '';
            if (isIncome) {
                pendingIncTotal += val;
                if (pendingIncomeList) pendingIncomeList.innerHTML += `<div class="pending-item"><span>${item.desc}${dueDateStr}</span><strong class="text-success">${formatMoney(val)}</strong><div class="pending-actions"><button class="btn-icon text-success" onclick="window.markTransactionPaid('${item.id}')" title="Lançar como recebido"><i class="fas fa-check"></i></button><button class="btn-icon text-primary" onclick="window.editTransaction('${item.id}')" title="Editar conta"><i class="fas fa-edit"></i></button></div></div>`;
            } else {
                pendingExpTotal += val;
                if (pendingExpenseList) pendingExpenseList.innerHTML += `<div class="pending-item"><span>${item.desc}${dueDateStr}</span><strong class="text-danger">${formatMoney(val)}</strong><div class="pending-actions"><button class="btn-icon text-success" onclick="window.markTransactionPaid('${item.id}')" title="Lançar como pago"><i class="fas fa-check"></i></button><button class="btn-icon text-primary" onclick="window.editTransaction('${item.id}')" title="Editar conta"><i class="fas fa-edit"></i></button></div></div>`;
            }
        }

        if (tableBody) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="checkbox" class="row-checkbox" value="${item.id}" ${selectedTransactionIds.has(item.id) ? 'checked' : ''}></td>
                <td>${formatDateBR(item.date)}</td>
                <td>${item.desc}</td>
                <td><span class="account-badge">${acc}</span></td>
                <td>${item.category}</td>
                <td>${isIncome ? 'Entrada' : 'Saída'}</td>
                <td class="${isIncome ? 'text-success' : 'text-danger'}">${formatMoney(val)}</td>
                <td>${isPaid ? 'Pago' : 'Pendente'}</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="window.editTransaction('${item.id}')" class="btn-icon text-primary" title="Editar"><i class="fas fa-edit"></i></button>
                        <button onclick="window.deleteTransaction('${item.id}')" class="btn-icon text-danger" title="Excluir"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        }
    });

    const accountsListEl = document.getElementById('accountsList');
    if (accountsListEl) {
        accountsListEl.innerHTML = '';
        if (Object.keys(accountsBalance).length === 0) {
            accountsListEl.innerHTML = `<div class="text-center" style="font-size:0.85rem; padding: 1rem; width: 100%;">Nenhuma conta movimentada.</div>`;
        } else {
            Object.keys(accountsBalance).forEach(acc => {
                accountsListEl.innerHTML += `
                    <div class="account-item" style="position: relative;">
                        <span>${acc}</span>
                        <strong>${formatMoney(accountsBalance[acc])}</strong>
                        <button onclick="window.openEditBalanceModal('${acc}', ${accountsBalance[acc]})" class="btn-icon text-primary" style="position: absolute; top: 10px; right: 10px; font-size: 1rem; padding: 5px;" title="Ajustar Saldo"><i class="fas fa-edit"></i></button>
                    </div>`;
            });
        }
    }

    const currentBalance = Object.values(accountsBalance).reduce((a, b) => a + b, 0);
    const balanceCard = document.querySelector('.hud-card.card-balance');
    if (balanceCard) {
        balanceCard.classList.toggle('balance-positive', currentBalance >= 0);
        balanceCard.classList.toggle('balance-negative', currentBalance < 0);
    }
    if (document.getElementById('totalIncome')) document.getElementById('totalIncome').innerText = formatMoney(totalIncome);
    if (document.getElementById('totalExpense')) document.getElementById('totalExpense').innerText = formatMoney(totalExpense);
    if (document.getElementById('totalBalance')) document.getElementById('totalBalance').innerText = formatMoney(currentBalance);

    if (pendingIncomeList && pendingIncTotal === 0) pendingIncomeList.innerHTML = '<div class="text-center" style="font-size:0.85rem; margin-top:10px;">Nada a receber.</div>';
    if (pendingExpenseList && pendingExpTotal === 0) pendingExpenseList.innerHTML = '<div class="text-center" style="font-size:0.85rem; margin-top:10px;">Nada a pagar.</div>';

    updateSelectedTransactionsUI();
    renderRecurringRules();
    renderCashFlowForecast();
    renderFinancialHealth();
    updateCharts();
}

// ================= GRÁFICOS (Incluindo Comparativo) =================
function initCharts() {
    const ctxLineEl = document.getElementById('lineChart');
    if (ctxLineEl && !myLineChart) {
        myLineChart = new Chart(ctxLineEl.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
                datasets: [
                    { label: 'Entradas', data: Array(12).fill(0), backgroundColor: '#10b981' },
                    { label: 'Saídas', data: Array(12).fill(0), backgroundColor: '#ef4444' }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
    const ctxPieEl = document.getElementById('pieChart');
    if (ctxPieEl && !myPieChart) {
        myPieChart = new Chart(ctxPieEl.getContext('2d'), { type: 'doughnut', data: { labels: [], datasets: [{ data: [], backgroundColor: ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#64748b', '#ef4444'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    }
}

function updateCharts() {
    if (!myLineChart || !myPieChart) return;

    const incomeData = Array(12).fill(0);
    const expenseData = Array(12).fill(0);
    const expensesByCategory = {};

    filteredTransactions.forEach(t => {
        if (!t.date || t.type === 'transfer') return;
        const month = parseInt(t.date.split('-')[1], 10) - 1;
        const val = parseFloat(t.value || t.amount || 0);

        if (t.type === 'income' || t.type === 'entrada') incomeData[month] += val;
        else if (t.type === 'expense' || t.type === 'saida') {
            expenseData[month] += val;
            if (t.status === 'pago' || !t.status) {
                expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + val;
            }
        }
    });

    myLineChart.data.datasets[0].data = incomeData;
    myLineChart.data.datasets[1].data = expenseData;
    myLineChart.update();

    myPieChart.data.labels = Object.keys(expensesByCategory);
    myPieChart.data.datasets[0].data = Object.values(expensesByCategory);
    myPieChart.update();
}

// ================= UTILITÁRIOS & MODAIS =================
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

window.switchTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    const target = document.getElementById(tabId); if (target) target.classList.add('active');
    document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(btn => btn.classList.add('active'));
    if (tabId === 'annual' && typeof window.renderAnnualReport === 'function') window.renderAnnualReport();
    if (tabId === 'dashboard') {
        const today = new Date();
        currentStartDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        currentEndDate = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
        searchQuery = "";
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = "";
        ['filterType', 'filterStatus', 'filterCategory'].forEach(id => {
            const filter = document.getElementById(id);
            if (filter) filter.value = "";
        });
        const periodLabel = document.getElementById('periodLabel');
        if (periodLabel) periodLabel.innerText = `${formatDateBR(currentStartDate)} até ${formatDateBR(currentEndDate)}`;
        renderDashboard();
    } else if (tabId === 'history') {
        renderDashboard();
    }
};

window.openModal = function () {
    editingId = null;
    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.innerText = "Nova Transação";

    const form = document.getElementById('transactionForm');
    if (form) {
        form.reset();
        document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];

        const typeIncome = document.getElementById('typeIncome');
        if (typeIncome) typeIncome.checked = true;
    }

    const goalContainer = document.getElementById('goalAllocationContainer');
    if (goalContainer) {
        goalContainer.style.display = 'block';
    }

    const goalSelect = document.getElementById('allocationGoalId');
    if (goalSelect) {
        goalSelect.innerHTML = '<option value="">Selecione uma meta...</option>';
        if (typeof goals !== 'undefined') {
            goals.forEach(g => {
                goalSelect.innerHTML += `<option value="${g.id}">${g.title} (Falta R$ ${(g.target - (g.current || 0)).toFixed(2)})</option>`;
            });
        }
    }

    updateCategoryDropdowns();
    window.toggleTransferFields();
    document.getElementById('modal').classList.add('active');
};
window.closeModal = () => {
    const modal = document.getElementById('modal');
    if (modal) modal.classList.remove('active');
    if (document.getElementById('transactionForm')) document.getElementById('transactionForm').reset();
    window.toggleTransferFields();
};
window.openFilterModal = () => document.getElementById('filterModal').classList.add('active');
window.closeFilterModal = () => document.getElementById('filterModal').classList.remove('active');
window.openInvestmentModal = () => document.getElementById('investmentModal')?.classList.add('active');
window.closeInvestmentModal = () => document.getElementById('investmentModal')?.classList.remove('active');
window.openBudgetModal = () => document.getElementById('budgetModal')?.classList.add('active');
window.closeBudgetModal = () => document.getElementById('budgetModal')?.classList.remove('active');
window.openGoalModal = () => document.getElementById('goalModal')?.classList.add('active');
window.closeGoalModal = () => document.getElementById('goalModal')?.classList.remove('active');

window.openAddFundsModal = function (goalId, current, target) {
    currentGoalForDeposit = { id: goalId, current: current, target: target };
    document.getElementById('addFundsGoalText').innerText = `Falta ${formatMoney(target - current)} para concluir esta meta.`;
    document.getElementById('addFundsInput').value = '';
    document.getElementById('addFundsGoalModal').classList.add('active');
};
window.closeAddFundsModal = () => document.getElementById('addFundsGoalModal').classList.remove('active');

window.saveGoalDeposit = async function () {
    if (!currentGoalForDeposit) return;
    const amount = parseFloat(document.getElementById('addFundsInput').value);
    if (isNaN(amount) || amount <= 0) { window.showToast("Valor inválido.", "error"); return; }
    try {
        await updateDoc(doc(db, 'transacoes', currentGoalForDeposit.id), { current: currentGoalForDeposit.current + amount });
        window.showToast("Depósito salvo com sucesso!");
        window.closeAddFundsModal();
    } catch (e) { window.showToast("Erro ao depositar valor.", "error"); }
};

window.openEditBudgetModal = function (id, category, limit) {
    currentBudgetForEdit = { id, category };
    document.getElementById('editBudgetCategoryLabel').innerText = `Categoria: ${category}`;
    document.getElementById('editBudgetLimitInput').value = parseFloat(limit).toFixed(2);
    document.getElementById('editBudgetModal').classList.add('active');
};
window.closeEditBudgetModal = () => document.getElementById('editBudgetModal').classList.remove('active');

window.saveEditBudget = async function () {
    if (!currentBudgetForEdit) return;
    const newLimit = parseFloat(document.getElementById('editBudgetLimitInput').value);
    if (isNaN(newLimit) || newLimit <= 0) { window.showToast("Valor inválido.", "error"); return; }
    try {
        await updateDoc(doc(db, 'transacoes', currentBudgetForEdit.id), { limit: newLimit });
        window.showToast("Orçamento atualizado!");
        window.closeEditBudgetModal();
    } catch (e) { window.showToast("Erro", "error"); }
};

window.openGenericConfirm = function (title, message, callback, isDanger = true) {
    document.getElementById('confirmModalTitle').innerText = title;
    document.getElementById('confirmModalText').innerText = message;
    const confirmBtn = document.getElementById('genericConfirmBtn');
    confirmBtn.style.backgroundColor = isDanger ? 'var(--danger)' : 'var(--primary)';
    confirmBtn.onclick = async () => { window.closeGenericConfirmModal(); if (callback) await callback(); };
    document.getElementById('genericConfirmModal').classList.add('active');
};
window.closeGenericConfirmModal = () => document.getElementById('genericConfirmModal').classList.remove('active');

window.deleteTransaction = (id) => window.openGenericConfirm("Excluir Transação", "Deseja excluir esta transação?", async () => await deleteDoc(doc(db, 'transacoes', id)));
window.deleteSystemDoc = async (id, label) => window.openGenericConfirm(`Excluir ${label}`, `Tem certeza?`, async () => await deleteDoc(doc(db, 'transacoes', id)));
window.deleteSelectedTransactions = function () {
    const ids = [...selectedTransactionIds];
    if (ids.length === 0) {
        window.showToast("Selecione pelo menos uma transação.", "error");
        return;
    }

    window.openGenericConfirm(
        "Excluir transações",
        `Tem certeza que deseja excluir ${ids.length} transação${ids.length === 1 ? '' : 'ões'} selecionada${ids.length === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`,
        async () => {
            try {
                await Promise.all(ids.map(id => deleteDoc(doc(db, 'transacoes', id))));
                selectedTransactionIds.clear();
                window.showToast(`${ids.length} transação${ids.length === 1 ? '' : 'ões'} excluída${ids.length === 1 ? '' : 's'} com sucesso!`);
                renderDashboard();
            } catch (error) {
                console.error(error);
                window.showToast("Não foi possível excluir todas as transações selecionadas.", "error");
            }
        }
    );
};

window.logout = function () {
    window.openGenericConfirm("Sair", "Deseja encerrar a sessão?", async () => {
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        signOut(auth).then(() => window.location.href = "/login.html");
    }, false);
};

window.exportPDF = function () {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) return;
    const doc = new jsPDF();
    doc.text("Relatório Financeiro", 14, 20);
    const rows = filteredTransactions.map(t => [formatDateBR(t.date), t.desc, t.category, formatMoney(t.value)]);
    doc.autoTable({ head: [["Data", "Descrição", "Categoria", "Valor"]], body: rows, startY: 30 });
    doc.save("Relatorio.pdf");
};

window.exportCSV = function () {
    let csv = "Data;Descrição;Categoria;Valor\n";
    filteredTransactions.forEach(t => csv += `${t.date};"${t.desc}";${t.category};${t.value}\n`);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Relatorio.csv";
    link.click();
};

window.applyFilter = function () {
    currentStartDate = document.getElementById('startDateFilter').value;
    currentEndDate = document.getElementById('endDateFilter').value;
    window.closeFilterModal();
    renderDashboard();
};

window.clearFilter = function () {
    const today = new Date();
    currentStartDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    currentEndDate = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
    window.closeFilterModal();
    renderDashboard();
};

window.editTransaction = function (id) {
    const item = transactions.find(t => t.id === id);
    if (!item) return;
    editingId = id;
    document.getElementById('modalTitle').innerText = "Editar Transação";
    if (item.type === 'income') document.getElementById('typeIncome').checked = true;
    else if (item.type === 'transfer') document.getElementById('typeTransfer').checked = true;
    else document.getElementById('typeExpense').checked = true;
    updateCategoryDropdowns();
    document.getElementById('descInput').value = item.desc || '';
    document.getElementById('valueInput').value = item.value || '';
    document.getElementById('dateInput').value = item.date || '';
    document.getElementById('dueDateInput').value = item.dueDate || '';
    const paidStatus = document.getElementById('statusPaid');
    const pendingStatus = document.getElementById('statusPending');
    if (paidStatus) paidStatus.checked = item.status !== 'pendente';
    if (pendingStatus) pendingStatus.checked = item.status === 'pendente';
    document.getElementById('categoryInput').value = item.category || 'Transferência';
    document.getElementById('accountInput').value = item.account || 'Nubank';
    if (item.type === 'transfer') {
        document.getElementById('transferFromAccount').value = item.fromAccount || item.account || 'Nubank';
        document.getElementById('transferToAccount').value = item.toAccount || item.account || 'Nubank';
    }
    window.toggleTransferFields();
    document.getElementById('modal').classList.add('active');
};

window.toggleSelectAll = function (master) {
    document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = master.checked; if (master.checked) selectedTransactionIds.add(cb.value); else selectedTransactionIds.delete(cb.value); });
    updateSelectedTransactionsUI();
};

function updateSelectedTransactionsUI() {
    const button = document.getElementById('btnMassDelete');
    const count = document.getElementById('massDeleteCount');
    const selectAll = document.getElementById('selectAllChecks');
    const visibleCheckboxes = [...document.querySelectorAll('.row-checkbox')];
    const selectedVisible = visibleCheckboxes.filter(checkbox => checkbox.checked).length;
    if (button) button.style.display = selectedTransactionIds.size > 0 ? 'inline-flex' : 'none';
    if (count) count.innerText = selectedTransactionIds.size;
    if (selectAll) selectAll.checked = visibleCheckboxes.length > 0 && selectedVisible === visibleCheckboxes.length;
}

document.addEventListener('change', event => {
    if (!event.target.classList.contains('row-checkbox')) return;
    if (event.target.checked) selectedTransactionIds.add(event.target.value);
    else selectedTransactionIds.delete(event.target.value);
    updateSelectedTransactionsUI();
});

document.querySelectorAll('input[name="type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        updateCategoryDropdowns();
        const goalContainer = document.getElementById('goalAllocationContainer');
        if (goalContainer) {
            goalContainer.style.display = e.target.value === 'income' ? 'block' : 'none';
        }
        window.toggleTransferFields();
    });
});

// ================= SISTEMA DE ALERTAS E NOTIFICAÇÕES NO TELEFONE =================
const dueNotificationBody = "Tá esquecendo de pagar nada não? 👀";
const dueNotificationOffsets = [7, 5, 3, 0];
const dueNotificationStorageKey = 'kaizenScheduledDueNotifications';
const dueNotificationMessages = {
    7: "Sua conta vence em 7 dias. Já conferiu? 👀",
    5: "Faltam 5 dias para sua conta vencer. Não deixe para depois!",
    3: "Sua conta vence em 3 dias. Se organize para evitar atrasos.",
    0: dueNotificationBody
};

function getNativeNotifications() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
}

function getDueNotificationId(transactionId, offset) {
    let hash = 2166136261;
    for (const character of `${transactionId}:${offset}`) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) || 1;
}

function getNotificationDate(dueDate, daysBefore) {
    const [year, month, day] = dueDate.split('-').map(Number);
    const notificationDate = new Date(year, month - 1, day - daysBefore, 9, 0, 0, 0);
    return notificationDate;
}

async function schedulePendingDueNotifications() {
    const nativeNotifications = getNativeNotifications();
    if (!nativeNotifications) return;

    const permission = await nativeNotifications.checkPermissions();
    if (permission.display !== 'granted') return;

    const pendingExpenses = transactions.filter(transaction =>
        transaction.type === 'expense' &&
        transaction.status === 'pendente' &&
        typeof transaction.dueDate === 'string' &&
        transaction.dueDate
    );
    const now = new Date();
    const notifications = [];
    const notificationIds = [];

    pendingExpenses.forEach(transaction => {
        dueNotificationOffsets.forEach(daysBefore => {
            const at = getNotificationDate(transaction.dueDate, daysBefore);
            const id = getDueNotificationId(transaction.id, daysBefore);
            if (at > now) {
                notifications.push({
                    id,
                    title: "Lembrete de pagamento",
                    body: dueNotificationMessages[daysBefore],
                    schedule: { at }
                });
                notificationIds.push(id);
            }
        });
    });

    const previousIds = JSON.parse(localStorage.getItem(dueNotificationStorageKey) || '[]');
    if (previousIds.length > 0) {
        await nativeNotifications.cancel({
            notifications: previousIds.map(id => ({ id }))
        });
    }
    if (notifications.length > 0) {
        await nativeNotifications.schedule({ notifications });
    }
    localStorage.setItem(dueNotificationStorageKey, JSON.stringify(notificationIds));
}

window.requestNotificationPermission = async function() {
    const oneSignal = getOneSignal();
    if (oneSignal) {
        const granted = oneSignal.Notifications
            ? await oneSignal.Notifications.requestPermission(true)
            : (await oneSignal.requestPermission({ fallbackToSettings: true })).permission;
        if (granted) {
            await schedulePendingDueNotifications();
            window.showToast("Notificações ativadas e dispositivo registrado.", "success");
        } else {
            window.showToast("Permissão para notificações não concedida.", "error");
        }
        return;
    }

    const nativeNotifications = getNativeNotifications();
    if (nativeNotifications) {
        const permission = await nativeNotifications.requestPermissions();
        if (permission.display === 'granted') {
            await schedulePendingDueNotifications();
            window.showToast("Notificações ativadas e lembretes agendados.", "success");
        } else {
            window.showToast("Permissão para notificações nativas não concedida.", "error");
        }
        return;
    }

    if (!("Notification" in window)) {
        window.showToast("Este navegador não suporta notificações no dispositivo.", "error");
        return;
    }

    if (Notification.permission === "granted") {
        window.showToast("As notificações já estão ativadas!");
    } else if (Notification.permission !== "denied") {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            window.showToast("Notificações ativadas. Os lembretes futuros funcionam no app Android.", "success");
        }
    }
};

function sendMobileNotification(title, bodyText) {
    const nativeNotifications = getNativeNotifications();
    if (nativeNotifications) {
        nativeNotifications.schedule({
            notifications: [{
                id: Math.floor(Date.now() % 2147483647),
                title,
                body: bodyText,
                schedule: { at: new Date(Date.now() + 1000) }
            }]
        }).catch(error => console.error("Erro ao agendar notificação nativa:", error));
        return;
    }

    if ("Notification" in window && Notification.permission === "granted") {
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(title, {
                        body: bodyText,
                        icon: '/icons/icon-192x192.png',
                        badge: '/icons/icon-192x192.png',
                        vibrate: [200, 100, 200]
                    });
                });
            } else {
                new Notification(title, { body: bodyText, icon: '/icons/icon-192x192.png' });
            }
        } catch (e) {
            console.error("Erro ao enviar notificação push:", e);
        }
    }
}

function positionAlertsDropdown() {
    const bell = document.querySelector('.notification-bell');
    const alertsContainer = document.getElementById('alertsDropdown');
    if (!bell || !alertsContainer || !alertsContainer.classList.contains('active')) return;

    const bellRect = bell.getBoundingClientRect();
    const horizontalMargin = 12;
    const dropdownWidth = Math.min(280, window.innerWidth - horizontalMargin * 2);
    const right = Math.max(horizontalMargin, window.innerWidth - bellRect.right);

    alertsContainer.style.width = `${dropdownWidth}px`;
    alertsContainer.style.top = `${bellRect.bottom + 8}px`;
    alertsContainer.style.right = `${right}px`;
    alertsContainer.style.left = 'auto';
}

window.toggleAlerts = function () {
    const bell = document.querySelector('.notification-bell');
    const alertsContainer = document.getElementById('alertsDropdown');
    if (!bell || !alertsContainer) return;

    if (alertsContainer.parentElement !== document.body) {
        document.body.appendChild(alertsContainer);
    }

    alertsContainer.classList.toggle('active');
    positionAlertsDropdown();
};

window.addEventListener('resize', positionAlertsDropdown);
window.addEventListener('scroll', positionAlertsDropdown, true);

function checkAlerts() {
    const alertsContainer = document.getElementById('alertsDropdown');
    const badge = document.getElementById('alertBadge');
    if(!alertsContainer || !badge) return;

    alertsContainer.innerHTML = '';
    let alertCount = 0;
    const today = new Date();
    today.setHours(0,0,0,0);

    transactions.forEach(t => {
        if(t.status === 'pendente' && t.dueDate) {
            const due = new Date(t.dueDate + 'T00:00:00');
            const diffTime = due - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let alertHtml = '';
            if(diffDays < 0) {
                alertHtml = `<div class="alert-item alert-danger"><strong>Atrasado: ${t.desc}</strong> Venceu há ${Math.abs(diffDays)} dias. R$ ${t.value}</div>`;
                alertCount++;
            } else if (diffDays <= 3) {
                alertHtml = `<div class="alert-item alert-warning"><strong>Vence em breve: ${t.desc}</strong> Em ${diffDays} dias. R$ ${t.value}</div>`;
                alertCount++;
            }
            alertsContainer.innerHTML += alertHtml;
        }
    });

    if(alertCount > 0) {
        badge.style.display = 'block'; 
        badge.innerText = alertCount;
    } else {
        badge.style.display = 'none';
        alertsContainer.innerHTML = '<div class="alert-item text-center" style="padding:10px; color:var(--text-light)">Nenhum alerta pendente.</div>';
    }
}

// ================= GAMIFICAÇÃO & INSIGHTS =================
function checkGamificationAndInsights() {
    const insightsList = document.getElementById('aiInsightsList');
    const badgesList = document.getElementById('badgesList');
    if(!insightsList || !badgesList) return;

    let totalIncome = 0;
    let totalExpense = 0;
    let categoryMap = {};

    transactions.forEach(t => {
        const val = parseFloat(t.value || t.amount || 0);
        if(t.type === 'income' || t.type === 'entrada') totalIncome += val;
        if(t.type === 'expense' || t.type === 'saida') {
            totalExpense += val;
            categoryMap[t.category] = (categoryMap[t.category] || 0) + val;
        }
    });

    insightsList.innerHTML = '';
    
    if(totalExpense > totalIncome && totalIncome > 0) {
        insightsList.innerHTML += `<div style="padding:10px; background:rgba(239, 68, 68, 0.1); border-left:4px solid #ef4444; border-radius:4px; color:var(--text-main);">⚠️ <strong>Cuidado:</strong> Seus gastos ultrapassaram suas receitas neste período.</div>`;
    } else if (totalIncome > totalExpense) {
        insightsList.innerHTML += `<div style="padding:10px; background:rgba(16, 185, 129, 0.1); border-left:4px solid #10b981; border-radius:4px; color:var(--text-main);">📈 <strong>Excelente:</strong> Você manteve suas contas no verde!</div>`;
    }

    const assinaturas = (categoryMap['Internet'] || 0) + (categoryMap['Telefone'] || 0);
    if(assinaturas > 0) {
        insightsList.innerHTML += `<div style="padding:10px; background:rgba(59, 130, 246, 0.1); border-left:4px solid #3b82f6; border-radius:4px; color:var(--text-main);">🔄 Comprometimento fixo com serviços (Internet/Telefone): R$ ${assinaturas.toFixed(2)}.</div>`;
    }

    badgesList.innerHTML = '';
    const addBadge = (icon, title, desc, color) => {
        badgesList.innerHTML += `
            <div style="background:var(--surface); border:1px solid var(--surface-border); padding:15px; border-radius:12px; text-align:center; width:140px;">
                <i class="${icon}" style="font-size:2rem; color:${color}; margin-bottom:10px;"></i>
                <h4 style="font-size:0.9rem; margin-bottom:5px;">${title}</h4>
                <p style="font-size:0.7rem; color:var(--text-light);">${desc}</p>
            </div>`;
    };

    if(transactions.length > 0) addBadge('fas fa-seedling', 'Iniciante', 'Fez o primeiro registro', '#10b981');
    if(totalIncome > totalExpense && totalExpense > 0) addBadge('fas fa-shield-alt', 'No Azul', 'Gastou menos do que ganhou', '#3b82f6');
    if(investments && investments.length > 0) addBadge('fas fa-chart-line', 'Investidor', 'Possui ativos cadastrados', '#f59e0b');
}

// ================= CARTÕES DE CRÉDITO =================
window.openCreditCardModal = () => document.getElementById('creditCardModal').classList.add('active');

window.saveCreditCard = async function() {
    const name = document.getElementById('ccNameInput').value.trim();
    const limit = parseFloat(document.getElementById('ccLimitInput').value);
    const closeDay = parseInt(document.getElementById('ccCloseDay').value);
    const dueDay = parseInt(document.getElementById('ccDueDay').value);

    if (!name || isNaN(limit)) {
        window.showToast("Preencha os dados corretamente.", "error"); return;
    }

    try {
        await addDoc(transactionsCol, {
            userId: currentUser.uid, type: 'creditCard',
            name, limit, closeDay, dueDay,
            date: new Date().toISOString().split('T')[0]
        });
        
        const accountSelect = document.getElementById('accountInput');
        if (accountSelect && ![...accountSelect.options].some(opt => opt.value === name)) {
            accountSelect.innerHTML += `<option value="${name}">${name} (Cartão)</option>`;
        }
        
        window.showToast("Cartão adicionado com sucesso!");
        document.getElementById('creditCardModal').classList.remove('active');
        document.getElementById('creditCardForm').reset();
    } catch (e) {
        window.showToast("Erro ao salvar cartão.", "error");
    }
}

function renderCreditCards() {
    const list = document.getElementById('creditCardsList');
    if(!list) return;
    list.innerHTML = '';

    if (creditCards.length === 0) {
        list.innerHTML = '<div style="font-size:0.9rem; padding:15px;">Nenhum cartão cadastrado.</div>';
        return;
    }

    creditCards.forEach(card => {
        const cardExpenses = transactions.filter(t => t.account === card.name && (t.type === 'expense' || t.type === 'saida') && t.status === 'pendente');
        const invoiceTotal = cardExpenses.reduce((acc, curr) => acc + parseFloat(curr.value || curr.amount || 0), 0);
        const limitAvailable = card.limit - invoiceTotal;

        list.innerHTML += `
            <div class="card" style="background: linear-gradient(135deg, #1e293b, #0f172a); color: white; border-radius: 16px; padding: 20px;">
                <div style="display: flex; justify-content: space-between;">
                    <h3 style="margin-bottom: 5px; color: white;">${card.name}</h3>
                    <button class="btn-icon text-danger" onclick="window.deleteSystemDoc('${card.id}', 'Cartão')" style="color:#ef4444;"><i class="fas fa-trash"></i></button>
                </div>
                <p style="font-size: 0.8rem; color: #94a3b8;">Fecha dia ${card.closeDay} • Vence dia ${card.dueDay}</p>
                <div style="margin-top: 20px;">
                    <p style="font-size: 0.85rem; color: #cbd5e1; margin-bottom:5px;">Fatura Atual</p>
                    <h2 style="color: #ef4444; font-size:1.8rem; margin:0;">${invoiceTotal.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</h2>
                </div>
                <div style="margin-top: 20px; font-size: 0.85rem; display: flex; justify-content: space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;">
                    <span style="color:#cbd5e1;">Limite Disp: <strong style="color:#10b981;">${limitAvailable.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</strong></span>
                </div>
            </div>
        `;
    });
}

// ================= LEITURA DE QR CODE (CAPACITOR) =================
window.scanReceiptQR = async function() {
    const scanner = window.Capacitor?.Plugins?.BarcodeScanner;
    if(scanner) {
        try {
            await scanner.checkPermission({ force: true });
            
            const modal = document.getElementById('modal');
            if (modal) modal.style.opacity = '0';
            document.body.style.background = 'transparent';
            document.documentElement.style.background = 'transparent';

            const result = await scanner.startScan();
            
            if (modal) modal.style.opacity = '1';
            document.body.style.background = '';
            document.documentElement.style.background = '';

            if(result.hasContent) {
                window.showToast("QR Code da Nota lido com sucesso!");
                document.getElementById('descInput').value = "Nota Fiscal Escaneada";
            }
        } catch(e) { 
            const modal = document.getElementById('modal');
            if (modal) modal.style.opacity = '1';
            document.body.style.background = '';
            document.documentElement.style.background = '';
            
            window.showToast("Câmera indisponível ou leitura cancelada.", "error"); 
        }
    } else {
        window.showToast("O leitor de QR Code funciona apenas no App Android.", "error");
    }
};

// ================= INVESTIMENTOS AVANÇADOS (COTAÇÕES REAIS E DIVIDENDOS) =================
window.updateStockQuotes = async function() {
    window.showToast("Buscando cotações no mercado...");
    try {
        let updatedCount = 0;
        const token = 'CBRAPI_TOKEN=mVf8q6adWy9RSbSJbyVHLx'; 

        for (let inv of investments) {
            if (inv.class === 'Ações' || inv.class === 'Fundos Imobiliários' || inv.class === 'FIIs') {
                const ticker = inv.name.trim().toUpperCase();
                try {
                    const response = await fetch(`https://brapi.dev/api/quote/${ticker}?token=${token}`);
                    const data = await response.json();
                    if (data.results && data.results.length > 0) {
                        const newPrice = data.results[0].regularMarketPrice;
                        if (newPrice) {
                            await updateDoc(doc(db, 'transacoes', inv.id), { 
                                currentVal: newPrice * parseFloat(inv.qty) 
                            });
                            updatedCount++;
                        }
                    }
                } catch (apiError) { console.error(`Falha ao consultar ${ticker}:`, apiError); }
            }
        }
        
        if (updatedCount > 0) window.showToast(`${updatedCount} ativos sincronizados com a B3!`);
        else window.showToast("Nenhum ativo atualizado. Verifique se usou os códigos corretos (ex: PETR4).", "error");
    } catch(e) { console.error(e); window.showToast("Erro na sincronização de preços.", "error"); }
};

window.openDividendModal = function() {
    const select = document.getElementById('divAssetInput');
    if(select) {
        select.innerHTML = '<option value="">Selecione o ativo...</option>';
        investments.forEach(inv => select.innerHTML += `<option value="${inv.name}">${inv.name}</option>`);
    }
    document.getElementById('dividendModal').classList.add('active');
};

window.closeDividendModal = () => document.getElementById('dividendModal').classList.remove('active');

window.saveDividend = async function() {
    const asset = document.getElementById('divAssetInput').value;
    const value = parseFloat(document.getElementById('divValueInput').value);
    const account = document.getElementById('divAccountInput').value;

    if(!asset || isNaN(value)) return;
    try {
        await addDoc(transactionsCol, {
            userId: currentUser.uid, type: 'income', desc: `Dividendos/Rendimentos - ${asset}`, value: value,
            category: 'Rendimentos', account: account, date: new Date().toISOString().split('T')[0], status: 'pago'
        });
        window.showToast("Dividendo recebido e lançado na conta!");
        window.closeDividendModal();
        document.getElementById('dividendForm').reset();
    } catch (e) { window.showToast("Erro ao lançar dividendo.", "error"); }
};
window.openDeleteAccountModal = function() {
    const input = document.getElementById('deleteAccountConfirmInput');
    if(input) input.value = '';
    document.getElementById('deleteAccountModal').classList.add('active');
};

window.closeDeleteAccountModal = function() {
    document.getElementById('deleteAccountModal').classList.remove('active');
};
window.processAccountDeletion = async function() {
    // Agora converte tudo para maiúsculas automaticamente
    const confirmText = document.getElementById('deleteAccountConfirmInput').value.trim().toUpperCase(); 
    
    if (confirmText !== 'EXCLUIR') {
        window.showToast('Escreva "EXCLUIR" para confirmar.', 'error');
        return;
    }

    const btn = document.getElementById('btnConfirmDeleteAccount');
    btn.innerText = 'A apagar...';
    btn.disabled = true;

    try {
        const q = query(transactionsCol, where("userId", "==", currentUser.uid));
        const querySnapshot = await getDocs(q);
        
        const deletePromises = [];
        querySnapshot.forEach((docSnap) => {
            deletePromises.push(deleteDoc(doc(db, 'transacoes', docSnap.id)));
        });
        await Promise.all(deletePromises); 

        await deleteDoc(doc(db, 'usuarios', currentUser.uid));
        await deleteUser(currentUser);

        window.showToast('Conta e dados excluídos com sucesso.', 'success');
    } catch (error) {
        console.error("Erro na exclusão:", error);
        if (error.code === 'auth/requires-recent-login') {
            window.showToast('Por segurança, faça logout e inicie sessão novamente antes de excluir a conta.', 'error');
        } else {
            window.showToast('Erro ao excluir conta. Tente novamente.', 'error');
        }
        btn.innerText = 'Apagar Tudo';
        btn.disabled = false;
    }
};
// ================= ASSISTENTE FINANCEIRO COM GROQ (LLAMA 3) =================
const GROQ_API_KEY = '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'; // Insira aqui a sua chave do Groq Console

window.openAIAssistantModal = function() {
    document.getElementById('aiAssistantModal').classList.add('active');
    const chatMessages = document.getElementById('aiChatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
};

window.closeAIAssistantModal = function() {
    document.getElementById('aiAssistantModal').classList.remove('active');
};

window.sendAIMessage = async function() {
    const input = document.getElementById('aiChatInput');
    const text = input.value.trim();
    if (!text) return;

    if (GROQ_API_KEY === 'SUA_CHAVE_DA_GROQ_AQUI') {
        window.showToast('Configure a sua chave da API da Groq no script.js', 'error');
        return;
    }

    const chatMessages = document.getElementById('aiChatMessages');
    
    chatMessages.innerHTML += `
        <div style="background: var(--primary); color: white; padding: 12px 16px; border-radius: 12px; max-width: 85%; align-self: flex-end; font-size: 0.9rem; word-break: break-word;">
            ${text}
        </div>
    `;
    input.value = '';
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const typingId = 'typing-' + Date.now();
    chatMessages.innerHTML += `
        <div id="${typingId}" style="background: var(--surface); padding: 10px 14px; border-radius: 12px; border: 1px solid var(--surface-border); max-width: 60px; align-self: flex-start; font-size: 0.9rem; color: var(--text-light);">
            <i class="fas fa-circle-notch fa-spin"></i>
        </div>
    `;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        let totalIncome = 0;
        let totalExpense = 0;
        let categorySummary = {};

        transactions.forEach(t => {
            const val = parseFloat(t.value || t.amount || 0);
            if (t.status === 'pago' || !t.status) {
                if (t.type === 'income' || t.type === 'entrada') totalIncome += val;
                if (t.type === 'expense' || t.type === 'saida') {
                    totalExpense += val;
                    categorySummary[t.category] = (categorySummary[t.category] || 0) + val;
                }
            }
        });

        const nameInput = document.getElementById('usernameInput');
        const userName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : "Utilizador";

        const financialContext = `
            Contexto financeiro atual:
            - Nome do utilizador: ${userName}
            - Receitas totais: R$ ${totalIncome.toFixed(2)}
            - Despesas totais: R$ ${totalExpense.toFixed(2)}
            - Saldo atual: R$ ${(totalIncome - totalExpense).toFixed(2)}
            - Gastos por categoria: ${JSON.stringify(categorySummary)}
        `;

        const systemPrompt = `
            És o Kaizen IA, um assistente financeiro pessoal inteligente e amigável. O utilizador chama-se ${userName}.
            Podes responder normalmente às dúvidas financeiras ou, se o utilizador quiser registar uma despesa ou entrada (ex: "gastei 50 em mercado" ou "recebi 1000 de salário"), deves extrair os dados e responder estritamente num formato JSON especial no início da tua resposta, seguido de uma mensagem amigável:
            
            Formato JSON para transação (se aplicável):
            {"action": "add_transaction", "type": "expense" ou "income", "desc": "descrição", "value": valor_numerico, "category": "categoria"}
            
            Se não for pedido para criar transação, responde apenas em texto normal em português.
        `;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `${financialContext}\n\nMensagem: ${text}` }
                ],
                temperature: 0.5,
                max_tokens: 500
            })
        });

        const data = await response.json();
        document.getElementById(typingId)?.remove();

        let aiReply = "Desculpa, ocorreu um erro ao processar a tua resposta.";
        if (data.choices && data.choices[0] && data.choices[0].message) {
            aiReply = data.choices[0].message.content;
            
            // Tenta detetar se a IA gerou um JSON de ação de transação
            try {
                const jsonMatch = aiReply.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsedAction = JSON.parse(jsonMatch[0]);
                    if (parsedAction.action === "add_transaction") {
                        // Grava automaticamente no Firestore
                        await addDoc(transactionsCol, {
                            userId: currentUser.uid,
                            type: parsedAction.type,
                            status: 'pago',
                            desc: parsedAction.desc,
                            value: parseFloat(parsedAction.value),
                            category: parsedAction.category || 'Outros',
                            date: new Date().toISOString().split('T')[0],
                            account: 'Nubank'
                        });
                        window.showToast("Transação criada pela IA com sucesso!");
                        aiReply = aiReply.replace(jsonMatch[0], '').trim();
                        aiReply = `✅ Registei isto para ti! ${aiReply}`;
                    }
                }
            } catch (e) {
                console.error("Erro ao interpretar ação da IA:", e);
            }
        }

        chatMessages.innerHTML += `
            <div style="background: var(--surface); padding: 12px 16px; border-radius: 12px; border: 1px solid var(--surface-border); max-width: 85%; align-self: flex-start; font-size: 0.9rem; color: var(--text-main);">
                ${aiReply}
            </div>
        `;
        chatMessages.scrollTop = chatMessages.scrollHeight;

    } catch (error) {
        console.error("Erro na API da Groq:", error);
        document.getElementById(typingId)?.remove();
        window.showToast("Erro de ligação com a IA.", "error");
    }
};