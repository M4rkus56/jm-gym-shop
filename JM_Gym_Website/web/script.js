let cart = []; let total = 0; let discountApplied = false; let stripe, elements;
let isRegisterMode = false;

const cartSidebar = document.getElementById('cart-sidebar');
const cartItemsContainer = document.getElementById('cart-items');
const cartTotalElement = document.getElementById('cart-total');
const cartCountElement = document.querySelector('.cart-count');
const checkoutModal = document.getElementById('checkout-modal');
const loginModal = document.getElementById('login-modal');

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
    const response = await fetch("/config");
    const { stripePublishableKey } = await response.json();
    stripe = Stripe(stripePublishableKey);
    checkLoginStatus();
    if(!sessionStorage.getItem('popupClosed')) setTimeout(() => document.getElementById('promo-popup').classList.add('show'), 2500);
});

// --- NEUE AUTH LOGIK (Tabs) ---
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authBtn = document.getElementById('auth-action-btn');

tabLogin.addEventListener('click', () => {
    isRegisterMode = false;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    authBtn.innerText = "Einloggen";
});

tabRegister.addEventListener('click', () => {
    isRegisterMode = true;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    authBtn.innerText = "Registrieren";
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const endpoint = isRegisterMode ? "/register" : "/login";
    
    try {
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        
        if (res.ok) {
            if (isRegisterMode) { 
                alert("Account erstellt! Bitte jetzt einloggen."); 
                tabLogin.click(); // Wechsel zum Login Tab
            } else { 
                localStorage.setItem('token', data.token); 
                localStorage.setItem('user', data.email); 
                alert("Willkommen zurück!"); 
                loginModal.style.display = 'none'; 
                checkLoginStatus(); 
            }
        } else { alert(data.message); }
    } catch (err) { alert("Server Fehler"); }
});

function checkLoginStatus() {
    const token = localStorage.getItem('token');
    const icon = document.getElementById('login-btn-trigger');
    if (token) {
        icon.style.color = "#00ff88"; icon.title = "Eingeloggt: " + localStorage.getItem('user');
        icon.onclick = () => { if(confirm("Ausloggen?")) { localStorage.clear(); location.reload(); } };
    } else {
        icon.style.color = "white"; icon.onclick = () => loginModal.style.display = 'flex';
    }
}

// Schließen
document.getElementById('close-login').addEventListener('click', () => loginModal.style.display = 'none');
document.getElementById('close-checkout').addEventListener('click', () => checkoutModal.style.display = 'none');
document.getElementById('close-popup').addEventListener('click', () => { document.getElementById('promo-popup').classList.remove('show'); sessionStorage.setItem('popupClosed', 'true'); });

// --- SHOP ---
function addToCart(n, p) { cart.push({name:n, price:p}); updateCartDisplay(); cartSidebar.classList.add('open'); }
function removeFromCart(i) { cart.splice(i, 1); updateCartDisplay(); }
function updateCartDisplay() {
    cartItemsContainer.innerHTML = ''; total = 0;
    if(cart.length === 0) cartItemsContainer.innerHTML = '<p>Leer.</p>';
    else cart.forEach((item, i) => {
        total += item.price;
        cartItemsContainer.innerHTML += `<div><span>${item.name}</span> <span>${item.price}€</span> <span onclick="removeFromCart(${i})" style="color:red;cursor:pointer">X</span></div>`;
    });
    if (discountApplied) total *= 0.9;
    cartTotalElement.innerText = total.toFixed(2) + ' €'; cartCountElement.innerText = cart.length;
}
document.getElementById('cart-btn').addEventListener('click', () => cartSidebar.classList.add('open'));
document.getElementById('close-cart').addEventListener('click', () => cartSidebar.classList.remove('open'));
document.getElementById('apply-discount').addEventListener('click', () => {
    if(document.getElementById('discount-input').value.toUpperCase() === 'JM10' && !discountApplied) { discountApplied = true; updateCartDisplay(); }
});

// --- CHECKOUT ---
document.getElementById('checkout-btn').addEventListener('click', async () => {
    if(cart.length === 0) return alert("Leer!");
    cartSidebar.classList.remove('open'); checkoutModal.style.display = 'flex';
    document.getElementById('checkout-total-amount').innerText = total.toFixed(2) + ' €';
    const res = await fetch("/create-payment-intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: total }) });
    const { clientSecret } = await res.json();
    elements = stripe.elements({ clientSecret, appearance: { theme: 'night' } });
    elements.create("payment").mount("#stripe-payment-element");
    
    document.getElementById('paypal-button-container').innerHTML = "";
    paypal.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
        createOrder: (d, a) => fetch("/create-paypal-order", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({amount:total}) }).then(r => r.json()).then(d => d.id),
        onApprove: (d, a) => fetch("/capture-paypal-order", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({orderID: d.orderID}) }).then(r => r.json()).then(() => { alert("Zahlung erfolgreich!"); checkoutModal.style.display = 'none'; cart=[]; updateCartDisplay(); })
    }).render('#paypal-button-container');
});

document.getElementById('checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href } });
    if(error) alert(error.message);
});