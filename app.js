
const SUPABASE_URL = 'https://jtvkxeqjtkwrkwvpgafx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0dmt4ZXFqdGt3cmt3dnBnYWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAzMjQyMjcsImV4cCI6MjA3NTkwMDIyN30.8OBj3JOMYqIBY64IHrLe5Gw2oOuztMaYTORcU3EuWuY';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const logoutButton = document.getElementById('logout-button');
const showSignup = document.getElementById('show-signup');
const showLogin = document.getElementById('show-login');
const loginContainer = document.getElementById('login-container');
const signupContainer = document.getElementById('signup-container');
const userInfo = document.getElementById('user-info');
const addCustomerForm = document.getElementById('add-customer-form');
const customerList = document.getElementById('customer-list');
const navLinksContainer = document.getElementById('nav-links-container');

const showDashboard = (user) => {
    authSection.style.display = 'none';
    dashboardSection.style.display = 'block';
    userInfo.innerHTML = `Logged in as: <strong>${user.email}</strong>`;
};

const showAuth = () => {
    authSection.style.display = 'block';
    dashboardSection.style.display = 'none';
    loginContainer.style.display = 'none';
    signupContainer.style.display = 'block';
    if (navLinksContainer) navLinksContainer.style.display = 'none';
};

const checkUserSession = async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    
    if (session) {
        showDashboard(session.user);
        
        const customerProfile = JSON.parse(localStorage.getItem('customerProfile'));
        
        if (customerProfile && customerProfile.payment_status === 'paid') {
            if (navLinksContainer) navLinksContainer.style.display = 'block';
        } else {
            if (navLinksContainer) navLinksContainer.style.display = 'none';
        }
        
        fetchCustomers();

    } else {
        showAuth();
    }
};

async function handleAuth(event, endpoint) {
    event.preventDefault();
    const form = event.target;
    const email = form.querySelector('input[type="email"]').value;
    const password = form.querySelector('input[type="password"]').value;
    
    let body = { email, password };

    if (endpoint === '/api/signup') {
        const planInput = form.querySelector('input[name="subscription_plan"]:checked');
        if (!planInput) {
            alert('Sila pilih pelan langganan.');
            return;
        }
        body.subscription_plan = planInput.value;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        if (endpoint === '/api/signin') {
            const { error } = await _supabase.auth.setSession(data.session);
            if (error) throw error;

            if (data.customer) {
                localStorage.setItem('customerProfile', JSON.stringify(data.customer));
            } else {
                localStorage.removeItem('customerProfile');
            }
            
            checkUserSession();

        } else { 
            if (data.paymentUrl) {
                alert('Pendaftaran berjaya! Anda akan dibawa ke laman pembayaran.');
                window.location.href = data.paymentUrl;
            } else {
                alert('Pendaftaran berjaya! Sila semak email anda untuk pengesahan.');
                signupContainer.style.display = 'none';
                loginContainer.style.display = 'block';
            }
        }
    } catch (error) {
        alert(`Ralat: ${error.message}`);
    }
    form.reset();
}

async function handleSignOut() {
    await _supabase.auth.signOut();
    localStorage.removeItem('customerProfile');
    checkUserSession();
}

async function fetchCustomers() {
    const response = await fetch('/api/customers');
    const customers = await response.json();
    customerList.innerHTML = customers.length ? '' : '<p>Tiada data pelanggan.</p>';
    customers.forEach(customer => {
        const el = document.createElement('div');
        el.classList.add('customer-item');
        el.innerHTML = `<div><strong>${customer.name || customer.email}</strong><br><small>${customer.subscription_plan || ''}</small></div><button class="delete-button" data-id="${customer.id}">Padam</button>`;
        customerList.appendChild(el);
    });
}

async function handleAddCustomer(event) {
    event.preventDefault();
    const name = document.getElementById('customer-name').value;
    const email = document.getElementById('customer-email').value;
    const phone = document.getElementById('customer-phone').value;
    await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone })
    });
    fetchCustomers();
    addCustomerForm.reset();
}

async function handleDeleteCustomer(event) {
    if (!event.target.classList.contains('delete-button')) return;
    if (confirm('Padam pelanggan ini?')) {
        await fetch(`/api/customers/${event.target.dataset.id}`, { method: 'DELETE' });
        fetchCustomers();
    }
}

showSignup.addEventListener('click', (e) => { e.preventDefault(); loginContainer.style.display = 'none'; signupContainer.style.display = 'block'; });
showLogin.addEventListener('click', (e) => { e.preventDefault(); signupContainer.style.display = 'none'; loginContainer.style.display = 'block'; });

loginForm.addEventListener('submit', (e) => handleAuth(e, '/api/signin'));
signupForm.addEventListener('submit', (e) => handleAuth(e, '/api/signup'));
logoutButton.addEventListener('click', handleSignOut);
addCustomerForm.addEventListener('submit', handleAddCustomer);
customerList.addEventListener('click', handleDeleteCustomer);

document.addEventListener('DOMContentLoaded', checkUserSession);
